// Phase 7 终端规则类型定义；零运行时依赖（被 core / mcp / 测试共同消费）。

import type { SessionId } from '../../shared/types.js';
import type { SequenceCursor, TranscriptEvent } from '../transcript/types.js';

/**
 * 完成标记。
 *
 * - `string`：按字节包含匹配（适合静态 prompt，如 `"# "`、`"OK\r\n"`）。
 * - `RegExp`：在累计 UTF-8 解码 buffer 上 `regex.test()`（适合 `\d+>`、`[a-z]+@host:.*\$ ` 之类动态 prompt）。
 *
 * MCP 入参用 `{ pattern, flags? }` 对象形式（zod schema），由 {@link parseMarkerSpec}
 * 转换为 `RegExp` 实例进入 core 层。
 */
export type CompletionMarker = string | RegExp;

/**
 * 回显处理策略。
 *
 * - `'auto'`：按已写入字节计数尝试剥离；首字节不匹配则保留原 chunk。
 * - `'keep'`：完全透传，调用方自己决定怎么处理。
 */
export type EchoStrategy = 'auto' | 'keep';

/**
 * 终端规则集合。
 *
 * 不强求所有字段都 readonly 数组——`completionMarkers` 是 readonly 数组以便 mergeRules
 * 拼接候选标记；其余基础类型字段也是 readonly 以避免 orchestrator 跨调用复用同一规则集时被改写。
 */
export interface TerminalRuleSet {
  /** 写入末尾自动追加的字节序列（仅在 `appendLineEnding=true` 时拼接）。 */
  readonly lineEnding: string;
  /** 完成标记列表；按数组顺序优先（先列出的 marker 命中时取其下标）。 */
  readonly completionMarkers: readonly CompletionMarker[];
  /** sendAndWait 默认超时（毫秒）。 */
  readonly defaultTimeoutMs: number;
  /** 回显处理策略。 */
  readonly echoStrategy: EchoStrategy;
  /** CompletionDetector 累计 buffer 上限（字节）；超出时丢头保尾。 */
  readonly completionBufferMaxBytes: number;
}

/**
 * CompletionDetector.feed() 返回的最新状态快照。
 *
 * 一旦 `matched=true`，调用方应当停止继续 feed —— detector 不会"二次命中"，
 * 保持 matched 直到 reset()。
 */
export interface DetectorState {
  /** 已命中任一完成标记；命中后 feed 仍会更新 totalBytes，但 matched 保持 true。 */
  readonly matched: boolean;
  /** 命中的标记在 completionMarkers 中的下标；未命中为 -1。 */
  readonly matchedMarkerIndex: number;
  /** 命中区间（含）的起始字节偏移（从 detector 实例首次 feed 起算）；未命中为 -1。 */
  readonly matchStartByte: number;
  /** 命中区间（不含）的结束字节偏移；未命中为 -1。 */
  readonly matchEndByte: number;
  /** 已 feed 的累计字节总数（无论 matched 与否）。 */
  readonly totalBytes: number;
}

/** CompletionDetector 契约：仅依赖字节流，不感知 transcript / session 概念。 */
export interface ICompletionDetector {
  /**
   * 喂入一段字节；返回 feed 后的最新状态。
   * 空 chunk 不抛错也不会重置状态。
   * @param bytes 待检测字节序列
   */
  feed(bytes: Uint8Array): DetectorState;
  /** 清空内部状态与累计 buffer。 */
  reset(): void;
  /**
   * 取当前累计 buffer 的字节快照（独立拷贝；调用方修改不影响 detector）。
   * 用于 timeout 路径回填 `received`。
   */
  snapshotBuffer(): Uint8Array;
}

/** EchoHandler 契约：负责把 device 入站字节中"前缀回显部分"剥离掉，再喂给 detector。 */
export interface IEchoHandler {
  /**
   * 记录一次 AI 写入的字节序列（按 FIFO 入队）。
   * 必须**早于**对应 device chunk 抵达；orchestrator 在 sessionManager.write 之前调用。
   */
  observeWrite(bytes: Uint8Array): void;
  /**
   * 过滤一段 device 入站字节：吃掉头部与队首 expected 重合的字节，返回剩余。
   * 一旦遇到任意不匹配字节，剩余 expected 全部丢弃（保守假设：之后都是真实 device 输出）。
   */
  filter(deviceChunk: Uint8Array): Uint8Array;
  /** 清空 expected 队列。 */
  reset(): void;
}

