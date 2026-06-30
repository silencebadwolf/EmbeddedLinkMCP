import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const url = process.env.LINKTERM_MCP_URL ?? 'http://localhost:57371/mcp';
const token = process.env.LINKTERM_MCP_TOKEN;

if (!token) {
  console.error('LINKTERM_MCP_TOKEN is required');
  process.exit(2);
}

const client = new Client({ name: 'linkterm-http-smoke', version: '1.0.0' });
const transport = new StreamableHTTPClientTransport(new URL(url), {
  requestInit: {
    headers: {
      authorization: `Bearer ${token}`,
    },
  },
});

try {
  await client.connect(transport);
  const tools = await client.listTools();
  const status = await client.callTool({ name: 'get_app_status', arguments: {} });
  console.log(JSON.stringify({
    toolCount: tools.tools.length,
    status: status.structuredContent,
  }));
} finally {
  await client.close().catch(() => undefined);
  await transport.close().catch(() => undefined);
}
