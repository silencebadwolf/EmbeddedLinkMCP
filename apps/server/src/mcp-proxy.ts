import { request as httpRequest, type IncomingMessage, type ServerResponse } from 'node:http';
import type { McpHttpRuntimeServer } from '@linkterm/mcp/http-runtime-server';
import { readJson } from './http-utils.js';

/** Keep the existing MCP transport semantics while exposing it on the Web origin. */
export async function proxyMcp(request: IncomingMessage, response: ServerResponse, endpoint: McpHttpRuntimeServer): Promise<void> {
  const body = request.method === 'POST' ? JSON.stringify(await readJson(request, 32 * 1024 * 1024)) : undefined;
  const headers: Record<string, string> = { authorization: `Bearer ${endpoint.token}` };
  for (const name of ['accept', 'mcp-protocol-version', 'mcp-session-id', 'last-event-id']) {
    const value = request.headers[name];
    if (typeof value === 'string') headers[name] = value;
  }
  if (body !== undefined) {
    headers['content-type'] = 'application/json';
    headers['content-length'] = String(Buffer.byteLength(body));
  }
  await new Promise<void>((resolve, reject) => {
    const upstream = httpRequest(endpoint.url, { method: request.method, headers }, result => {
      response.writeHead(result.statusCode ?? 502, { ...result.headers, 'cache-control': 'no-store' });
      result.pipe(response);
      result.once('end', resolve);
      result.once('error', reject);
    });
    upstream.once('error', reject);
    response.once('close', () => { upstream.destroy(); resolve(); });
    upstream.end(body);
  });
}
