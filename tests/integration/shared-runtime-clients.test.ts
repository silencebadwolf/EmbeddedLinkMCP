import { EventEmitter } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { createClientAPI } from '@linkterm/contracts/create-client';
import type { ClientTransport } from '@linkterm/contracts/client-transport';
import { createRuntime } from '@linkterm/runtime';
import { AgentIntegrationManager } from '@linkterm/runtime/core/agent-integrations/index';
import { NullJLinkBackend } from '@linkterm/runtime/jlink/null-backend';
import { registerRuntimeClientServices, type ClientInvocation, type ClientRequestRegistry, type ClientServiceHost } from '@linkterm/runtime/services/client/index';
import { createMockPtyFactory } from '../fixtures/mock-pty.js';

class Peer extends EventEmitter {
  destroyed = false;
  constructor(readonly id: number) { super(); }
  isDestroyed() { return this.destroyed; }
  send(channel: string, payload: unknown) { this.emit(channel, undefined, payload); }
  disconnect() { this.destroyed = true; this.emit('destroyed'); }
}

it('runs typed clients over host-neutral services and keeps sessions/jobs when a peer disconnects', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'linkterm-client-services-'));
  const pty = createMockPtyFactory();
  const runtime = await createRuntime({
    dataDir,
    nativeBindings: { createPty: pty.factory, createSerialPort: () => { throw new Error('No hardware'); }, listSerialPorts: async () => [] },
    secretCodec: { isAvailable: () => false, encryptUtf8: () => { throw new Error('Unavailable'); }, decryptUtf8: () => { throw new Error('Unavailable'); } },
    jlinkBackend: new NullJLinkBackend(),
  });
  const peers = [new Peer(1), new Peer(2)];
  const handlers = new Map<string, (event: ClientInvocation, payload: unknown) => unknown>();
  const requests: ClientRequestRegistry = {
    handle<T>(method: string, handler: (event: ClientInvocation, payload: T) => unknown) {
      if (handlers.has(method)) throw new Error(`Duplicate method: ${method}`);
      handlers.set(method, (event, payload) => handler(event, payload as T));
    },
    removeHandler: method => { handlers.delete(method); },
  };
  const host: ClientServiceHost = {
    requests, getPeers: () => peers.filter(peer => !peer.destroyed),
    chooseWorkspaceRoot: async () => ({ success: true, data: { root: dataDir } }),
    chooseFirmwareFile: async () => ({ success: true, data: { path: null } }),
  };
  const off = registerRuntimeClientServices(runtime, host, {
    agentIntegrationManager: new AgentIntegrationManager({ targets: [], launchConfig: { command: process.execPath, args: [] } }),
    isTrustedPeer: id => id === 2,
  });
  const client = (peer: Peer) => {
    const transport: ClientTransport = {
      invoke: async (method, payload) => {
        if (peer.destroyed) throw new Error('Disconnected');
        const handler = handlers.get(method);
        if (!handler) throw new Error('Unknown method');
        return handler({ sender: peer }, payload);
      },
      on: (channel, listener) => { peer.on(channel, listener); },
      removeListener: (channel, listener) => { peer.removeListener(channel, listener); },
    };
    return createClientAPI(transport);
  };
  try {
    const first = client(peers[0]), second = client(peers[1]);
    const opened = await first.session.create({ config: { type: 'local-shell' } });
    expect(opened.success).toBe(true);
    if (!opened.success) throw new Error(opened.error.message);
    const { sessionId } = opened.data;
    expect((await second.session.list()).success).toBe(true);
    expect(runtime.sessionManager.list()).toHaveLength(1);
    expect(pty.created).toHaveLength(1);
    const events = vi.fn();
    second.transcript.onEvent(events);
    await first.session.subscribe({ sessionId });
    await second.session.subscribe({ sessionId });
    await second.activity.subscribe();
    await second.readiness.subscribe();
    const payload = { sessionId, dataBase64: Buffer.from('hello').toString('base64'), origin: 'ai' };
    expect(await first.session.write(payload)).toEqual({ success: true, data: { bytesWritten: 5 } });
    expect(pty.created[0].writes).toEqual(['hello']);
    expect(runtime.sessionManager.read(sessionId, 0).events.find(event => event.type === 'data')?.origin).toBe('human');
    expect((await first.activity.status()).success).toBe(false);
    pty.created[0].pushIncoming('reply\r\n');
    expect(events).toHaveBeenCalled();
    expect(runtime.sessionManager.getSubscriberCursor('wc:1', sessionId)).toBeGreaterThan(0);
    const job = runtime.controlWorkflowJobManager.create({ input: { root: dataDir, mode: 'flash-observe' } });
    peers[0].disconnect();
    expect(runtime.sessionManager.getSubscriberCursor('wc:1', sessionId)).toBe(0);
    expect(runtime.sessionManager.list()).toHaveLength(1);
    expect(pty.created[0].killCalls).toBe(0);
    expect((await second.controlProfile.getDownloadStatus({ jobId: job.jobId })).success).toBe(true);
    expect((await second.connections.list()).success).toBe(true);
    expect((await second.readiness.get()).success).toBe(true);
    expect((await second.activity.status()).success).toBe(true);
    off();
    expect(handlers.size).toBe(0);
    expect(peers[1].listenerCount('destroyed')).toBe(0);
  } finally {
    for (const peer of peers) peer.disconnect();
    off(); await runtime.dispose();
    await rm(dataDir, { recursive: true, force: true });
  }
});
