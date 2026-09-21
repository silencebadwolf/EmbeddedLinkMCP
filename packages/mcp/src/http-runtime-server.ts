import { createServer, type IncomingMessage, type Server as HttpServer, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createMcpServer, type CreateMcpServerOptions, type LinkTermMcpServer } from './server.js';
import {
  createRuntimeToken,
  removeRuntimeMetadata,
  writeRuntimeMetadata,
} from './runtime-metadata.js';

/** Local MCP HTTP runtime server handle. */
export interface McpHttpRuntimeServer {
  url: string;
  token: string;
  port: number;
  close(): Promise<void>;
}

/** Options for starting the local MCP HTTP runtime endpoint. */
export interface StartMcpHttpRuntimeServerOptions extends Omit<CreateMcpServerOptions, 'transportFactory'> {
  metadataPath: string;
  host?: string;
  /** Preferred port; an EADDRINUSE conflict falls back to an OS-assigned available port. */
  port?: number;
  token?: string;
}

/**
 * Start a localhost Streamable HTTP MCP endpoint backed by the shared LinkTerm runtime.
 *
 * @param options Runtime dependencies and endpoint persistence path.
 * @returns Started HTTP endpoint handle.
 */
export async function startMcpHttpRuntimeServer(
  options: StartMcpHttpRuntimeServerOptions,
): Promise<McpHttpRuntimeServer> {
  const host = options.host ?? '127.0.0.1';
  const token = options.token ?? createRuntimeToken();

  const activeMcpServers = new Set<LinkTermMcpServer>();
  const pendingStops = new Set<Promise<void>>();
  const requestListener = (req: IncomingMessage, res: ServerResponse): void => {
    void handleRequest(req, res, options, token, activeMcpServers, pendingStops);
  };
  const requestedPort = options.port ?? 0;
  let httpServer = createServer(requestListener);

  try {
    await listenHttpServer(httpServer, requestedPort, host);
  } catch (err) {
    if (requestedPort === 0 || !isAddressInUseError(err)) throw err;
    // A persisted port is only a preference: keeping the desktop usable is more important than
    // failing startup when another process or an ephemeral client temporarily owns that port.
    httpServer = createServer(requestListener);
    await listenHttpServer(httpServer, 0, host);
  }

  const address = httpServer.address();
  if (!address || typeof address === 'string') {
    await closeHttpServer(httpServer);
    throw new Error('MCP HTTP runtime did not bind to a TCP port');
  }

  const port = (address as AddressInfo).port;
  const url = `http://${host}:${port}/mcp`;
  try {
    await writeRuntimeMetadata(options.metadataPath, { pid: process.pid, url, token });
  } catch (err) {
    await stopActiveMcpServers(activeMcpServers, pendingStops);
    await closeHttpServer(httpServer).catch(() => undefined);
    throw err;
  }

  return {
    url,
    token,
    port,
    close: async () => {
      await removeRuntimeMetadata(options.metadataPath).catch(() => undefined);
      await stopActiveMcpServers(activeMcpServers, pendingStops);
      await closeHttpServer(httpServer);
    },
  };
}

/**
 * Handle one MCP HTTP request by creating a short-lived transport/server pair.
 *
 * @param req Incoming HTTP request.
 * @param res HTTP response.
 * @param options Runtime dependencies.
 * @param token Expected bearer token.
 * @param activeMcpServers Active per-request MCP servers for shutdown cleanup.
 * @param pendingStops MCP servers already stopping after request completion.
 */
async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  options: StartMcpHttpRuntimeServerOptions,
  token: string,
  activeMcpServers: Set<LinkTermMcpServer>,
  pendingStops: Set<Promise<void>>,
): Promise<void> {
  if (req.url === '/health') {
    writeJson(res, 200, { success: true });
    return;
  }
  if (!req.url?.startsWith('/mcp')) {
    writeJson(res, 404, { success: false, error: 'NOT_FOUND' });
    return;
  }
  if (req.headers.authorization !== `Bearer ${token}`) {
    writeJson(res, 401, {
      jsonrpc: '2.0',
      error: { code: -32001, message: 'Unauthorized' },
      id: null,
    });
    return;
  }

  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  const mcpServer = createMcpServer({ ...options, transportFactory: () => transport });
  activeMcpServers.add(mcpServer);
  let cleaned = false;
  const cleanup = (): void => {
    if (cleaned) return;
    cleaned = true;
    activeMcpServers.delete(mcpServer);
    const stopPromise = mcpServer.stop().catch(() => undefined);
    pendingStops.add(stopPromise);
    void stopPromise.finally(() => pendingStops.delete(stopPromise));
  };
  res.once('finish', cleanup);
  res.once('close', cleanup);

  try {
    await mcpServer.start();
    await transport.handleRequest(req, res);
  } catch (err) {
    if (!res.headersSent) {
      const message = err instanceof Error ? err.message : String(err);
      writeJson(res, 500, {
        jsonrpc: '2.0',
        error: { code: -32603, message },
        id: null,
      });
    }
  }
}

/**
 * Write a JSON response if headers are still mutable.
 *
 * @param res HTTP response.
 * @param status HTTP status code.
 * @param payload JSON payload.
 */
function writeJson(res: ServerResponse, status: number, payload: unknown): void {
  if (res.headersSent) return;
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

/**
 * Stop all active per-request MCP servers.
 *
 * @param activeMcpServers Active server set owned by the HTTP endpoint.
 * @param pendingStops In-flight stop operations already detached from active requests.
 */
async function stopActiveMcpServers(
  activeMcpServers: Set<LinkTermMcpServer>,
  pendingStops: Set<Promise<void>>,
): Promise<void> {
  const servers = Array.from(activeMcpServers);
  activeMcpServers.clear();
  await Promise.all([
    ...servers.map((server) => server.stop().catch(() => undefined)),
    ...Array.from(pendingStops),
  ]);
}

/**
 * Close a Node HTTP server.
 *
 * @param server HTTP server.
 */
function closeHttpServer(server: HttpServer): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

/** Bind an HTTP server and surface asynchronous listen errors through a Promise. */
function listenHttpServer(server: HttpServer, port: number, host: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (err: Error): void => {
      server.off('listening', onListening);
      reject(err);
    };
    const onListening = (): void => {
      server.off('error', onError);
      resolve();
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, host);
  });
}

/** Return true only for the recoverable TCP port-conflict error. */
function isAddressInUseError(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: unknown }).code === 'EADDRINUSE'
  );
}
