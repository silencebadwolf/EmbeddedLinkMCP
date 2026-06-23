import { BrowserWindow, ipcMain, type IpcMainInvokeEvent, type WebContents } from 'electron';
import type { SessionManager } from '../../core/session/session-manager.js';
import type { TranscriptEvent } from '../../core/transcript/types.js';
import { IPC_CHANNELS } from '../../shared/ipc-protocol.js';
import { WriteQueueFullError } from '../../core/write-queue/types.js';
import { SessionNotOpenError, SessionNotFoundError, SessionNotWritableError } from '../../core/session/types.js';
import type { SessionId, SessionLifecycleEvent, SessionState, SessionSummary } from '../../shared/types.js';
import {
  serializeTranscriptEvent,
  type SerializedTranscriptEvent,
} from '../../shared/transcript-ipc-types.js';
import type {
  PreloadResult,
  PreloadFail,
} from '../../shared/preload-api.js';
import { ERROR_CODES } from '../../shared/error-codes.js';

/** session:write 入参契约。data 通过 IPC 传 base64 字符串，避免 Buffer 序列化平台差异。 */
interface SessionWriteRequest {
  sessionId: SessionId;
  /** base64 编码字节；空字符串视为 0 字节合法写入。 */
  dataBase64: string;
  /** 仅作审计透传——origin 不接受渲染端覆盖（强制 'human'）。 */
  correlationId?: string;
  /**
   * 是否高优先级。仅人触发的 abort/Ctrl-C 应当为 true，UI 默认 false。
   * 渲染进程不能伪造 origin，但允许声明优先级（仍受 WriteQueue 单一序列化保护）。
   */
  priority?: 'high' | 'normal';
}

interface SessionReadRequest {
  sessionId: SessionId;
  cursor?: number;
}

interface SessionClearRequest {
  sessionId: SessionId;
}

interface SessionStatusRequest {
  sessionId: SessionId;
}

interface SessionResizeRequest {
  sessionId: SessionId;
  cols: number;
  rows: number;
}

interface SessionDestroyRequest {
  sessionId: SessionId;
}

interface TranscriptSubscribeRequest {
  sessionId: SessionId;
}

/**
 * 注册所有 session 相关 IPC handler 与 transcript 推送。
 *
 * 承担两层职责：
 * 1. **写入通道（origin=human）** —— `session:write` IPC handler 强制 `origin: 'human'`，
 *    渲染进程不能伪造 AI 身份；写入仍走 SessionManager → WriteQueue → transport 单一通道。
 * 2. **transcript 订阅推送** —— 渲染端通过 `transcript:subscribe` 注册（以 webContents 为 subscriberId），
 *    主进程把 SessionManager 的 'session:event' 转发到对应 BrowserWindow，
 *    `transcript:event` 频道携带完整 TranscriptEvent。
 *
 * 多渲染进程窗口共存时，每个 webContents 持有独立 cursor —— 见 SessionManager.subscribe()。
 *
 * @param sessionManager 与 MCP server 共享的同一 SessionManager 实例（§4.5 不变量）
 * @returns 反注册函数：移除全部 ipcMain handler 与 manager 监听器（用于退出/测试 teardown）
 */
