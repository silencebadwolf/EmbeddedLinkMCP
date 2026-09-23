import { EventEmitter } from 'node:events';
import { expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { NetworkPeer } from '../src/network-peer.js';

class SlowSocket extends EventEmitter {
  readyState = WebSocket.OPEN;
  bufferedAmount = 4 * 1024 * 1024;
  readonly sent: string[] = [];
  readonly closures: { code: number; reason: string }[] = [];
  send(frame: string): void { this.sent.push(frame); }
  close(code: number, reason: string): void {
    this.closures.push({ code, reason });
    this.readyState = WebSocket.CLOSED;
    queueMicrotask(() => this.emit('close'));
  }
  terminate(): void { this.readyState = WebSocket.CLOSED; this.emit('close'); }
}

it('disconnects a slow browser before queuing another event frame', async () => {
  const socket = new SlowSocket();
  const peer = new NetworkPeer(1, 'session-one', socket as unknown as WebSocket);
  let destroyed = 0;
  peer.on('destroyed', () => { destroyed += 1; });

  peer.send('session:lifecycle', { type: 'stateChanged' });
  await Promise.resolve();

  expect(socket.sent).toHaveLength(0);
  expect(socket.closures).toMatchObject([{ code: 1013 }]);
  expect(destroyed).toBe(1);
  expect(peer.isDestroyed()).toBe(true);
});
