import { EventEmitter } from 'node:events';
import type { IJLinkBackend } from '../../jlink/types.js';
import type { Origin, SessionId, SessionState } from '../../shared/types.js';
import { TranscriptBuffer } from '../transcript/transcript-buffer.js';
import type {
  ITranscriptBuffer,
  ReadResult,
  SequenceCursor,
  TranscriptEvent,
  TranscriptEventInput,
} from '../transcript/types.js';
import type { ISession, SessionErrorMeta, SessionStateMeta, SessionWriteOptions } from './types.js';
import { SessionNotOpenError } from './types.js';
import { analyzeRttDataChunk } from './rtt-log-diagnostics.js';
import { WriteQueue } from '../write-queue/write-queue.js';
import type { WriteAuditCallback, WriteQueueItem } from '../write-queue/types.js';

/** RTT 日志会话配置。 */
export interface RttLogSessionOptions {
  /** SessionManager 分配的会话 ID。 */
  id: SessionId;
  /** J-Link backend；RTT socket/GDB 细节必须停留在 backend 内部。 */
  jlinkBackend: IJLinkBackend;
  /** 已连接 probe 的非敏感 handle。 */
  probeId: string;
  /** RTT up channel index；当前生产 backend 主要支持 0。 */
  channelIndex: number;
  /** 轮询间隔，单位毫秒。 */
  pollIntervalMs: number;
  /** 单次读取最大字节数。 */
  maxBytesPerRead: number;
  /** 测试可注入 transcript；生产缺省使用 TranscriptBuffer。 */
  transcript?: ITranscriptBuffer;
  /** TranscriptBuffer 容量上限（仅当未提供 transcript 时生效）。 */
  transcriptCapacity?: number;
}

/** RTT 日志会话最低轮询间隔，避免配置错误导致忙轮询。 */
const MIN_POLL_INTERVAL_MS = 10;

/** 单次 RTT 读取的最小字节数。 */
const MIN_MAX_BYTES_PER_READ = 1;

/** 单次 RTT 读取的最大字节数，与 MCP debug binary cap 保持同量级上限。 */
const MAX_BYTES_PER_READ = 16 * 1024 * 1024;

/**
 * 可交互 RTT 日志会话。
 *
 * 它把 `IJLinkBackend.rttRead()` 的 up-channel 字节转换为普通 transcript data 事件，
 * 让 UI 和 AI 都能复用已有 cursor/subscription/xterm 渲染路径；但所有 RTT socket、GDB server
 * 和 SEGGER 细节仍归 J-Link backend 拥有。
 */
export class RttLogSession extends EventEmitter implements ISession {
  readonly id: SessionId;
  readonly #jlinkBackend: IJLinkBackend;
  readonly #probeId: string;
  readonly #channelIndex: number;
  readonly #pollIntervalMs: number;
  readonly #maxBytesPerRead: number;
  readonly #transcript: ITranscriptBuffer;
  readonly #writeQueue: WriteQueue;
  #state: SessionState = 'idle';
  #timer: ReturnType<typeof setTimeout> | undefined;
  #closing = false;
  #polling = false;
  #bannerOnlyHintRecorded = false;

