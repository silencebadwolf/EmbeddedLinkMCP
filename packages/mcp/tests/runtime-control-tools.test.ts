import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SessionManager } from '@linkterm/runtime/core/session/session-manager';
import { createMcpServer } from '@linkterm/mcp/index';
import type { LinkTermMcpServer } from '@linkterm/mcp/server';
import { SerialDiscovery } from '@linkterm/runtime/transports/serial/serial-discovery';
import { createInMemoryMcpTransportPair } from '../../../tests/fixtures/mock-mcp-transport.js';

interface RestartRequest {
  delayMs: number;
  requestedAt: string;
  reason: string;
}

interface Harness {
  manager: SessionManager;
  serialDiscovery: SerialDiscovery;
  mcp: LinkTermMcpServer;
  client: Client;
  restartRequests: RestartRequest[];
}

async function setup(): Promise<Harness> {
  const manager = new SessionManager();
  const serialDiscovery = new SerialDiscovery({ listFn: async () => [] });
  const { server: serverTransport, client: clientTransport } = createInMemoryMcpTransportPair();
  const restartRequests: RestartRequest[] = [];
  const mcp = createMcpServer({
    sessionManager: manager,
    serialDiscovery,
    runtimeDiagnostics: () => ({
      identity: {
        runtimeId: 'stale-runtime-id',
        pid: 21248,
        startedAt: '2026-06-29T12:49:36.000Z',
      },
      transport: { mode: 'http-owner' },
      metadata: { available: true, fresh: true },
      code: {
        fresh: false,
        staleArtifacts: [
          {
            path: 'dist/main/mcp/surfaces/control-workflow/tools.js',
            modifiedAt: '2026-06-29T16:00:20.000Z',
          },
        ],
      },
    }),
    runtimeRestartScheduler: async (request: RestartRequest) => {
      restartRequests.push(request);
      return { scheduled: true, delayMs: request.delayMs, mode: 'test' };
    },
    transportFactory: () => serverTransport,
  });
  await mcp.start();
  const client = new Client({ name: 'lt-runtime-control-test', version: '0.0.0' });
  await client.connect(clientTransport);
  return { manager, serialDiscovery, mcp, client, restartRequests };
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
}

async function callTool(
  client: Client,
  name: string,
  args: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  const res = await client.callTool({ name, arguments: args });
  expect(res.structuredContent).toBeDefined();
  return res.structuredContent as Record<string, unknown>;
}

describe('runtime control MCP tools', () => {
  let h: Harness;

  beforeEach(async () => {
    h = await setup();
  });

  afterEach(async () => {
    await teardown(h);
  });

  it('registers restart_mcp_runtime as a core recovery tool', async () => {
    const tools = await h.client.listTools();

    expect(tools.tools.map((tool) => tool.name)).toContain('restart_mcp_runtime');
  });

  it('schedules a runtime restart without confirmation', async () => {
    const out = await callTool(h.client, 'restart_mcp_runtime');

    expect(out.success).toBe(true);
    expect(h.restartRequests).toHaveLength(1);
  });

  it('ignores confirm:false for runtime restart scheduling', async () => {
    const out = await callTool(h.client, 'restart_mcp_runtime', { confirm: false });

    expect(out.success).toBe(true);
    expect(h.restartRequests).toHaveLength(1);
  });

  it('can schedule a runtime restart while runtime code is stale', async () => {
    const out = await callTool(h.client, 'restart_mcp_runtime', { confirm: true });

    expect(out.success).toBe(true);
    expect(h.restartRequests).toHaveLength(1);
    expect(h.restartRequests[0]).toMatchObject({
      delayMs: 250,
      reason: 'stale-runtime-recovery',
    });
    expect(h.restartRequests[0]!.requestedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(out.evidence).toMatchObject({
      kind: 'app_status',
      data: {
        restartScheduled: true,
        delayMs: 250,
        mode: 'test',
        nextAction: 'Call get_app_status after the runtime restarts before hardware operations.',
      },
      cursor: 0,
    });
  });
});
