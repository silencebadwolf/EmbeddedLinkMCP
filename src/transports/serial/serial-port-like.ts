import type { EventEmitter } from 'node:events';
import type {
  SerialDataBits,
  SerialParity,
  SerialStopBits,
} from '../../shared/types.js';

/**
 * 一组打开真实 SerialPort 时需要的物理参数 —— 已展平默认值，
 * SerialTransport 在调用 SerialPortFactory 前会把可选字段补齐。
 *
 * `autoOpen: false` 是固定约束：我们用 `open(cb)` 显式打开，
 * 这样 open 才能 await，并能与 SessionBase 的状态机对齐。
 */
export interface SerialPortOpenOptions {
  path: string;
  baudRate: number;
  dataBits: SerialDataBits;
  stopBits: SerialStopBits;
  parity: SerialParity;
  rtscts: boolean;
  xon: boolean;
  xoff: boolean;
  autoOpen: false;
}

/**
 * `SerialTransport` 实际依赖的最小 SerialPort 接口面。
 *
 * 只列出真实使用到的方法/属性，避免把 `serialport` 整个 API 渗透进 transport。
 * 这是 E1 约定的 mock 注入边界 —— 测试用 `FakeSerialPort` 实现该接口即可。
 *
 * 事件契约：'open' / 'data'(Buffer) / 'error'(Error) / 'close'(可能携带 disconnected 标志)。
 */
export interface SerialPortLike extends EventEmitter {
  readonly isOpen: boolean;
  open(cb?: (err: Error | null) => void): void;
  close(cb?: (err: Error | null) => void): void;
  write(data: Buffer | Uint8Array, cb?: (err: Error | null | undefined) => void): boolean;
  drain(cb?: (err: Error | null | undefined) => void): void;
}

/**
 * SerialPort 工厂：测试通过此入口注入 FakeSerialPort，生产由
 * `defaultSerialPortFactory` 创建真实 `SerialPort` 实例。
 */
export type SerialPortFactory = (options: SerialPortOpenOptions) => SerialPortLike;
