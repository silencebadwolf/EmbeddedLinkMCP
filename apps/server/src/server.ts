import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { homedir, hostname } from 'node:os';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { WebSocketServer } from 'ws';
import { createRuntime, type Runtime, type RuntimeOptions, ToolError } from '@linkterm/runtime';
import { registerRuntimeClientServices } from '@linkterm/runtime/services/client';
import { AgentIntegrationManager } from '@linkterm/runtime/core/agent-integrations/index';
import { startMcpHttpRuntimeServer, type McpHttpRuntimeServer } from '@linkterm/mcp/http-runtime-server';
import { CLIENT_CHANNELS } from '@linkterm/contracts/client-protocol';
import { WEB_MAX_FRAME_BYTES, WEB_PROTOCOL_VERSION, WebClientFrameSchema, WebRequestSchema, type WebRequest, type WebRuntimeInfo } from '@linkterm/contracts/web-protocol';
import { AuthService } from './auth.js';
import { HttpError, failure, readBytes, readJson, writeJson } from './http-utils.js';
import { OriginPolicy, LOOPBACK_HOSTS } from './origin-policy.js';
import { NetworkPeer } from './network-peer.js';
import { RequestRegistry } from './request-registry.js';
import { RequestLedger } from './request-ledger.js';
import { serveStatic } from './static-files.js';
import { proxyMcp } from './mcp-proxy.js';
import { FirmwareResources, WorkspaceResources } from './resources.js';

export interface ServerOptions {
  readonly runtime: RuntimeOptions;
  readonly accessToken: string;
  readonly publicDir: string;
  readonly host?: string;
  readonly port?: number;
  /** Required for non-loopback hosting; HTTPS is terminated by the configured reverse proxy. */
  readonly publicOrigin?: string;
  /** Explicit loopback-only Vite origin, never enabled for a deployed remote server. */
  readonly devOrigin?: string;
  readonly workspaceRoots?: readonly string[];
  /** Defaults to the server account's home, never the browser's computer. */
  readonly agentConfigHome?: string;
}

export interface LinkTermServer {
  readonly url: string;
  readonly runtime: Runtime;
  readonly runtimeId: string;
  close(): Promise<void>;
}