export function registerSessionIpc(sessionManager: SessionManager): () => void {
  /**
   * 把 manager 转发的事件广播给所有已注册的 webContents。
   * 我们不挂 BrowserWindow.getAllWindows（那会把"未订阅过"的窗口也喂事件，消耗带宽）；
   * 仅广播给 #subscribers 集合中的 webContents。
   */
  const subscribers = new Map<number, WebContents>();

  const subscriberIdOf = (wc: WebContents): string => `wc:${wc.id}`;

  /** 广播会话生命周期事件；没有监听器的窗口会自动忽略该 channel。 */
  const broadcastSessionLifecycle = (event: SessionLifecycleEvent): void => {
    for (const win of BrowserWindow.getAllWindows()) {
      sendToWebContents(win.webContents, IPC_CHANNELS.SESSION_LIFECYCLE, event);
    }
  };

  const onSessionEvent = (sessionId: SessionId, event: TranscriptEvent): void => {
    if (event.type === 'state') {
      const summary = sessionManager.summaryOf(sessionId);
      if (summary) broadcastSessionLifecycle({ type: 'stateChanged', session: summary });
    }
    const serialized = serializeTranscriptEvent(event);
    for (const wc of subscribers.values()) {
      sendToWebContents(wc, IPC_CHANNELS.TRANSCRIPT_EVENT, { sessionId, event: serialized });
    }
  };
  sessionManager.on('session:event', onSessionEvent);

  const onSessionCreated = (sessionId: SessionId): void => {
    const summary = sessionManager.summaryOf(sessionId);
    if (!summary) return;
    broadcastSessionLifecycle({ type: 'created', session: summary });
  };
  sessionManager.on('session:created', onSessionCreated);

  const onSessionDestroyed = (sessionId: SessionId): void => {
    broadcastSessionLifecycle({ type: 'destroyed', sessionId });
    // session 被销毁时也广播一条系统通知，让渲染端更新 UI；用 transcript:event 通道复用
    for (const wc of subscribers.values()) {
      sendToWebContents(wc, IPC_CHANNELS.TRANSCRIPT_EVENT, {
        sessionId,
        event: null,
        destroyed: true,
      });
    }
  };
  sessionManager.on('session:destroyed', onSessionDestroyed);

  /** 把字符串 base64 解为 Uint8Array。容错空串、非法字符都抛 INVALID_PAYLOAD。 */
  const decodeBase64 = (s: string): Uint8Array => {
    try {
      return new Uint8Array(Buffer.from(s, 'base64'));
    } catch (err) {
      throw new IpcError(ERROR_CODES.INVALID_PAYLOAD, err instanceof Error ? err.message : String(err));
    }
  };

  ipcMain.handle(
    IPC_CHANNELS.SESSION_WRITE,
    async (_event, req: SessionWriteRequest): Promise<PreloadResult<{ bytesWritten: number }>> =>
      wrap(async () => {
        const data = decodeBase64(req.dataBase64);
        // 安全边界：origin 在主进程强制 'human'，不接受渲染端任何覆盖
        const session = sessionManager.get(req.sessionId);
        if (!session) {
          throw new IpcError(ERROR_CODES.SESSION_NOT_FOUND, `Session not found: ${req.sessionId}`);
        }
        try {
          await session.write(data, {
            origin: 'human',
            correlationId: req.correlationId,
            priority: req.priority,
          });
        } catch (err) {
          if (err instanceof WriteQueueFullError) {
            throw new IpcError(ERROR_CODES.QUEUE_FULL, err.message);
          }
          if (err instanceof SessionNotOpenError) {
            throw new IpcError(ERROR_CODES.NOT_OPEN, err.message);
          }
          if (err instanceof SessionNotWritableError) {
            throw new IpcError(ERROR_CODES.NOT_WRITABLE, err.message);
          }
          throw err;
        }
        return { bytesWritten: data.byteLength };
      }),
  );

  ipcMain.handle(
    IPC_CHANNELS.SESSION_READ,
    async (
      _event,
      req: SessionReadRequest,
    ): Promise<
      PreloadResult<{
        events: ReadonlyArray<SerializedTranscriptEvent>;
        cursor: number;
        truncated: boolean;
        oldestAvailableSequence: number;
      }>
    > =>
      wrap(async () => {
        const result = sessionManager.read(req.sessionId, req.cursor ?? 0);
        return {
          events: result.events.map(serializeTranscriptEvent),
          cursor: result.cursor,
          truncated: result.truncated,
          oldestAvailableSequence: result.oldestAvailableSequence,
        };
      }),
  );

  ipcMain.handle(
    IPC_CHANNELS.SESSION_CLEAR,
    async (_event, req: SessionClearRequest): Promise<PreloadResult<{ sequence: number }>> =>
      wrap(async () => {
        const event = sessionManager.clear(req.sessionId, 'human');
        return { sequence: event.sequence };
      }),
  );

  ipcMain.handle(
    IPC_CHANNELS.SESSION_LIST,
    async (): Promise<PreloadResult<{ sessions: ReadonlyArray<SessionSummary> }>> =>
      wrap(async () => ({ sessions: sessionManager.listSummaries() })),
  );

  ipcMain.handle(
    IPC_CHANNELS.SESSION_STATUS,
    async (
      _event,
      req: SessionStatusRequest,
    ): Promise<PreloadResult<{ sessionId: SessionId; state: SessionState; latestCursor: number }>> =>
      wrap(async () => {
        const session = sessionManager.get(req.sessionId);
        if (!session) {
          throw new IpcError(ERROR_CODES.SESSION_NOT_FOUND, `Session not found: ${req.sessionId}`);
        }
        const result = session.read(0);
        return {
          sessionId: session.id,
          state: session.state,
          latestCursor: result.cursor,
        };
      }),
  );

  ipcMain.handle(
    IPC_CHANNELS.SESSION_RESIZE,
    async (_event, req: SessionResizeRequest): Promise<PreloadResult<{ resized: boolean }>> =>
      wrap(async () => {
        const session = sessionManager.get(req.sessionId);
        if (!session) {
          throw new IpcError(ERROR_CODES.SESSION_NOT_FOUND, `Session not found: ${req.sessionId}`);
        }
        if (typeof session.resize !== 'function') {
          // 串口 session 没有窗口概念；返回 resized=false 而非抛错让前端兼容写法更简洁
          return { resized: false };
        }
        await session.resize(req.cols, req.rows);
        return { resized: true };
      }),
  );

  ipcMain.handle(
    IPC_CHANNELS.SESSION_DESTROY,
    async (_event, req: SessionDestroyRequest): Promise<PreloadResult<{ destroyed: true }>> =>
      wrap(async () => {
        await sessionManager.destroy(req.sessionId);
        return { destroyed: true };
      }),
  );

  ipcMain.handle(
    IPC_CHANNELS.TRANSCRIPT_SUBSCRIBE,
    async (
      event: IpcMainInvokeEvent,
      req: TranscriptSubscribeRequest,
    ): Promise<
      PreloadResult<{
        events: ReadonlyArray<SerializedTranscriptEvent>;
        cursor: number;
        truncated: boolean;
        oldestAvailableSequence: number;
      }>
    > =>
      wrap(async () => {
        const wc = event.sender;
        // M4：only register the 'destroyed' once-listener on the FIRST subscribe call
        // for this webContents. ipcRenderer.invoke('transcript:subscribe') 会被多次触发
        // （组件 mount 重连、HMR 等），如果每次都挂一份 'destroyed' once，会累积成
        // MaxListenersExceededWarning 并在 wc 真正销毁时多次清理。守卫保证只挂一次。
        const isFirst = !subscribers.has(wc.id);
        subscribers.set(wc.id, wc);
        if (isFirst) {
          // 渲染端 reload / 销毁时自动清理订阅，避免死引用
          wc.once('destroyed', () => {
            subscribers.delete(wc.id);
            sessionManager.unsubscribe(subscriberIdOf(wc));
          });
        }
        const result = sessionManager.readForSubscriber(subscriberIdOf(wc), req.sessionId);
        return {
          events: result.events.map(serializeTranscriptEvent),
          cursor: result.cursor,
          truncated: result.truncated,
          oldestAvailableSequence: result.oldestAvailableSequence,
        };
      }),
  );

  return () => {
    ipcMain.removeHandler(IPC_CHANNELS.SESSION_WRITE);
    ipcMain.removeHandler(IPC_CHANNELS.SESSION_READ);
    ipcMain.removeHandler(IPC_CHANNELS.SESSION_CLEAR);
    ipcMain.removeHandler(IPC_CHANNELS.SESSION_LIST);
    ipcMain.removeHandler(IPC_CHANNELS.SESSION_STATUS);
    ipcMain.removeHandler(IPC_CHANNELS.SESSION_RESIZE);
    ipcMain.removeHandler(IPC_CHANNELS.SESSION_DESTROY);
    ipcMain.removeHandler(IPC_CHANNELS.TRANSCRIPT_SUBSCRIBE);
    sessionManager.off('session:event', onSessionEvent);
    sessionManager.off('session:created', onSessionCreated);
    sessionManager.off('session:destroyed', onSessionDestroyed);
    subscribers.clear();
  };
}