  /**
   * @param options RTT 日志会话依赖与轮询配置
   */
  constructor(options: RttLogSessionOptions) {
    super();
    this.id = options.id;
    this.#jlinkBackend = options.jlinkBackend;
    this.#probeId = options.probeId;
    this.#channelIndex = options.channelIndex;
    this.#pollIntervalMs = normalizePollInterval(options.pollIntervalMs);
    this.#maxBytesPerRead = normalizeMaxBytes(options.maxBytesPerRead);
    this.#transcript = options.transcript ?? new TranscriptBuffer({
      sessionId: options.id,
      capacity: options.transcriptCapacity,
    });
    this.#writeQueue = new WriteQueue({
      writer: async (data) => {
        await this.#jlinkBackend.rttWrite(
          this.#probeId,
          this.#channelIndex,
          Buffer.from(data),
        );
      },
      onStart: this.#onWriteStart,
      audit: this.#onWriteAudit,
    });
  }

  /** 当前会话状态。 */
  get state(): SessionState {
    return this.#state;
  }

  /** 打开 RTT 日志会话并启动轮询；已 open/opening 时幂等。 */
  async open(): Promise<void> {
    if (this.#state === 'open' || this.#state === 'opening') return;
    if (this.#state === 'closed' || this.#state === 'errored') {
      throw new Error(`Cannot open RTT log session ${this.id} from state ${this.#state}`);
    }
    this.#setState('opening');
    this.#setState('open');
    this.#recordOpenGuidance();
    await this.#pollOnce({ throwOnError: true });
  }

  /** 停止轮询并关闭会话。 */
  async close(): Promise<void> {
    if (this.#state === 'closed' || this.#state === 'errored') return;
    if (this.#closing) return;
    this.#closing = true;
    this.#clearTimer();
    this.#setState('closing');
    await this.#writeQueue.close().catch(() => undefined);
    this.#setState('closed');
    this.#closing = false;
  }

  /** 写入 RTT down-channel；任务开始时记录 human/ai transcript，失败时追加错误。 */
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

  /** 从 cursor 之后读取 transcript。 */
  read(cursor: SequenceCursor): ReadResult {
    return this.#transcript.readSince(cursor);
  }

  /** 追加 clear 事件，不删除历史。 */
  clear(origin: Origin): TranscriptEvent {
    return this.#appendAndEmit({ type: 'clear', origin });
  }

  async #pollOnce(options?: { throwOnError?: boolean }): Promise<void> {
    if (this.#state !== 'open' || this.#polling) return;
    this.#polling = true;
    try {
      const result = await this.#jlinkBackend.rttRead(
        this.#probeId,
        this.#channelIndex,
        this.#maxBytesPerRead,
      );
      this.#polling = false;
      if (this.#state !== 'open') return;
      if (result.data.byteLength > 0) {
        const dataDiagnostic = analyzeRttDataChunk(result.data);
        this.#appendAndEmit({
          type: 'data',
          origin: 'device',
          evidenceKind: 'raw_bytes',
          data: result.data,
          meta: result.truncated ? { truncated: true, channelIndex: result.channelIndex } : { channelIndex: result.channelIndex },
        });
        if (dataDiagnostic.bannerOnly) {
          this.#recordBannerOnlyGuidance();
        }
      }
      this.#scheduleNextPoll();
    } catch (err) {
      this.#polling = false;
      this.#clearTimer();
      if (this.#state !== 'open') return;
      const error = err instanceof Error ? err : new Error(String(err));
      this.#recordError({ message: error.message, source: 'rtt', fatal: true });
      this.#setState('errored');
      if (options?.throwOnError === true) throw error;
    }
  }

  #scheduleNextPoll(): void {
    if (this.#state !== 'open') return;
    this.#clearTimer();
    this.#timer = setTimeout(() => {
      void this.#pollOnce();
    }, this.#pollIntervalMs);
  }

  #clearTimer(): void {
    if (this.#timer !== undefined) {
      clearTimeout(this.#timer);
      this.#timer = undefined;
    }
  }

  #recordError(meta: SessionErrorMeta): TranscriptEvent {
    return this.#appendAndEmit({ type: 'error', origin: 'system', meta });
  }

  #onWriteStart = (item: WriteQueueItem): void => {
    this.#appendAndEmit({
      type: 'data',
      origin: item.origin,
      evidenceKind: 'raw_bytes',
      data: item.data,
      meta: item.correlationId ? { correlationId: item.correlationId } : undefined,
    });
  };

  #onWriteAudit: WriteAuditCallback = (_item, result) => {
    if (!result.ok) {
      this.#recordError({ message: result.error.message, source: 'writer', fatal: false });
    }
  };

  #recordOpenGuidance(): TranscriptEvent {
    const message =
      `RTT log connected on channel ${this.#channelIndex}; waiting for target output. ` +
      'If this stays silent, verify firmware RTT output/channel/control block; ' +
      'do not repeat flash solely because RTT is silent.\r\n';
    return this.#appendAndEmit({
      type: 'data',
      origin: 'system',
      evidenceKind: 'raw_bytes',
      data: Buffer.from(message, 'utf8'),
      meta: { channelIndex: this.#channelIndex },
    });
  }

  #recordBannerOnlyGuidance(): TranscriptEvent | undefined {
    if (this.#bannerOnlyHintRecorded) return undefined;
    this.#bannerOnlyHintRecorded = true;
    const message =
      'SEGGER RTT transport banner received; this proves LinkTerm/J-Link RTT transport, ' +
      'not firmware log output. If no target log follows, check firmware RTT output, ' +
      'selected channel, and control block; do not repeat flash solely because RTT is silent.\r\n';
    return this.#appendAndEmit({
      type: 'data',
      origin: 'system',
      evidenceKind: 'raw_bytes',
      data: Buffer.from(message, 'utf8'),
      meta: {
        channelIndex: this.#channelIndex,
        diagnostic: 'segger_rtt_banner_without_firmware_output',
      },
    });
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
    this.#appendAndEmit({ type: 'state', origin: 'system', meta });
    this.emit('state', next);
  }
}

function normalizePollInterval(value: number): number {
  if (!Number.isFinite(value) || value < MIN_POLL_INTERVAL_MS) return MIN_POLL_INTERVAL_MS;
  return Math.floor(value);
}

function normalizeMaxBytes(value: number): number {
  if (!Number.isFinite(value) || value < MIN_MAX_BYTES_PER_READ) return MIN_MAX_BYTES_PER_READ;
  return Math.min(Math.floor(value), MAX_BYTES_PER_READ);
}
