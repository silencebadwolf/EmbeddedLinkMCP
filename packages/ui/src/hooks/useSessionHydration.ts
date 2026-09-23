/**
 * 从主进程/后台 runtime 水合 renderer 会话列表。
 */

import * as React from 'react';
import type { SessionSummary } from '@linkterm/contracts/types';
import { getLinkterm } from '../lib/linkterm-bridge.js';
import { useAppStore } from '../store/app-store.js';

const SESSION_RECONCILE_INTERVAL_MS = 2000;

/**
 * 在组件挂载后读取后台 runtime 当前会话摘要，并把尚未知晓的会话加入 renderer store。
 *
 * @returns 无返回值；副作用是同步 Zustand store。
 */
export function useSessionHydration(reconcileMissingSessions = false): void {
  const addSession = useAppStore((s) => s.addSession);
  const removeSession = useAppStore((s) => s.removeSession);
  const setActive = useAppStore((s) => s.setActive);

  React.useEffect(() => {
    const api = getLinkterm();
    if (!api) return;

    let cancelled = false;
    let reconciling = false;
    let lifecycleRevision = 0;
    const touched = new Map<string, number>();
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
      lifecycleRevision += 1;
      touched.set(event.type === 'destroyed' ? event.sessionId : event.session.sessionId, lifecycleRevision);
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
      if (reconciling) return;
      reconciling = true;
      const before = new Set(useAppStore.getState().sessions.keys());
      const snapshotRevision = lifecycleRevision;
      try {
        const result = await api.session.list();
        if (cancelled || !result.success) return;
        const present = new Set<string>();
        for (const summary of result.data.sessions) {
          present.add(summary.sessionId);
          if ((touched.get(summary.sessionId) ?? 0) > snapshotRevision) continue;
          const isKnownSession = useAppStore.getState().sessions.has(summary.sessionId);
          upsertSummary(summary);
          if (!isKnownSession && summary.createdBy === 'ai') {
            setActive(summary.sessionId);
          }
        }
        if (reconcileMissingSessions) for (const sessionId of before) {
          if (!present.has(sessionId) && (touched.get(sessionId) ?? 0) <= snapshotRevision) removeSession(sessionId);
        }
      } finally {
        reconciling = false;
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
  }, [addSession, reconcileMissingSessions, removeSession, setActive]);
}
