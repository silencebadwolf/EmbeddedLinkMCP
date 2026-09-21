import type {
  ReadinessSeverity,
  RuntimeReadinessSnapshot,
  SafeReadinessCode,
} from '@linkterm/contracts/readiness-contract';

export interface RuntimeReadinessViewDiagnostic {
  readonly code: SafeReadinessCode;
  readonly severity: ReadinessSeverity;
}

export interface RuntimeReadinessViewState {
  readonly phase: 'loading' | 'ready' | 'error';
  readonly refreshing: boolean;
  readonly snapshot?: RuntimeReadinessSnapshot;
  readonly diagnostics: readonly RuntimeReadinessViewDiagnostic[];
}

export function createInitialRuntimeReadinessState(
  diagnostics: readonly RuntimeReadinessViewDiagnostic[] = [],
): RuntimeReadinessViewState {
  return {
    phase: 'loading',
    refreshing: false,
    diagnostics,
  };
}

export function applyRuntimeReadinessSnapshot(
  state: RuntimeReadinessViewState,
  snapshot: RuntimeReadinessSnapshot,
): RuntimeReadinessViewState {
  if (state.snapshot !== undefined && snapshot.generation < state.snapshot.generation) {
    return state;
  }
  return {
    ...state,
    phase: 'ready',
    refreshing: false,
    snapshot,
  };
}

export function recordRuntimeReadinessDiagnostic(
  state: RuntimeReadinessViewState,
  diagnostic: RuntimeReadinessViewDiagnostic,
  phase: RuntimeReadinessViewState['phase'] = state.phase,
): RuntimeReadinessViewState {
  return {
    ...state,
    phase,
    diagnostics: [...state.diagnostics, diagnostic],
  };
}

export function setRuntimeReadinessRefreshing(
  state: RuntimeReadinessViewState,
  refreshing: boolean,
): RuntimeReadinessViewState {
  return { ...state, refreshing };
}
