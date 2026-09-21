import type {
  ActivityCursorRequest,
  ActivityEventView,
  ActivitySnapshotResult,
  ActivitySnapshotView,
} from '@linkterm/contracts/activity-contract';
import { ActivitySnapshotResultSchema } from '@linkterm/contracts/activity-contract';
import type { PreloadResult, Unsubscribe } from '@linkterm/contracts/preload-api';
import {
  createInitialActivityCenterState,
  ingestActivityEvent,
  ingestActivitySnapshot,
  recordActivityDiagnostic,
  type ActivityCenterDiagnostic,
  type ActivityCenterState,
} from './activity-reducer.js';

export interface ActivityBridge {
  subscribe(req?: ActivityCursorRequest): Promise<unknown>;
  snapshot(req?: ActivityCursorRequest): Promise<unknown>;
  unsubscribe(): Promise<PreloadResult<{ unsubscribed: true }>>;
  onEvent(handler: (event: ActivityEventView) => void): Unsubscribe;
}

export interface ActivityHydrationController {
  start(req?: ActivityCursorRequest): Promise<void>;
  stop(): Promise<void>;
  getState(): ActivityCenterState;
}

export interface ActivityHydrationControllerOptions {
  readonly onStateChange?: (state: ActivityCenterState) => void;
}

/** 创建 renderer activity hydration 控制器；它不持有 React/DOM/Main-only 对象。 */
export function createActivityHydrationController(
  bridge: ActivityBridge,
  options: ActivityHydrationControllerOptions = {},
): ActivityHydrationController {
  let state = createInitialActivityCenterState();
  let unsubscribeEvents: Unsubscribe | undefined;
  let subscribing = false;
  let stopped = false;
  let buffer: ActivityEventView[] = [];
  let generation = 0;

  const setState = (next: ActivityCenterState): void => {
    state = next;
    options.onStateChange?.(state);
  };

  const replaceFromSnapshot = (snapshot: ActivitySnapshotView): void => {
    if (isOlderCursor(snapshot.cursor, state.cursor)) return;
    setState(ingestActivitySnapshot(state, snapshot));
  };

  const markInvalidSnapshot = (): void => {
    setState(ingestActivitySnapshot(state, undefined));
  };

  const markSubscribeFailed = (): void => {
    setState(
      recordActivityDiagnostic(createInitialActivityCenterState(), { code: 'subscribe-failed' }, 'error'),
    );
  };

  const appendEvent = (event: ActivityEventView): void => {
    const beforeDiagnostics = state.diagnostics.length;
    setState(ingestActivityEvent(state, event));
    const diagnostic = state.diagnostics.at(-1);
    if (
      (diagnostic?.code === 'sequence-gap' || diagnostic?.code === 'runtime-reset') &&
      state.diagnostics.length > beforeDiagnostics
    ) {
      void resnapshotAfterDiagnostic(diagnostic);
    }
  };

  const onEvent = (event: ActivityEventView): void => {
    if (subscribing) {
      buffer = [...buffer, event];
      return;
    }
    appendEvent(event);
  };

  const applyBufferedAfterSnapshot = (): void => {
    const cursor = state.cursor;
    const pending = buffer;
    buffer = [];
    for (const event of pending) {
      if (
        cursor !== undefined &&
        event.runtimeId === cursor.runtimeId &&
        event.sequence <= cursor.sequence
      ) {
        continue;
      }
      appendEvent(event);
    }
  };

  const resnapshotAfterDiagnostic = async (
    diagnostic: ActivityCenterDiagnostic,
  ): Promise<void> => {
    const activeGeneration = generation;
    try {
      const parsed = parseSnapshotResult(
        await bridge.snapshot(state.cursor === undefined ? {} : { cursor: state.cursor }),
      );
      if (stopped || activeGeneration !== generation) return;
      if (parsed === null || !parsed.success) return;
      if (isOlderCursor(parsed.data.cursor, state.cursor)) return;
      const priorDiagnostics = state.diagnostics;
      replaceFromSnapshot(parsed.data);
      setState({ ...state, diagnostics: [...priorDiagnostics, diagnostic] });
    } catch {
      // A resnapshot failure remains a local diagnostic concern; the next pushed event or user action can retry.
    }
  };

  return {
    start: async (req = {}) => {
      if (unsubscribeEvents !== undefined) return;
      const activeGeneration = generation + 1;
      generation = activeGeneration;
      stopped = false;
      subscribing = true;
      unsubscribeEvents = bridge.onEvent(onEvent);
      let result: ActivitySnapshotResult | null;
      try {
        result = parseSnapshotResult(await bridge.subscribe(req));
      } catch {
        if (stopped || activeGeneration !== generation) return;
        markSubscribeFailed();
        buffer = [];
        subscribing = false;
        unsubscribeEvents?.();
        unsubscribeEvents = undefined;
        return;
      }
      if (stopped || activeGeneration !== generation) return;
      if (result === null) {
        markInvalidSnapshot();
        buffer = [];
      } else if (result.success) {
        replaceFromSnapshot(result.data);
        applyBufferedAfterSnapshot();
      } else if (req.cursor !== undefined) {
        const retry = await subscribeFreshAfterRejectedCursor(activeGeneration);
        if (retry === 'applied') return;
        if (retry === 'stale') return;
        markInvalidSnapshot();
        buffer = [];
      } else {
        markInvalidSnapshot();
        buffer = [];
      }
      subscribing = false;
    },
    stop: async () => {
      stopped = true;
      generation += 1;
      subscribing = false;
      buffer = [];
      unsubscribeEvents?.();
      unsubscribeEvents = undefined;
      await bridge.unsubscribe();
    },
    getState: () => state,
  };

  async function subscribeFreshAfterRejectedCursor(
    activeGeneration: number,
  ): Promise<'applied' | 'failed' | 'stale'> {
    let retry: ActivitySnapshotResult | null;
    try {
      retry = parseSnapshotResult(await bridge.subscribe({}));
    } catch {
      return stopped || activeGeneration !== generation ? 'stale' : 'failed';
    }
    if (stopped || activeGeneration !== generation) return 'stale';
    if (retry === null || !retry.success) return 'failed';
    replaceFromSnapshot(retry.data);
    applyBufferedAfterSnapshot();
    subscribing = false;
    return 'applied';
  }
}

function parseSnapshotResult(result: unknown): ActivitySnapshotResult | null {
  const parsed = ActivitySnapshotResultSchema.safeParse(result);
  return parsed.success ? parsed.data : null;
}

function isOlderCursor(
  next: ActivitySnapshotView['cursor'],
  current: ActivitySnapshotView['cursor'] | undefined,
): boolean {
  return (
    current !== undefined &&
    next.runtimeId === current.runtimeId &&
    next.sequence < current.sequence
  );
}
