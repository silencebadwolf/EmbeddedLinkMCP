import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  CallToolResultSchema,
  ListToolsRequestSchema,
  type CallToolResult,
  type CallToolRequest,
  type ListToolsRequest,
  type ListToolsResult,
} from '@modelcontextprotocol/sdk/types.js';
import { APP_NAME } from '@linkterm/contracts/constants';
import { createAgentRunbookInstructions } from './surfaces/agent-runbook/runbook.js';
import { LINKTERM_MCP_SCHEMA_VERSION } from './versioning/version-check.js';
import type { McpRuntimeMetadata } from './runtime-metadata.js';

/** Stdio MCP proxy handle. */
export interface McpStdioProxy {
  stop(): Promise<void>;
}

type ProxyStopFn = () => Promise<void>;

/** Minimal owner-runtime client surface required by the stdio proxy server. */
export interface McpProxyUpstream {
  listTools(params?: ListToolsRequest['params']): Promise<ListToolsResult>;
  callTool(
    params: CallToolRequest['params'],
    resultSchema?: typeof CallToolResultSchema,
  ): Promise<unknown>;
}

/**
 * Forward one request to the owner HTTP runtime.
 *
 * Transport failures mean the owner process or localhost endpoint disappeared. In that case the
 * stdio proxy must close so the Agent host can restart MCP instead of keeping a dead tool surface.
 */
export async function forwardRuntimeRequest<T>(
  operation: () => Promise<T>,
  stopProxy: ProxyStopFn,
): Promise<T> {
  try {
    return await operation();
  } catch (err) {
    if (isOwnerRuntimeTransportError(err)) {
      void stopProxy().catch(() => undefined);
    }
    throw err;
  }
}

/**
 * Construct the transport-independent proxy server used by production stdio and protocol tests.
 *
 * @param upstream Connected owner-runtime MCP client.
 * @param stopProxy Proxy shutdown hook for owner transport failures.
 * @returns MCP server with packaged initialize guidance and forwarding handlers.
 */
export function createMcpProxyServer(
  upstream: McpProxyUpstream,
  stopProxy: ProxyStopFn,
): Server {
  const server = new Server(
    {
      name: 'linkterm-stdio-proxy',
      version: LINKTERM_MCP_SCHEMA_VERSION,
      title: APP_NAME,
    },
    {
      capabilities: { tools: {} },
      instructions: createAgentRunbookInstructions(LINKTERM_MCP_SCHEMA_VERSION),
    },
  );

  server.setRequestHandler(ListToolsRequestSchema, async (request): Promise<ListToolsResult> => {
    return forwardRuntimeRequest(() => upstream.listTools(request.params), stopProxy);
  });

  server.setRequestHandler(CallToolRequestSchema, async (request): Promise<CallToolResult> => {
    return forwardRuntimeRequest(async () => {
      const result = await upstream.callTool(request.params, CallToolResultSchema);
      return CallToolResultSchema.parse(result);
    }, stopProxy);
  });

  return server;
}

/**
 * Start a stdio MCP server that forwards tool listing/calls to an existing HTTP runtime endpoint.
 *
 * @param metadata Runtime endpoint metadata discovered from the owner process.
 * @returns Proxy lifecycle handle.
 */
export async function startMcpStdioProxy(metadata: McpRuntimeMetadata): Promise<McpStdioProxy> {
  const client = new Client({
    name: 'linkterm-stdio-proxy-client',
    version: LINKTERM_MCP_SCHEMA_VERSION,
  });
  const httpTransport = new StreamableHTTPClientTransport(new URL(metadata.url), {
    requestInit: {
      headers: { authorization: `Bearer ${metadata.token}` },
    },
  });
  await client.connect(httpTransport);

  let stopping = false;
  async function stop(): Promise<void> {
    if (stopping) return;
    stopping = true;
    await server.close().catch(() => undefined);
    await stdioTransport.close().catch(() => undefined);
    await httpTransport.close().catch(() => undefined);
    await client.close().catch(() => undefined);
  }

  const server = createMcpProxyServer(client, stop);
  const stdioTransport = new StdioServerTransport();
  await server.connect(stdioTransport);

  return {
    stop,
  };
}

function isOwnerRuntimeTransportError(err: unknown): boolean {
  if (!err) return false;
  if (err instanceof TypeError && err.message.toLowerCase().includes('fetch failed')) return true;
  if (err instanceof Error) {
    const message = err.message.toLowerCase();
    return message.includes('fetch failed')
      || message.includes('econnrefused')
      || message.includes('socket hang up')
      || message.includes('terminated');
  }
  return false;
}
