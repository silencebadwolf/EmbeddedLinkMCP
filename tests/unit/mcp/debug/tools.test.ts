/**
 * MCP debug tools — registration & non-binary semantic tests.
 *
 * 覆盖：
 * - 28 工具全注册（用 SDK listTools()）
 * - sensitivity 分类对版本协商的影响（read-only mismatch 警告 vs state-affecting 拒绝）
 * - NO_BACKEND 默认拒绝（不注入 jlinkBackend 时挂 NullJLinkBackend）
 * - probe_connect/status/disconnect 端到端 roundtrip via FakeJLinkBackend
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SessionManager } from '@/core/session/session-manager.js';
import { SerialDiscovery } from '@/transports/serial/serial-discovery.js';
import { createMcpServer } from '@/mcp/index.js';
import type { LinkTermMcpServer } from '@/mcp/server.js';
import { LINKTERM_MCP_SCHEMA_VERSION } from '@/mcp/index.js';
import { createInMemoryMcpTransportPair } from '../../../fixtures/mock-mcp-transport.js';
import { FakeJLinkBackend } from '../../../fixtures/fake-jlink-backend.js';

interface Harness {
  manager: SessionManager;
  serialDiscovery: SerialDiscovery;
  fake?: FakeJLinkBackend;
  mcp: LinkTermMcpServer;
  client: Client;
}

async function setup(opts: { withBackend?: boolean } = {}): Promise<Harness> {
  const manager = new SessionManager();
  const serialDiscovery = new SerialDiscovery({
    listFn: async () => [],
  });
  const fake = opts.withBackend === false ? undefined : new FakeJLinkBackend();
  const { server: serverTransport, client: clientTransport } = createInMemoryMcpTransportPair();
  const mcp = createMcpServer({
    sessionManager: manager,
    serialDiscovery,
    ...(fake !== undefined ? { jlinkBackend: fake } : {}),
    transportFactory: () => serverTransport,
  });
  await mcp.start();
  const client = new Client({ name: 'lt-test-client', version: '0.0.0' });
  await client.connect(clientTransport);
  return { manager, serialDiscovery, ...(fake !== undefined ? { fake } : {}), mcp, client };
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

const ALL_DEBUG_TOOLS = [
  // probe lifecycle (4)
  'probe_detect',
  'probe_connect',
  'probe_disconnect',
  'probe_status',
  // cpu (4)
  'cpu_reset',
  'cpu_halt',
  'cpu_run',
  'cpu_step',
  // breakpoints (3)
  'breakpoint_set',
  'breakpoint_clear',
  'breakpoint_list',
  // registers (3)
  'register_read',
  'register_write',
  'register_list',
  // memory (2)
  'memory_read',
  'memory_write',
  // flash (4)
  'flash_download',
  'flash_erase',
  'flash_write',
  'flash_verify',
  // RTT (4)
  'rtt_connect',
  'rtt_read',
  'rtt_clear',
  'rtt_search',
  // GDB (2)
  'gdb_server_start',
  'gdb_server_stop',
  // diagnostics (3)
  'snapshot_capture',
  'crash_diagnose',
  'jlink_commander_script',
];

describe('MCP debug tools', () => {
  let h: Harness;

  beforeEach(async () => {
    h = await setup();
  });

  afterEach(async () => {
    await teardown(h);
  });

  describe('registration', () => {
    it('exposes all 28 debug tools', async () => {
      const list = await h.client.listTools();
      const names = list.tools.map((t) => t.name);
      for (const expected of ALL_DEBUG_TOOLS) {
        expect(names).toContain(expected);
      }
      expect(ALL_DEBUG_TOOLS.length).toBe(29);
    });
  });

  describe('probe lifecycle roundtrip via FakeJLinkBackend', () => {
    it('probe_connect → probe_status → probe_disconnect', async () => {
      const connect = await callTool(h.client, 'probe_connect', { target: 'STM32F407VG' });
      expect(connect.success).toBe(true);
      const probe = (connect.evidence as { data: { probe: { probeId: string; target: string } } })
        .data.probe;
      expect(probe.target).toBe('STM32F407VG');
      expect(probe.probeId).toMatch(/^[0-9a-f-]{36}$/);

      const status = await callTool(h.client, 'probe_status', { probeId: probe.probeId });
      expect(status.success).toBe(true);

      const disc = await callTool(h.client, 'probe_disconnect', { probeId: probe.probeId });
      expect(disc.success).toBe(true);

      // After disconnect: probe_status should fail with PROBE_NOT_FOUND
      const status2 = await callTool(h.client, 'probe_status', { probeId: probe.probeId });
      expect(status2.success).toBe(false);
      expect((status2.error as { code: string }).code).toBe('PROBE_NOT_FOUND');
    });

    it('probe_connect normalizes STM32 order-code targets before backend connection', async () => {
      const connect = await callTool(h.client, 'probe_connect', { target: 'STM32H743IIT6' });

      expect(connect.success).toBe(true);
      const probe = (connect.evidence as { data: { probe: { target: string } } }).data.probe;
      expect(probe.target).toBe('STM32H743II');
      expect(h.fake!.callsOf('probeConnect')[0]!.args[0]).toMatchObject({
        target: 'STM32H743II',
      });
    });

    it('probe_connect with empty target returns INVALID_STATE via fake backend', async () => {
      // schema accepts non-empty string; we pass " " which schema accepts (min 1)
      // but FakeJLinkBackend.probeConnect throws JLinkInvalidStateError for whitespace-only target.
      const out = await callTool(h.client, 'probe_connect', { target: ' ' });
      expect(out.success).toBe(false);
      expect((out.error as { code: string }).code).toBe('INVALID_STATE');
    });
  });

  describe('schema version sensitivity', () => {
    it('read-only tool with mismatched version still succeeds and warns', async () => {
      const out = await callTool(h.client, 'probe_detect', {
        clientSchemaVersion: 'wrong-version',
      });
      expect(out.success).toBe(true);
      const meta = (out.evidence as { meta?: { warning?: string } }).meta;
      expect(meta?.warning).toMatch(/schema version mismatch/i);
    });

    it('state-affecting tool with mismatched version is refused', async () => {
      const out = await callTool(h.client, 'cpu_halt', {
        probeId: '00000000-0000-4000-8000-000000000000',
        clientSchemaVersion: 'wrong-version',
      });
      expect(out.success).toBe(false);
      expect((out.error as { code: string }).code).toBe('VERSION_MISMATCH');
    });

    it('matched version succeeds (read-only)', async () => {
      const out = await callTool(h.client, 'probe_detect', {
        clientSchemaVersion: LINKTERM_MCP_SCHEMA_VERSION,
      });
      expect(out.success).toBe(true);
    });
  });

  describe('NO_BACKEND default rejection', () => {
    let nullH: Harness;

    beforeEach(async () => {
      nullH = await setup({ withBackend: false });
    });

    afterEach(async () => {
      await teardown(nullH);
    });

    it('probe_detect returns NO_BACKEND when backend is omitted', async () => {
      const out = await callTool(nullH.client, 'probe_detect', {});
      expect(out.success).toBe(false);
      expect((out.error as { code: string }).code).toBe('NO_BACKEND');
    });

    it('probe_connect returns NO_BACKEND when backend is omitted', async () => {
      const out = await callTool(nullH.client, 'probe_connect', { target: 'STM32F4' });
      expect(out.success).toBe(false);
      expect((out.error as { code: string }).code).toBe('NO_BACKEND');
    });

    it('cpu_halt returns NO_BACKEND when backend is omitted', async () => {
      const out = await callTool(nullH.client, 'cpu_halt', {
        probeId: '00000000-0000-4000-8000-000000000000',
      });
      expect(out.success).toBe(false);
      expect((out.error as { code: string }).code).toBe('NO_BACKEND');
    });
  });

  describe('cpu / breakpoint / register tools delegate to backend', () => {
    it('cpu_reset records halt option in fake ledger', async () => {
      const connect = await callTool(h.client, 'probe_connect', { target: 'STM32F4' });
      const probe = (connect.evidence as { data: { probe: { probeId: string } } }).data.probe;

      const out = await callTool(h.client, 'cpu_reset', { probeId: probe.probeId, halt: true, confirm: true });
      expect(out.success).toBe(true);
      const reset = h.fake!.callsOf('cpuReset');
      expect(reset).toHaveLength(1);
      expect(reset[0]!.args[1]).toEqual({ halt: true });
    });

    it('breakpoint_set returns synthetic breakpoint', async () => {
      const connect = await callTool(h.client, 'probe_connect', { target: 'STM32F4' });
      const probe = (connect.evidence as { data: { probe: { probeId: string } } }).data.probe;

      const out = await callTool(h.client, 'breakpoint_set', {
        probeId: probe.probeId,
        address: 0x100,
        kind: 'hw',
      });
      expect(out.success).toBe(true);
      const data = (out.evidence as { data: { breakpoint: { address: number; kind: string } } })
        .data;
      expect(data.breakpoint.address).toBe(0x100);
      expect(data.breakpoint.kind).toBe('hw');
    });

    it('register_read returns synthetic value', async () => {
      const connect = await callTool(h.client, 'probe_connect', { target: 'STM32F4' });
      const probe = (connect.evidence as { data: { probe: { probeId: string } } }).data.probe;

      const out = await callTool(h.client, 'register_read', {
        probeId: probe.probeId,
        name: 'r0',
      });
      expect(out.success).toBe(true);
      const data = (out.evidence as { data: { register: { name: string; value: number } } }).data;
      expect(data.register.name).toBe('r0');
      expect(data.register.value).toBe(0xdeadbeef);
    });

    it('gdb_server_start projects typed backend DTOs instead of raw SEGGER text', async () => {
      const connect = await callTool(h.client, 'probe_connect', { target: 'STM32F4' });
      const probe = (connect.evidence as { data: { probe: { probeId: string } } }).data.probe;

      const out = await callTool(h.client, 'gdb_server_start', {
        probeId: probe.probeId,
        host: '127.0.0.1',
        port: 2331,
        confirm: true,
      });

      expect(out.success).toBe(true);
      expect((out.evidence as { kind: string }).kind).toBe('debug_output');
      expect((out.evidence as { data: { handle: { host: string; port: number } } }).data.handle).toEqual({
        host: '127.0.0.1',
        port: 2331,
      });
      expect(JSON.stringify(out.evidence)).not.toMatch(/SEGGER|Listening on TCP\/IP/i);
    });

    it('jlink_commander_script delegates diagnostic command lines to the backend', async () => {
      const connect = await callTool(h.client, 'probe_connect', { target: 'STM32F4' });
      const probe = (connect.evidence as { data: { probe: { probeId: string } } }).data.probe;

      const out = await callTool(h.client, 'jlink_commander_script', {
        probeId: probe.probeId,
        commands: ['r', 'mem 0x08080000, 64'],
        timeoutMs: 1234,
        confirm: true,
      });

      expect(out.success).toBe(true);
      expect((out.evidence as { kind: string }).kind).toBe('debug_output');
      expect((out.evidence as { data: { exitCode: number; stdout: string } }).data).toMatchObject({
        exitCode: 0,
        stdout: expect.stringContaining('synthetic Commander output'),
      });
      const calls = h.fake!.callsOf('runCommanderScript');
      expect(calls).toHaveLength(1);
      expect(calls[0]!.args).toEqual([probe.probeId, ['r', 'mem 0x08080000, 64'], { timeoutMs: 1234 }, undefined]);
    });
  });

  describe('schema validation', () => {
    it('rejects non-UUID probeId at schema layer', async () => {
      const res = await h.client.callTool({
        name: 'cpu_halt',
        arguments: { probeId: 'not-a-uuid' },
      });
      expect(res.isError).toBe(true);
    });

    it('rejects missing target on probe_connect', async () => {
      const res = await h.client.callTool({
        name: 'probe_connect',
        arguments: {},
      });
      expect(res.isError).toBe(true);
    });

    it('rejects unknown fields inside nested .strict() schema (snapshot ranges)', async () => {
      const connect = await callTool(h.client, 'probe_connect', { target: 'STM32F4' });
      const probe = (connect.evidence as { data: { probe: { probeId: string } } }).data.probe;
      const res = await h.client.callTool({
        name: 'snapshot_capture',
        arguments: {
          probeId: probe.probeId,
          ranges: [{ address: 0x100, length: 4, unexpected: 'oops' }],
        },
      });
      expect(res.isError).toBe(true);
    });
  });

  describe('serialNumber privacy boundary', () => {
    it('probe_connect strips serialNumber from MCP evidence', async () => {
      const out = await callTool(h.client, 'probe_connect', {
        target: 'STM32F4',
        serialNumber: 'SN-12345-LICENSE-KEY',
      });
      expect(out.success).toBe(true);
      const probe = (out.evidence as { data: { probe: Record<string, unknown> } }).data.probe;
      expect(probe.target).toBe('STM32F4');
      // 关键断言：evidence 中绝不出现 serialNumber
      expect(Object.prototype.hasOwnProperty.call(probe, 'serialNumber')).toBe(false);
    });
  });
});
