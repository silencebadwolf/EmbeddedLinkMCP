import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  CallToolResultSchema,
  ListToolsRequestSchema,
  type CallToolResult,
  type ListToolsResult,
} from '@modelcontextprotocol/sdk/types.js';
import { APP_NAME } from '../shared/constants.js';
import { createAgentRunbookInstructions } from './surfaces/agent-runbook/runbook.js';
import { LINKTERM_MCP_SCHEMA_VERSION } from './versioning/version-check.js';
import type { McpRuntimeMetadata } from './runtime-metadata.js';

/** Stdio MCP proxy handle. */
export interface McpStdioProxy {
  stop(): Promise<void>;
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
    return client.listTools(request.params);
  });

  server.setRequestHandler(CallToolRequestSchema, async (request): Promise<CallToolResult> => {
    const result = await client.callTool(request.params, CallToolResultSchema);
    return CallToolResultSchema.parse(result);
  });

  const stdioTransport = new StdioServerTransport();
  await server.connect(stdioTransport);

  return {
    stop: async () => {
      await server.close().catch(() => undefined);
      await stdioTransport.close().catch(() => undefined);
      await httpTransport.close().catch(() => undefined);
      await client.close().catch(() => undefined);
    },
  };
}
