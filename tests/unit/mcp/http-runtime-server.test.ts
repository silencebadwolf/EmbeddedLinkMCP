import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { SessionManager } from '../../../src/core/session/session-manager.js';
import { startMcpHttpRuntimeServer, type McpHttpRuntimeServer } from '../../../src/mcp/http-runtime-server.js';
import type { SerialDiscovery } from '../../../src/transports/serial/serial-discovery.js';

function makeSerialDiscovery(): SerialDiscovery {
  return {
    listPorts: async () => [],
  } as unknown as SerialDiscovery;
}

describe('startMcpHttpRuntimeServer', () => {
  let root: string;
  let server: McpHttpRuntimeServer | null = null;
  let client: Client | null = null;
  let transport: StreamableHTTPClientTransport | null = null;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'lt-mcp-http-runtime-'));
  });

  afterEach(async () => {
    await client?.close().catch(() => undefined);
    await transport?.close().catch(() => undefined);
    await server?.close().catch(() => undefined);
    await rm(root, { recursive: true, force: true });
    client = null;
    transport = null;
    server = null;
  });

  it('serves MCP terminal tools over authenticated Streamable HTTP', async () => {
    server = await startMcpHttpRuntimeServer({
      sessionManager: new SessionManager(),
      serialDiscovery: makeSerialDiscovery(),
      metadataPath: path.join(root, 'mcp-runtime.json'),
    });

    client = new Client({ name: 'test-http-client', version: '1.0.0' });
    transport = new StreamableHTTPClientTransport(new URL(server.url), {
      requestInit: {
        headers: { authorization: `Bearer ${server.token}` },
      },
    });
    await client.connect(transport);

    const tools = await client.listTools();
    expect(tools.tools.some((tool) => tool.name === 'list_sessions')).toBe(true);

    const out = await client.callTool({ name: 'list_sessions', arguments: {} });
    expect(out.structuredContent).toMatchObject({ success: true, origin: 'ai' });
  });

  it('can start on a requested localhost port with a provided token', async () => {
    server = await startMcpHttpRuntimeServer({
      sessionManager: new SessionManager(),
      serialDiscovery: makeSerialDiscovery(),
      metadataPath: path.join(root, 'mcp-runtime.json'),
      host: '127.0.0.1',
      port: 0,
      token: 'abcdefghijklmnopqrstuvwxyz1234567890_stable',
    });

    expect(server.url).toBe(`http://127.0.0.1:${server.port}/mcp`);
    expect(server.token).toBe('abcdefghijklmnopqrstuvwxyz1234567890_stable');
  });
});
