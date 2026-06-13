import type { Origin, SessionId, SessionState } from '../../shared/types.js';
import type { ReadResult, SequenceCursor, TranscriptEvent } from '../transcript/types.js';

/**
 * 会话写入选项。
 */
export interface SessionWriteOptions {
  /** 写入来源标签。必填 —— 调用层（IPC/MCP）必须显式标注 origin。 */
  origin: Origin;
  correlationId?: string;
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
