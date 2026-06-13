import { MAX_TRANSCRIPT_EVENTS } from '../../shared/constants.js';
import type {
  ITranscriptBuffer,
  ReadResult,
  SequenceCursor,
  TranscriptBufferOptions,
  TranscriptEvent,
  TranscriptEventInput,
} from './types.js';

/**
 * 追加写入 + 环形缓冲实现的 TranscriptBuffer。
 *
 * 关键不变量：
 * - sequence 每会话独立、单调递增、永不回退；即使被环形覆盖，已分配的 sequence 不会重新使用。
 * - 当容量耗尽、最旧事件被覆盖时，记录 #droppedUpTo（被丢弃的最大 sequence）。
 *   后续 readSince(cursor) 若 cursor 落入已丢弃区间，会在 ReadResult 中置 truncated=true。
 * - clear 事件不真正删除历史；仅作为 EventType.clear 追加一条事件，AI 通过 cursor 仍能看见之前的输出。
 *
 * 注意：truncation 通过 ReadResult.truncated 标志暴露，而非在 buffer 内插入 'truncated' 哨兵事件。
 * 这样可以避免每次溢出都额外丢一条事件去塞哨兵的"双倍丢弃"问题。
 */
export class TranscriptBuffer implements ITranscriptBuffer {
  readonly #capacity: number;
  readonly #events: (TranscriptEvent | undefined)[];
  /** 下一条事件的 sequence。从 1 开始分配，0 保留给"未读取过"的初始游标。 */
  #nextSequence: SequenceCursor = 1;
  /** buffer 中当前事件数（<= capacity） */
  #count = 0;
  /** 环形数组中"最旧事件"的下标 */
  #headIndex = 0;
  /** 已被丢弃的事件中最大的 sequence；为 0 表示从未发生过截断 */
  #droppedUpTo: SequenceCursor = 0;

  constructor(options: TranscriptBufferOptions) {
    this.#capacity = options.capacity ?? MAX_TRANSCRIPT_EVENTS;
    if (!Number.isInteger(this.#capacity) || this.#capacity <= 0) {
      throw new Error(
        `TranscriptBuffer capacity must be a positive integer, got ${this.#capacity}`,
      );
    }
    this.#events = new Array(this.#capacity);
  }

  /**
   * 追加事件到 buffer 尾部。容量耗尽时覆盖最旧事件并更新 droppedUpTo。
   *
   * @param input 事件输入（type/origin 必填，其余可选）
   * @returns 写入后的完整事件，含分配好的 sequence 与 timestamp
   */
  append(input: TranscriptEventInput): TranscriptEvent {
    const event: TranscriptEvent = {
      ...input,
      sequence: this.#nextSequence,
      timestamp: Date.now(),
    };
    this.#nextSequence += 1;

    if (this.#count < this.#capacity) {
      const writeIndex = (this.#headIndex + this.#count) % this.#capacity;
      this.#events[writeIndex] = event;
      this.#count += 1;
    } else {
      // 满，覆盖最旧事件
      const evicted = this.#events[this.#headIndex];
      if (evicted) {
        this.#droppedUpTo = evicted.sequence;
      }
      this.#events[this.#headIndex] = event;
      this.#headIndex = (this.#headIndex + 1) % this.#capacity;
    }

    return event;
  }

  /**
   * 读取 cursor 之后的所有事件。
   *
   * @param cursor 上次读取的最大 sequence；0 表示从最早可见事件开始
   * @returns events 列表 + 最新 cursor + truncated 标志（cursor 落入已丢弃区间时为 true）
   * @throws 当 cursor 为负数或非有限值时
   */
  readSince(cursor: SequenceCursor): ReadResult {
    if (cursor < 0 || !Number.isFinite(cursor)) {
      throw new Error(`Invalid cursor: ${cursor}`);
    }

    const latest = this.latestCursor();
    if (this.#count === 0) {
      return { events: [], cursor: latest, truncated: false };
    }

    const earliest = this.earliestCursor();
    // cursor 已落入被丢弃的区间：cursor>0 且 cursor < earliest-1（earliest-1 是"恰好读到 earliest 的前一条"，不视为截断）
    const truncated = cursor > 0 && cursor < earliest - 1;
    // 起点 sequence：cursor+1（取下一条），但不能早于 earliest
    const startSeq = Math.max(cursor + 1, earliest);

    if (startSeq > latest) {
      return { events: [], cursor: latest, truncated };
    }

    const out: TranscriptEvent[] = [];
    const startOffset = startSeq - earliest;
    for (let i = startOffset; i < this.#count; i += 1) {
      const slot = this.#events[(this.#headIndex + i) % this.#capacity];
      if (slot) out.push(slot);
    }

    return { events: out, cursor: latest, truncated };
  }

  /** @returns 当前最新事件的 sequence；空 buffer 返回已丢弃区间的最大 sequence（初始为 0）。 */
  latestCursor(): SequenceCursor {
    if (this.#count === 0) return this.#droppedUpTo;
    const tailIndex = (this.#headIndex + this.#count - 1) % this.#capacity;
    return this.#events[tailIndex]?.sequence ?? 0;
  }

  /** @returns 当前 buffer 中最早事件的 sequence；空 buffer 返回 droppedUpTo+1。 */
  earliestCursor(): SequenceCursor {
    if (this.#count === 0) return this.#droppedUpTo + 1;
    return this.#events[this.#headIndex]?.sequence ?? 0;
  }

  /** @returns buffer 当前持有的事件条数（0 ≤ size ≤ capacity）。 */
  size(): number {
    return this.#count;
  }
}
