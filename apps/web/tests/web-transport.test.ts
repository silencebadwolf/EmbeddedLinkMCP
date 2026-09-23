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
  open(): void {
    this.readyState = FakeSocket.OPEN;
    this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify({
      type: 'hello', protocol: WEB_PROTOCOL_VERSION, clientId: 'peer-one', runtime,
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
  const fetchCommand = vi.fn((_url: string, init: RequestInit) => new Promise<never>((_, reject) => {
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
  expect(fetchCommand).toHaveBeenCalledTimes(1);
  expect(sockets[0].readyState).toBe(3);
  transport.close();
});
