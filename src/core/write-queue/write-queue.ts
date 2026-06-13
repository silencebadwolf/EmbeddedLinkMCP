import {
  WriteQueueFullError,
  type IWriteQueue,
  type WriteAuditCallback,
  type WriteQueueItem,
  type WriteQueueOptions,
} from './types.js';

/**
 * 单个待执行任务的内部表达：item + 已 resolve/reject 的 deferred。
 *
 * 之所以不再用"Promise 链 #tail"那一套，是因为优先级 + 背压需要在排队时
 * 还能从中间挑选下一条要执行的项；Promise 链拓扑下做不到（链是已经定型的）。
 */
interface PendingTask {
  item: WriteQueueItem;
  resolve: () => void;
  reject: (err: Error) => void;
}

/**
 * 串行写入队列：
 *
 * - 两条 FIFO 链表（high / normal），高优先级先 drain；
 * - 调用方 await 单次 enqueue 的 Promise；
 * - 队列大小受 `maxDepth` 限制，超出立即抛 `WriteQueueFullError`；
 * - 单 item 失败不会卡死后续 item；
 * - `close()` 后等待已入队项 drain，新 enqueue 立即 reject。
 *
 * 这是 LinkTerm 唯一的写入序列化点，AI/人在此处汇流。
 */
export class WriteQueue implements IWriteQueue {
  readonly #writer: (data: Uint8Array) => Promise<void>;
  readonly #audit: WriteAuditCallback | undefined;
  readonly #maxDepth: number;

  /** 高优先级 FIFO 队列。 */
  readonly #high: PendingTask[] = [];
  /** 普通优先级 FIFO 队列。 */
  readonly #normal: PendingTask[] = [];

  /** 是否有 task 正在 #writer() 中执行（用于驱动 #drain）。 */
  #running = false;
  #closed = false;
  /** drain 完成的 Promise；close() await 它。 */
  #drainPromise: Promise<void> | undefined;
  #drainResolve: (() => void) | undefined;

  constructor(options: WriteQueueOptions) {
    this.#writer = options.writer;
    this.#audit = options.audit;
    const depth = options.maxDepth ?? 1024;
    if (!Number.isInteger(depth) || depth <= 0) {
      throw new Error(`WriteQueue.maxDepth must be a positive integer, got ${depth}`);
    }
    this.#maxDepth = depth;
  }

  /**
   * 入队一个写入任务。
   *
   * @param item 待写入项（origin/data 必填，priority/correlationId 可选）
   * @returns 写入完成的 Promise；
   *          - 队列已 close 时立即 reject `Error('WriteQueue is closed')`
   *          - 队列已满（仅 normal 优先级）时立即 reject `WriteQueueFullError`
   * @remarks
   * - 单个任务的 reject 不会影响后续任务的执行。
   * - `priority === 'high'` 豁免 maxDepth 检查：high 是人触发的 Ctrl-C/abort 紧急通道，
   *   恰恰是远端卡死、normal 把队列堆到上限时最需要中断手段的时刻；这种场景下若一并
   *   reject 会让用户失去中断能力（req §4.4 / §5.1）。high 入队后仍按现有规则插入到
   *   high lane 尾部，FIFO 内部有序；high 早于 normal 被 drain 的语义不变。
   */
  enqueue(item: WriteQueueItem): Promise<void> {
    if (this.#closed) {
      return Promise.reject(new Error('WriteQueue is closed'));
    }

    const priority = item.priority ?? 'normal';
    if (priority !== 'high') {
      const currentDepth = this.pendingCount();
      if (currentDepth >= this.#maxDepth) {
        return Promise.reject(new WriteQueueFullError(this.#maxDepth, currentDepth));
      }
    }

    return new Promise<void>((resolve, reject) => {
      const task: PendingTask = { item, resolve, reject };
      const lane = priority === 'high' ? this.#high : this.#normal;
      lane.push(task);
      this.#schedule();
    });
  }

  /** @returns 当前在队列中（含正在执行）的任务数。 */
  pendingCount(): number {
    return this.#high.length + this.#normal.length + (this.#running ? 1 : 0);
  }

  /**
   * 关闭队列：标记为已关闭后，等待所有已入队项 drain 才 resolve。
   * 关闭后再 enqueue 立即 reject。重复调用安全。
   */
  async close(): Promise<void> {
    this.#closed = true;
    if (this.pendingCount() === 0) return;
    if (!this.#drainPromise) {
      this.#drainPromise = new Promise<void>((resolve) => {
        this.#drainResolve = resolve;
      });
    }
    await this.#drainPromise;
  }

  /**
   * 触发执行：若当前没有任务在跑，从 high → normal 取一个执行；
   * 任务结束后递归触发下一条，直到两条 lane 都空。
   *
   * 用 microtask 包裹一下 `#run`，让 enqueue 的同步路径先返回 Promise，
   * 再开始 #writer 调用 —— 避免 enqueue 还没把 Promise 交给调用方就 settle。
   */
  #schedule(): void {
    if (this.#running) return;
    const next = this.#high.shift() ?? this.#normal.shift();
    if (!next) {
      // 队列空：通知 close() 等待者
      if (this.#closed && this.#drainResolve) {
        const r = this.#drainResolve;
        this.#drainResolve = undefined;
        r();
      }
      return;
    }
    this.#running = true;
    queueMicrotask(() => {
      void this.#run(next);
    });
  }

  /**
   * 执行单个任务：调用 writer，回调 audit，settle 调用方 Promise，再调度下一条。
   * 异常不会传播到 #schedule 调用点。
   */
  async #run(task: PendingTask): Promise<void> {
    try {
      await this.#writer(task.item.data);
      this.#audit?.(task.item, { ok: true, bytesWritten: task.item.data.byteLength });
      task.resolve();
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      this.#audit?.(task.item, { ok: false, error });
      task.reject(error);
    } finally {
      this.#running = false;
      this.#schedule();
    }
  }
}