/**
 * send-and-wait orchestrator 与 SessionManager 之间的接口隔离。
 *
 * 仅暴露所需方法 —— 让纯函数 orchestrator 在测试中可以注入 4 方法 mock，
 * 而无需构造完整 SessionManager + SessionBase + Transport 链。
 */
export interface SessionManagerLike {
  /**
   * 写入会话。orchestrator 必填 `origin: 'ai'`，对应 §4.4 / §5.1 安全边界。
   *
   * 实现要透传 SessionWriteOptions —— SessionManager.write 当前签名要求传入对象形式 origin/correlationId。
   */
  write(
    id: SessionId,
    data: Uint8Array,
    options: { origin: 'ai'; correlationId?: string },
  ): Promise<void>;
  /** Mark this session's AI write path as unresponsive after a timeout. */
  markAiUnresponsive?(
    id: SessionId,
    details: { cursorBefore: SequenceCursor; cursorAfter: SequenceCursor },
  ): void;
  /**
   * 等待匹配 predicate 的 transcript event。语义见 SessionManager.waitFor。
   *
   * 注意：`kind` 联合是 `'match' | 'timeout' | 'closed'`，不是 `'matched'`。
   */
  waitFor(
    id: SessionId,
    predicate: (event: TranscriptEvent) => boolean,
    options?: { timeoutMs?: number; replayHistorySince?: SequenceCursor },
  ): Promise<
    | { kind: 'match'; event: TranscriptEvent }
    | { kind: 'timeout'; lastCursor: SequenceCursor }
    | { kind: 'closed'; lastCursor: SequenceCursor; state: 'closed' | 'errored' }
  >;
  /**
   * 读取 transcript（仅取 `cursor` 字段；orchestrator 用它求 cursorBefore / cursorAfter）。
   * 返回类型只要求结构子型 `{ cursor }`，让真实 SessionManager（返回完整 ReadResult）天然满足。
   */
  read(id: SessionId, cursor: SequenceCursor): { readonly cursor: SequenceCursor };
}

/** orchestrator 注入项。 */
export interface SendAndWaitDeps {
  sessionManager: SessionManagerLike;
}

/** orchestrator 入参。 */
export interface SendAndWaitArgs {
  /** 目标会话 id。 */
  sessionId: SessionId;
  /** 待写入字节（不含可能追加的 lineEnding）。 */
  payload: Uint8Array;
  /** 规则覆盖（与 DEFAULT_TERMINAL_RULES 合并）。 */
  rules?: Partial<TerminalRuleSet>;
  /**
   * 是否在 payload 末尾追加 lineEnding；默认 `true`。
   * 当调用方已显式带换行（如 ANSI control sequence）时应传 false。
   */
  appendLineEnding?: boolean;
  /** 覆盖默认超时（毫秒）。 */
  timeoutMs?: number;
  /** 关联 ID（写入 transcript audit 用）。 */
  correlationId?: string;
  /** 外部取消信号；触发后 orchestrator 立即结束等待并返回 `reason: 'aborted'`。 */
  signal?: AbortSignal;
}

/**
 * sendAndWait 结构化结果。
 *
 * **超时不抛 ToolError** —— 由调用方（MCP 工具层）决定是否翻成 ToolError(TIMEOUT)。
 * 这样 IPC / 工作流编排层可以统一拿到 received（含部分输出）做下一步决策。
 */
export type SendAndWaitResult =
  | {
      success: true;
      reason: 'matched';
      bytesWritten: number;
      /** 命中的 marker 下标；fallback 模式（completionMarkers 为空）下命中时为 null。 */
      matchedMarkerIndex: number | null;
      received: Uint8Array;
      receivedBase64: string;
      cursorBefore: SequenceCursor;
      cursorAfter: SequenceCursor;
    }
  | {
      success: false;
      reason: 'timeout' | 'session-closed' | 'queue-full' | 'aborted';
      bytesWritten: number;
      received: Uint8Array;
      receivedBase64: string;
      cursorBefore: SequenceCursor;
      cursorAfter: SequenceCursor;
      /** 仅 `reason='session-closed'` 时存在；标识 session 终态。 */
      sessionState?: 'closed' | 'errored';
    };
