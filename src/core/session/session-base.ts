import { EventEmitter } from 'node:events';
import type { Origin, SessionId, SessionState } from '../../shared/types.js';
import type { ITransport } from '../../transports/types.js';
import { TranscriptBuffer } from '../transcript/transcript-buffer.js';
import type {
  ITranscriptBuffer,
  ReadResult,
  SequenceCursor,
  TranscriptEvent,
  TranscriptEventInput,
} from '../transcript/types.js';
import { WriteQueue } from '../write-queue/write-queue.js';
import type { WriteAuditCallback } from '../write-queue/types.js';
import type {
  ISession,
  SessionErrorMeta,
  SessionStateMeta,
  SessionWriteOptions,
} from './types.js';
import { SessionNotOpenError } from './types.js';

export interface SessionBaseOptions {
  id: SessionId;
  /** Transport 实例。Phase 1 仅 mock-transport 用于测试；Phase 2 起替换为真实适配器。 */
  transport: ITransport;
  /** 可选：覆盖默认 TranscriptBuffer（测试 / 持久化场景）。 */
  transcript?: ITranscriptBuffer;
  /** TranscriptBuffer 容量上限（仅当未提供 transcript 时生效）。 */
  transcriptCapacity?: number;
}

/**
 * 所有会话类型的抽象基类。
 *
 * 职责：
 * - 串联 transport ↔ TranscriptBuffer ↔ WriteQueue 三者
 * - 把 transport 'data' 事件转写为 EventType.data，origin='device'
 * - 把 transport 'error' 转写为 EventType.error，并将 session 状态转为 'errored'，同时释放底层资源
 * - 把 transport 'close' 转写为状态 'closed'（若非由 close() 主动触发），同时关闭 WriteQueue
 * - 写入成功后通过 WriteQueue audit 回调把出站字节追加到 transcript（这是 §4.5 审计不变量的核心）
 * - 公开 EventEmitter 接口，让 SessionManager / IPC / MCP 订阅 transcript 事件流
 *
 * 子类（Phase 2+）通常只需在构造函数中创建对应的 ITransport 并 super() 即可。
 */
export abstract class SessionBase extends EventEmitter implements ISession {
  readonly id: SessionId;
  readonly #transcript: ITranscriptBuffer;
  readonly #writeQueue: WriteQueue;
  readonly #transport: ITransport;
  #state: SessionState = 'idle';
  #closing = false;

