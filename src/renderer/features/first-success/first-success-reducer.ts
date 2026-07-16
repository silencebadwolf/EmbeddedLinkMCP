import type {
  FirstSignalClosedReason,
  FirstSignalObservation,
  FirstSignalStopReason,
} from '@/shared/first-signal-contract.js';
import type { SessionId } from '@/shared/types.js';

export type FirstSuccessPhase =
  | 'checking'
  | 'needs-device'
  | 'ready-to-connect'
  | 'reviewing-plan'
  | 'connecting'
  | 'waiting-for-output'
  | 'data-received'
  | 'display-unavailable'
  | 'silent'
  | 'errored'
  | 'disconnected'
  | 'cancelled'
  | 'completed';

export type FirstSuccessRecoveryAction =
  | 'keep-waiting'
  | 'disconnect-and-edit'
  | 'back-to-session'
  | 'disconnect'
  | 'retry';

export interface FirstSuccessState {
  readonly phase: FirstSuccessPhase;
  readonly phaseHistory: readonly FirstSuccessPhase[];
  readonly draftId?: string;
  readonly clientAttemptKey?: string;
  readonly attemptId?: string;
  readonly sessionId?: SessionId;
  readonly ownsSession?: boolean;
  readonly observationRevision?: number;
  readonly observedSequence?: number;
  readonly lastVisibleDeviceSequence?: number;
  readonly displayUnavailableReasonCode?: string;
  readonly errorCode?: string;
  readonly disconnectReason?: FirstSignalClosedReason | 'user-disconnect';
  readonly recoveryAction?: FirstSuccessRecoveryAction | FirstSignalStopReason;
  readonly shouldCloseSession?: boolean;
  readonly shouldStopObservation?: boolean;
  readonly focusTerminal: boolean;
  readonly goToTerminalAvailable: boolean;
}

export type FirstSuccessAction =
  | { readonly type: 'readiness-evaluated'; readonly hasUsableSerialDraft: boolean }
  | { readonly type: 'serial-draft-ready'; readonly draftId: string }
  | { readonly type: 'review-plan' }
  | { readonly type: 'connect-started' }
  | { readonly type: 'observation-updated'; readonly observation: FirstSignalObservation }
  | { readonly type: 'visible-device-sequence'; readonly attemptId: string; readonly sessionId: SessionId; readonly sequence: number; readonly focusPolicy: { readonly canFocusTerminal: boolean } }
  | { readonly type: 'transcript-display-unavailable'; readonly reasonCode: string }
  | { readonly type: 'transcript-display-recovered' }
  | { readonly type: 'keep-waiting' }
  | { readonly type: 'disconnect-and-edit' }
  | { readonly type: 'back-to-session' }
  | { readonly type: 'user-disconnected' }
  | { readonly type: 'cancelled' }
  | { readonly type: 'retry-started'; readonly nextClientAttemptKey: string };

export function createInitialFirstSuccessState(): FirstSuccessState {
  return {
    phase: 'checking',
    phaseHistory: ['checking'],
    focusTerminal: false,
    goToTerminalAvailable: false,
  };
}

export function reduceFirstSuccessState(
  state: FirstSuccessState,
  action: FirstSuccessAction,
): FirstSuccessState {
  switch (action.type) {
    case 'readiness-evaluated':
      return withPhase(state, action.hasUsableSerialDraft ? 'ready-to-connect' : 'needs-device');
    case 'serial-draft-ready':
      return withPhase({ ...state, draftId: action.draftId }, 'ready-to-connect');
    case 'review-plan':
      return withPhase(state, 'reviewing-plan');
    case 'connect-started':
      return withPhase(
        {
          ...state,
          errorCode: undefined,
          disconnectReason: undefined,
          recoveryAction: undefined,
          shouldCloseSession: undefined,
          shouldStopObservation: undefined,
        },
        'connecting',
      );
    case 'observation-updated':
      return applyObservation(state, action.observation);
    case 'visible-device-sequence':
      return applyVisibleDeviceSequence(state, action);
    case 'transcript-display-unavailable':
      return withPhase(
        {
          ...state,
          displayUnavailableReasonCode: action.reasonCode,
        },
        state.observedSequence !== undefined ? 'display-unavailable' : state.phase,
      );
    case 'transcript-display-recovered': {
      const recovered = {
        ...state,
        displayUnavailableReasonCode: undefined,
      };
      return withPhase(
        recovered,
        state.phase === 'display-unavailable' && state.observedSequence !== undefined
          ? 'data-received'
          : state.phase,
      );
    }
    case 'keep-waiting':
      return withPhase({ ...state, recoveryAction: 'keep-waiting' }, 'waiting-for-output');
    case 'disconnect-and-edit':
      if (state.ownsSession !== true) return state;
      return withPhase(
        {
          ...state,
          recoveryAction: 'disconnect-and-edit',
          shouldCloseSession: true,
          shouldStopObservation: true,
          attemptId: undefined,
          sessionId: undefined,
          observedSequence: undefined,
          lastVisibleDeviceSequence: undefined,
          observationRevision: undefined,
        },
        'ready-to-connect',
      );
    case 'back-to-session':
      return withPhase(
        {
          ...state,
          recoveryAction: 'back-to-session',
          shouldCloseSession: false,
          shouldStopObservation: true,
          goToTerminalAvailable: true,
        },
        'disconnected',
      );
    case 'user-disconnected':
      return withPhase(
        {
          ...state,
          disconnectReason: 'user-disconnect',
          recoveryAction: 'disconnect',
          shouldCloseSession: true,
          shouldStopObservation: true,
        },
        'disconnected',
      );
    case 'cancelled':
      return withPhase({ ...state, shouldStopObservation: true }, 'cancelled');
    case 'retry-started':
      return withPhase(
        {
          ...state,
          clientAttemptKey: action.nextClientAttemptKey,
          attemptId: undefined,
          sessionId: undefined,
          observationRevision: undefined,
          observedSequence: undefined,
          lastVisibleDeviceSequence: undefined,
          displayUnavailableReasonCode: undefined,
          errorCode: undefined,
          disconnectReason: undefined,
          recoveryAction: 'retry',
          shouldCloseSession: undefined,
          shouldStopObservation: true,
          focusTerminal: false,
          goToTerminalAvailable: false,
        },
        'connecting',
      );
    default:
      return state;
  }
}

