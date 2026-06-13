/**
 * Transcript 订阅 hook：把 IPC 推送的事件渲染到 xterm Terminal。
 *
 * 启动序（Phase 6 评审 C1 修订）：
 * 1. mount → 注册 `linkterm.transcript.onEvent` 监听增量（必须先于 subscribe，避免事件丢失）
 * 2. 调用 `linkterm.session.subscribe`：
 *    - 主进程返回的 `events` 字段作为唯一历史快照（按 webContents.id 跟踪游标，无重复风险）；
 *    - 渲染快照后切换到 onEvent 流式接续。
 *
 * **不再调用 `session.read({cursor:0})`**：
 * - read 只是没有 subscriberId 的 buffer 快照，与 subscribe 的 events 字段返回内容完全重叠；
 * - 旧实现在 read 与 subscribe 之间存在竞态：在 read 完成后、subscribe 之前到达的事件会丢失，
 *   而 subscribe 之后又会重发已读历史的尾部，造成"既漏又重"。
 *
 * cleanup：取消 onEvent 监听 + 释放渲染状态；不在主进程侧 unsubscribe，因为主进程按
 * webContents 生命周期管理订阅注册。
 */

import { useEffect, useRef } from 'react';
import type { Terminal } from '@xterm/xterm';
import type { Origin, SessionId, SessionState } from '../../shared/types.js';
import { useAppStore } from '../store/app-store.js';
import { getLinkterm } from '../lib/linkterm-bridge.js';
import {
  createRenderState,
  disposeSessionRenderState,
  renderEventToXterm,
  type RenderState,
} from '../lib/render-event.js';

/** Origin 活动节流间隔（ms）：呼吸灯不需要 60Hz 精度，250ms 足够人眼察觉。 */
const ORIGIN_ACTIVITY_THROTTLE_MS = 250;

/**
 * 订阅指定 session 的 transcript 并喂入给定 Terminal。
 *
 * @param sessionId 目标 session id；为 null 时不做任何事
 * @param terminal 目标 xterm Terminal；为 null 时不做任何事（StrictMode 双 mount 期间临时为 null 是合法的）
 */
export function useTranscript(
  sessionId: SessionId | null,
  terminal: Pick<Terminal, 'write' | 'clear'> | null,
): void {
  const updateSessionState = useAppStore((s) => s.updateSessionState);
  const removeSession = useAppStore((s) => s.removeSession);
  const markOriginActivity = useAppStore((s) => s.markOriginActivity);

  // 渲染状态跨重渲染保留：不能放在 useEffect 局部，否则 StrictMode 双 mount 会丢失行状态
  const renderStateRef = useRef<RenderState | null>(null);
  if (renderStateRef.current === null) {
    renderStateRef.current = createRenderState();
  }

  // 节流 markOriginActivity：每 (sessionId, origin) 至多每 250ms 落一次 store
  // 用 ref 跨渲染保留，避免每次 hook 重跑都重置时间戳
  const lastOriginAtRef = useRef<Map<string, number>>(new Map());

  useEffect(() => {
    if (!sessionId || !terminal) return;
    const api = getLinkterm();
    if (!api) return;
    const renderState = renderStateRef.current!;
    const lastOriginAt = lastOriginAtRef.current;
    let cancelled = false;
    let unsubscribeOnEvent: (() => void) | null = null;

    /** 节流后的 origin 活动通知：250ms 内重复 origin 仅触发一次 store 更新。 */
    const tickOriginActivity = (origin: Origin): void => {
      const key = `${sessionId}\0${origin}`;
      const now = Date.now();
      const prev = lastOriginAt.get(key) ?? 0;
      if (now - prev < ORIGIN_ACTIVITY_THROTTLE_MS) return;
      lastOriginAt.set(key, now);
      markOriginActivity(sessionId, origin, now);
    };

    const start = async (): Promise<void> => {
      // 1) 必须先注册 onEvent 监听，再 subscribe；否则 subscribe 期间到达的事件会丢失
      unsubscribeOnEvent = api.transcript.onEvent((envelope) => {
        if (envelope.sessionId !== sessionId) return;
        if (envelope.destroyed) {
          // 主进程通知：session 已销毁；从 store 移除并清理渲染状态
          removeSession(sessionId);
          disposeSessionRenderState(renderState, sessionId);
          return;
        }
        const event = envelope.event;
        renderEventToXterm(terminal, event, renderState, sessionId);
        tickOriginActivity(event.origin);
        // state 事件：同步 UI store 上的 state 字段
        if (event.type === 'state') {
          const meta = event.meta as { to?: SessionState } | undefined;
          if (meta?.to) updateSessionState(sessionId, meta.to);
        }
      });

      // 2) subscribe 同时拿到历史快照；主进程按 webContents.id 跟踪游标，
      //    后续 onEvent 推送的事件 sequence 严格大于此次 events 的最大 sequence —— 不会重复
      const subResult = await api.session.subscribe({ sessionId });
      if (cancelled) return;
      if (subResult.success) {
        for (const event of subResult.data.events) {
          renderEventToXterm(terminal, event, renderState, sessionId);
          // 历史回放不触发呼吸灯（lastOriginAt 不更新），避免视觉突兀
        }
      }
    };

    void start().catch(() => {
      // 主进程未就绪时静默忽略
    });

    return () => {
      cancelled = true;
      if (unsubscribeOnEvent) unsubscribeOnEvent();
      // 不主动 unsubscribe 主进程：那是 webContents.destroyed 时机的事；
      // 多组件共用同一 sessionId 的订阅时，提前 unsubscribe 会让其它组件失去推送
    };
  }, [sessionId, terminal, updateSessionState, removeSession, markOriginActivity]);
}
