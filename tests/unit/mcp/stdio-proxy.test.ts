import { describe, expect, it, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import {
  createMcpProxyServer,
  forwardRuntimeRequest,
  type McpProxyUpstream,
} from '@/mcp/stdio-proxy.js';
import { createAgentRunbookInstructions } from '@/mcp/surfaces/agent-runbook/runbook.js';
import { LINKTERM_MCP_SCHEMA_VERSION } from '@/mcp/versioning/version-check.js';
import { createInMemoryMcpTransportPair } from '../../fixtures/mock-mcp-transport.js';

describe('stdio MCP proxy forwarding', () => {
  it('delivers the packaged runbook through proxy initialize and forwards tools/list', async () => {
    const upstream: McpProxyUpstream = {
      listTools: vi.fn().mockResolvedValue({
        tools: [{ name: 'list_sessions', inputSchema: { type: 'object' } }],
      }),
      callTool: vi.fn(),
    };
    const { server: serverTransport, client: clientTransport } =
      createInMemoryMcpTransportPair();
    const server = createMcpProxyServer(upstream, vi.fn().mockResolvedValue(undefined));
    const client = new Client({ name: 'proxy-guide-test', version: '0.0.0' });

    await server.connect(serverTransport);
    await client.connect(clientTransport);

    expect(client.getInstructions()).toBe(
      createAgentRunbookInstructions(LINKTERM_MCP_SCHEMA_VERSION),
    );
    expect((await client.listTools()).tools.map((tool) => tool.name)).toContain('list_sessions');

    await client.close();
    await server.close();
  });

  it('forwards tools/call parameters and validates the upstream result', async () => {
    const callResult = {
      content: [{ type: 'text' as const, text: 'owner result' }],
      structuredContent: { success: true },
    };
    const upstream: McpProxyUpstream = {
      listTools: vi.fn().mockResolvedValue({ tools: [] }),
      callTool: vi.fn().mockResolvedValue(callResult),
    };
    const { server: serverTransport, client: clientTransport } =
      createInMemoryMcpTransportPair();
    const server = createMcpProxyServer(upstream, vi.fn().mockResolvedValue(undefined));
    const client = new Client({ name: 'proxy-call-test', version: '0.0.0' });

    await server.connect(serverTransport);
    await client.connect(clientTransport);

    await expect(client.callTool({
      name: 'list_sessions',
      arguments: { includeClosed: false },
    })).resolves.toMatchObject(callResult);
    expect(upstream.callTool).toHaveBeenCalledWith(
      { name: 'list_sessions', arguments: { includeClosed: false } },
      expect.anything(),
    );

    await client.close();
    await server.close();
  });

  it('stops through the registered tools/call handler when the owner transport disappears', async () => {
    const stop = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    const upstream: McpProxyUpstream = {
      listTools: vi.fn().mockResolvedValue({ tools: [] }),
      callTool: vi.fn().mockRejectedValue(new TypeError('fetch failed')),
    };
    const { server: serverTransport, client: clientTransport } =
      createInMemoryMcpTransportPair();
    const server = createMcpProxyServer(upstream, stop);
    const client = new Client({ name: 'proxy-call-failure-test', version: '0.0.0' });

    await server.connect(serverTransport);
    await client.connect(clientTransport);

    await expect(client.callTool({ name: 'list_sessions', arguments: {} })).rejects.toThrow();
    await new Promise((resolve) => {
      queueMicrotask(resolve);
    });
    expect(stop).toHaveBeenCalledTimes(1);

    await client.close();
    await server.close();
  });

  it('stops the proxy when the owner runtime transport disappears', async () => {
    const stop = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    const failure = new TypeError('fetch failed');

    await expect(forwardRuntimeRequest(
      async () => {
        throw failure;
      },
      stop,
    )).rejects.toBe(failure);
    await new Promise((resolve) => {
      queueMicrotask(resolve);
    });

    expect(stop).toHaveBeenCalledTimes(1);
  });

  it('keeps the proxy open for ordinary tool errors', async () => {
    const stop = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    const failure = new Error('tool validation failed');

    await expect(forwardRuntimeRequest(
      async () => {
        throw failure;
      },
      stop,
    )).rejects.toBe(failure);
    await new Promise((resolve) => {
      queueMicrotask(resolve);
    });

    expect(stop).not.toHaveBeenCalled();
  });
});
