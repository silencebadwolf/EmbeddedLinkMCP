/**
 * Phase 12 — 边界场景 9：高影响 J-Link 工具的 confirm 闸门。
 *
 * 验证高影响工具（flash_download / flash_write / flash_erase / cpu_reset /
 * gdb_server_start / jlink_reboot / jlink_commander_script）× 3 种 confirm 状态：
 *
 * - confirm 缺失 → `{ success: false, error: { code: 'CONFIRMATION_REQUIRED', details: { tool } } }`
 *   且 backend ledger 显示对应方法**未被调用**（守门发生在调 backend 之前）；
 * - confirm: false → 同上；
 * - confirm: true → backend 被调用（用 FakeJLinkBackend.callsOf 验证）。
 *
 * 设计：FakeJLinkBackend 对这些方法的成功路径已经实现，所以"调到了 backend"用
 * `success: true` 也能间接断言；关键还是直接看 ledger，避免误把 zod-level reject
 * 也算成"门没守住"。
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SessionManager } from '@/core/session/session-manager.js';
import { SerialDiscovery } from '@/transports/serial/serial-discovery.js';
import { createMcpServer } from '@/mcp/index.js';
import { MAX_BASE64_INPUT_LEN } from '@/mcp/limits.js';
import type { LinkTermMcpServer } from '@/mcp/server.js';
import { createInMemoryMcpTransportPair } from '../fixtures/mock-mcp-transport.js';
import { FakeJLinkBackend } from '../fixtures/fake-jlink-backend.js';

interface Harness {
  manager: SessionManager;
  serialDiscovery: SerialDiscovery;
  fake: FakeJLinkBackend;
  mcp: LinkTermMcpServer;
  client: Client;
  probeId: string;
}

async function setup(): Promise<Harness> {
  const manager = new SessionManager();
  const serialDiscovery = new SerialDiscovery({ listFn: async () => [] });
  const fake = new FakeJLinkBackend();
  const { server: serverTransport, client: clientTransport } = createInMemoryMcpTransportPair();
  const mcp = createMcpServer({
    sessionManager: manager,
    serialDiscovery,
    jlinkBackend: fake,
    transportFactory: () => serverTransport,
  });
  await mcp.start();
  const client = new Client({ name: 'lt-phase12-client', version: '0.0.0' });
  await client.connect(clientTransport);

  const connect = await client.callTool({
    name: 'probe_connect',
    arguments: { target: 'STM32F4' },
  });
  const probe = (
    (connect.structuredContent as { evidence: { data: { probe: { probeId: string } } } }).evidence
      .data.probe
  );
  return { manager, serialDiscovery, fake, mcp, client, probeId: probe.probeId };
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
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const res = await client.callTool({ name, arguments: args });
  expect(res.structuredContent).toBeDefined();
  return res.structuredContent as Record<string, unknown>;
}

/**
 * 5 个高影响工具的 (toolName, backendMethod, baseArgs) 表。
 * baseArgs 在测试里再补 probeId / confirm 字段。
 */
const HIGH_IMPACT_TOOLS: Array<{
  tool: string;
  backendMethod: string;
  needsProbeId?: boolean;
  baseArgs: () => Record<string, unknown>;
}> = [
  { tool: 'flash_download', backendMethod: 'flashDownload', baseArgs: () => ({ binaryBase64: Buffer.from([0x01]).toString('base64') }) },
  { tool: 'flash_write', backendMethod: 'flashWrite', baseArgs: () => ({ address: 0x0800_0000, dataBase64: Buffer.from([0xff]).toString('base64') }) },
  { tool: 'flash_erase', backendMethod: 'flashErase', baseArgs: () => ({}) },
  { tool: 'cpu_reset', backendMethod: 'cpuReset', baseArgs: () => ({ halt: true }) },
  { tool: 'gdb_server_start', backendMethod: 'gdbServerStart', baseArgs: () => ({ port: 2331 }) },
  { tool: 'jlink_reboot', backendMethod: 'jlinkReboot', needsProbeId: false, baseArgs: () => ({}) },
  { tool: 'jlink_commander_script', backendMethod: 'runCommanderScript', baseArgs: () => ({ commands: ['r', 'mem 0x08080000, 64'] }) },
];

describe('Phase 12 / scenario 9 — high-impact confirm gate', () => {
  let h: Harness;

  beforeEach(async () => {
    h = await setup();
  });

  afterEach(async () => {
    await teardown(h);
  });

  for (const { tool, backendMethod, needsProbeId = true, baseArgs } of HIGH_IMPACT_TOOLS) {
    describe(tool, () => {
      it('confirm 缺失 → CONFIRMATION_REQUIRED 且 backend 未被调用', async () => {
        const callsBefore = h.fake.callsOf(backendMethod).length;
        const out = await callTool(h.client, tool, {
          ...(needsProbeId ? { probeId: h.probeId } : {}),
          ...baseArgs(),
        });
        expect(out.success).toBe(false);
        const error = out.error as { code: string; details?: { tool?: string } };
        expect(error.code).toBe('CONFIRMATION_REQUIRED');
        expect(error.details?.tool).toBe(tool);
        // 守门发生在调 backend 之前
        expect(h.fake.callsOf(backendMethod).length).toBe(callsBefore);
      });

      it('confirm: false → CONFIRMATION_REQUIRED 且 backend 未被调用', async () => {
        const callsBefore = h.fake.callsOf(backendMethod).length;
        const out = await callTool(h.client, tool, {
          ...(needsProbeId ? { probeId: h.probeId } : {}),
          ...baseArgs(),
          confirm: false,
        });
        expect(out.success).toBe(false);
        const error = out.error as { code: string; details?: { tool?: string } };
        expect(error.code).toBe('CONFIRMATION_REQUIRED');
        expect(error.details?.tool).toBe(tool);
        expect(h.fake.callsOf(backendMethod).length).toBe(callsBefore);
      });

      it('confirm: true → backend 被调用一次', async () => {
        const callsBefore = h.fake.callsOf(backendMethod).length;
        const out = await callTool(h.client, tool, {
          ...(needsProbeId ? { probeId: h.probeId } : {}),
          ...baseArgs(),
          confirm: true,
        });
        expect(out.success).toBe(true);
        expect(h.fake.callsOf(backendMethod).length).toBe(callsBefore + 1);
      });
    });
  }

  it.each([
    {
      tool: 'flash_download',
      backendMethod: 'flashDownload',
      args: { binaryBase64: '@@@' },
    },
    {
      tool: 'flash_write',
      backendMethod: 'flashWrite',
      args: { address: 0x0800_0000, dataBase64: '@@@' },
    },
    {
      tool: 'flash_download',
      backendMethod: 'flashDownload',
      args: { binaryBase64: 'A'.repeat(MAX_BASE64_INPUT_LEN + 4) },
    },
    {
      tool: 'flash_write',
      backendMethod: 'flashWrite',
      args: { address: 0x0800_0000, dataBase64: 'A'.repeat(MAX_BASE64_INPUT_LEN + 4) },
    },
  ])('$tool 在 confirm 缺失时先返回 CONFIRMATION_REQUIRED，不解码畸形或超长 base64', async ({ tool, backendMethod, args }) => {
    const callsBefore = h.fake.callsOf(backendMethod).length;
    const out = await callTool(h.client, tool, {
      probeId: h.probeId,
      ...args,
    });

    expect(out.success).toBe(false);
    expect((out.error as { code: string }).code).toBe('CONFIRMATION_REQUIRED');
    expect(h.fake.callsOf(backendMethod).length).toBe(callsBefore);
  });
});
