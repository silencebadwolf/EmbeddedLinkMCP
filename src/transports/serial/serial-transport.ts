import { EventEmitter } from 'node:events';
import { SerialPort } from 'serialport';
import {
  DEFAULT_SERIAL_DATA_BITS,
  DEFAULT_SERIAL_PARITY,
  DEFAULT_SERIAL_STOP_BITS,
} from '../../shared/constants.js';
import type { SerialSessionConfig } from '../../shared/types.js';
import type { ITransport } from '../types.js';
import type {
  SerialPortFactory,
  SerialPortLike,
  SerialPortOpenOptions,
} from './serial-port-like.js';

/**
 * 默认 SerialPort 工厂：构造真实 `serialport` 实例。
 * 测试请通过 `SerialTransportOptions.portFactory` 注入 FakeSerialPort。
 */
export const defaultSerialPortFactory: SerialPortFactory = (options) =>
  new SerialPort(options) as unknown as SerialPortLike;

export interface SerialTransportOptions {
  config: SerialSessionConfig;
  /** 注入用工厂；省略时使用真实 `serialport`。 */
  portFactory?: SerialPortFactory;
}

/**
 * 串口 ITransport 实现。
 *
 * 关键语义：
 * - `open()` 调用底层 `port.open(cb)`，cb 成功后 resolve；订阅 data/error/close 转发到事件流。
 * - `write(data)` 先 `port.write` 再 `port.drain`，**两步全成功后才 resolve**，
 *   保证 SessionBase 把审计事件追加到 transcript 时字节确实已发出（满足 §4.5 审计不变量）。
 * - `close()` 幂等；底层 `'close'` 事件即使是物理拔出也只转发为 'close'，
 *   不主动升级为 'error' —— 物理断开属于正常生命周期，由用户重连决定（按 F1）。
 * - 'error' 事件原样转发，由 SessionBase 决定是否进入 errored 状态。
 */
export class SerialTransport extends EventEmitter implements ITransport {
  readonly #openOptions: SerialPortOpenOptions;
  readonly #portFactory: SerialPortFactory;
  #port: SerialPortLike | null = null;
  #closed = false;

  constructor(options: SerialTransportOptions) {
    super();
    this.#openOptions = SerialTransport.#buildOpenOptions(options.config);
    this.#portFactory = options.portFactory ?? defaultSerialPortFactory;
  }

  isOpen(): boolean {
    return this.#port?.isOpen === true && !this.#closed;
  }

  /**
   * 打开底层 SerialPort。已打开时直接 resolve（幂等）。
   *
   * 失败路径会主动 destroy 已分配的 port 句柄（fd 泄漏防护），
   * 与 SessionBase.open() 的"半初始化释放"约定一致。
   */
  async open(): Promise<void> {
    if (this.isOpen()) return;
    if (this.#closed) throw new Error('SerialTransport has been closed; create a new instance');

    const port = this.#portFactory(this.#openOptions);
    this.#port = port;
    this.#bindPortEvents(port);

    await new Promise<void>((resolve, reject) => {
      port.open((err) => {
        if (err) {
          // open 失败时 serialport 内部已清理 fd；这里只需放弃对 port 的引用，
          // 让事件订阅随对象一起被 GC 回收。不再调 port.close()，避免触发同步 'close' 事件。
          this.#port = null;
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }

  /**
   * 关闭 SerialPort。已关闭/未打开时直接 resolve（幂等）。
   *
   * close() 完成后必定 emit 'close'（除非底层已先 emit 过）。
   */
  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    const port = this.#port;
    if (!port) {
      this.emit('close');
      return;
    }
    await new Promise<void>((resolve, reject) => {
      port.close((err) => {
        if (err) reject(err);
        else resolve();
      });
    });
    // 'close' 事件由底层 port 在 close() 完成时 emit；我们透传到 transport
  }

  /**
   * 向底层串口写入。先 write 再 drain，二者皆成功后 resolve。
   *
   * 调用方（WriteQueue）已串行化，无需在此排队；但要求底层支持并发 drain
   * （Node 的 SerialPort 实现按调用顺序排队 drain 回调，安全）。
   */
  async write(data: Uint8Array): Promise<void> {
    if (!this.isOpen() || !this.#port) {
      throw new Error('SerialTransport is not open');
    }
    const port = this.#port;
    const buf = Buffer.isBuffer(data) ? data : Buffer.from(data.buffer, data.byteOffset, data.byteLength);
    await new Promise<void>((resolve, reject) => {
      port.write(buf, (err) => {
        if (err) {
          reject(err);
          return;
        }
        port.drain((drainErr) => {
          if (drainErr) reject(drainErr);
          else resolve();
        });
      });
    });
  }

  /**
   * 订阅底层 SerialPort 事件并转发到 ITransport 事件流。
   *
   * - 'data'(Buffer) → 'data'(Uint8Array)：Buffer 已是 Uint8Array 子类，无需转换。
   * - 'error'(Error) → 'error'(Error)：透传。
   * - 'close' → 'close'：物理拔出/正常关闭都走这条路径，meta 由 SessionBase 决定如何记录。
   */
  #bindPortEvents(port: SerialPortLike): void {
    port.on('data', (chunk: Buffer) => {
      this.emit('data', chunk);
    });
    port.on('error', (err: Error) => {
      this.emit('error', err);
    });
    port.on('close', () => {
      this.#closed = true;
      this.emit('close');
    });
  }

  /**
   * 把用户配置展平成底层 SerialPort 需要的完整选项，填充 8N1 + 无流控的常用默认值。
   */
  static #buildOpenOptions(config: SerialSessionConfig): SerialPortOpenOptions {
    return {
      path: config.port,
      baudRate: config.baudRate,
      dataBits: config.dataBits ?? DEFAULT_SERIAL_DATA_BITS,
      stopBits: config.stopBits ?? DEFAULT_SERIAL_STOP_BITS,
      parity: config.parity ?? DEFAULT_SERIAL_PARITY,
      rtscts: config.rtscts ?? false,
      xon: config.xon ?? false,
      xoff: config.xoff ?? false,
      autoOpen: false,
    };
  }
}
