/**
 * MCP UI screenshot — BUFFER_TOO_LARGE & decoding round-trip.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SessionManager } from '@linkterm/runtime/core/session/session-manager';
import { SerialDiscovery } from '@linkterm/runtime/transports/serial/serial-discovery';
import { createMcpServer } from '@linkterm/mcp/index';
import type { LinkTermMcpServer } from '@linkterm/mcp/server';
import type { CapturableWindow } from '@linkterm/mcp/surfaces/ui/types';
import { MAX_BINARY_BYTES } from '@linkterm/mcp/surfaces/debug/binary-codec';
import { createInMemoryMcpTransportPair } from '../../../../tests/fixtures/mock-mcp-transport.js';

interface H {
  manager: SessionManager;
  serialDiscovery: SerialDiscovery;
  mcp: LinkTermMcpServer;
  client: Client;
}

async function setupWithWindow(win: CapturableWindow): Promise<H> {
  const manager = new SessionManager();
  const serialDiscovery = new SerialDiscovery({ listFn: async () => [] });
  const { server: serverTransport, client: clientTransport } =
    createInMemoryMcpTransportPair();
  const mcp = createMcpServer({
    sessionManager: manager,
    serialDiscovery,
    getActiveWindow: () => win,
    transportFactory: () => serverTransport,
  });
  await mcp.start();
  const client = new Client({ name: 'lt-ui-shot', version: '0.0.0' });
  await client.connect(clientTransport);
  return { manager, serialDiscovery, mcp, client };
}

async function teardown(h: H): Promise<void> {
  try {
    await h.client.close();
  } catch {
    /* ignore */
  }
  await h.mcp.stop();
  await h.manager.destroyAll();
  h.serialDiscovery.dispose();
}

describe('ui_screenshot binary handling', () => {
  let h: H;

  afterEach(async () => {
    if (h) await teardown(h);
  });

  it('round-trips a small PNG payload', async () => {
    const payload = Buffer.from('hello-png');
    h = await setupWithWindow({
      isDestroyed: () => false,
      webContents: {
        capturePage: async () => ({
          toPNG: () => payload,
          getSize: () => ({ width: 4, height: 4 }),
        }),
      },
    });
    const res = await h.client.callTool({ name: 'ui_screenshot', arguments: {} });
    const out = res.structuredContent as Record<string, unknown>;
    expect(out.success).toBe(true);
    const data = (out.evidence as {
      data: { base64: string; byteLength: number };
    }).data;
    const decoded = Buffer.from(data.base64, 'base64');
    expect(decoded.equals(payload)).toBe(true);
    expect(data.byteLength).toBe(payload.byteLength);
  });

  it('rejects oversize PNG with BUFFER_TOO_LARGE', async () => {
    const oversize = Buffer.alloc(MAX_BINARY_BYTES + 1, 0);
    h = await setupWithWindow({
      isDestroyed: () => false,
      webContents: {
        capturePage: async () => ({
          toPNG: () => oversize,
          getSize: () => ({ width: 8000, height: 6000 }),
        }),
      },
    });
    const res = await h.client.callTool({ name: 'ui_screenshot', arguments: {} });
    const out = res.structuredContent as Record<string, unknown>;
    expect(out.success).toBe(false);
    expect((out.error as { code: string }).code).toBe('BUFFER_TOO_LARGE');
  });
});