/** One owner process serves browser clients and all MCP requests from the same runtime. */
export async function startServer(options: ServerOptions): Promise<LinkTermServer> {
  const host = options.host ?? '127.0.0.1';
  const isLoopback = LOOPBACK_HOSTS.has(host);
  const publicOrigin = options.publicOrigin ? parseOrigin(options.publicOrigin) : undefined;
  if (!isLoopback && publicOrigin?.protocol !== 'https:') throw new Error('Remote hosting requires an explicit HTTPS public origin');
  if (publicOrigin && !LOOPBACK_HOSTS.has(publicOrigin.hostname) && publicOrigin.protocol !== 'https:') throw new Error('Remote public origins must use HTTPS');
  const devOrigin = options.devOrigin ? parseOrigin(options.devOrigin) : undefined;
  if (devOrigin && (!isLoopback || !LOOPBACK_HOSTS.has(devOrigin.hostname) || publicOrigin)) throw new Error('The development origin is only allowed for a loopback server');
  const auth = new AuthService(options.accessToken, publicOrigin?.protocol === 'https:');
  let agentIntegrationManager: AgentIntegrationManager | undefined;
  const runtime = await createRuntime({ ...options.runtime, agentIntegrations: {
    listStatuses: () => agentIntegrationManager?.listStatuses() ?? Promise.resolve([]),
  } });
  let workspaces: WorkspaceResources;
  let firmware: FirmwareResources;
  try {
    workspaces = await WorkspaceResources.create(runtime.dataDir, options.workspaceRoots);
    firmware = await FirmwareResources.create(runtime.dataDir);
  } catch (error) { await runtime.dispose(); throw error; }
  const runtimeId = randomUUID();
  const runtimeInfo = (): WebRuntimeInfo => ({ id: runtimeId, hostname: hostname(), platform: process.platform, protocol: WEB_PROTOCOL_VERSION, serverTime: Date.now(), capabilities: { nativeFilePicker: false, screenshot: false, terminalHost: 'server' } });
  const requests = new RequestRegistry();
  const ledger = new RequestLedger();
  const peers = new Map<string, NetworkPeer>();
  let nextPeerId = 1;
  let uiTarget: NetworkPeer | undefined;
  let unregister: (() => void) | undefined;
  let mcp: McpHttpRuntimeServer | undefined;
  let policy: OriginPolicy | undefined;
  let closing: Promise<void> | undefined;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let activeUploads = 0;
  const sockets = new WebSocketServer({ noServer: true, maxPayload: WEB_MAX_FRAME_BYTES, perMessageDeflate: false });
  const server = createServer({ requestTimeout: 30_000, headersTimeout: 10_000, maxHeaderSize: 16 * 1024 }, (request, response) => {
    void handleHttp(request, response).catch(error => respondError(response, error));
  });

  const invoke = (peer: NetworkPeer, input: unknown): Promise<unknown> => {
    if (closing) throw new HttpError(503, 'SERVER_STOPPING');
    if (peer.isDestroyed() || !auth.getSession(peer.sessionId)) throw new HttpError(401, 'AUTH_REQUIRED');
    const parsed = WebRequestSchema.safeParse(input);
    if (!parsed.success) throw new HttpError(400, 'INVALID_REQUEST');
    if (!requests.has(parsed.data.method)) throw new HttpError(404, 'METHOD_NOT_FOUND');
    return ledger.execute(peer.sessionId, parsed.data, async () => requests.invoke(parsed.data.method, { sender: peer }, await authorizeWebPayload(parsed.data.method, parsed.data.payload, workspaces, firmware)));
  };
  const peerForRequest = (request: IncomingMessage, sessionId: string): NetworkPeer => {
    const clientId = request.headers['x-linkterm-client'];
    const peer = typeof clientId === 'string' ? peers.get(clientId) : undefined;
    if (!peer || peer.isDestroyed() || peer.sessionId !== sessionId) throw new HttpError(409, 'CLIENT_NOT_CONNECTED');
    return peer;
  };
  async function handleHttp(request: IncomingMessage, response: ServerResponse): Promise<void> {
    if (!policy || closing) throw new HttpError(503, 'SERVER_STOPPING');
    policy.checkHost(request);
    const url = new URL(request.url ?? '/', 'http://localhost');
    if (url.pathname === '/health' && request.method === 'GET') { writeJson(response, 200, { success: true, protocol: WEB_PROTOCOL_VERSION }); return; }
    if (url.pathname === '/mcp') {
      policy.checkOrigin(request, false);
      const token = request.headers.authorization?.startsWith('Bearer ') ? request.headers.authorization.slice(7) : '';
      if (!auth.acceptsToken(token)) throw new HttpError(401, 'AUTH_REQUIRED');
      await proxyMcp(request, response, mcp!); return;
    }
    if (!url.pathname.startsWith('/api/')) {
      if (request.method !== 'GET') throw new HttpError(405, 'METHOD_NOT_ALLOWED');
      await serveStatic(options.publicDir, url.pathname, response); return;
    }
    policy.checkOrigin(request, request.method !== 'GET');
    if (url.pathname === '/api/login' && request.method === 'POST') {
      const body = await readJson(request, 4_096);
      const session = auth.login(body && typeof body === 'object' && 'token' in body ? body.token : undefined, request.socket.remoteAddress ?? 'unknown');
      response.setHeader('Set-Cookie', auth.cookie(session));
      writeJson(response, 200, { csrf: session.csrf, runtime: runtimeInfo() }); return;
    }
    const session = auth.requireSession(request);
    if (request.method !== 'GET') auth.requireCsrf(request, session);
    if (url.pathname === '/api/session' && request.method === 'GET') { writeJson(response, 200, { csrf: session.csrf, runtime: runtimeInfo() }); return; }
    if (url.pathname === '/api/workspaces' && request.method === 'GET') {
      writeJson(response, 200, await workspaces.list(url.searchParams.get('parentId') ?? undefined)); return;
    }
    if (url.pathname === '/api/workspaces/select' && request.method === 'POST') {
      const body = await readJson(request, 1024) as { id?: unknown };
      if (typeof body?.id !== 'string') throw new HttpError(400, 'WORKSPACE_ID_REQUIRED');
      writeJson(response, 200, { root: await workspaces.select(body.id) }); return;
    }
    if (url.pathname === '/api/workspaces/create' && request.method === 'POST') {
      const body = await readJson(request, 1024) as { parentId?: unknown; name?: unknown };
      if (typeof body?.parentId !== 'string' || typeof body.name !== 'string') throw new HttpError(400, 'WORKSPACE_INPUT_INVALID');
      writeJson(response, 200, await workspaces.create(body.parentId, body.name)); return;
    }
    if (url.pathname === '/api/resources/upload' && request.method === 'POST') {
      if (++activeUploads > 4) { activeUploads--; throw new HttpError(429, 'UPLOAD_CAPACITY'); }
      try {
        const name = request.headers['x-linkterm-filename'];
        if (typeof name !== 'string') throw new HttpError(400, 'FIRMWARE_NAME_REQUIRED');
        writeJson(response, 200, await firmware.upload(name, await readBytes(request, 32 * 1024 * 1024)));
      } finally { activeUploads--; }
      return;
    }
    if (url.pathname === '/api/logout' && request.method === 'POST') {
      auth.logout(session.id);
      for (const peer of peers.values()) if (peer.sessionId === session.id) peer.close(1008, 'Signed out');
      response.setHeader('Set-Cookie', auth.cookie()); writeJson(response, 200, { success: true }); return;
    }
    if (url.pathname === '/api/request' && request.method === 'POST') {
      const peer = peerForRequest(request, session.id);
      writeJson(response, 200, await invoke(peer, await readJson(request, WEB_MAX_FRAME_BYTES))); return;
    }
    if (url.pathname.startsWith('/api/requests/') && request.method === 'GET') {
      writeJson(response, 200, ledger.status(session.id, url.pathname.slice('/api/requests/'.length))); return;
    }
    if (url.pathname === '/api/ui-target' && request.method === 'POST') {
      uiTarget = peerForRequest(request, session.id); writeJson(response, 200, { success: true }); return;
    }
    throw new HttpError(404, 'NOT_FOUND');
  }

  server.on('upgrade', (request, socket, head) => {
    try {
      if (!policy || closing) throw new HttpError(503, 'SERVER_STOPPING');
      policy.checkHost(request); policy.checkOrigin(request);
      if (request.url !== '/api/events') throw new HttpError(404, 'NOT_FOUND');
      const session = auth.requireSession(request);
      if (peers.size >= 64 || [...peers.values()].filter(peer => peer.sessionId === session.id).length >= 16) throw new HttpError(429, 'TOO_MANY_CLIENTS');
      sockets.handleUpgrade(request, socket, head, ws => {
        const peer = new NetworkPeer(nextPeerId++, session.id, ws);
        peers.set(peer.clientId, peer);
        uiTarget ??= peer;
        peer.once('destroyed', () => { peers.delete(peer.clientId); if (uiTarget === peer) uiTarget = undefined; });
        peer.sendFrame({ type: 'hello', protocol: WEB_PROTOCOL_VERSION, clientId: peer.clientId, runtime: runtimeInfo() });
        ws.on('message', (raw, binary) => {
          let request: WebRequest;
          try {
            if (binary) throw new Error('Binary frames are not supported');
            const frame = WebClientFrameSchema.parse(JSON.parse(raw.toString()));
            request = frame.request;
          } catch { peer.close(1008, 'Invalid client frame'); return; }
          void Promise.resolve().then(() => invoke(peer, request)).then(
            result => peer.sendFrame({ type: 'response', id: request.id, result }),
            error => peer.sendFrame({ type: 'response', id: request.id, result: errorResult(error) }),
          );
        });
      });
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 500;
      socket.end(`HTTP/1.1 ${status} Rejected\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
    }
  });

  const close = (): Promise<void> => closing ??= (async () => {
    ledger.stopAccepting();
    if (heartbeat) clearInterval(heartbeat);
    const httpClosed = server.listening ? new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())) : Promise.resolve();
    server.closeIdleConnections();
    const forceClose = setTimeout(() => server.closeAllConnections(), 5_000); forceClose.unref();
    const failures: unknown[] = [];
    const results = await Promise.allSettled([ledger.settle(), mcp?.close()]);
    for (const result of results) if (result.status === 'rejected') failures.push(result.reason);
    for (const peer of peers.values()) peer.close();
    auth.clear();
    try { await httpClosed; } catch (error) { failures.push(error); }
    clearTimeout(forceClose);
    try { unregister?.(); } catch (error) { failures.push(error); }
    try { await runtime.dispose(); } catch (error) { failures.push(error); }
    await new Promise<void>(resolve => sockets.close(() => resolve()));
    if (failures.length) throw new AggregateError(failures, 'Server shutdown failed');
  })();

  try {
    mcp = await startMcpHttpRuntimeServer({ ...runtime, metadataPath: path.join(runtime.dataDir, 'mcp-runtime.json'), host: '127.0.0.1', port: 0,
      getActiveWindow: () => null,
      uiBridge: { applyPatch: patch => {
        if (!uiTarget || uiTarget.isDestroyed() || !auth.getSession(uiTarget.sessionId)) throw new ToolError('UI_NOT_AVAILABLE', 'Select an authenticated browser as the UI target');
        uiTarget.send(CLIENT_CHANNELS.UI_STATE_PATCH, patch);
      } },
    });
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(options.port ?? 8711, host, () => { server.off('error', reject); resolve(); });
    });
    const port = (server.address() as AddressInfo).port;
    const url = publicOrigin?.origin ?? `http://${host.includes(':') ? `[${host}]` : host}:${port}`;
    agentIntegrationManager = new AgentIntegrationManager({
      targets: [{
        id: 'codex', label: 'Codex (server host)',
        configPath: path.join(options.agentConfigHome ?? homedir(), '.codex', 'config.toml'),
        configKind: 'codex-config-toml', locationLabel: 'Server host',
        transport: { type: 'http', url: `${url}/mcp`, bearerTokenEnvVar: 'LINKTERM_MCP_TOKEN' },
      }],
      launchConfig: { command: process.execPath, args: [], env: {} },
    });
    unregister = registerRuntimeClientServices(runtime, {
      requests, getPeers: () => [...peers.values()].filter(peer => !!auth.getSession(peer.sessionId) && !peer.isDestroyed()),
      chooseWorkspaceRoot: async () => failure('WEB_FILE_SELECTION_REQUIRED', 'Select a server workspace in the browser'),
      chooseFirmwareFile: async () => failure('WEB_FILE_SELECTION_REQUIRED', 'Upload or select firmware in the browser'),
    }, { agentIntegrationManager, isTrustedPeer: id => [...peers.values()].some(peer => peer.id === id && !peer.isDestroyed() && !!auth.getSession(peer.sessionId)) });
    const origins = publicOrigin ? [publicOrigin.origin] : [...LOOPBACK_HOSTS].filter(value => value !== '::1').map(value => `http://${value}:${port}`);
    if (devOrigin) origins.push(devOrigin.origin);
    policy = new OriginPolicy(origins);
    heartbeat = setInterval(() => {
      for (const peer of peers.values()) {
        if (!auth.getSession(peer.sessionId) || !peer.alive) { peer.close(1008, 'Session expired or connection lost'); continue; }
        peer.alive = false; peer.socket.ping();
      }
    }, 30_000); heartbeat.unref();
    return { url, runtime, runtimeId, close };
  } catch (error) {
    try { await close(); } catch (cleanupError) { throw new AggregateError([error, cleanupError], 'Server startup and cleanup failed'); }
    throw error;
  }
}

/** Resolve browser resource IDs and constrain control-profile paths to configured host roots. */
async function authorizeWebPayload(method: string, payload: unknown, workspaces: WorkspaceResources, firmware: FirmwareResources): Promise<unknown> {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return payload;
  const raw = payload as Record<string, unknown>;
  if (method.startsWith('controlProfile:') && typeof raw.root === 'string') await workspaces.requireDirectory(raw.root);
  const config = raw.config;
  if ((method === CLIENT_CHANNELS.SESSION_CREATE || method.startsWith('connections:') || method === CLIENT_CHANNELS.RTT_LOG_OPEN) && config && typeof config === 'object' && 'root' in config && typeof config.root === 'string') await workspaces.requireDirectory(config.root);
  if (method !== CLIENT_CHANNELS.CONTROL_PROFILE_SAVE) return payload;
  const profile = raw.profile;
  if (!profile || typeof profile !== 'object' || !('flash' in profile) || !profile.flash || typeof profile.flash !== 'object' || !('binary' in profile.flash) || typeof profile.flash.binary !== 'string') return payload;
  const selected = profile.flash.binary;
  const binary = selected.startsWith('resource:') ? await firmware.resolve(selected) : typeof raw.root === 'string' ? await workspaces.firmwareReference(raw.root, selected) : selected;
  return { ...raw, profile: { ...profile, flash: { ...profile.flash, binary } } };
}

function parseOrigin(value: string): URL {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('Expected an HTTP(S) origin without a path, query, or credentials');
  return url;
}
function errorResult(error: unknown) {
  return error instanceof HttpError ? failure(error.code, error.message) : failure('INTERNAL', 'The operation failed');
}
function respondError(response: ServerResponse, error: unknown): void {
  if (response.headersSent) { response.destroy(); return; }
  writeJson(response, error instanceof HttpError ? error.status : 500, errorResult(error));
}
