// sendAndWait orchestrator：发送后固定观察窗口，再返回 transcript 中的设备输出。

import type { TranscriptEvent } from '../transcript/types.js';
import { WriteQueueFullError } from '../write-queue/types.js';
import { TERMINAL_OBSERVATION_MAX_BYTES } from '../../shared/constants.js';
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
 * @param args  写入 payload + 规则覆盖 + settle 窗口/correlationId/signal
 * @returns     结构化结果；调用方据此决定是否翻译为 ToolError
 */
export async function sendAndWait(
  deps: SendAndWaitDeps,
  args: SendAndWaitArgs,
): Promise<SendAndWaitResult> {
  const { sessionManager } = deps;
  const rules = mergeRules(DEFAULT_TERMINAL_RULES, args.rules);
  const settleMs = args.settleMs ?? args.timeoutMs ?? rules.defaultSettleMs;

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
  const observedChunks: Uint8Array[] = [];
  let observedStoredBytes = 0;
  let observedTotalBytes = 0;

  // 终态构造 helper：所有路径共用 received/cursor/bytesWritten 抓取，
  // settle 是正常成功结果，marker 只作为观察元数据。
  const finalize = (
    reason: 'settled' | 'session-closed' | 'aborted',
    extras: {
      bytesWritten: number;
      matchedMarkerIndex?: number | null;
      sessionState?: 'closed' | 'errored';
    },
  ): SendAndWaitResult => {
    const buffer = joinObservedChunks(observedChunks, observedStoredBytes);
    const cursorAfter = safeReadCursor(sessionManager, args.sessionId, cursorBefore);
    if (reason === 'settled') {
      const detectorState = detector.feed(EMPTY);
      return {
        success: true,
        reason: 'settled',
        bytesWritten: extras.bytesWritten,
        matchedMarkerIndex:
          extras.matchedMarkerIndex ??
          (detectorState.matchedMarkerIndex >= 0 ? detectorState.matchedMarkerIndex : null),
        hasDeviceOutput: buffer.byteLength > 0,
        receivedTruncated: observedTotalBytes > observedStoredBytes,
        receivedTotalBytes: observedTotalBytes,
        received: buffer,
        receivedBase64: toBase64(buffer),
        cursorBefore,
        cursorAfter,
      };
    }
    const base = {
      success: false as const,
      bytesWritten: extras.bytesWritten,
      received: buffer,
      receivedBase64: toBase64(buffer),
      receivedTruncated: observedTotalBytes > observedStoredBytes,
      receivedTotalBytes: observedTotalBytes,
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
        receivedTruncated: false,
        receivedTotalBytes: 0,
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

  const predicate = (event: TranscriptEvent): boolean => {
    if (event.type !== 'data' || event.origin !== 'device') return false;
    const raw = event.data;
    if (!raw) return false;
    const filtered = echo.filter(raw);
    if (filtered.byteLength === 0) return false;
    // 设备输出只进入观察缓冲区；既不因任意输出提前返回，也不因 marker
    // 缺失把健康设备误判成 timeout/unresponsive。
    detector.feed(filtered);
    observedTotalBytes += filtered.byteLength;
    const remaining = TERMINAL_OBSERVATION_MAX_BYTES - observedStoredBytes;
    if (remaining > 0) {
      const stored =
        filtered.byteLength <= remaining ? new Uint8Array(filtered) : filtered.slice(0, remaining);
      observedChunks.push(stored);
      observedStoredBytes += stored.byteLength;
    }
    return false;
  };

  type RaceResult =
    | { kind: 'wait'; outcome: Awaited<ReturnType<typeof sessionManager.waitFor>> }
    | { kind: 'abort' };

  const waitPromise = sessionManager
    .waitFor(args.sessionId, predicate, {
      timeoutMs: settleMs,
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
    // predicate 当前永不返回 true；保留该分支以防未来 SessionManager 注入
    // 实现改变时破坏结果契约。
    return finalize('settled', {
      bytesWritten: writeBytes.byteLength,
    });
  }
  if (outcome.kind === 'timeout') {
    return finalize('settled', { bytesWritten: writeBytes.byteLength });
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

/** 在独立观察缓冲中拼接已保留的设备字节，不受 marker 检测窗口影响。 */
function joinObservedChunks(chunks: readonly Uint8Array[], totalBytes: number): Uint8Array {
  if (totalBytes === 0) return EMPTY;
  const out = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
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
