import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { expect, it, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { CLIENT_CHANNELS } from '@linkterm/contracts/client-protocol';
import { NullJLinkBackend } from '@linkterm/runtime/jlink/null-backend';
import { createMockPtyFactory } from '../../../tests/fixtures/mock-pty.js';
import { ServerSecretCodec } from '../src/secret-codec.js';
import { startServer } from '../src/server.js';

async function connect(url: string, cookie: string, origin: string): Promise<{ socket: WebSocket; clientId: string }> {
  const socket = new WebSocket(url.replace(/^http/u, 'ws') + '/api/events', { headers: { Cookie: cookie, Origin: origin } });
  const hello = new Promise<{ clientId: string }>((resolve, reject) => {
    socket.once('message', raw => resolve(JSON.parse(raw.toString()) as { clientId: string }));
    socket.once('error', reject);
  });
  await new Promise<void>((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
  return { socket, clientId: (await hello).clientId };
}

it('serves authenticated Web clients from one runtime and retains commands across duplicate requests', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'linkterm-web-server-'));
  const publicDir = join(dataDir, 'public');
  await mkdir(publicDir);
  await writeFile(join(publicDir, 'index.html'), '<h1>LinkTerm Web</h1>');
  const pty = createMockPtyFactory();
  const token = randomBytes(32).toString('base64');
  const options = { runtime: { dataDir,
    nativeBindings: { createPty: pty.factory, createSerialPort: () => { throw new Error('No hardware'); }, listSerialPorts: async () => [] },
    secretCodec: new ServerSecretCodec(randomBytes(32)), jlinkBackend: new NullJLinkBackend(),
  }, accessToken: token, publicDir, host: '127.0.0.1', port: 0, agentConfigHome: join(dataDir, 'agent-home') } as const;
  const server = await startServer(options);
  const peers: WebSocket[] = [];
  let mcpClient: Client | undefined;
  try {
    const origin = server.url;
    const page = await fetch(server.url);
    expect(await page.text()).toContain('LinkTerm Web');
    expect((await fetch(server.url + '/api/session')).status).toBe(401);
    expect((await fetch(server.url + '/api/login', { method: 'POST', headers: { Origin: 'https://attacker.example', 'Content-Type': 'application/json' }, body: JSON.stringify({ token }) })).status).toBe(403);
    expect((await fetch(server.url + '/mcp')).status).toBe(401);
    const login = await fetch(server.url + '/api/login', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ token }) });
    expect(login.status).toBe(200);
    const cookie = login.headers.get('set-cookie')!.split(';')[0];
    const { csrf, runtime } = await login.json() as { csrf: string; runtime: { id: string; capabilities: { terminalHost: string } } };
    expect(runtime.capabilities.terminalHost).toBe('server');
    const first = await connect(origin, cookie, origin); peers.push(first.socket);
    const second = await connect(origin, cookie, origin); peers.push(second.socket);
    const command = (method: string, payload?: unknown) => ({ id: randomUUID(), issuedAt: Date.now(), method, payload });
    const send = (clientId: string, request: ReturnType<typeof command>, extraHeaders: Record<string, string> = {}) => fetch(server.url + '/api/request', {
      method: 'POST', headers: { Origin: origin, Cookie: cookie, 'X-Linkterm-Csrf': csrf, 'X-Linkterm-Client': clientId, 'Content-Type': 'application/json', ...extraHeaders }, body: JSON.stringify(request),
    });
    expect((await send(first.clientId, command(CLIENT_CHANNELS.SESSION_LIST), { 'X-Linkterm-Csrf': 'wrong' })).status).toBe(403);
    const create = command(CLIENT_CHANNELS.SESSION_CREATE, { config: { type: 'local-shell' } });
    const created = await (await send(first.clientId, create)).json() as { success: boolean; data: { sessionId: string } };
    expect(created.success).toBe(true);
    expect((await (await send(first.clientId, create)).json())).toEqual(created);
    expect(pty.created).toHaveLength(1);
    const list = await (await send(second.clientId, command(CLIENT_CHANNELS.SESSION_LIST))).json() as { success: boolean; data: { sessions: unknown[] } };
    expect(list.success).toBe(true); expect(list.data.sessions).toHaveLength(1);
    const agents = await (await send(first.clientId, command(CLIENT_CHANNELS.AGENT_INTEGRATIONS_LIST))).json() as { success: boolean; data: { id: string; locationLabel: string; transportLabel: string }[] };
    expect(agents).toMatchObject({ success: true, data: [{ id: 'codex', locationLabel: 'Server host', transportLabel: 'HTTP' }] });
    const installed = await (await send(first.clientId, command(CLIENT_CHANNELS.AGENT_INTEGRATIONS_INSTALL, { targetId: 'codex' }))).json() as { success: boolean };
    expect(installed.success).toBe(true);
    const agentConfig = await readFile(join(dataDir, 'agent-home', '.codex', 'config.toml'), 'utf8');
    expect(agentConfig).toContain(`${server.url}/mcp`);
    expect(agentConfig).toContain('LINKTERM_MCP_TOKEN');
    expect(agentConfig).not.toContain(token);
    mcpClient = new Client({ name: 'web-server-integration', version: '1.0.0' });
    await mcpClient.connect(new StreamableHTTPClientTransport(new URL(`${server.url}/mcp`), {
      requestInit: { headers: { authorization: `Bearer ${token}` } },
    }));
    expect((await mcpClient.listTools()).tools).toHaveLength(63);
    const mcpSessions = await mcpClient.callTool({ name: 'list_sessions', arguments: {} });
    expect(mcpSessions.structuredContent).toMatchObject({
      success: true,
      evidence: { data: { sessions: [{ sessionId: created.data.sessionId }] } },
    });
    const write = command(CLIENT_CHANNELS.SESSION_WRITE, { sessionId: created.data.sessionId, dataBase64: Buffer.from('hello').toString('base64'), origin: 'ai' });
    const response = new Promise<{ type: string; result: { success: boolean } }>((resolve, reject) => {
      const onMessage = (raw: Buffer): void => {
        const frame = JSON.parse(raw.toString()) as { type: string; id?: string; result: { success: boolean } };
        if (frame.type !== 'response' || frame.id !== write.id) return;
        second.socket.off('message', onMessage); resolve(frame);
      };
      second.socket.on('message', onMessage);
      second.socket.once('error', reject);
    });
    second.socket.send(JSON.stringify({ type: 'request', request: write }));
    expect((await response).result.success).toBe(true);
    expect(pty.created[0].writes).toEqual(['hello']);
    expect(server.runtime.sessionManager.read(created.data.sessionId, 0).events.find(event => event.type === 'data')?.origin).toBe('human');
    const status = await fetch(`${server.url}/api/requests/${create.id}`, { headers: { Cookie: cookie } });
    expect((await status.json() as { state: string }).state).toBe('completed');
    const workspaceList = await fetch(server.url + '/api/workspaces', { headers: { Cookie: cookie } });
    const roots = await workspaceList.json() as { directories: { id: string }[] };
    expect(roots.directories).toHaveLength(1);
    const workspaceResponse = await fetch(server.url + '/api/workspaces/create', { method: 'POST', headers: { Origin: origin, Cookie: cookie, 'X-Linkterm-Csrf': csrf, 'Content-Type': 'application/json' }, body: JSON.stringify({ parentId: roots.directories[0].id, name: 'Board_A' }) });
    expect(workspaceResponse.status).toBe(200);
    const selected = await workspaceResponse.json() as { id: string; path: string };
    const upload = await fetch(server.url + '/api/resources/upload', { method: 'POST', headers: { Origin: origin, Cookie: cookie, 'X-Linkterm-Csrf': csrf, 'X-Linkterm-Filename': 'test.bin', 'Content-Type': 'application/octet-stream' }, body: Buffer.from([1, 2, 3]) });
    expect(upload.status).toBe(200);
    const resource = await upload.json() as { id: string };
    const invalid = await (await send(first.clientId, command(CLIENT_CHANNELS.CONTROL_PROFILE_LOAD, { root: dataDir }))).json() as { error: { code: string } };
    expect(invalid.error.code).toBe('WORKSPACE_OUTSIDE_ROOT');
    const saved = await (await send(first.clientId, command(CLIENT_CHANNELS.CONTROL_PROFILE_SAVE, { root: selected.path, profile: { flash: { binary: resource.id } } }))).json() as { success: boolean };
    expect(saved.success).toBe(true);
    const controlProfile = JSON.parse(await readFile(join(selected.path, '.linkterm', 'control-profile.json'), 'utf8')) as { flash: { binary: string } };
    expect(controlProfile.flash.binary).toContain('uploaded-firmware');
    expect(await readFile(controlProfile.flash.binary)).toEqual(Buffer.from([1, 2, 3]));
    await expect(startServer(options)).rejects.toThrow(/locked|owned|in use/i);
    expect(server.runtime.sessionManager.list()).toHaveLength(1);
    const logout = await fetch(server.url + '/api/logout', { method: 'POST', headers: { Origin: origin, Cookie: cookie, 'X-Linkterm-Csrf': csrf } });
    expect(logout.status).toBe(200);
    expect((await fetch(server.url + '/api/session', { headers: { Cookie: cookie } })).status).toBe(401);
  } finally {
    await mcpClient?.close().catch(() => undefined);
    for (const socket of peers) socket.terminate();
    await server.close();
    await rm(dataDir, { recursive: true, force: true });
  }
}, 30_000);

