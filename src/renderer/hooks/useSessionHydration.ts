/**
 * 从主进程/后台 runtime 水合 renderer 会话列表。
 */

import * as React from 'react';
import type { SessionSummary } from '../../shared/types.js';
import { getLinkterm } from '../lib/linkterm-bridge.js';
import { useAppStore } from '../store/app-store.js';

/**
 * 在组件挂载后读取后台 runtime 当前会话摘要，并把尚未知晓的会话加入 renderer store。
 *
 * @returns 无返回值；副作用是同步 Zustand store。
 */
export function useSessionHydration(): void {
  const addSession = useAppStore((s) => s.addSession);
  const removeSession = useAppStore((s) => s.removeSession);

  React.useEffect(() => {
    const api = getLinkterm();
    if (!api) return;

    let cancelled = false;
    const upsertSummary = (summary: SessionSummary): void => {
      addSession({
        id: summary.sessionId,
        label: summary.label,
        connectionType: summary.connectionType,
        state: summary.state,
      });
    };

    const unsubscribeLifecycle = api.session.onLifecycle((event) => {
      if (event.type === 'created' || event.type === 'stateChanged') {
        upsertSummary(event.session);
        return;
      }
      removeSession(event.sessionId);
    });

    const hydrate = async (): Promise<void> => {
      const result = await api.session.list();
      if (cancelled || !result.success) return;
      for (const summary of result.data.sessions) {
        upsertSummary(summary);
      }
    };

    void hydrate();

    return () => {
      cancelled = true;
      unsubscribeLifecycle();
    };
  }, [addSession, removeSession]);
}
