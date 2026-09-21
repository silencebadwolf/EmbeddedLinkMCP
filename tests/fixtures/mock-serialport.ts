import { EventEmitter } from 'node:events';
import type {
  SerialPortFactory,
  SerialPortLike,
  SerialPortOpenOptions,
} from '@linkterm/runtime/transports/serial/serial-port-like';

export interface FakeSerialPortBehavior {
  /** open() 回调时使用的错误；省略则成功打开。 */
  failOnOpen?: Error;
  /** close() 回调时使用的错误；省略则成功关闭。 */
  failOnClose?: Error;
  /** write 行为：'ok'（默认）/ 'fail'（write cb 返回错误）。 */
  writeBehavior?: 'ok' | 'fail';
  /** drain 行为：'ok'（默认）/ 'fail'（drain cb 返回错误）。 */
  drainBehavior?: 'ok' | 'fail';
  writeError?: Error;
  drainError?: Error;
}

/**
 * `SerialPortLike` 的进程内 mock。
 *
 * - 行为可通过构造选项配置（success / error / 永不回调暂未提供，可按需扩展）。
 * - `pushIncoming` / `pushError` / `triggerClose` 让测试主动驱动事件流。
 * - 所有 `write` 调用的字节按顺序记录在 `writes` 中，便于断言写入序列与 drain 顺序。
 */
export class FakeSerialPort extends EventEmitter implements SerialPortLike {
  #isOpen = false;
  /** 测试可读：write() 收到的字节。 */
  readonly writes: Buffer[] = [];
  /** 测试可读：drain() 被调用的次数。 */
  drainCalls = 0;
  /** 测试可读：close() 被调用的次数（含 transport 主动 close 与底层 triggerClose）。 */
  closeCalls = 0;

  constructor(
    public readonly options: SerialPortOpenOptions,
    public readonly behavior: FakeSerialPortBehavior = {},
  ) {
    super();
  }

  get isOpen(): boolean {
    return this.#isOpen;
  }

  open(cb?: (err: Error | null) => void): void {
    queueMicrotask(() => {
      if (this.behavior.failOnOpen) {
        cb?.(this.behavior.failOnOpen);
        return;
      }
      this.#isOpen = true;
      cb?.(null);
      this.emit('open');
    });
  }

  close(cb?: (err: Error | null) => void): void {
    this.closeCalls += 1;
    queueMicrotask(() => {
      if (this.behavior.failOnClose) {
        cb?.(this.behavior.failOnClose);
        return;
      }
      const wasOpen = this.#isOpen;
      this.#isOpen = false;
      cb?.(null);
      if (wasOpen) this.emit('close');
    });
  }

  write(data: Buffer | Uint8Array, cb?: (err: Error | null | undefined) => void): boolean {
    const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
    this.writes.push(buf);
    queueMicrotask(() => {
      if (this.behavior.writeBehavior === 'fail') {
        cb?.(this.behavior.writeError ?? new Error('mock write failed'));
      } else {
        cb?.(null);
      }
    });
    return true;
  }

  drain(cb?: (err: Error | null | undefined) => void): void {
    this.drainCalls += 1;
    queueMicrotask(() => {
      if (this.behavior.drainBehavior === 'fail') {
        cb?.(this.behavior.drainError ?? new Error('mock drain failed'));
      } else {
        cb?.(null);
      }
    });
  }

  /** 模拟设备入站数据（serialport 的真实事件载荷类型为 Buffer）。 */
  pushIncoming(data: Buffer | Uint8Array): void {
    const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
    this.emit('data', buf);
  }

  /** 模拟底层错误。 */
  pushError(err: Error): void {
    this.emit('error', err);
  }

  /** 模拟物理拔出（仅 emit 'close'，不报错）。 */
  triggerClose(): void {
    if (!this.#isOpen) {
      this.emit('close');
      return;
    }
    this.#isOpen = false;
    this.emit('close');
  }
}

/**
 * 工厂助手：创建一个返回固定 FakeSerialPort 实例的工厂；
 * 同时把生成的实例放进 `created` 数组供测试断言。
 */
export function createMockSerialPortFactory(behavior: FakeSerialPortBehavior = {}): {
  factory: SerialPortFactory;
  created: FakeSerialPort[];
} {
  const created: FakeSerialPort[] = [];
  const factory: SerialPortFactory = (options) => {
    const port = new FakeSerialPort(options, behavior);
    created.push(port);
    return port;
  };
  return { factory, created };
}
