// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CLIENT_CHANNELS } from '@linkterm/contracts/client-protocol';
import { WEB_PROTOCOL_VERSION, type WebRuntimeInfo } from '@linkterm/contracts/web-protocol';
import { WebTransport } from '../src/web-transport.js';

const runtime: WebRuntimeInfo = {
  id: 'runtime-one', hostname: 'test-host', platform: 'win32',
  protocol: WEB_PROTOCOL_VERSION, serverTime: Date.now(),
  capabilities: { nativeFilePicker: false, screenshot: false, terminalHost: 'server' },
};

class FakeSocket extends EventTarget {
  static readonly CLOSING = 2;
  static readonly OPEN = 1;
  readonly sent: string[] = [];
  readyState = 0;
  constructor(readonly url: URL) { super(); sockets.push(this); }
  send(data: string): void { this.sent.push(data); }
  open(serverRuntime: WebRuntimeInfo = runtime): void {
    this.readyState = FakeSocket.OPEN;
    this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify({
      type: 'hello', protocol: WEB_PROTOCOL_VERSION, clientId: 'peer-one', runtime: serverRuntime,
    }) }));
  }
  close(): void {
    if (this.readyState === 3) return;
    this.readyState = 3; this.dispatchEvent(new Event('close'));
  }
}