it('drains an accepted Web command before disposing the runtime', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'linkterm-web-drain-'));
  const publicDir = join(dataDir, 'public');
  await mkdir(publicDir);
  await writeFile(join(publicDir, 'index.html'), 'ready');
  const pty = createMockPtyFactory();
  const token = randomBytes(32).toString('base64');
  const server = await startServer({ runtime: { dataDir,
    nativeBindings: { createPty: pty.factory, createSerialPort: () => { throw new Error('No hardware'); }, listSerialPorts: async () => [] },
    secretCodec: new ServerSecretCodec(randomBytes(32)), jlinkBackend: new NullJLinkBackend(),
  }, accessToken: token, publicDir, host: '127.0.0.1', port: 0, agentConfigHome: join(dataDir, 'agent-home') });
  let socket: WebSocket | undefined;
  let releaseWrite: (() => void) | undefined;
  try {
    const origin = server.url;
    const login = await fetch(server.url + '/api/login', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ token }) });
    const cookie = login.headers.get('set-cookie')!.split(';')[0];
    const { csrf } = await login.json() as { csrf: string };
    const peer = await connect(origin, cookie, origin);
    socket = peer.socket;
    const create = await fetch(server.url + '/api/request', { method: 'POST', headers: {
      Origin: origin, Cookie: cookie, 'X-Linkterm-Csrf': csrf, 'X-Linkterm-Client': peer.clientId, 'Content-Type': 'application/json',
    }, body: JSON.stringify({ id: randomUUID(), issuedAt: Date.now(), method: CLIENT_CHANNELS.SESSION_CREATE, payload: { config: { type: 'local-shell' } } }) });
    const created = await create.json() as { success: boolean; data: { sessionId: string } };
    expect(created.success).toBe(true);
    const session = server.runtime.sessionManager.get(created.data.sessionId)!;
    let writeEntered: () => void = () => undefined;
    const entered = new Promise<void>(resolve => { writeEntered = resolve; });
    const writeGate = new Promise<void>(resolve => { releaseWrite = resolve; });
    vi.spyOn(session, 'write').mockImplementation(async () => { writeEntered(); await writeGate; });
    socket.send(JSON.stringify({ type: 'request', request: {
      id: randomUUID(), issuedAt: Date.now(), method: CLIENT_CHANNELS.SESSION_WRITE,
      payload: { sessionId: created.data.sessionId, dataBase64: 'YQ==' },
    } }));
    await Promise.race([entered, new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Write handler did not start')), 3_000))]);
    let stopped = false;
    const closing = server.close().then(() => { stopped = true; });
    await new Promise(resolve => setTimeout(resolve, 25));
    expect(stopped).toBe(false);
    expect(pty.created[0].killCalls).toBe(0);
    releaseWrite();
    await Promise.race([closing, new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Server did not drain the write')), 3_000))]);
    expect(pty.created[0].killCalls).toBe(1);
  } finally {
    releaseWrite?.();
    socket?.terminate();
    await server.close();
    await rm(dataDir, { recursive: true, force: true });
  }
}, 30_000);
