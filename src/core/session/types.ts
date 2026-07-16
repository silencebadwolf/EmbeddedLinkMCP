import type { Origin, SessionId, SessionState } from '../../shared/types.js';
import type { ReadResult, SequenceCursor, TranscriptEvent } from '../transcript/types.js';
import type { WritePriority } from '../write-queue/types.js';

/**
 * 会话写入选项。
 */
export interface SessionWriteOptions {
  /** 写入来源标签。必填 —— 调用层（IPC/MCP）必须显式标注 origin。 */
  origin: Origin;
  correlationId?: string;
  /**
   * 写入优先级；缺省 `'normal'`。
   *
   * 仅在用户显式触发的中断场景（Ctrl-C / abort）填 `'high'`；
   * SessionBase 把它原样透传到 WriteQueue.enqueue，
   * 受 WriteQueue 单一序列化点约束（仍走同一通道，仅决定 lane 选择）。
   */
  priority?: WritePriority;
}

/**
 * 会话契约：所有 transport 类型（serial/ssh/local-shell）共享的最小操作集合。
 *
 * Phase 1 仅定义接口和基类；Phase 2/3 提供具体实现（SerialSession 等）。
 */
export interface ISession {
  readonly id: SessionId;
  readonly state: SessionState;

  /** 进入 open 状态（开打 transport、订阅事件）。已 open 时为幂等。 */
  open(): Promise<void>;

  /** 关闭并释放资源。已 closed/errored 时为幂等。 */
  close(): Promise<void>;

  /** 写入；最终调用 WriteQueue.enqueue。返回 Promise 在 transport 确认写入后 resolve。 */
  write(data: Uint8Array, options: SessionWriteOptions): Promise<void>;

  /** 从 cursor 之后读取 transcript。 */
  read(cursor: SequenceCursor): ReadResult;

  /** 在 transcript 中追加一条 clear 事件（不删除历史）。 */
  clear(origin: Origin): TranscriptEvent;

  /**
   * 调整远端/本地 PTY 终端窗口尺寸。
   *
   * 仅 SSH / 本地 Shell 等持有 PTY 的会话需要实现；串口会话不持有窗口概念，可省略此方法或在内部当作 no-op。
   * 调用方（IPC handler）应允许此方法不存在，按 `typeof session.resize === 'function'` 判断。
   */
  resize?(cols: number, rows: number): Promise<void>;

  /** 注册事件订阅。SessionBase 继承自 EventEmitter，提供 off/once 等标准 API。 */
  on(event: 'event', listener: (event: TranscriptEvent) => void): this;
  on(event: 'state', listener: (state: SessionState) => void): this;
}

/**
 * 错误事件 meta（追加到 transcript 的 EventType.error 事件）。
 * 用 type 别名而非 interface，便于直接赋值给 TranscriptEventInput.meta。
 */
export type SessionErrorMeta = {
  message: string;
  /** 错误来源："transport" | "session" | "writer" 等 */
  source: string;
  /** 是否致命：true 时 session 进入 errored 状态。 */
  fatal: boolean;
};

/**
 * 状态变化 meta。
 */
export type SessionStateMeta = {
  from: SessionState;
  to: SessionState;
};

/**
 * 会话未处于 `open` 状态时调用 `write()` 抛出的具名错误。
 *
 * 上层（IPC handler / MCP tool）通过 `err instanceof SessionNotOpenError` 或
 * `code === 'NOT_OPEN'` 识别它，并向客户端返回结构化错误码 `'NOT_OPEN'`，
 * 而不是让它落到通用 `INTERNAL` 桶。这样 IPC 通道与 MCP 工具表层对"非 open
 * 状态写入"返回一致的错误码（req §5.4 错误归类）。
 */
export class SessionNotOpenError extends Error {
  readonly code = 'NOT_OPEN' as const;
  /** 触发时会话当下状态，便于客户端展示提示。 */
  readonly sessionState: SessionState;
  readonly sessionId: SessionId;

  constructor(sessionId: SessionId, state: SessionState) {
    super(`Session ${sessionId} is not open (state=${state})`);
    this.name = 'SessionNotOpenError';
    this.sessionId = sessionId;
    this.sessionState = state;
  }
}

/**
 * 会话处于 open 状态但语义上不可写时抛出的具名错误。
 *
 * RTT 日志终端当前是只读观察流；使用独立错误能让 IPC/MCP 把“不可写”和“未打开”
 * 区分开，避免客户端误导用户去重开会话。
 */
export class SessionNotWritableError extends Error {
  readonly code = 'NOT_WRITABLE' as const;
  readonly sessionId: SessionId;

  constructor(sessionId: SessionId) {
    super(`Session ${sessionId} is read-only and does not accept writes`);
    this.name = 'SessionNotWritableError';
    this.sessionId = sessionId;
  }
}

/**
 * Details captured when an AI command timed out without any completion evidence.
 *
 * The session remains open and readable, but subsequent AI writes are blocked until
 * fresh device output proves that the transport is responsive again.
 */
export interface SessionUnresponsiveDetails {
  readonly cursorBefore: SequenceCursor;
  readonly cursorAfter: SequenceCursor;
}

/**
 * AI write rejected after a sendAndWait timeout marked the session unresponsive.
 *
 * Human writes and transcript reads remain available; this is deliberately separate
 * from SessionState so the shared terminal session is not taken away from the user.
 */
export class SessionUnresponsiveError extends Error {
  readonly code = 'DEVICE_UNRESPONSIVE' as const;
  readonly sessionId: SessionId;
  readonly cursorBefore: SequenceCursor;
  readonly cursorAfter: SequenceCursor;
  readonly retryable = false as const;
  readonly recoveryRequired = true as const;

  constructor(sessionId: SessionId, details: SessionUnresponsiveDetails) {
    super(
      `AI writes are blocked for session ${sessionId} after a timeout; wait for device output or reopen the session`,
    );
    this.name = 'SessionUnresponsiveError';
    this.sessionId = sessionId;
    this.cursorBefore = details.cursorBefore;
    this.cursorAfter = details.cursorAfter;
  }
}

/**
 * 会话不存在（已 destroy 或从未注册）时 SessionManager 抛出的具名错误。
 *
 * Phase 6 评审 M3：原 SessionManager 抛 `Error('Session not found: ...')`，
 * 上层用正则 `/not found/i` 嗅探消息——脆弱（任何消息改动都会让 fallback 失效）。
 * 改为命名错误后，IPC handler / MCP tool 用 `instanceof` 识别并映射到
 * `ERROR_CODES.SESSION_NOT_FOUND`。
 */
export class SessionNotFoundError extends Error {
  readonly code = 'SESSION_NOT_FOUND' as const;
  readonly sessionId: SessionId;

  constructor(sessionId: SessionId) {
    super(`Session not found: ${sessionId}`);
    this.name = 'SessionNotFoundError';
    this.sessionId = sessionId;
  }
}
