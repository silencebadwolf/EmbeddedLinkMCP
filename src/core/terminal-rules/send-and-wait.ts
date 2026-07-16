// Phase 7 sendAndWait orchestrator：串联 EchoHandler + CompletionDetector + SessionManager.write/waitFor，输出结构化结果。

import type { TranscriptEvent } from '../transcript/types.js';
import { WriteQueueFullError } from '../write-queue/types.js';
import { CompletionDetector } from './completion-detector.js';
import { EchoHandler } from './echo-handler.js';
import { DEFAULT_TERMINAL_RULES, appendLineEnding, mergeRules } from './rules.js';
import type {
  SendAndWaitArgs,
  SendAndWaitDeps,
  SendAndWaitResult,
  SessionManagerLike,
} from './types.js';

const EMPTY = new Uint8Array(0);

/**
 * sendAndWait orchestrator —— 注入式纯函数。
 *
 * @param deps  注入的 SessionManagerLike（生产环境 = SessionManager；测试 = mock）
 * @param args  写入 payload + 规则覆盖 + 超时/correlationId/signal
 * @returns     结构化结果；调用方据此决定是否翻译为 ToolError
 */
export async function sendAndWait(
  deps: SendAndWaitDeps,
  args: SendAndWaitArgs,
): Promise<SendAndWaitResult> {
  const { sessionManager } = deps;
  const rules = mergeRules(DEFAULT_TERMINAL_RULES, args.rules);
  const timeoutMs = args.timeoutMs ?? rules.defaultTimeoutMs;

  const writeBytes =
    args.appendLineEnding === false
      ? new Uint8Array(args.payload)
      : appendLineEnding(args.payload, rules.lineEnding);

  let cursorBefore = 0;
  try {
    cursorBefore = sessionManager.read(args.sessionId, 0).cursor;
  } catch {
    // session 不存在 —— 让后续 write 抛 SessionNotFoundError 给上层处理
    cursorBefore = 0;
  }

  const detector = new CompletionDetector(rules.completionMarkers, rules.completionBufferMaxBytes);
  const echo = new EchoHandler(rules.echoStrategy);

  // 终态构造 helper：四分支共用 received/cursor/bytesWritten 抓取，差异化部分通过 extras 注入
  const finalize = (
    reason: 'matched' | 'timeout' | 'session-closed' | 'aborted',
    extras: {
      bytesWritten: number;
      matchedMarkerIndex?: number | null;
      sessionState?: 'closed' | 'errored';
    },
  ): SendAndWaitResult => {
    const buffer = detector.snapshotBuffer();
    const cursorAfter = safeReadCursor(sessionManager, args.sessionId, cursorBefore);
    if (reason === 'matched') {
      return {
        success: true,
        reason: 'matched',
        bytesWritten: extras.bytesWritten,
        matchedMarkerIndex: extras.matchedMarkerIndex ?? null,
        received: buffer,
        receivedBase64: toBase64(buffer),
        cursorBefore,
        cursorAfter,
      };
    }
    if (reason === 'timeout') {
      try {
        sessionManager.markAiUnresponsive?.(args.sessionId, { cursorBefore, cursorAfter });
      } catch {
        // A concurrent destroy must not replace the timeout evidence with a mark failure.
      }
    }
    const base = {
      success: false as const,
      bytesWritten: extras.bytesWritten,
      received: buffer,
      receivedBase64: toBase64(buffer),
      cursorBefore,
      cursorAfter,
    };
    if (reason === 'session-closed') {
      return { ...base, reason: 'session-closed', sessionState: extras.sessionState };
    }
    return { ...base, reason };
  };

  // pre-abort：caller 在 enter 前已 abort，立刻返回，不写任何字节也不入 echo 队列
  if (args.signal?.aborted) {
    return finalize('aborted', { bytesWritten: 0 });
  }

  // observeWrite 必须早于 write —— 避免 device 抢先把回显字节当成 device 输出
  echo.observeWrite(writeBytes);

  try {
    await sessionManager.write(args.sessionId, writeBytes, {
      origin: 'ai',
      ...(args.correlationId !== undefined ? { correlationId: args.correlationId } : {}),
    });
  } catch (err) {
    if (err instanceof WriteQueueFullError) {
      const cursorAfter = safeReadCursor(sessionManager, args.sessionId, cursorBefore);
      return {
        success: false,
        reason: 'queue-full',
        bytesWritten: 0,
        received: EMPTY,
        receivedBase64: '',
        cursorBefore,
        cursorAfter,
      };
    }
    throw err;
  }

  // write 完成后再检查一次 abort，避免 race 在 await 期间触发
  if (args.signal?.aborted) {
    return finalize('aborted', { bytesWritten: writeBytes.byteLength });
  }

  // 当 completionMarkers 为空数组时退化为 "任意 device 输出即视为完成"
  const fallbackOnAny = rules.completionMarkers.length === 0;
  const predicate = (event: TranscriptEvent): boolean => {
    if (event.type !== 'data' || event.origin !== 'device') return false;
    const raw = event.data;
    if (!raw) return false;
    const filtered = echo.filter(raw);
    if (filtered.byteLength === 0) return false;
    const state = detector.feed(filtered);
    if (fallbackOnAny) return true;
    return state.matched;
  };

  type RaceResult =
    | { kind: 'wait'; outcome: Awaited<ReturnType<typeof sessionManager.waitFor>> }
    | { kind: 'abort' };

  const waitPromise = sessionManager
    .waitFor(args.sessionId, predicate, {
      timeoutMs,
      replayHistorySince: cursorBefore,
    })
    .then((outcome): RaceResult => ({ kind: 'wait', outcome }));

  let abortListener: (() => void) | undefined;
  const abortPromise = new Promise<RaceResult>((resolve) => {
    if (!args.signal) return; // 永不 resolve（被 race 抛弃）
    abortListener = (): void => resolve({ kind: 'abort' });
    args.signal.addEventListener('abort', abortListener, { once: true });
  });

  let raceResult: RaceResult;
  try {
    raceResult = await Promise.race([waitPromise, abortPromise]);
  } finally {
    if (abortListener && args.signal) {
      args.signal.removeEventListener('abort', abortListener);
    }
  }

  if (raceResult.kind === 'abort') {
    return finalize('aborted', { bytesWritten: writeBytes.byteLength });
  }

  const outcome = raceResult.outcome;

  if (outcome.kind === 'match') {
    const state = detector.feed(EMPTY); // 取最新快照
    const matchedMarkerIndex =
      fallbackOnAny && state.matchedMarkerIndex < 0 ? null : state.matchedMarkerIndex;
    return finalize('matched', {
      bytesWritten: writeBytes.byteLength,
      matchedMarkerIndex,
    });
  }
  if (outcome.kind === 'timeout') {
    return finalize('timeout', { bytesWritten: writeBytes.byteLength });
  }
  return finalize('session-closed', {
    bytesWritten: writeBytes.byteLength,
    sessionState: outcome.state,
  });
}

/** 安全读取 cursor —— session 中途被 destroy 时回退到 cursorBefore。 */
function safeReadCursor(
  sessionManager: SessionManagerLike,
  sessionId: string,
  fallback: number,
): number {
  try {
    return sessionManager.read(sessionId, 0).cursor;
  } catch {
    return fallback;
  }
}

/**
 * Uint8Array → base64。
 *
 * 用 Buffer.from（Node 唯一无外部依赖路径）；core 模块允许使用 `Buffer`，
 * 它属于 Node 标准库，不破坏"core 不依赖 Electron / 原生 native"约束。
 */
function toBase64(bytes: Uint8Array): string {
  if (bytes.byteLength === 0) return '';
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64');
}
