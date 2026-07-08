/**
 * 从主进程/后台 runtime 水合 renderer 会话列表。
 */

import * as React from 'react';
import type { SessionSummary } from '../../shared/types.js';
import { getLinkterm } from '../lib/linkterm-bridge.js';
import { useAppStore } from '../store/app-store.js';

const SESSION_RECONCILE_INTERVAL_MS = 2000;

/**
 * 在组件挂载后读取后台 runtime 当前会话摘要，并把尚未知晓的会话加入 renderer store。
 *
 * @returns 无返回值；副作用是同步 Zustand store。
 */
export function useSessionHydration(): void {
  const addSession = useAppStore((s) => s.addSession);
  const removeSession = useAppStore((s) => s.removeSession);
  const setActive = useAppStore((s) => s.setActive);

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
        ...(summary.rttLog ? { rttLog: summary.rttLog } : {}),
      });
    };

    const unsubscribeLifecycle = api.session.onLifecycle((event) => {
      if (event.type === 'created' || event.type === 'stateChanged') {
        upsertSummary(event.session);
        if (event.type === 'created' && event.session.createdBy === 'ai') {
          setActive(event.session.sessionId);
        }
        return;
      }
      removeSession(event.sessionId);
    });

    const hydrate = async (): Promise<void> => {
      const result = await api.session.list();
      if (cancelled || !result.success) return;
      for (const summary of result.data.sessions) {
        upsertSummary(summary);
        if (summary.createdBy === 'ai') {
          setActive(summary.sessionId);
        }
      }
    };

    void hydrate();
    const reconcileTimer = window.setInterval(() => {
      void hydrate();
    }, SESSION_RECONCILE_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(reconcileTimer);
      unsubscribeLifecycle();
    };
  }, [addSession, removeSession, setActive]);
}
