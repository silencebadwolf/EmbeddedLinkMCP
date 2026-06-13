import type { Origin, EvidenceKind, SessionId } from '../../shared/types.js';

/**
 * TranscriptBuffer 中的事件类型。
 *
 * - data:   入站或出站的字节数据（evidenceKind 区分原始字节 / 终端输出 / 调试输出）
 * - clear:  用户或 AI 触发的清屏；transcript 不真正删除历史，仅记录边界
 * - error:  transport 或 session 层的错误（保留为审计证据）
 * - state:  会话状态变化（idle→opening→open→closed/errored）
 *
 * 注意：环形缓冲溢出不会作为事件类型暴露，而是通过 ReadResult.truncated 标志通知调用方。
 */
export type EventType = 'data' | 'clear' | 'error' | 'state';

/**
 * 每会话独立的单调递增游标。
 * - readSince(cursor) 返回 cursor 之后（不含 cursor 本身）的事件。
 * - 0 表示"从最早可见事件开始读"。
 */
export type SequenceCursor = number;

/** TranscriptBuffer.append() 的输入。sequence 与 timestamp 由 buffer 自动生成。 */
export interface TranscriptEventInput {
  type: EventType;
  origin: Origin;
  /** 仅 data 事件需要 */
  evidenceKind?: EvidenceKind;
  /** 事件主体；data 事件为字节流，其它事件可能是结构化对象 */
  data?: Uint8Array;
  /** 状态变化、错误等附带的结构化信息 */
  meta?: Readonly<Record<string, unknown>>;
}

/** 写入 TranscriptBuffer 后产出的完整事件。 */
export interface TranscriptEvent extends TranscriptEventInput {
  /** 单调递增、每会话独立。 */
  sequence: SequenceCursor;
  /** UNIX 毫秒时间戳。 */
  timestamp: number;
}

/** readSince() 的返回值。cursor 是本次读取后的最新游标，应作为下次调用的入参。 */
export interface ReadResult {
  events: readonly TranscriptEvent[];
  /** 调用方应保存此值作为下次 readSince 的入参。 */
  cursor: SequenceCursor;
  /**
   * 当 cursor 入参指向已被环形缓冲丢弃的区间时，置 true。
   * 调用方需要据此提示 AI/UI "历史不完整"。
   */
  truncated: boolean;
}

/**
 * TranscriptBuffer 的对外契约（接口隔离，便于 SessionManager 注入 mock）。
 */
export interface ITranscriptBuffer {
  /** 追加事件，返回写入后的完整事件（含 sequence/timestamp）。 */
  append(event: TranscriptEventInput): TranscriptEvent;

  /**
   * 读取 cursor 之后的所有事件。
   * cursor=0 表示从最早可见事件开始；返回 cursor 等于最后一条事件的 sequence（无新事件时等于入参）。
   */
  readSince(cursor: SequenceCursor): ReadResult;

  /** 当前最新事件的 sequence；buffer 为空时返回 0。 */
  latestCursor(): SequenceCursor;

  /** 当前 buffer 中最早事件的 sequence（用于判断 cursor 是否已过期）。 */
  earliestCursor(): SequenceCursor;

  /** 当前 buffer 中事件总条数。 */
  size(): number;
}

/** TranscriptBuffer 构造选项。 */
export interface TranscriptBufferOptions {
  /** 关联的 sessionId，仅作元信息存储，便于审计。 */
  sessionId: SessionId;
  /** 环形容量上限。默认 MAX_TRANSCRIPT_EVENTS。 */
  capacity?: number;
}
