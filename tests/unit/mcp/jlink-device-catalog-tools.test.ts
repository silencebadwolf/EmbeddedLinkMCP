import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SessionManager } from '@/core/session/session-manager.js';
import { SerialDiscovery } from '@/transports/serial/serial-discovery.js';
import { createMcpServer } from '@/mcp/index.js';
import type { LinkTermMcpServer } from '@/mcp/server.js';
import type { JLinkDeviceCatalog } from '@/jlink/device-catalog.js';
import { createInMemoryMcpTransportPair } from '../../fixtures/mock-mcp-transport.js';

function makeCatalog(): JLinkDeviceCatalog {
  return {
    search: async () => ({
      available: true,
      sourceFiles: ['JLinkDevices.xml'],
      devices: [{ name: '-AT32F435RGT7', vendor: 'ArteryTek', sourceFile: 'JLinkDevices.xml', flashBanks: [] }],
    }),
    get: async (name) =>
      name === '-AT32F435RGT7'
        ? { name, vendor: 'ArteryTek', sourceFile: 'JLinkDevices.xml', flashBanks: [] }
        : undefined,
    has: async (name) => name === '-AT32F435RGT7',
    refresh: async () => undefined,
  };
}

describe('MCP J-Link device catalog tools', () => {
  let manager: SessionManager;
  let serialDiscovery: SerialDiscovery;
  let mcp: LinkTermMcpServer;
  let client: Client;

  beforeEach(async () => {
    manager = new SessionManager();
    serialDiscovery = new SerialDiscovery({ listFn: async () => [] });
    const { server: serverTransport, client: clientTransport } = createInMemoryMcpTransportPair();
    mcp = createMcpServer({
      sessionManager: manager,
      serialDiscovery,
      jlinkDeviceCatalog: makeCatalog(),
      transportFactory: () => serverTransport,
    });
    await mcp.start();
    client = new Client({ name: 'lt-test-client', version: '0.0.0' });
    await client.connect(clientTransport);
  });

  afterEach(async () => {
    await client.close().catch(() => undefined);
    await mcp.stop();
    await manager.destroyAll();
    serialDiscovery.dispose();
  });

  it('exposes catalog search and get tools', async () => {
    const tools = await client.listTools();
    expect(tools.tools.map((t) => t.name)).toEqual(expect.arrayContaining([
      'jlink_device_catalog_search',
      'jlink_device_catalog_get',
    ]));
  });

  it('searches installed J-Link devices', async () => {
    const out = await client.callTool({ name: 'jlink_device_catalog_search', arguments: { query: 'AT32F435' } });
    const data = out.structuredContent as { success: boolean; evidence: { data: { devices: Array<{ name: string }> } } };
    expect(data.success).toBe(true);
    expect(data.evidence.data.devices[0]?.name).toBe('-AT32F435RGT7');
  });

  it('returns NOT_FOUND for an unknown exact device', async () => {
    const out = await client.callTool({ name: 'jlink_device_catalog_get', arguments: { name: 'NOPE' } });
    const data = out.structuredContent as { success: boolean; error: { code: string } };
    expect(data.success).toBe(false);
    expect(data.error.code).toBe('NOT_FOUND');
  });
});