  constructor(options: SessionBaseOptions) {
    super();
    this.id = options.id;
    this.#transport = options.transport;
    this.#transcript =
      options.transcript ??
      new TranscriptBuffer({ sessionId: options.id, capacity: options.transcriptCapacity });
    this.#writeQueue = new WriteQueue({
      writer: (data) => this.#transport.write(data),
      audit: this.#onWriteAudit,
    });

    this.#transport.on('data', this.#onTransportData);
    this.#transport.on('error', this.#onTransportError);
    this.#transport.on('close', this.#onTransportClose);
  }

  /** 当前状态机阶段。所有变更都通过 #setState 走，并同步追加 EventType.state 事件。 */
  get state(): SessionState {
    return this.#state;
  }

  /**
   * 打开底层 transport。
   *
   * 状态转移：idle → opening → open（成功） / opening → errored（失败）。
   * 若已处于 open/opening，立即返回（幂等）。closed/errored 状态再次 open 会抛错 ——
   * 会话是一次性的，需重新构造。失败时会主动关闭半初始化的 transport，避免句柄泄漏。
   *
   * @throws transport.open() 抛出的原始错误（已先记录为 transcript error 事件）
   */
  async open(): Promise<void> {
    if (this.#state === 'open' || this.#state === 'opening') return;
    if (this.#state === 'closed' || this.#state === 'errored') {
      throw new Error(`Cannot open session ${this.id} from state ${this.#state}`);
    }
    this.#setState('opening');
    try {
      await this.#transport.open();
      this.#setState('open');
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      this.#recordError({ message: error.message, source: 'transport', fatal: true });
      // 部分初始化的 transport 必须释放（fd / 句柄 / SSH channel）
      void this.#transport.close().catch(() => undefined);
      this.#setState('errored');
      throw error;
    }
  }

  /**
   * 关闭会话：先 drain WriteQueue，再关闭 transport。
   *
   * 状态转移：open/opening → closing → closed（成功） / closing → errored（transport.close 失败）。
   * 已 closed/errored 立即返回；并发重入由 #closing 标志保护。
   * 队列关闭异常被吞掉，不阻塞 transport 关闭 —— 优先保证句柄释放。
   *
   * @throws transport.close() 抛出的原始错误（已先记录为 transcript error 事件）
   */
  async close(): Promise<void> {
    if (this.#state === 'closed' || this.#state === 'errored') return;
    if (this.#closing) return;
    this.#closing = true;
    this.#setState('closing');
    try {
      await this.#writeQueue.close();
    } catch {
      // 队列关闭异常不阻塞 transport 关闭
    }
    try {
      await this.#transport.close();
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      this.#recordError({ message: error.message, source: 'transport', fatal: true });
      this.#setState('errored');
      this.#closing = false;
      throw error;
    }
    if (this.state !== 'closed' && this.state !== 'errored') {
      this.#setState('closed');
    }
    this.#closing = false;
  }

  /**
   * 写入数据。必须在 state==='open' 时调用，否则抛 {@link SessionNotOpenError}。
   *
   * 实际字节通过 WriteQueue 串行送达 transport；写入成功后由 audit 回调
   * 把字节追加到 transcript（origin = options.origin），从而保证 AI 与 human 的
   * 输入在 transcript 中按队列顺序可见 —— 这是 §4.5 审计不变量的核心。
   *
   * @param data 待写入字节
   * @param options origin 必填（human/ai/system）；correlationId 可选，AI 调用应填以便外部关联；
   *                priority 可选（缺省 'normal'），仅 Ctrl-C/abort 等中断场景填 'high'，
   *                由 WriteQueue 调度先于 normal lane drain
   * @throws {SessionNotOpenError} session 当前不在 'open' 状态时立即抛出（含 `code:'NOT_OPEN'`）
   * @throws {Error} 底层 writer 失败时按原异常透传给调用方
   */
  async write(data: Uint8Array, options: SessionWriteOptions): Promise<void> {
    if (this.#state !== 'open') {
      throw new SessionNotOpenError(this.id, this.#state);
    }
    await this.#writeQueue.enqueue({
      origin: options.origin,
      data,
      correlationId: options.correlationId,
      priority: options.priority,
    });
  }

  /**
   * 从 cursor 之后读取 transcript。
   * @param cursor 上次读取的最大 sequence；0 表示从最早可见事件开始
   * @returns events 列表 + 最新 cursor + truncated 标志
   */
  read(cursor: SequenceCursor): ReadResult {
    return this.#transcript.readSince(cursor);
  }

  /**
   * 写入 clear 事件 —— 不真正删除历史，旧 cursor 仍能看见之前的输出（req §4.5）。
   * @param origin 触发方（human/ai/system）
   * @returns 已追加的 clear TranscriptEvent
   */
  clear(origin: Origin): TranscriptEvent {
    return this.#appendAndEmit({ type: 'clear', origin });
  }

  #onWriteAudit: WriteAuditCallback = (item, result) => {
    if (result.ok) {
      this.#appendAndEmit({
        type: 'data',
        origin: item.origin,
        evidenceKind: 'raw_bytes',
        data: item.data,
        meta: item.correlationId ? { correlationId: item.correlationId } : undefined,
      });
    } else {
      this.#recordError({ message: result.error.message, source: 'writer', fatal: false });
    }
  };

  #onTransportData = (chunk: Uint8Array): void => {
    this.#appendAndEmit({
      type: 'data',
      origin: 'device',
      evidenceKind: 'raw_bytes',
      data: chunk,
    });
  };

  #onTransportError = (err: Error): void => {
    this.#recordError({ message: err.message, source: 'transport', fatal: true });
    if (this.#state !== 'errored') {
      this.#setState('errored');
      // 释放队列与底层连接，避免句柄泄漏与"errored 但 transport 仍存活"的不一致
      void this.#writeQueue.close().catch(() => undefined);
      void this.#transport.close().catch(() => undefined);
    }
  };

  #onTransportClose = (): void => {
    if (this.#state === 'closed' || this.#state === 'errored') return;
    this.#setState('closed');
    // 关闭队列：底层已断，残留写入应立即被拒
    void this.#writeQueue.close().catch(() => undefined);
  };

  #recordError(meta: SessionErrorMeta): TranscriptEvent {
    return this.#appendAndEmit({
      type: 'error',
      origin: 'system',
      meta,
    });
  }

  /**
   * 子类专用：把一条 system 来源的事件追加到 transcript 并 emit 给订阅者。
   *
   * 用于 PTY 子进程退出、SSH banner 等"非字节流但需要审计可见"的事件。
   * 直接复用 #appendAndEmit 通道，保证事件顺序与状态变更穿插一致。
   */
  protected recordSystemEvent(input: TranscriptEventInput): TranscriptEvent {
    return this.#appendAndEmit(input);
  }

  #appendAndEmit(input: TranscriptEventInput): TranscriptEvent {
    const event = this.#transcript.append(input);
    this.emit('event', event);
    return event;
  }

  #setState(next: SessionState): void {
    if (this.#state === next) return;
    const meta: SessionStateMeta = { from: this.#state, to: next };
    this.#state = next;
    this.#appendAndEmit({
      type: 'state',
      origin: 'system',
      meta,
    });
    this.emit('state', next);
  }
}
