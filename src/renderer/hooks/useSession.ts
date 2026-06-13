/**
 * 会话管理 hook —— 把 store 暴露的 sessions / activeId 与 IPC 交互（create/destroy/setActive）打通。
 */

import { useCallback } from 'react';
import { useAppStore } from '../store/app-store.js';
import { getLinkterm } from '../lib/linkterm-bridge.js';
import type { SessionMeta } from '../store/app-store.js';
import type { SessionId } from '../../shared/types.js';
import type { SessionCreateRequestConfig } from '../../shared/preload-api.js';

/** useSessions 返回值。 */
export interface UseSessionsResult {
  /** 已注册到 store 的 SessionMeta 列表（按插入顺序）。 */
  sessions: ReadonlyArray<SessionMeta>;
  /** 当前选中的 session id，无活跃 tab 时为 null。 */
  activeId: SessionId | null;
  /**
   * 创建新会话。成功后自动设为活跃 tab；open 失败 session 仍写进 store 供 UI 看到 errored 状态。
   *
   * @returns 新会话 id；invoke 失败时返回 null
   */
  create(input: { config: SessionCreateRequestConfig; label?: string }): Promise<SessionId | null>;
  /** 关闭并销毁会话，从 store 移除。 */
  destroy(id: SessionId): Promise<void>;
  /** 切换活跃 tab。 */
  select(id: SessionId | null): void;
}

/**
 * 会话管理 hook。
 *
 * 注意：本 hook 不订阅 transcript（那是 useTranscript 的职责），
 * 但会在 create/destroy 时同步 store 的 SessionMeta。
 */
export function useSessions(): UseSessionsResult {
  const sessions = useAppStore((s) => s.sessions);
  const activeId = useAppStore((s) => s.activeSessionId);
  const addSession = useAppStore((s) => s.addSession);
  const removeSession = useAppStore((s) => s.removeSession);
  const setActive = useAppStore((s) => s.setActive);

  const create = useCallback(
    async (input: { config: SessionCreateRequestConfig; label?: string }): Promise<SessionId | null> => {
      const api = getLinkterm();
      if (!api) return null;
      const result = await api.session.create({
        config: input.config,
        label: input.label,
      });
      if (!result.success) return null;
      const meta: SessionMeta = {
        id: result.data.sessionId,
        label: input.label ?? input.config.label ?? defaultLabel(input.config),
        connectionType: input.config.type,
        state: result.data.state,
      };
      addSession(meta);
      setActive(meta.id);
      return meta.id;
    },
    [addSession, setActive],
  );

  const destroy = useCallback(
    async (id: SessionId): Promise<void> => {
      const api = getLinkterm();
      if (api) await api.session.destroy({ sessionId: id });
      removeSession(id);
    },
    [removeSession],
  );

  const select = useCallback(
    (id: SessionId | null): void => {
      setActive(id);
    },
    [setActive],
  );

  return {
    sessions: Array.from(sessions.values()),
    activeId,
    create,
    destroy,
    select,
  };
}

/** 缺省 label 派生：按 type 给一个直观短语，避免 UI 出现空 tab。 */
function defaultLabel(config: SessionCreateRequestConfig): string {
  switch (config.type) {
    case 'serial':
      return config.port;
    case 'ssh':
      return `${config.username}@${config.host}`;
    case 'local-shell':
      return config.shell ?? 'shell';
  }
}
