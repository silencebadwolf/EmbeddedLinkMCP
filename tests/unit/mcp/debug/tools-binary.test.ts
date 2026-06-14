/**
 * MCP debug binary tools — base64 ↔ Buffer 翻译 + AbortSignal + 上限。
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SessionManager } from '@/core/session/session-manager.js';
import { SerialDiscovery } from '@/transports/serial/serial-discovery.js';
import { createMcpServer } from '@/mcp/index.js';
import type { LinkTermMcpServer } from '@/mcp/server.js';
import { JLinkAbortedError } from '@/jlink/errors.js';
import { createInMemoryMcpTransportPair } from '../../../fixtures/mock-mcp-transport.js';
import { FakeJLinkBackend } from '../../../fixtures/fake-jlink-backend.js';

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
  const client = new Client({ name: 'lt-test-client', version: '0.0.0' });
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

describe('MCP debug binary tools', () => {
  let h: Harness;

  beforeEach(async () => {
    h = await setup();
  });

  afterEach(async () => {
    await teardown(h);
  });

  describe('memory_read', () => {
    it('returns base64 of raw bytes (Buffer.alloc(8, 0xab))', async () => {
      const out = await callTool(h.client, 'memory_read', {
        probeId: h.probeId,
        address: 0x20000000,
        length: 8,
      });
      expect(out.success).toBe(true);
      const data = (out.evidence as {
        data: { dataBase64: string; address: number; length: number };
      }).data;
      expect(data.address).toBe(0x20000000);
      expect(data.length).toBe(8);
      const decoded = Buffer.from(data.dataBase64, 'base64');
      expect(decoded.byteLength).toBe(8);
      for (const b of decoded) expect(b).toBe(0xab);
    });
  });

  describe('memory_write', () => {
    it('decodes base64 to Buffer that backend records', async () => {
      const original = Buffer.from([0x01, 0x02, 0x03, 0x04, 0x05]);
      const out = await callTool(h.client, 'memory_write', {
        probeId: h.probeId,
        address: 0x20000000,
        dataBase64: original.toString('base64'),
      });
      expect(out.success).toBe(true);

      const writeCall = h.fake.callsOf('memoryWrite');
      expect(writeCall).toHaveLength(1);
      const recorded = writeCall[0]!.args[2] as Buffer;
      expect(Buffer.isBuffer(recorded)).toBe(true);
      expect(Array.from(recorded)).toEqual(Array.from(original));
    });

    it('rejects invalid base64 with INVALID_ARGUMENT', async () => {
      const out = await callTool(h.client, 'memory_write', {
        probeId: h.probeId,
        address: 0,
        dataBase64: 'AAA', // length 3 mod 4 != 0
      });
      expect(out.success).toBe(false);
      expect((out.error as { code: string }).code).toBe('INVALID_ARGUMENT');
    });
  });

  describe('flash_download', () => {
    it('honors verify=true and reports verified', async () => {
      const binary = Buffer.from([0x01, 0x02, 0x03, 0x04]);
      const out = await callTool(h.client, 'flash_download', {
        probeId: h.probeId,
        binaryBase64: binary.toString('base64'),
        verify: true,
      });
      expect(out.success).toBe(true);
      const data = (out.evidence as {
        data: { bytesWritten: number; verified: boolean };
      }).data;
      expect(data.bytesWritten).toBe(4);
      expect(data.verified).toBe(true);
    });

    it('aborts when timeoutMs < delayMs (FakeJLinkBackend)', async () => {
      h.fake.delayMs = 200;
      const binary = Buffer.from([0x00]);
      const out = await callTool(h.client, 'flash_download', {
        probeId: h.probeId,
        binaryBase64: binary.toString('base64'),
        timeoutMs: 30,
      });
      expect(out.success).toBe(false);
      expect((out.error as { code: string }).code).toBe('ABORTED');
    });

    it('rejects oversize payload at schema cap (Zod-level reject)', async () => {
      // 16 MiB + 256 bytes raw → base64 length 越过 schema MAX_BASE64_INPUT_LEN，
      // Zod 阶段直接 reject，SDK 返回 isError + InvalidParams 文本。Phase 10 起
      // schema cap 与 codec maxStripped 对齐，BUFFER_TOO_LARGE 仅作为 codec
      // defense-in-depth（如 schema 被绕过时）。
      const big = Buffer.alloc(16 * 1024 * 1024 + 256, 0);
      const res = await h.client.callTool({
        name: 'flash_download',
        arguments: { probeId: h.probeId, binaryBase64: big.toString('base64') },
      });
      expect(res.isError).toBe(true);
      const text = (res.content as Array<{ text: string }>)[0]?.text ?? '';
      expect(text).toMatch(/Invalid arguments|Input validation|too_big/);
    });

    it('rejects oversize base64 at schema cap (Zod precheck, no Buffer alloc)', async () => {
      // 长度 = MAX_BASE64_INPUT_LEN + 4 → 越过 schema .max() 4 字符。
      // Zod 直接拒绝，绝不进入 codec / Buffer.from。
      const justOverSchema = 'A'.repeat(Math.ceil((16 * 1024 * 1024 * 4) / 3 / 4) * 4 + 4);
      const res = await h.client.callTool({
        name: 'flash_download',
        arguments: { probeId: h.probeId, binaryBase64: justOverSchema },
      });
      expect(res.isError).toBe(true);
      const text = (res.content as Array<{ text: string }>)[0]?.text ?? '';
      expect(text).toMatch(/Invalid arguments|Input validation|too_big/);
    });

    it('rejects whitespace-only base64 with INVALID_ARGUMENT', async () => {
      const out = await callTool(h.client, 'memory_write', {
        probeId: h.probeId,
        address: 0,
        dataBase64: '   \r\n\t  ',
      });
      expect(out.success).toBe(false);
      expect((out.error as { code: string }).code).toBe('INVALID_ARGUMENT');
    });
  });

  describe('flash_verify', () => {
    it('returns ok=true (synthetic backend) when not aborted', async () => {
      const out = await callTool(h.client, 'flash_verify', {
        probeId: h.probeId,
        binaryBase64: Buffer.from([0x00]).toString('base64'),
      });
      expect(out.success).toBe(true);
      expect((out.evidence as { data: { ok: boolean } }).data.ok).toBe(true);
    });
  });

  describe('rtt_read', () => {
    it('returns base64 of synthetic data', async () => {
      const out = await callTool(h.client, 'rtt_read', {
        probeId: h.probeId,
        channelIndex: 0,
        maxBytes: 1024,
      });
      expect(out.success).toBe(true);
      const data = (out.evidence as {
        data: { channelIndex: number; dataBase64: string; truncated: boolean };
      }).data;
      expect(data.channelIndex).toBe(0);
      const decoded = Buffer.from(data.dataBase64, 'base64').toString('utf-8');
      expect(decoded).toBe('hello-rtt');
      expect(data.truncated).toBe(false);
    });
  });

  describe('snapshot_capture', () => {
    it('returns memorySnippets each with base64-encoded data', async () => {
      const out = await callTool(h.client, 'snapshot_capture', {
        probeId: h.probeId,
        ranges: [
          { address: 0x20000000, length: 4 },
          { address: 0x20000100, length: 8 },
        ],
      });
      expect(out.success).toBe(true);
      const data = (out.evidence as {
        data: {
          memorySnippets: Array<{ address: number; dataBase64: string }>;
        };
      }).data;
      expect(data.memorySnippets).toHaveLength(2);
      expect(Buffer.from(data.memorySnippets[0]!.dataBase64, 'base64').byteLength).toBe(4);
      expect(Buffer.from(data.memorySnippets[1]!.dataBase64, 'base64').byteLength).toBe(8);
    });
  });

  describe('JLinkAbortedError mapped to ABORTED', () => {
    it('failOnce injection yields ABORTED', async () => {
      h.fake.failOnce.set('rttRead', new JLinkAbortedError('fake-aborted'));
      const out = await callTool(h.client, 'rtt_read', {
        probeId: h.probeId,
        channelIndex: 0,
        maxBytes: 16,
      });
      expect(out.success).toBe(false);
      expect((out.error as { code: string }).code).toBe('ABORTED');
    });
  });
});