let sockets: FakeSocket[];
beforeEach(() => {
  sockets = [];
  vi.stubGlobal('WebSocket', FakeSocket);
  vi.stubGlobal('location', { href: 'http://localhost:5174/' });
  vi.stubGlobal('fetch', vi.fn(async () => ({ status: 200, ok: true, json: async () => ({}) })));
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it('reconnects when the server never sends its hello frame', async () => {
  vi.useFakeTimers();
  const transport = new WebTransport('csrf', runtime);
  transport.connect();
  await vi.advanceTimersByTimeAsync(10_000);
  expect(sockets[0].readyState).toBe(3);
  expect(transport.status).toBe('disconnected');
  await vi.advanceTimersByTimeAsync(500);
  expect(sockets).toHaveLength(2);
  sockets[1].open();
  expect(transport.status).toBe('connected');
  transport.close();
});

it('keeps an interrupted terminal write uncertain and does not resend it after reconnect', async () => {
  vi.useFakeTimers();
  const fetchStatus = vi.fn(async () => ({ ok: true, json: async () => ({ state: 'completed' }) }));
  vi.stubGlobal('fetch', fetchStatus);
  const transport = new WebTransport('csrf', runtime);
  transport.connect(); sockets[0].open();
  const writing = transport.invoke(CLIENT_CHANNELS.SESSION_WRITE, { sessionId: 'sess_one', dataBase64: 'YQ==' });
  expect(sockets[0].sent).toHaveLength(1);
  const request = JSON.parse(sockets[0].sent[0]) as { request: { id: string } };

  sockets[0].close();
  await expect(writing).resolves.toMatchObject({ success: false, error: { code: 'CONNECTION_LOST' } });
  expect(transport.uncertainRequests).toContain(request.request.id);
  await vi.advanceTimersByTimeAsync(500);
  expect(sockets).toHaveLength(2);
  sockets[1].open();
  await Promise.resolve(); await Promise.resolve();
  expect(sockets[1].sent).toHaveLength(0);
  expect(fetchStatus).toHaveBeenCalledWith(`/api/requests/${request.request.id}`, expect.anything());
  expect(transport.uncertainRequests).toHaveLength(0);
  transport.close();
});

it('keeps old command outcomes visibly unrecoverable after a server restart', async () => {
  vi.useFakeTimers();
  const fetchStatus = vi.fn(async (_url: string) => ({ status: 200 }));
  vi.stubGlobal('fetch', fetchStatus);
  const transport = new WebTransport('csrf', runtime);
  transport.connect(); sockets[0].open();
  const writing = transport.invoke(CLIENT_CHANNELS.SESSION_WRITE, { sessionId: 'sess_one', dataBase64: 'YQ==' });
  const request = JSON.parse(sockets[0].sent[0]) as { request: { id: string } };
  sockets[0].close();
  await writing;

  await vi.advanceTimersByTimeAsync(500);
  sockets[1].open({ ...runtime, id: 'runtime-two' });
  expect(transport.status).toBe('connected');
  expect(transport.runtimeReplaced).toBe(true);
  expect(transport.uncertainRequests).toHaveLength(0);
  expect(transport.unrecoverableRequests).toContain(request.request.id);
  expect(sockets[1].sent).toHaveLength(0);
  expect(fetchStatus).toHaveBeenCalledWith('/api/session', expect.anything());
  expect(fetchStatus.mock.calls.some(([url]) => String(url).startsWith('/api/requests/'))).toBe(false);
  transport.close();
});

it('returns to login when the server rejects the old browser session', async () => {
  vi.useFakeTimers();
  const checkSession = vi.fn(async () => ({ status: 401 }));
  vi.stubGlobal('fetch', checkSession);
  const transport = new WebTransport('csrf', runtime);
  transport.connect(); sockets[0].open();
  const writing = transport.invoke(CLIENT_CHANNELS.SESSION_WRITE, { sessionId: 'sess_one', dataBase64: 'YQ==' });
  sockets[0].close();
  await writing;
  await Promise.resolve(); await Promise.resolve();

  expect(transport.status).toBe('auth-required');
  expect(transport.uncertainRequests).toHaveLength(1);
  await vi.advanceTimersByTimeAsync(10_000);
  expect(sockets).toHaveLength(1);
  expect(checkSession).toHaveBeenCalledWith('/api/session', expect.anything());
  transport.close();
});

it('bounds a half-open WebSocket command and marks its result uncertain', async () => {
  vi.useFakeTimers();
  const transport = new WebTransport('csrf', runtime);
  transport.connect(); sockets[0].open();
  const writing = transport.invoke(CLIENT_CHANNELS.SESSION_WRITE, { sessionId: 'sess_one', dataBase64: 'YQ==' });
  const request = JSON.parse(sockets[0].sent[0]) as { request: { id: string } };

  await vi.advanceTimersByTimeAsync(30_000);
  await expect(writing).resolves.toMatchObject({ success: false, error: { code: 'CONNECTION_LOST' } });
  expect(transport.uncertainRequests).toContain(request.request.id);
  expect(sockets[0].readyState).toBe(3);
  transport.close();
});

it('aborts a stalled HTTP command without automatically repeating it', async () => {
  vi.useFakeTimers();
  const fetchCommand = vi.fn((url: string, init: RequestInit) => url === '/api/session'
    ? Promise.resolve({ status: 200 })
    : new Promise<never>((_, reject) => {
    init.signal?.addEventListener('abort', () => reject(new Error('aborted')));
    }));
  vi.stubGlobal('fetch', fetchCommand);
  const transport = new WebTransport('csrf', runtime);
  transport.connect(); sockets[0].open();
  const listing = transport.invoke(CLIENT_CHANNELS.SESSION_LIST);
  const request = JSON.parse(fetchCommand.mock.calls[0][1].body as string) as { id: string };

  await vi.advanceTimersByTimeAsync(30_000);
  await expect(listing).resolves.toMatchObject({ success: false, error: { code: 'CONNECTION_LOST' } });
  expect(transport.uncertainRequests).toContain(request.id);
  expect(fetchCommand.mock.calls.filter(([url]) => url === '/api/request')).toHaveLength(1);
  expect(sockets[0].readyState).toBe(3);
  transport.close();
});

it('recovers a download start result from the ledger after its HTTP response is lost', async () => {
  const recoveredJob = { success: true, data: { jobId: 'job_started_once', state: 'queued' } };
  const fetchCommand = vi.fn(async (url: string, _init?: RequestInit) => {
    if (url === '/api/request') throw new Error('response lost');
    if (url.startsWith('/api/requests/')) return { status: 200, ok: true, json: async () => ({ state: 'completed', result: recoveredJob }) };
    return { status: 200, ok: true, json: async () => ({}) };
  });
  vi.stubGlobal('fetch', fetchCommand);
  const transport = new WebTransport('csrf', runtime);
  transport.connect(); sockets[0].open();

  await expect(transport.invoke(CLIENT_CHANNELS.CONTROL_PROFILE_START_DOWNLOAD, { root: 'C:/repo' })).resolves.toEqual(recoveredJob);
  const posted = fetchCommand.mock.calls.filter(([url]) => url === '/api/request');
  expect(posted).toHaveLength(1);
  const request = JSON.parse((posted[0][1] as RequestInit).body as string) as { id: string };
  expect(fetchCommand).toHaveBeenCalledWith(`/api/requests/${request.id}`, expect.anything());
  expect(transport.uncertainRequests).toHaveLength(0);
  expect(sockets[0].readyState).toBe(FakeSocket.OPEN);
  transport.close();
});

it('keeps a compensation start uncertain when the lost response is absent from the ledger', async () => {
  const fetchCommand = vi.fn(async (url: string, _init?: RequestInit) => url === '/api/request'
    ? Promise.reject(new Error('response lost'))
    : url.startsWith('/api/requests/')
      ? { status: 404, ok: false }
      : { status: 200, ok: true });
  vi.stubGlobal('fetch', fetchCommand);
  const transport = new WebTransport('csrf', runtime);
  transport.connect(); sockets[0].open();

  await expect(transport.invoke(CLIENT_CHANNELS.CONTROL_PROFILE_START_COMPENSATION_REFLASH, { candidateId: 'candidate_1' }))
    .resolves.toMatchObject({ success: false, error: { code: 'CONNECTION_LOST' } });
  const posted = fetchCommand.mock.calls.filter(([url]) => url === '/api/request');
  expect(posted).toHaveLength(1);
  const request = JSON.parse((posted[0][1] as RequestInit).body as string) as { id: string };
  expect(transport.uncertainRequests).toContain(request.id);
  expect(sockets[0].readyState).toBe(3);
  transport.close();
});

it('does not query a replacement runtime or close its socket for an old download start', async () => {
  vi.useFakeTimers();
  let rejectRequest!: (error: Error) => void;
  const fetchCommand = vi.fn((url: string, _init?: RequestInit) => url === '/api/request'
    ? new Promise<never>((_, reject) => { rejectRequest = reject; })
    : Promise.resolve({ status: 200, ok: true }));
  vi.stubGlobal('fetch', fetchCommand);
  const transport = new WebTransport('csrf', runtime);
  transport.connect(); sockets[0].open();
  const starting = transport.invoke(CLIENT_CHANNELS.CONTROL_PROFILE_START_DOWNLOAD, { root: 'C:/repo' });
  const request = JSON.parse(fetchCommand.mock.calls[0][1]?.body as string) as { id: string };

  sockets[0].close();
  await vi.advanceTimersByTimeAsync(500);
  sockets[1].open({ ...runtime, id: 'runtime-two' });
  rejectRequest(new Error('old response lost'));

  await expect(starting).resolves.toMatchObject({ success: false, error: { code: 'CONNECTION_LOST' } });
  expect(transport.unrecoverableRequests).toContain(request.id);
  expect(transport.uncertainRequests).toHaveLength(0);
  expect(sockets[1].readyState).toBe(FakeSocket.OPEN);
  expect(fetchCommand.mock.calls.some(([url]) => String(url).startsWith('/api/requests/'))).toBe(false);
  transport.close();
});
