/**
 * MCP debug binary tools — base64 ↔ Buffer 翻译 + AbortSignal + 上限。
 */

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SessionManager } from '@/core/session/session-manager.js';
import { CONTROL_PROFILE_SCHEMA_VERSION } from '@/core/workspace/control-profile-types.js';
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

async function setup(options: {
  runtimeCodeFresh?: boolean;
  hostPathResolver?: { toHostPath(inputPath: string): Promise<string> };
} = {}): Promise<Harness> {
  const manager = new SessionManager();
  const serialDiscovery = new SerialDiscovery({ listFn: async () => [] });
  const fake = new FakeJLinkBackend();
  const { server: serverTransport, client: clientTransport } = createInMemoryMcpTransportPair();
  const mcp = createMcpServer({
    sessionManager: manager,
    serialDiscovery,
    jlinkBackend: fake,
    hostPathResolver: options.hostPathResolver,
    runtimeDiagnostics: () => ({
      identity: { runtimeId: 'test-runtime', pid: 1234, startedAt: '2026-06-29T12:49:36.000Z' },
      transport: { mode: 'in-memory' },
      metadata: { available: true, fresh: true },
      code: options.runtimeCodeFresh === false
        ? {
            fresh: false,
            staleArtifacts: [
              {
                path: 'dist/main/jlink/segger-command-runner.js',
                modifiedAt: '2026-06-30T00:00:20.000Z',
              },
            ],
          }
        : { fresh: true, staleArtifacts: [] },
    }),
    transportFactory: () => serverTransport,
  });
  await mcp.start();
  const client = new Client({ name: 'lt-test-client', version: '0.0.0' });
  await client.connect(clientTransport);

  const probe = options.runtimeCodeFresh === false
    ? await fake.probeConnect({ target: 'STM32F4' })
    : (
        (await client.callTool({
          name: 'probe_connect',
          arguments: { target: 'STM32F4' },
        })).structuredContent as { evidence: { data: { probe: { probeId: string } } } }
      ).evidence.data.probe;
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

async function writeProfileGuardRoot(input: {
  target: string;
  baseAddress: string;
}): Promise<string> {
  const profileRoot = path.join(tmpdir(), `lt-profile-guard-${Date.now()}-${Math.random()}`);
  await mkdir(path.join(profileRoot, '.linkterm'), { recursive: true });
  await writeFile(
    path.join(profileRoot, '.linkterm', 'control-profile.json'),
    JSON.stringify({
      schemaVersion: CONTROL_PROFILE_SCHEMA_VERSION,
      jlink: { enabled: true, target: input.target, interface: 'swd', speedKHz: 4000 },
      flash: {
        binary: 'build/gcc-arm-debug/rtthread.bin',
        baseAddress: input.baseAddress,
        verify: true,
      },
    }),
    'utf-8',
  );
  return profileRoot;
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
    it('defaults verification on when verify is omitted', async () => {
      const binary = Buffer.from([0x01, 0x02, 0x03, 0x04]);
      const out = await callTool(h.client, 'flash_download', {
        probeId: h.probeId,
        binaryBase64: binary.toString('base64'),
        confirm: true,
      });

      expect(out.success).toBe(true);
      expect(h.fake.callsOf('flashDownload').at(-1)?.args).toMatchObject([
        h.probeId,
        binary.byteLength,
        { verify: true },
      ]);
      expect((out.evidence as { data: { verified: boolean } }).data.verified).toBe(true);
    });

    it('honors verify=true and reports verified', async () => {
      const binary = Buffer.from([0x01, 0x02, 0x03, 0x04]);
      const out = await callTool(h.client, 'flash_download', {
        probeId: h.probeId,
        binaryBase64: binary.toString('base64'),
        verify: true,
        confirm: true,
      });
      expect(out.success).toBe(true);
      const data = (out.evidence as {
        data: { bytesWritten: number; verified: boolean };
      }).data;
      expect(data.bytesWritten).toBe(4);
      expect(data.verified).toBe(true);
    });

    it('reports the independent readback verification contract for verified downloads', async () => {
      const out = await callTool(h.client, 'flash_download', {
        probeId: h.probeId,
        binaryBase64: Buffer.from([0x01, 0x02, 0x03, 0x04]).toString('base64'),
        verify: true,
        confirm: true,
      });

      expect(out.success).toBe(true);
      expect((out.evidence as {
        data: {
          verification: {
            requested: boolean;
            method: string;
            postDownloadReadbackRequired: boolean;
          };
        };
      }).data.verification).toEqual({
        requested: true,
        method: 'commander-verifybin-plus-savebin-readback',
        postDownloadReadbackRequired: true,
      });
    });

    it('refuses confirmed flash when the running MCP runtime code is stale', async () => {
      await teardown(h);
      h = await setup({ runtimeCodeFresh: false });
      const callsBefore = h.fake.callsOf('flashDownload').length;

      const out = await callTool(h.client, 'flash_download', {
        probeId: h.probeId,
        binaryBase64: Buffer.from([0x01, 0x02, 0x03, 0x04]).toString('base64'),
        verify: true,
        confirm: true,
      });

      expect(out.success).toBe(false);
      expect((out.error as { code: string; message: string }).code).toBe('INVALID_STATE');
      expect((out.error as { message: string }).message).toMatch(/Restart the LinkTerm MCP runtime/i);
      expect(h.fake.callsOf('flashDownload')).toHaveLength(callsBefore);
    });

    it('rejects direct flash when the probe target disagrees with the LinkTerm profile target', async () => {
      const profileRoot = await writeProfileGuardRoot({
        target: 'STM32H743II',
        baseAddress: '0x08000000',
      });
      const staleProbe = await h.fake.probeConnect({ target: 'STM32H743IIT6' });
      const callsBefore = h.fake.callsOf('flashDownload').length;

      const out = await callTool(h.client, 'flash_download', {
        probeId: staleProbe.probeId,
        binaryBase64: Buffer.from([0x01, 0x02, 0x03, 0x04]).toString('base64'),
        address: 0x08000000,
        profileRoot,
        confirm: true,
      });

      expect(out.success).toBe(false);
      expect((out.error as { code: string; message: string }).code).toBe('INVALID_ARGUMENT');
      expect((out.error as { message: string }).message).toContain('probe target');
      expect(h.fake.callsOf('flashDownload')).toHaveLength(callsBefore);
    });

    it('rejects direct flash when the requested address disagrees with the LinkTerm profile flash base', async () => {
      const profileRoot = await writeProfileGuardRoot({
        target: 'STM32F4',
        baseAddress: '0x08000000',
      });
      const callsBefore = h.fake.callsOf('flashDownload').length;

      const out = await callTool(h.client, 'flash_download', {
        probeId: h.probeId,
        binaryBase64: Buffer.from([0x01, 0x02, 0x03, 0x04]).toString('base64'),
        address: 0x08008000,
        profileRoot,
        confirm: true,
      });

      expect(out.success).toBe(false);
      expect((out.error as { code: string; message: string }).code).toBe('INVALID_ARGUMENT');
      expect((out.error as { message: string }).message).toContain('profile flash base');
      expect(h.fake.callsOf('flashDownload')).toHaveLength(callsBefore);
    });

    it('accepts WSL Linux profileRoot values for direct flash profile guards', async () => {
      await teardown(h);
      const linuxRoot = `/home/linkterm-${Date.now()}/code/FNA1000`;
      const hostRoot = await writeProfileGuardRoot({
        target: 'STM32F4',
        baseAddress: '0x08000000',
      });
      h = await setup({
        hostPathResolver: {
          async toHostPath(inputPath: string): Promise<string> {
            return inputPath === linuxRoot ? hostRoot : inputPath;
          },
        },
      });

      const out = await callTool(h.client, 'flash_download', {
        probeId: h.probeId,
        binaryBase64: Buffer.from([0x01, 0x02, 0x03, 0x04]).toString('base64'),
        address: 0x08000000,
        profileRoot: linuxRoot,
        confirm: true,
      });

      expect(out.success).toBe(true);
      expect(h.fake.callsOf('flashDownload').at(-1)!.args).toMatchObject([
        expect.any(String),
        4,
        { address: 0x08000000, verify: true },
      ]);
    });

    it('passes timeoutMs through to the backend flash options', async () => {
      const binary = Buffer.from([0x01, 0x02, 0x03, 0x04]);

      const out = await callTool(h.client, 'flash_download', {
        probeId: h.probeId,
        binaryBase64: binary.toString('base64'),
        timeoutMs: 300_000,
        confirm: true,
      });

      expect(out.success).toBe(true);
      expect(h.fake.callsOf('flashDownload').at(-1)?.args).toMatchObject([
        h.probeId,
        binary.byteLength,
        { verify: true, timeoutMs: 300_000 },
      ]);
    });

    it('reports invalid argument when profileRoot does not contain a control profile', async () => {
      const profileRoot = path.join(tmpdir(), `lt-profile-missing-${Date.now()}-${Math.random()}`);
      const callsBefore = h.fake.callsOf('flashDownload').length;

      const out = await callTool(h.client, 'flash_download', {
        probeId: h.probeId,
        binaryBase64: Buffer.from([0x01, 0x02, 0x03, 0x04]).toString('base64'),
        address: 0x08000000,
        profileRoot,
        confirm: true,
      });

      expect(out.success).toBe(false);
      expect((out.error as { code: string; message: string }).code).toBe('INVALID_ARGUMENT');
      expect((out.error as { message: string }).message).toContain('control profile');
      expect((out.error as { details?: Record<string, unknown> }).details).toBeUndefined();
      expect(h.fake.callsOf('flashDownload')).toHaveLength(callsBefore);
    });

    it('rejects a Cortex-M vector table whose reset address is outside the requested image range', async () => {
      const firmware = Buffer.alloc(64, 0xff);
      firmware.writeUInt32LE(0x24000d20, 0);
      firmware.writeUInt32LE(0x080a8141, 4);
      const callsBefore = h.fake.callsOf('flashDownload').length;

      const out = await callTool(h.client, 'flash_download', {
        probeId: h.probeId,
        binaryBase64: firmware.toString('base64'),
        address: 0x08008000,
        verify: true,
        confirm: true,
      });

      expect(out.success).toBe(false);
      expect((out.error as { code: string; message: string }).code).toBe('INVALID_ARGUMENT');
      expect((out.error as { message: string }).message).toContain('reset vector');
      expect(h.fake.callsOf('flashDownload')).toHaveLength(callsBefore);
    });

    it('aborts when timeoutMs < delayMs (FakeJLinkBackend)', async () => {
      h.fake.delayMs = 200;
      const binary = Buffer.from([0x00]);
      const out = await callTool(h.client, 'flash_download', {
        probeId: h.probeId,
        binaryBase64: binary.toString('base64'),
        timeoutMs: 30,
        confirm: true,
      });
      expect(out.success).toBe(false);
      expect((out.error as { code: string }).code).toBe('ABORTED');
    });

    it('rejects confirmed oversize payload with BUFFER_TOO_LARGE before backend call', async () => {
      const big = Buffer.alloc(16 * 1024 * 1024 + 256, 0);
      const callsBefore = h.fake.callsOf('flashDownload').length;

      const out = await callTool(h.client, 'flash_download', {
        probeId: h.probeId,
        binaryBase64: big.toString('base64'),
        confirm: true,
      });

      expect(out.success).toBe(false);
      expect((out.error as { code: string }).code).toBe('BUFFER_TOO_LARGE');
      expect(h.fake.callsOf('flashDownload')).toHaveLength(callsBefore);
    });

    it('rejects confirmed oversize base64 with codec precheck and no backend call', async () => {
      const justOverCap = 'A'.repeat(Math.ceil((16 * 1024 * 1024 * 4) / 3 / 4) * 4 + 4);
      const callsBefore = h.fake.callsOf('flashDownload').length;

      const out = await callTool(h.client, 'flash_download', {
        probeId: h.probeId,
        binaryBase64: justOverCap,
        confirm: true,
      });

      expect(out.success).toBe(false);
      expect((out.error as { code: string }).code).toBe('BUFFER_TOO_LARGE');
      expect(h.fake.callsOf('flashDownload')).toHaveLength(callsBefore);
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

    it('reports the independent readback verification contract', async () => {
      const out = await callTool(h.client, 'flash_verify', {
        probeId: h.probeId,
        binaryBase64: Buffer.from([0x01, 0x02, 0x03, 0x04]).toString('base64'),
        address: 0x08000000,
      });

      expect(out.success).toBe(true);
      expect((out.evidence as {
        data: {
          verification: {
            method: string;
            address: number;
            bytesCompared: number;
            readbackRequired: boolean;
          };
        };
      }).data.verification).toEqual({
        method: 'commander-verifybin-plus-savebin-readback',
        address: 0x08000000,
        bytesCompared: 4,
        readbackRequired: true,
      });
    });

    it('rejects direct verify when the probe target disagrees with the LinkTerm profile target', async () => {
      const profileRoot = await writeProfileGuardRoot({
        target: 'STM32H743II',
        baseAddress: '0x08000000',
      });
      const staleProbe = await h.fake.probeConnect({ target: 'STM32H743IIT6' });
      const callsBefore = h.fake.callsOf('flashVerify').length;

      const out = await callTool(h.client, 'flash_verify', {
        probeId: staleProbe.probeId,
        binaryBase64: Buffer.from([0x01, 0x02, 0x03, 0x04]).toString('base64'),
        address: 0x08000000,
        profileRoot,
      });

      expect(out.success).toBe(false);
      expect((out.error as { code: string; message: string }).code).toBe('INVALID_ARGUMENT');
      expect((out.error as { message: string }).message).toContain('probe target');
      expect(h.fake.callsOf('flashVerify')).toHaveLength(callsBefore);
    });

    it('rejects a Cortex-M vector table whose reset address is outside the verified image range', async () => {
      const firmware = Buffer.alloc(64, 0xff);
      firmware.writeUInt32LE(0x24000d20, 0);
      firmware.writeUInt32LE(0x080a8141, 4);
      const callsBefore = h.fake.callsOf('flashVerify').length;

      const out = await callTool(h.client, 'flash_verify', {
        probeId: h.probeId,
        binaryBase64: firmware.toString('base64'),
        address: 0x08008000,
      });

      expect(out.success).toBe(false);
      expect((out.error as { code: string; message: string }).code).toBe('INVALID_ARGUMENT');
      expect((out.error as { message: string }).message).toContain('reset vector');
      expect(h.fake.callsOf('flashVerify')).toHaveLength(callsBefore);
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