function applyObservation(
  state: FirstSuccessState,
  observation: FirstSignalObservation,
): FirstSuccessState {
  if (state.attemptId !== undefined && observation.attemptId !== state.attemptId) {
    return state;
  }
  if (
    state.observationRevision !== undefined &&
    observation.revision < state.observationRevision
  ) {
    return state;
  }

  const base: FirstSuccessState = {
    ...state,
    attemptId: observation.attemptId,
    clientAttemptKey: observation.clientAttemptKey,
    sessionId: observation.sessionId,
    ownsSession: observation.ownsSession,
    observationRevision: observation.revision,
    errorCode: undefined,
    disconnectReason: undefined,
  };

  switch (observation.state) {
    case 'waiting':
      return withPhase(
        {
          ...base,
          observedSequence: undefined,
          lastVisibleDeviceSequence: state.lastVisibleDeviceSequence,
        },
        'waiting-for-output',
      );
    case 'silent':
      return withPhase(base, 'silent');
    case 'signal-detected': {
      const observedSequence = observation.observedSequence;
      const withObserved = {
        ...base,
        observedSequence,
        lastVisibleDeviceSequence: state.lastVisibleDeviceSequence,
      };
      if (
        observedSequence !== undefined &&
        state.lastVisibleDeviceSequence !== undefined &&
        state.lastVisibleDeviceSequence >= observedSequence
      ) {
        return withPhase({ ...withObserved, goToTerminalAvailable: true }, 'completed');
      }
      return withPhase(
        withObserved,
        state.displayUnavailableReasonCode !== undefined ? 'display-unavailable' : 'data-received',
      );
    }
    case 'closed':
      return withPhase(
        {
          ...base,
          disconnectReason: observation.closedReason,
          goToTerminalAvailable: observation.closedReason !== 'user-disconnect',
        },
        'disconnected',
      );
    case 'stopped':
      return withPhase(
        {
          ...base,
          recoveryAction: observation.stopReason,
          shouldStopObservation: true,
          goToTerminalAvailable: observation.stopReason === 'back-to-session',
        },
        'disconnected',
      );
    case 'errored':
      return withPhase(
        {
          ...base,
          errorCode: observation.error?.code,
        },
        'errored',
      );
    default:
      return state;
  }
}

function applyVisibleDeviceSequence(
  state: FirstSuccessState,
  action: Extract<FirstSuccessAction, { type: 'visible-device-sequence' }>,
): FirstSuccessState {
  if (state.attemptId !== action.attemptId || state.sessionId !== action.sessionId) {
    return state;
  }
  const lastVisibleDeviceSequence = Math.max(
    state.lastVisibleDeviceSequence ?? 0,
    action.sequence,
  );
  const next = {
    ...state,
    lastVisibleDeviceSequence,
  };
  if (
    state.observedSequence !== undefined &&
    lastVisibleDeviceSequence >= state.observedSequence
  ) {
    return withPhase(
      {
        ...next,
        focusTerminal: action.focusPolicy.canFocusTerminal,
        goToTerminalAvailable: true,
        displayUnavailableReasonCode: undefined,
      },
      'completed',
    );
  }
  return next;
}

function withPhase(state: FirstSuccessState, phase: FirstSuccessPhase): FirstSuccessState {
  if (state.phase === phase) return state;
  return {
    ...state,
    phase,
    phaseHistory: [...state.phaseHistory, phase],
  };
}
