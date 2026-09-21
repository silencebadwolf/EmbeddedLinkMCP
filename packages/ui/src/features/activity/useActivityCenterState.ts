import * as React from 'react';
import {
  ActivityCursorSchema,
  type ActivityCursor,
} from '@linkterm/contracts/activity-contract';
import { getLinkterm } from '../../lib/linkterm-bridge.js';
import {
  createInitialActivityCenterState,
  type ActivityCenterState,
} from './activity-reducer.js';
import { createActivityHydrationController } from './activity-hydration.js';

const ACTIVITY_CURSOR_STORAGE_KEY = 'linkterm:activity-cursor';

/** 订阅 Main-owned activity bridge，并仅把 display-safe ActivityCenterState 暴露给 React。 */
export function useActivityCenterState(): ActivityCenterState {
  const [state, setState] = React.useState<ActivityCenterState>(() =>
    createInitialActivityCenterState(),
  );

  React.useEffect(() => {
    const api = getLinkterm();
    if (!api) return;

    let disposed = false;
    const controller = createActivityHydrationController(api.activity, {
      onStateChange: (next) => {
        syncStoredActivityCursor(next.cursor);
        if (!disposed) setState(next);
      },
    });

    const priorCursor = readStoredActivityCursor();
    void controller.start(priorCursor === null ? {} : { cursor: priorCursor });
    return () => {
      disposed = true;
      void controller.stop();
    };
  }, []);

  return state;
}

function readStoredActivityCursor(): ActivityCursor | null {
  try {
    const raw = sessionStorage.getItem(ACTIVITY_CURSOR_STORAGE_KEY);
    if (raw === null) return null;
    const parsed = ActivityCursorSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function syncStoredActivityCursor(cursor: ActivityCursor | undefined): void {
  try {
    if (cursor === undefined) {
      sessionStorage.removeItem(ACTIVITY_CURSOR_STORAGE_KEY);
      return;
    }
    sessionStorage.setItem(ACTIVITY_CURSOR_STORAGE_KEY, JSON.stringify(cursor));
  } catch {
    // Storage can be unavailable in restricted renderer contexts; in-memory state still works.
  }
}
