import type { Origin } from '../../shared/types.js';

/**
 * 写入优先级。
 *
 * - `'normal'`: AI / human 默认走此通道，按 FIFO 串行送达。
 * - `'high'`:   仅用于人手动中断（Ctrl-C / abort）等"必须立即排到队首"的紧急写入。
 *               高优先级队列内仍是 FIFO；高优先级永远先于普通优先级被取出。
 *
 * 为避免饿死，约定：调用方仅在用户显式触发的中断场景下使用 `'high'`，
 * 不允许把它当作"我比较急"的通用通道。
 */
export type WritePriority = 'high' | 'normal';

/** 由调用方提交、由队列串行执行的写入项。 */
export interface WriteQueueItem {
  /** 写入来源（审计标签：人 / AI / 系统等）。 */
  origin: Origin;
  /** 实际写入字节。 */
  data: Uint8Array;
  /** 可选关联 ID，用于 MCP 请求 ↔ transcript 对应。 */
  correlationId?: string;
  /**
   * 优先级；缺省 `'normal'`。
   * 高优先级仅用于人主动中断场景；不要滥用。
   */
  priority?: WritePriority;
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
   * 入队并 await 直到写入完成（成功）或拒绝（失败/已关闭/队列满）。
   * 异常不会污染后续 item —— 队列保证下一项继续被处理。
   *
   * 队列已 close 时立即 reject 一个 message 含 "closed" 的错误。
   * 队列已满（待处理项数 >= maxDepth）时立即 reject 一个 `code='QUEUE_FULL'` 错误。
   * 例外：`priority === 'high'` 豁免 maxDepth 检查 —— 它是用户主动中断的紧急通道，
   * 在 normal 已堆到上限时尤其需要可达；调用方仅应在 Ctrl-C/abort 场景使用。
   */
  enqueue(item: WriteQueueItem): Promise<void>;

  /** 当前待处理项数量（含正在执行的项）。 */
  pendingCount(): number;

  /**
   * 关闭队列：等待所有已入队项完成后停止接受新 item。
   * 关闭后再 enqueue 会立即 reject。
   */
  close(): Promise<void>;
}

/** 写入任务真正开始执行前的回调。用于先登记出站事件，再调用 transport writer。 */
export type WriteStartCallback = (item: WriteQueueItem) => void;

/** 单次写入完成后的审计回调。供 SessionBase 记录成功或失败结果。 */
export type WriteAuditCallback = (item: WriteQueueItem, result: WriteAuditResult) => void;

export type WriteAuditResult =
  | { ok: true; bytesWritten: number }
  | { ok: false; error: Error };

export interface WriteQueueOptions {
  /** 真正执行字节写入的回调。通常是 transport.write.bind(transport)。 */
  writer: (data: Uint8Array) => Promise<void>;
  /** 写入任务开始前被调用；此时尚未调用 writer，可用于追加出站 transcript。可选。 */
  onStart?: WriteStartCallback;
  /** 每次写入完成（成功或失败）后被调用，用于记录结果或追加错误。可选。 */
  audit?: WriteAuditCallback;
  /**
   * 队列待处理项上限（含正在执行）；超出时 enqueue 立即 reject。
   * 缺省 1024，用于在 AI/人狂喷数据时给出明确背压而不是无限增长内存。
   */
  maxDepth?: number;
}

/**
 * `enqueue()` 在背压触发时抛出的错误对象。
 * 通过 `name === 'WriteQueueFullError'` 与 `code === 'QUEUE_FULL'` 双重判别，
 * 调用方（IPC handler / MCP tool）应当捕获并向上层返回结构化错误，由用户决定是否重试。
 */
export class WriteQueueFullError extends Error {
  readonly code = 'QUEUE_FULL' as const;
  constructor(maxDepth: number, currentDepth: number) {
    super(`WriteQueue is full (depth=${currentDepth}, max=${maxDepth})`);
    this.name = 'WriteQueueFullError';
  }
}
