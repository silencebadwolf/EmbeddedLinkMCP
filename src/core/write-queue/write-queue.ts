import type {
  IWriteQueue,
  WriteAuditCallback,
  WriteQueueItem,
  WriteQueueOptions,
} from './types.js';

/**
 * 串行 FIFO 写入队列。
 *
 * 实现：用一个 Promise 链 `#tail` 驱动；每次 enqueue 都把新任务挂在尾部。
 * 优点：天然单线程串行、单 item 失败不会卡死队列、无需手写 mutex。
 *
 * close() 后：
 * - 已入队的 item 会被等待执行完成（drain）
 * - 新 enqueue 立即 reject
 */
export class WriteQueue implements IWriteQueue {
  readonly #writer: (data: Uint8Array) => Promise<void>;
  readonly #audit: WriteAuditCallback | undefined;
  #tail: Promise<void> = Promise.resolve();
  #pending = 0;
  #closed = false;

  constructor(options: WriteQueueOptions) {
    this.#writer = options.writer;
    this.#audit = options.audit;
  }

  /**
   * 入队一个写入任务。返回 Promise 在底层 writer 完成或失败后 settle。
   *
   * 异常隔离：单个任务的 reject **不会**传播到队列尾链，后续任务仍会被处理。
   *
   * @param item 待写入项（origin 必填，data 必填，correlationId 可选）
   * @returns 写入完成的 Promise；队列已 close 时立即 reject
   */
  enqueue(item: WriteQueueItem): Promise<void> {
    if (this.#closed) {
      return Promise.reject(new Error('WriteQueue is closed'));
    }

    this.#pending += 1;
    const previous = this.#tail;
    const taskPromise = previous.then(() => this.#run(item));
    // 单个任务失败不传播到链尾，否则后续 await this.#tail 会持续 reject
    this.#tail = taskPromise.then(
      () => undefined,
      () => undefined,
    );
    return taskPromise;
  }

  /** @returns 当前在队列中（含正在执行）的任务数。 */
  pendingCount(): number {
    return this.#pending;
  }

  /**
   * 关闭队列：标记为已关闭后，等待所有已入队项 drain 才 resolve。
   * 关闭后再 enqueue 立即 reject。重复调用安全。
   */
  async close(): Promise<void> {
    this.#closed = true;
    // 等所有已入队项 drain，再 resolve
    await this.#tail;
  }

  /**
   * 真正执行单个任务：调用 writer，回调 audit，最后递减 pending。
   * 异常会被原样 throw 给 enqueue 的调用方，但不会污染 #tail。
   */
  async #run(item: WriteQueueItem): Promise<void> {
    try {
      await this.#writer(item.data);
      this.#audit?.(item, { ok: true, bytesWritten: item.data.byteLength });
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      this.#audit?.(item, { ok: false, error });
      throw error;
    } finally {
      this.#pending -= 1;
    }
  }
}
