import { EventEmitter } from 'node:events';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';

/**
 * 进程内 MCP transport，将两端 message 直接对接 —— 不经过 stdin/stdout，
 * 适合在 Vitest 中模拟 client ↔ server 往返而无需启动子进程。
 *
 * 用法：
 *   const { server, client } = createPair();
 *   await mcpServer.connect(server);
 *   await mcpClient.connect(client);
 *
 * 设计：每端都是一个独立的 Transport 实现，send 时把 message 推送到对端的 onmessage。
 */
class InMemoryTransport extends EventEmitter implements Transport {
  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: (message: JSONRPCMessage) => void;

  /** 对端 transport；构造后通过 setPeer 绑定。 */
  #peer: InMemoryTransport | null = null;
  #started = false;
  #closed = false;

  setPeer(peer: InMemoryTransport): void {
    this.#peer = peer;
  }

  async start(): Promise<void> {
    if (this.#started) throw new Error('already started');
    this.#started = true;
  }

  async send(message: JSONRPCMessage): Promise<void> {
    if (this.#closed) throw new Error('transport closed');
    const peer = this.#peer;
    if (!peer) throw new Error('peer not set');
    // 异步派发，避免在同一 microtask 中互相递归
    queueMicrotask(() => {
      if (peer.#closed) return;
      peer.onmessage?.(message);
    });
  }

  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    this.onclose?.();
    const peer = this.#peer;
    if (peer && !peer.#closed) {
      peer.close().catch(() => undefined);
    }
  }
}

/** 创建一对内存 transport，互相对接。 */
export function createInMemoryMcpTransportPair(): {
  server: InMemoryTransport;
  client: InMemoryTransport;
} {
  const server = new InMemoryTransport();
  const client = new InMemoryTransport();
  server.setPeer(client);
  client.setPeer(server);
  return { server, client };
}

export type { InMemoryTransport };
