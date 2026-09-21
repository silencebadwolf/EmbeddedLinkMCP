import type {
  ReadinessEvent,
  ReadinessRefreshResult,
  RuntimeReadinessSnapshot,
} from '@linkterm/contracts/readiness-contract';
import { ReadinessRefreshResultSchema } from '@linkterm/contracts/readiness-contract';
import type {
  PreloadResult,
  ReadinessCursorRequest,
  Unsubscribe,
} from '@linkterm/contracts/preload-api';
import {
  applyRuntimeReadinessSnapshot,
  createInitialRuntimeReadinessState,
  recordRuntimeReadinessDiagnostic,
  setRuntimeReadinessRefreshing,
  type RuntimeReadinessViewDiagnostic,
  type RuntimeReadinessViewState,
} from './readiness-reducer.js';

export interface RuntimeReadinessBridge {
  get(): Promise<unknown>;
  refresh(): Promise<unknown>;
  subscribe(req?: ReadinessCursorRequest): Promise<unknown>;
  unsubscribe(): Promise<PreloadResult<{ unsubscribed: true }>>;
  onEvent(handler: (event: ReadinessEvent) => void, onInvalidPayload?: () => void): Unsubscribe;
}

export interface RuntimeReadinessHydrationController {
  start(req?: ReadinessCursorRequest): Promise<void>;
  refresh(): Promise<void>;
  stop(): Promise<void>;
  getState(): RuntimeReadinessViewState;
}

export interface RuntimeReadinessHydrationControllerOptions {
  readonly initialDiagnostics?: readonly RuntimeReadinessViewDiagnostic[];
  readonly onStateChange?: (state: RuntimeReadinessViewState) => void;
}

export function createRuntimeReadinessHydrationController(
  bridge: RuntimeReadinessBridge,
  options: RuntimeReadinessHydrationControllerOptions = {},
): RuntimeReadinessHydrationController {
  let state = createInitialRuntimeReadinessState(options.initialDiagnostics);
  let unsubscribeEvents: Unsubscribe | undefined;
  let subscribing = false;
  let stopped = false;
  let bufferedEvents: ReadinessEvent[] = [];
  let generation = 0;
  let latestRefreshRequest = 0;

  const setState = (next: RuntimeReadinessViewState): void => {
    state = next;
    options.onStateChange?.(state);
  };

  const applySnapshot = (snapshot: RuntimeReadinessSnapshot): void => {
    setState(applyRuntimeReadinessSnapshot(state, snapshot));
  };

  const recordDiagnostic = (
    code: RuntimeReadinessViewDiagnostic['code'],
    severity: RuntimeReadinessViewDiagnostic['severity'],
    phase: RuntimeReadinessViewState['phase'] = state.phase,
  ): void => {
    setState(recordRuntimeReadinessDiagnostic(state, { code, severity }, phase));
  };

  const applyEvent = (event: ReadinessEvent): void => {
    if (
      state.snapshot !== undefined &&
      event.snapshot.generation <= state.snapshot.generation
    ) {
      return;
    }
    applySnapshot(event.snapshot);
  };

  const applyBufferedAfterSnapshot = (): void => {
    const pending = bufferedEvents;
    bufferedEvents = [];
    for (const event of pending) applyEvent(event);
  };

  const onEvent = (event: ReadinessEvent): void => {
    if (subscribing) {
      bufferedEvents = [...bufferedEvents, event];
      return;
    }
    applyEvent(event);
  };

  return {
    start: async (req = {}) => {
      if (unsubscribeEvents !== undefined) return;
      const activeGeneration = generation + 1;
      generation = activeGeneration;
      stopped = false;
      subscribing = true;
      setState({ ...state, phase: 'loading' });
      unsubscribeEvents = bridge.onEvent(onEvent, () => {
        recordDiagnostic('readiness.invalid_payload', 'error', 'error');
      });

      let result: ReadinessRefreshResult | null;
      try {
        result = parseReadinessResult(await bridge.subscribe(req));
      } catch {
        if (stopped || activeGeneration !== generation) return;
        recordDiagnostic('readiness.subscribe_failed', 'error', 'error');
        cleanupLocalSubscription();
        return;
      }
      if (stopped || activeGeneration !== generation) return;
      if (result === null) {
        recordDiagnostic('readiness.invalid_payload', 'error', 'error');
        cleanupLocalSubscription();
        return;
      } else if (result.success) {
        applySnapshot(result.data);
        applyBufferedAfterSnapshot();
      } else if (req.cursor !== undefined && result.error.code === 'INVALID_READINESS_CURSOR') {
        const retry = await subscribeFreshAfterRejectedCursor(activeGeneration);
        if (retry === 'applied' || retry === 'stale') return;
        recordDiagnostic('readiness.invalid_payload', 'error', 'error');
        cleanupLocalSubscription();
        return;
      } else {
        recordDiagnostic('readiness.invalid_payload', 'error', 'error');
        cleanupLocalSubscription();
        return;
      }
      subscribing = false;
    },
    refresh: async () => {
      const refreshRequest = latestRefreshRequest + 1;
      latestRefreshRequest = refreshRequest;
      setState(setRuntimeReadinessRefreshing(state, true));

      let result: ReadinessRefreshResult | null;
      try {
        result = parseReadinessResult(await bridge.refresh());
      } catch {
        result = null;
      }
      if (stopped || refreshRequest !== latestRefreshRequest) return;
      if (result?.success) {
        applySnapshot(result.data);
        return;
      }

      const recovered = await recoverWithCurrentSnapshot(refreshRequest);
      if (recovered) return;
      setState(setRuntimeReadinessRefreshing(state, false));
      recordDiagnostic('readiness.refresh_failed', 'warning', state.snapshot ? 'ready' : 'error');
    },
    stop: async () => {
      stopped = true;
      generation += 1;
      subscribing = false;
      bufferedEvents = [];
      cleanupLocalSubscription();
      await bridge.unsubscribe();
    },
    getState: () => state,
  };

  async function subscribeFreshAfterRejectedCursor(
    activeGeneration: number,
  ): Promise<'applied' | 'failed' | 'stale'> {
    let retry: ReadinessRefreshResult | null;
    try {
      retry = parseReadinessResult(await bridge.subscribe({}));
    } catch {
      return stopped || activeGeneration !== generation ? 'stale' : 'failed';
    }
    if (stopped || activeGeneration !== generation) return 'stale';
    if (retry === null || !retry.success) return 'failed';
    applySnapshot(retry.data);
    applyBufferedAfterSnapshot();
    subscribing = false;
    return 'applied';
  }

  async function recoverWithCurrentSnapshot(refreshRequest: number): Promise<boolean> {
    let current: ReadinessRefreshResult | null;
    try {
      current = parseReadinessResult(await bridge.get());
    } catch {
      return false;
    }
    if (stopped || refreshRequest !== latestRefreshRequest || current === null || !current.success) {
      return false;
    }
    applySnapshot(current.data);
    recordDiagnostic('readiness.refresh_recovered', 'warning', 'ready');
    return true;
  }

  function cleanupLocalSubscription(): void {
    subscribing = false;
    bufferedEvents = [];
    unsubscribeEvents?.();
    unsubscribeEvents = undefined;
  }
}

function parseReadinessResult(result: unknown): ReadinessRefreshResult | null {
  const parsed = ReadinessRefreshResultSchema.safeParse(result);
  return parsed.success ? parsed.data : null;
}
