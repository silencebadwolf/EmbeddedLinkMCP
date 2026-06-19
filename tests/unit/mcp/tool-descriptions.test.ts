import { afterEach, beforeEach, describe, expect, it } from 'vitest';
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
  mcp: LinkTermMcpServer;
  client: Client;
}

async function setup(): Promise<Harness> {
  const manager = new SessionManager();
  const serialDiscovery = new SerialDiscovery({ listFn: async () => [] });
  const { server: serverTransport, client: clientTransport } = createInMemoryMcpTransportPair();
  const mcp = createMcpServer({
    sessionManager: manager,
    serialDiscovery,
    controlProfileManager: new ControlProfileManager(),
    jlinkBackend: new FakeJLinkBackend(),
    transportFactory: () => serverTransport,
  });
  await mcp.start();
  const client = new Client({ name: 'lt-tool-description-test', version: '0.0.0' });
  await client.connect(clientTransport);
  return { manager, serialDiscovery, mcp, client };
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

describe('high-impact MCP tool descriptions', () => {
  let h: Harness;

  beforeEach(async () => {
    h = await setup();
  });

  afterEach(async () => {
    await teardown(h);
  });

  it('states confirmation requirements and forbids external CLI fallback', async () => {
    const tools = await h.client.listTools();
    const descriptions = new Map(tools.tools.map((tool) => [tool.name, tool.description ?? '']));

    for (const name of [
      'flash_download',
      'flash_write',
      'flash_erase',
      'cpu_reset',
      'gdb_server_start',
      'jlink_commander_script',
      'run_control_workflow',
    ]) {
      const description = descriptions.get(name) ?? '';
      expect(description, `${name} must mention confirm=true`).toContain('confirm=true');
    }
  });

  it('describes background control workflow job recovery tools', async () => {
    const tools = await h.client.listTools();
    const descriptions = new Map(tools.tools.map((tool) => [tool.name, tool.description ?? '']));

    expect(descriptions.get('run_control_workflow')).toContain('background');
    expect(descriptions.get('run_control_workflow')).toContain('current workspace control profile');
    expect(descriptions.get('run_control_workflow')).toContain('omit firmware.filePath');
    expect(descriptions.get('run_control_workflow')).toContain('get_control_workflow_job_status');
    expect(descriptions.get('run_control_workflow')).toContain('read_control_workflow_job');
    expect(descriptions.get('cancel_control_workflow_job')).toContain('AbortSignal');
    expect(descriptions.get('cleanup_control_workflow_jobs')).toContain('completed or expired');
  });
});
