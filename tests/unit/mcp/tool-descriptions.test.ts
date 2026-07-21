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

  it('states immediate execution and observation requirements', async () => {
    const tools = await h.client.listTools();
    const descriptions = new Map(tools.tools.map((tool) => [tool.name, tool.description ?? '']));

    for (const name of [
      'flash_download',
      'flash_write',
      'flash_erase',
      'cpu_reset',
      'gdb_server_start',
      'jlink_reboot',
      'jlink_commander_script',
      'run_control_workflow',
    ]) {
      const description = descriptions.get(name) ?? '';
      expect(description, `${name} must mention immediate execution`).toContain('execute immediately');
      expect(description).not.toContain('CONFIRMATION_REQUIRED');
    }
  });

  it('describes background control workflow job recovery tools', async () => {
    const tools = await h.client.listTools();
    const descriptions = new Map(tools.tools.map((tool) => [tool.name, tool.description ?? '']));

    expect(descriptions.get('run_control_workflow')).toContain('background');
    expect(descriptions.get('run_control_workflow')).toContain('current workspace control profile');
    expect(descriptions.get('run_control_workflow')).toContain('omit firmware.filePath');
    expect(descriptions.get('run_control_workflow')).toContain('.bin/.hex/.elf');
    expect(descriptions.get('run_control_workflow')).toContain('ELF loadable segments');
    expect(descriptions.get('run_control_workflow')).toContain(
      'do not override an .elf profile with a .bin path',
    );
    expect(descriptions.get('run_control_workflow')).toContain('get_control_workflow_job_status');
    expect(descriptions.get('run_control_workflow')).toContain('read_control_workflow_job');
    expect(descriptions.get('run_control_workflow')).toContain(
      'host timeout is not proof that the hardware operation failed',
    );
    expect(descriptions.get('run_control_workflow')).toContain('do not retry');
    expect(descriptions.get('cancel_control_workflow_job')).toContain('AbortSignal');
    expect(descriptions.get('cleanup_control_workflow_jobs')).toContain('completed or expired');
  });

  it('describes shared create-or-reuse terminal operation without blind retries', async () => {
    const tools = await h.client.listTools();
    const descriptions = new Map(tools.tools.map((tool) => [tool.name, tool.description ?? '']));

    expect(descriptions.get('list_sessions')).toContain('before opening serial');
    expect(descriptions.get('open_session')).toContain('create or reuse');
    expect(descriptions.get('open_session')).toContain('evidence.data.reused');
    expect(descriptions.get('open_session')).toContain('SERIAL_SESSION_CONFLICT');
    expect(descriptions.get('open_session')).toContain('do not retry blindly');
    expect(descriptions.get('close_session')).toMatch(/human and AI/i);
    expect(descriptions.get('close_session')).toContain('shared');
    expect(descriptions.get('write_to_session')).toContain('host-side acceptance');
    expect(descriptions.get('read_from_session')).toContain('cursor');
    expect(descriptions.get('send_and_wait')).toMatch(/write bytes once/i);
    expect(descriptions.get('send_and_wait')).toContain('does not retry automatically');
    expect(descriptions.get('discover_serial_ports')).toContain(
      'only when neither a compatible active session nor any known configuration',
    );
    expect(descriptions.get('get_session_status')).toContain('reused');
  });

  it('describes read-only status discovery and the detailed operating guide', async () => {
    const tools = await h.client.listTools();
    const descriptions = new Map(tools.tools.map((tool) => [tool.name, tool.description ?? '']));

    expect(descriptions.get('get_app_status')).toContain('read-only discovery');
    expect(descriptions.get('get_app_status')).toContain(
      'does not connect to or mutate hardware',
    );
    expect(descriptions.get('get_agent_runbook')).toContain('operating guide');
  });
});
