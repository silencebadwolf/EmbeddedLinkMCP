import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SessionManager } from '@/core/session/session-manager.js';
import { ControlProfileManager } from '@/core/workspace/index.js';
import { createMcpServer } from '@/mcp/index.js';
import type { LinkTermMcpServer } from '@/mcp/server.js';
import { SerialDiscovery } from '@/transports/serial/serial-discovery.js';
import { FakeJLinkBackend } from '../../fixtures/fake-jlink-backend.js';
import { createInMemoryMcpTransportPair } from '../../fixtures/mock-mcp-transport.js';

interface Harness {
  manager: SessionManager;
  serialDiscovery: SerialDiscovery;
  controlProfileManager: ControlProfileManager;
  mcp: LinkTermMcpServer;
  client: Client;
  root: string;
}

async function setup(): Promise<Harness> {
  const root = await mkdtemp(path.join(tmpdir(), 'lt-evidence-kind-'));
  const manager = new SessionManager();
  const serialDiscovery = new SerialDiscovery({ listFn: async () => [] });
  const controlProfileManager = new ControlProfileManager();
  const { server: serverTransport, client: clientTransport } = createInMemoryMcpTransportPair();
  const mcp = createMcpServer({
    sessionManager: manager,
    serialDiscovery,
    controlProfileManager,
    jlinkBackend: new FakeJLinkBackend(),
    getActiveWindow: () => ({
      isDestroyed: () => false,
      webContents: {
        capturePage: async () => ({
          toPNG: () => Buffer.from([0x89, 0x50, 0x4e, 0x47]),
          getSize: () => ({ width: 2, height: 2 }),
        }),
      },
    }),
    transportFactory: () => serverTransport,
  });
  await mcp.start();
  const client = new Client({ name: 'lt-evidence-kind-test', version: '0.0.0' });
  await client.connect(clientTransport);
  return { manager, serialDiscovery, controlProfileManager, mcp, client, root };
}

async function teardown(h: Harness): Promise<void> {
  try {
    await h.client.close();
  } catch {
    /* ignore */
  }
  await h.mcp.stop();
  await h.manager.destroyAll();
  h.serialDiscovery.dispose();
  await rm(h.root, { recursive: true, force: true });
}

async function callTool(client: Client, name: string, args: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
  const res = await client.callTool({ name, arguments: args });
  expect(res.structuredContent).toBeDefined();
  return res.structuredContent as Record<string, unknown>;
}

function evidenceKind(out: Record<string, unknown>): string | undefined {
  return (out.evidence as { kind?: string } | undefined)?.kind;
}

describe('MCP evidence kind isolation', () => {
  let h: Harness;

  beforeEach(async () => {
    h = await setup();
  });

  afterEach(async () => {
    await teardown(h);
  });

  it('keeps terminal, debug, workflow, status/runbook, and UI evidence kinds distinct', async () => {
    await writeFile(path.join(h.root, 'firmware.bin'), Buffer.from([1, 2, 3, 4]));
    await callTool(h.client, 'init_control_profile', {
      root: h.root,
      profile: {
        serial: { enabled: true, port: 'COM7', baudRate: 115200, mode: 'terminal' },
        jlink: { enabled: true, target: 'AT32F435RGT7', interface: 'swd', speedKHz: 'auto' },
        flash: { binary: 'firmware.bin', baseAddress: '0x08008000', verify: true },
      },
    });

    const terminal = await callTool(h.client, 'list_sessions');
    const debug = await callTool(h.client, 'probe_detect');
    const workflow = await callTool(h.client, 'run_control_workflow', {
      root: h.root,
      mode: 'flash-observe',
      dryRun: true,
    });
    const runbook = await callTool(h.client, 'get_agent_runbook', { root: h.root });
    const appStatus = await callTool(h.client, 'get_app_status', { root: h.root });
    const screenshot = await callTool(h.client, 'ui_screenshot');

    expect(evidenceKind(terminal)).toBe('terminal_output');
    expect(evidenceKind(debug)).toBe('debug_output');
    expect(evidenceKind(workflow)).toBe('debug_output');
    expect(evidenceKind(runbook)).toBe('agent_runbook');
    expect(evidenceKind(appStatus)).toBe('app_status');
    expect(evidenceKind(screenshot)).toBe('ui_screenshot');
  });
});
