import type { EventEmitter } from 'node:events';

/**
 * Transport 是 LinkTerm 与底层物理 / 协议层（串口、SSH、本地 PTY）之间的最小适配契约。
 *
 * 设计要点：
 * - 写入是 Promise（便于 await 完成或失败）。
 * - 入站数据、错误、关闭通过 EventEmitter 事件流推送，与 SessionBase 的事件订阅模型对齐。
 * - 实现必须保证 'close' 事件最终一定会触发（无论是 close() 主动调用还是底层断连）。
 */
export interface ITransport extends EventEmitter {
  /**
   * 打开底层连接。已打开时再次调用应直接 resolve（幂等）。
   */
  open(): Promise<void>;

  /**
   * 关闭底层连接。已关闭时再次调用应直接 resolve（幂等）。
   * close() 完成后必定 emit 'close'（如果尚未 emit 过）。
   */
  close(): Promise<void>;

  /**
   * 向底层写入字节。返回 Promise，在底层确认接收后 resolve。
   * 调用方负责保证调用顺序（LinkTerm 的 WriteQueue 已串行化）。
   */
  write(data: Uint8Array): Promise<void>;

  /** 当前是否处于打开状态。 */
  isOpen(): boolean;
}

/**
 * Transport 事件契约：
 * - 'data'  : (chunk: Uint8Array)  入站数据
 * - 'error' : (err: Error)         任意错误，会话层会记入 transcript 并转 errored 状态
 * - 'close' : ()                   连接关闭（主动或被动）
 */
export interface TransportEvents {
  data: (chunk: Uint8Array) => void;
  error: (err: Error) => void;
  close: () => void;
}
