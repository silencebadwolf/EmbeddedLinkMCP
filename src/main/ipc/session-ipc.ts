import { ipcMain, type IpcMainInvokeEvent, type WebContents } from 'electron';
import type { SessionManager } from '../../core/session/session-manager.js';
import type { TranscriptEvent } from '../../core/transcript/types.js';
import { IPC_CHANNELS } from '../../shared/ipc-protocol.js';
import { WriteQueueFullError } from '../../core/write-queue/types.js';
import { SessionNotOpenError } from '../../core/session/types.js';
import type { SessionId } from '../../shared/types.js';

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
 * IPC 错误响应格式。客户端按 `success:false` 路径处理，避免 Electron 的默认抛错语义。
 *
 * 之所以不直接 throw：ipcRenderer.invoke 在被拒绝时会把 stack 整个 dump 给渲染端，
 * 既泄漏路径又难以国际化。改用结构化错误更稳定。
 */
type IpcResult<T> = { success: true; data: T } | { success: false; error: { code: string; message: string } };

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

  const onSessionEvent = (sessionId: SessionId, event: TranscriptEvent): void => {
    for (const wc of subscribers.values()) {
      if (!wc.isDestroyed()) {
        wc.send(IPC_CHANNELS.TRANSCRIPT_EVENT, { sessionId, event });
      }
    }
  };
  sessionManager.on('session:event', onSessionEvent);

  const onSessionDestroyed = (sessionId: SessionId): void => {
    // session 被销毁时也广播一条系统通知，让渲染端更新 UI；用 transcript:event 通道复用
    for (const wc of subscribers.values()) {
      if (!wc.isDestroyed()) {
        wc.send(IPC_CHANNELS.TRANSCRIPT_EVENT, {
          sessionId,
          event: null,
          destroyed: true,
        });
      }
    }
  };
  sessionManager.on('session:destroyed', onSessionDestroyed);

  /** 把字符串 base64 解为 Uint8Array。容错空串、非法字符都抛 INVALID_PAYLOAD。 */
  const decodeBase64 = (s: string): Uint8Array => {
    try {
      return new Uint8Array(Buffer.from(s, 'base64'));
    } catch (err) {
      throw new IpcError('INVALID_PAYLOAD', err instanceof Error ? err.message : String(err));
    }
  };

  ipcMain.handle(
    IPC_CHANNELS.SESSION_WRITE,
    async (_event, req: SessionWriteRequest): Promise<IpcResult<{ bytesWritten: number }>> =>
      wrap(async () => {
        const data = decodeBase64(req.dataBase64);
        // 安全边界：origin 在主进程强制 'human'，不接受渲染端任何覆盖
        const session = sessionManager.get(req.sessionId);
        if (!session) {
          throw new IpcError('SESSION_NOT_FOUND', `Session not found: ${req.sessionId}`);
        }
        try {
          await session.write(data, {
            origin: 'human',
            correlationId: req.correlationId,
            priority: req.priority,
          });
        } catch (err) {
          if (err instanceof WriteQueueFullError) {
            throw new IpcError('QUEUE_FULL', err.message);
          }
          if (err instanceof SessionNotOpenError) {
            throw new IpcError('NOT_OPEN', err.message);
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
      IpcResult<{
        events: ReadonlyArray<SerializedTranscriptEvent>;
        cursor: number;
        truncated: boolean;
        oldestAvailableSequence: number;
      }>
    > =>
      wrap(async () => {
        const result = sessionManager.read(req.sessionId, req.cursor ?? 0);
        return {
          events: result.events.map(serializeEvent),
          cursor: result.cursor,
          truncated: result.truncated,
          oldestAvailableSequence: result.oldestAvailableSequence,
        };
      }),
  );

  ipcMain.handle(
    IPC_CHANNELS.SESSION_CLEAR,
    async (_event, req: SessionClearRequest): Promise<IpcResult<{ sequence: number }>> =>
      wrap(async () => {
        const event = sessionManager.clear(req.sessionId, 'human');
        return { sequence: event.sequence };
      }),
  );

  ipcMain.handle(
    IPC_CHANNELS.SESSION_LIST,
    async (): Promise<IpcResult<{ sessionIds: ReadonlyArray<SessionId> }>> =>
      wrap(async () => ({ sessionIds: sessionManager.list() })),
  );

  ipcMain.handle(
    IPC_CHANNELS.SESSION_STATUS,
    async (
      _event,
      req: SessionStatusRequest,
    ): Promise<IpcResult<{ sessionId: SessionId; state: string; latestCursor: number }>> =>
      wrap(async () => {
        const session = sessionManager.get(req.sessionId);
        if (!session) {
          throw new IpcError('SESSION_NOT_FOUND', `Session not found: ${req.sessionId}`);
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
    async (_event, req: SessionResizeRequest): Promise<IpcResult<{ resized: boolean }>> =>
      wrap(async () => {
        const session = sessionManager.get(req.sessionId);
        if (!session) {
          throw new IpcError('SESSION_NOT_FOUND', `Session not found: ${req.sessionId}`);
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
    async (_event, req: SessionDestroyRequest): Promise<IpcResult<{ destroyed: true }>> =>
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
      IpcResult<{
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
          events: result.events.map(serializeEvent),
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
    sessionManager.off('session:destroyed', onSessionDestroyed);
    subscribers.clear();
  };
}

/** 序列化 TranscriptEvent 给 IPC：data 改为 base64 字符串，避免 Buffer 跨 worker 复制。 */
export interface SerializedTranscriptEvent {
  type: TranscriptEvent['type'];
  origin: TranscriptEvent['origin'];
  sequence: number;
  timestamp: number;
  evidenceKind?: TranscriptEvent['evidenceKind'];
  /** base64 编码；data 字段不存在或为空时省略此键。 */
  dataBase64?: string;
  meta?: TranscriptEvent['meta'];
}

/** 把 TranscriptEvent 序列化为 IPC 安全格式（Uint8Array → base64 字符串）。 */
export function serializeEvent(event: TranscriptEvent): SerializedTranscriptEvent {
  const out: SerializedTranscriptEvent = {
    type: event.type,
    origin: event.origin,
    sequence: event.sequence,
    timestamp: event.timestamp,
  };
  if (event.evidenceKind) out.evidenceKind = event.evidenceKind;
  if (event.data && event.data.byteLength > 0) {
    out.dataBase64 = Buffer.from(event.data).toString('base64');
  }
  if (event.meta) out.meta = event.meta;
  return out;
}

/** 主进程内部错误类型；包装成 IPC 标准错误响应时使用。 */
class IpcError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'IpcError';
  }
}

/**
 * 把 handler 抛出的异常包装为统一 `{ success:false, error }`，
 * 让渲染端永远拿到结构化结果而非 Electron 默认的 stack dump。
 */
async function wrap<T>(fn: () => Promise<T>): Promise<IpcResult<T>> {
  try {
    const data = await fn();
    return { success: true, data };
  } catch (err) {
    if (err instanceof IpcError) {
      return { success: false, error: { code: err.code, message: err.message } };
    }
    const message = err instanceof Error ? err.message : String(err);
    if (/not found/i.test(message)) {
      return { success: false, error: { code: 'SESSION_NOT_FOUND', message } };
    }
    return { success: false, error: { code: 'INTERNAL', message } };
  }
}

/** 测试用导出：让主进程之外的工具（不依赖 Electron）也能消费这一组类型。 */
export type { SessionWriteRequest, SessionReadRequest, IpcResult };
