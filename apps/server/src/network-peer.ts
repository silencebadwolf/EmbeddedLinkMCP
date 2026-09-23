import { EventEmitter } from 'node:events';
import { randomBytes } from 'node:crypto';
import { WebSocket } from 'ws';
import type { ClientPeer } from '@linkterm/runtime/services/client/ports';
import type { WebServerFrame } from '@linkterm/contracts/web-protocol';

export class NetworkPeer extends EventEmitter implements ClientPeer {
  readonly clientId = randomBytes(24).toString('base64url');
  #destroyed = false;
  alive = true;
  constructor(readonly id: number, readonly sessionId: string, readonly socket: WebSocket) {
    super();
    socket.once('close', () => this.disconnect());
    socket.on('error', () => this.disconnect());
    socket.on('pong', () => { this.alive = true; });
  }
  isDestroyed(): boolean { return this.#destroyed || this.socket.readyState !== WebSocket.OPEN; }
  send(channel: string, payload: unknown): void { this.sendFrame({ type: 'event', channel, payload }); }
  sendFrame(frame: WebServerFrame): void {
    if (this.isDestroyed()) return;
    const data = JSON.stringify(frame);
    if (this.socket.bufferedAmount + Buffer.byteLength(data) > 4 * 1024 * 1024) {
      this.close(1013, 'Client too slow; reconnect for a fresh snapshot'); return;
    }
    this.socket.send(data);
  }
  close(code = 1001, reason = 'Connection closed'): void {
    this.disconnect();
    this.socket.close(code, reason);
    const timer = setTimeout(() => this.socket.terminate(), 2_000);
    timer.unref(); this.socket.once('close', () => clearTimeout(timer));
  }
  disconnect(): void {
    if (this.#destroyed) return;
    this.#destroyed = true;
    this.emit('destroyed');
  }
}
