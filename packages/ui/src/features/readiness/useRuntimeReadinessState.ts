import * as React from 'react';
import { z } from 'zod';
import { SafeReadinessCodeSchema } from '@linkterm/contracts/readiness-contract';
import { getLinkterm } from '../../lib/linkterm-bridge.js';
import {
  createRuntimeReadinessHydrationController,
} from './readiness-hydration.js';
import {
  createInitialRuntimeReadinessState,
  type RuntimeReadinessViewDiagnostic,
  type RuntimeReadinessViewState,
} from './readiness-reducer.js';

const READINESS_CURSOR_STORAGE_KEY = 'linkterm:readiness-cursor';

const StoredReadinessCursorSchema = z
  .object({
    snapshotId: SafeReadinessCodeSchema,
    generation: z.number().int().nonnegative(),
  })
  .strict()
  .readonly();

type StoredReadinessCursor = z.infer<typeof StoredReadinessCursorSchema>;

export type RuntimeReadinessStateHandle = RuntimeReadinessViewState & {
  readonly refresh: () => Promise<void>;
};

export function useRuntimeReadinessState(enabled = true): RuntimeReadinessStateHandle {
  const [state, setState] = React.useState<RuntimeReadinessViewState>(() =>
    createInitialRuntimeReadinessState(),
  );
  const controllerRef = React.useRef<ReturnType<typeof createRuntimeReadinessHydrationController> | null>(
    null,
  );

  React.useEffect(() => {
    if (!enabled) return undefined;
    const api = getLinkterm();
    if (!api) return;

    const stored = readStoredReadinessCursor();
    const initialDiagnostics: RuntimeReadinessViewDiagnostic[] = stored.corrupt
      ? [{ code: 'readiness.preferences.corrupt', severity: 'warning' }]
      : [];
    let disposed = false;
    const controller = createRuntimeReadinessHydrationController(api.readiness, {
      initialDiagnostics,
      onStateChange: (next) => {
        syncStoredReadinessCursor(next.snapshot);
        if (!disposed) setState(next);
      },
    });
    controllerRef.current = controller;

    if (initialDiagnostics.length > 0) {
      setState(controller.getState());
    }

    void controller.start(stored.cursor === null ? {} : { cursor: stored.cursor });
    return () => {
      disposed = true;
      controllerRef.current = null;
      void controller.stop();
    };
  }, [enabled]);

  const refresh = React.useCallback(async (): Promise<void> => {
    await controllerRef.current?.refresh();
  }, []);

  return React.useMemo(() => ({ ...state, refresh }), [refresh, state]);
}

function readStoredReadinessCursor(): {
  readonly cursor: StoredReadinessCursor | null;
  readonly corrupt: boolean;
} {
  try {
    const raw = sessionStorage.getItem(READINESS_CURSOR_STORAGE_KEY);
    if (raw === null) return { cursor: null, corrupt: false };
    const parsed = StoredReadinessCursorSchema.safeParse(JSON.parse(raw));
    return parsed.success
      ? { cursor: parsed.data, corrupt: false }
      : { cursor: null, corrupt: true };
  } catch {
    return { cursor: null, corrupt: true };
  }
}

function syncStoredReadinessCursor(snapshot: RuntimeReadinessViewState['snapshot']): void {
  try {
    if (snapshot === undefined) {
      sessionStorage.removeItem(READINESS_CURSOR_STORAGE_KEY);
      return;
    }
    sessionStorage.setItem(
      READINESS_CURSOR_STORAGE_KEY,
      JSON.stringify({
        snapshotId: snapshot.snapshotId,
        generation: snapshot.generation,
      }),
    );
  } catch {
    // Storage can be unavailable in restricted renderer contexts; in-memory state still works.
  }
}
