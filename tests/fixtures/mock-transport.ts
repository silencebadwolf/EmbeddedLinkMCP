import { EventEmitter } from 'node:events';
import type { ITransport } from '@/transports/types.js';

export interface MockTransportOptions {
  /** open() 时是否立即抛错。 */
  failOnOpen?: Error;
  /** write() 时返回的 promise 行为：'resolve'（默认）、'reject'、'never'（永不 settle）。 */
  writeBehavior?: 'resolve' | 'reject' | 'never';
  /** 当 writeBehavior 为 'reject' 时使用的错误。 */
  writeError?: Error;
}

/**
 * 进程内 mock transport，提供完整 ITransport 契约：
 * - open/close 即时 resolve（除非配置了 failOnOpen）
 * - write 默认即时 resolve；可配置为 reject 或永不 settle 以模拟阻塞
 * - pushIncoming(bytes) / pushError(err) / triggerClose() 让测试主动驱动事件
 */
export class MockTransport extends EventEmitter implements ITransport {
  #open = false;
  #closed = false;
  /** 测试可读：所有调用 write() 的字节按顺序记录。 */
  readonly writes: Uint8Array[] = [];

  constructor(private readonly options: MockTransportOptions = {}) {
    super();
  }

  isOpen(): boolean {
    return this.#open;
  }

  async open(): Promise<void> {
    if (this.#open) return;
    if (this.options.failOnOpen) throw this.options.failOnOpen;
    this.#open = true;
  }

  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    this.#open = false;
    this.emit('close');
  }

  async write(data: Uint8Array): Promise<void> {
    if (this.#closed || !this.#open) {
      throw new Error('mock transport not open');
    }
    this.writes.push(data);
    const behavior = this.options.writeBehavior ?? 'resolve';
    if (behavior === 'resolve') return;
    if (behavior === 'reject') {
      throw this.options.writeError ?? new Error('mock write rejected');
    }
    // 'never'
    return new Promise<void>(() => {
      /* never resolves */
    });
  }

  /** 模拟设备发送数据。 */
  pushIncoming(data: Uint8Array): void {
    this.emit('data', data);
  }

  /** 模拟 transport 层错误。 */
  pushError(err: Error): void {
    this.emit('error', err);
  }

  /** 模拟底层主动关闭（断连）。 */
  triggerClose(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#open = false;
    this.emit('close');
  }
}