/** Safely send an IPC event to a webContents that may be destroyed between checks. */
function sendToWebContents(wc: WebContents, channel: string, payload: unknown): void {
  if (wc.isDestroyed()) return;
  try {
    wc.send(channel, payload);
  } catch {
    // Window was destroyed between isDestroyed() and send(); skip like ui-bridge.
  }
}

/** 序列化 TranscriptEvent 给 IPC：data 改为 base64 字符串，避免 Buffer 跨 worker 复制。 */
export type { SerializedTranscriptEvent } from '../../shared/transcript-ipc-types.js';

/**
 * 主进程内部错误类型；包装成 IPC 标准错误响应时使用。
 */
class IpcError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'IpcError';
  }
}

/**
 * 把 handler 抛出的异常包装为统一 `{ success:false, error }`，
 * 让渲染端永远拿到结构化结果而非 Electron 默认的 stack dump。
 *
 * Phase 6 评审 M3：原 fallback 用 `/not found/i` 嗅探消息映射到 SESSION_NOT_FOUND；
 * 现统一通过 `SessionNotFoundError` 命名错误识别，删除字符串 fallback。
 */
async function wrap<T>(fn: () => Promise<T>): Promise<PreloadResult<T>> {
  try {
    const data = await fn();
    return { success: true, data };
  } catch (err) {
    if (err instanceof IpcError) {
      return failOf(err.code, err.message);
    }
    if (err instanceof SessionNotFoundError) {
      return failOf(ERROR_CODES.SESSION_NOT_FOUND, err.message);
    }
    if (err instanceof SessionNotOpenError) {
      return failOf(ERROR_CODES.NOT_OPEN, err.message);
    }
    if (err instanceof WriteQueueFullError) {
      return failOf(ERROR_CODES.QUEUE_FULL, err.message);
    }
    const message = err instanceof Error ? err.message : String(err);
    return failOf(ERROR_CODES.INTERNAL, message);
  }
}

/** 构造 PreloadFail；保留这一辅助函数让 wrap 主体更短、可读性更高。 */
function failOf(code: string, message: string): PreloadFail {
  return { success: false, error: { code, message } };
}

/** 测试用导出：让主进程之外的工具（不依赖 Electron）也能消费这一组类型。 */
export type { SessionWriteRequest, SessionReadRequest };
export type { PreloadResult as IpcResult } from '../../shared/preload-api.js';
