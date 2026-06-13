import type { Origin } from '../../shared/types.js';

/** 由调用方提交、由队列串行执行的写入项。 */
export interface WriteQueueItem {
  /** 写入来源（审计标签：人 / AI / 系统等）。 */
  origin: Origin;
  /** 实际写入字节。 */
  data: Uint8Array;
  /** 可选关联 ID，用于 MCP 请求 ↔ transcript 对应。 */
  correlationId?: string;
}

/**
 * IWriteQueue 抽象 LinkTerm 唯一的写入序列化点。
 *
 * 所有写入（无论来自 UI 的人类输入还是 MCP 的 AI 命令）必须经过 enqueue()，
 * 再由队列内部按提交顺序调用注入的 transport.write 完成。
 * 这是 AI/人共操作场景下"单一有序证据流"的载体。
 */
export interface IWriteQueue {
  /**
   * 入队并 await 直到写入完成（成功）或拒绝（失败/已关闭）。
   * 异常不会污染后续 item —— 队列保证下一项继续被处理。
   */
  enqueue(item: WriteQueueItem): Promise<void>;

  /** 当前待处理项数量（不含正在执行的项）。 */
  pendingCount(): number;

  /**
   * 关闭队列：等待所有已入队项完成后停止接受新 item。
   * 关闭后再 enqueue 会立即 reject。
   */
  close(): Promise<void>;
}

/** 单次写入完成后的审计回调。供 SessionBase 把成功写入记入 transcript。 */
export type WriteAuditCallback = (item: WriteQueueItem, result: WriteAuditResult) => void;

export type WriteAuditResult =
  | { ok: true; bytesWritten: number }
  | { ok: false; error: Error };

export interface WriteQueueOptions {
  /** 真正执行字节写入的回调。通常是 transport.write.bind(transport)。 */
  writer: (data: Uint8Array) => Promise<void>;
  /** 每次写入完成（成功或失败）后被调用，用于追加 transcript。可选。 */
  audit?: WriteAuditCallback;
}
