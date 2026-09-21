import { describe, expect, it } from 'vitest';
import {
  FIRST_SIGNAL_SCHEMA_VERSION,
  FirstSignalObservationSchema,
  type FirstSignalObservation,
} from '../../../../src/shared/first-signal-contract.js';
import {
  createInitialFirstSuccessState,
  reduceFirstSuccessState,
} from '@linkterm/ui/features/first-success/first-success-reducer';

function observation(
  overrides: Partial<FirstSignalObservation> = {},
): FirstSignalObservation {
  const revision = overrides.revision ?? 1;
  const state = overrides.state ?? 'waiting';
  return FirstSignalObservationSchema.parse({
    schemaVersion: FIRST_SIGNAL_SCHEMA_VERSION,
    attemptId: 'attempt_1',
    clientAttemptKey: 'client_1',
    revision,
    sessionId: 'sess_1',
    ownsSession: true,
    baselineCursor: 0,
    state,
    startedAt: '2026-07-13T07:00:00.000Z',
    updatedAt: `2026-07-13T07:00:${String(revision % 60).padStart(2, '0')}.000Z`,
    timeoutMs: 1_000,
    ...(state === 'signal-detected'
      ? {
          observedAt: '2026-07-13T07:00:02.000Z',
          observedSequence: overrides.observedSequence ?? 7,
        }
      : {}),
    ...(state === 'silent'
      ? { silentSince: overrides.silentSince ?? '2026-07-13T07:00:01.000Z' }
      : {}),
    ...(state === 'closed'
      ? { closedReason: overrides.closedReason ?? 'session-closed' }
      : {}),
    ...(state === 'stopped'
      ? { stopReason: overrides.stopReason ?? 'user' }
      : {}),
    ...(state === 'errored'
      ? {
          error:
            overrides.error ??
            {
              code: 'firstSignal.session_errored',
              messageCode: 'firstSignal.error.sessionErrored',
              stage: 'session',
            },
        }
      : {}),
    ...overrides,
  });
}

function run(actions: Parameters<typeof reduceFirstSuccessState>[1][]) {
  return actions.reduce(reduceFirstSuccessState, createInitialFirstSuccessState());
}

describe('first-success reducer', () => {
  it('walks checking → needs-device → ready-to-connect → reviewing-plan → connecting → waiting-for-output', () => {
    const state = run([
      { type: 'readiness-evaluated', hasUsableSerialDraft: false },
      { type: 'serial-draft-ready', draftId: 'draft_1' },
      { type: 'review-plan' },
      { type: 'connect-started' },
      { type: 'observation-updated', observation: observation() },
    ]);

    expect(state.phaseHistory).toEqual([
      'checking',
      'needs-device',
      'ready-to-connect',
      'reviewing-plan',
      'connecting',
      'waiting-for-output',
    ]);
    expect(state).toMatchObject({
      phase: 'waiting-for-output',
      draftId: 'draft_1',
      attemptId: 'attempt_1',
      sessionId: 'sess_1',
      ownsSession: true,
    });
  });

  it('keeps data-received distinct from completed until matching visible-device ack arrives', () => {
    const detected = observation({ state: 'signal-detected', revision: 2, observedSequence: 7 });
    const dataReceived = run([
      { type: 'serial-draft-ready', draftId: 'draft_1' },
      { type: 'connect-started' },
      { type: 'observation-updated', observation: detected },
    ]);

    expect(dataReceived).toMatchObject({
      phase: 'data-received',
      observedSequence: 7,
      lastVisibleDeviceSequence: undefined,
    });

    const completed = reduceFirstSuccessState(dataReceived, {
      type: 'visible-device-sequence',
      attemptId: 'attempt_1',
      sessionId: 'sess_1',
      sequence: 7,
      focusPolicy: { canFocusTerminal: true },
    });

    expect(completed).toMatchObject({
      phase: 'completed',
      lastVisibleDeviceSequence: 7,
      focusTerminal: true,
      goToTerminalAvailable: true,
    });
  });

  it('ignores stale attempt/session observation events and xterm callbacks', () => {
    const current = run([
      { type: 'observation-updated', observation: observation({ attemptId: 'attempt_current' }) },
      {
        type: 'observation-updated',
        observation: observation({
          attemptId: 'attempt_old',
          revision: 99,
          state: 'signal-detected',
          observedSequence: 99,
        }),
      },
      {
        type: 'visible-device-sequence',
        attemptId: 'attempt_old',
        sessionId: 'sess_1',
        sequence: 99,
        focusPolicy: { canFocusTerminal: true },
      },
      {
        type: 'visible-device-sequence',
        attemptId: 'attempt_current',
        sessionId: 'sess_other',
        sequence: 99,
        focusPolicy: { canFocusTerminal: true },
      },
    ]);

    expect(current).toMatchObject({
      phase: 'waiting-for-output',
      attemptId: 'attempt_current',
      observedSequence: undefined,
      lastVisibleDeviceSequence: undefined,
    });
  });

  it('keeps silent non-terminal and late signal completes the same attempt after visible ack', () => {
    const silent = run([
      { type: 'observation-updated', observation: observation() },
      { type: 'observation-updated', observation: observation({ state: 'silent', revision: 2 }) },
      { type: 'keep-waiting' },
    ]);
    expect(silent).toMatchObject({ phase: 'waiting-for-output', attemptId: 'attempt_1' });

    const late = reduceFirstSuccessState(silent, {
      type: 'observation-updated',
      observation: observation({ state: 'signal-detected', revision: 3, observedSequence: 11 }),
    });
    const completed = reduceFirstSuccessState(late, {
      type: 'visible-device-sequence',
      attemptId: 'attempt_1',
      sessionId: 'sess_1',
      sequence: 11,
      focusPolicy: { canFocusTerminal: false },
    });

    expect(completed).toMatchObject({
      phase: 'completed',
      attemptId: 'attempt_1',
      observedSequence: 11,
      focusTerminal: false,
      goToTerminalAvailable: true,
    });
  });

  it('models display-unavailable recovery: detected data does not complete until replay is xterm-acknowledged', () => {
    const unavailable = run([
      { type: 'observation-updated', observation: observation() },
      { type: 'transcript-display-unavailable', reasonCode: 'firstSignal.display.subscribeFailed' },
      {
        type: 'observation-updated',
        observation: observation({ state: 'signal-detected', revision: 2, observedSequence: 7 }),
      },
    ]);

    expect(unavailable).toMatchObject({
      phase: 'display-unavailable',
      observedSequence: 7,
      displayUnavailableReasonCode: 'firstSignal.display.subscribeFailed',
    });

    const recovered = reduceFirstSuccessState(unavailable, { type: 'transcript-display-recovered' });
    expect(recovered.phase).toBe('data-received');

    const completed = reduceFirstSuccessState(recovered, {
      type: 'visible-device-sequence',
      attemptId: 'attempt_1',
      sessionId: 'sess_1',
      sequence: 7,
      focusPolicy: { canFocusTerminal: true },
    });
    expect(completed.phase).toBe('completed');
  });

  it('maps errored, user disconnect, transport close, cancel, and retry to distinct states/reasons', () => {
    const errored = run([
      {
        type: 'observation-updated',
        observation: observation({ state: 'errored', error: {
          code: 'firstSignal.session_errored',
          messageCode: 'firstSignal.error.sessionErrored',
          stage: 'session',
        } }),
      },
    ]);
    expect(errored).toMatchObject({ phase: 'errored', errorCode: 'firstSignal.session_errored' });

    const transportClosed = reduceFirstSuccessState(errored, {
      type: 'observation-updated',
      observation: observation({ state: 'closed', revision: 3, closedReason: 'transport-closed' }),
    });
    expect(transportClosed).toMatchObject({
      phase: 'disconnected',
      disconnectReason: 'transport-closed',
    });

    const userDisconnected = reduceFirstSuccessState(transportClosed, {
      type: 'user-disconnected',
    });
    expect(userDisconnected).toMatchObject({
      phase: 'disconnected',
      disconnectReason: 'user-disconnect',
    });

    const cancelled = reduceFirstSuccessState(userDisconnected, { type: 'cancelled' });
    expect(cancelled.phase).toBe('cancelled');

    const retrying = reduceFirstSuccessState(cancelled, {
      type: 'retry-started',
      nextClientAttemptKey: 'client_retry',
    });
    expect(retrying).toMatchObject({
      phase: 'connecting',
      clientAttemptKey: 'client_retry',
      attemptId: undefined,
      observedSequence: undefined,
    });
  });

  it('enforces ownsSession recovery action visibility and cleanup intent', () => {
    const owned = run([
      { type: 'observation-updated', observation: observation({ ownsSession: true }) },
      { type: 'disconnect-and-edit' },
    ]);
    expect(owned).toMatchObject({
      phase: 'ready-to-connect',
      recoveryAction: 'disconnect-and-edit',
      shouldCloseSession: true,
      shouldStopObservation: true,
    });

    const reused = run([
      { type: 'observation-updated', observation: observation({ ownsSession: false }) },
      { type: 'disconnect-and-edit' },
    ]);
    expect(reused.phase).toBe('waiting-for-output');

    const back = reduceFirstSuccessState(reused, { type: 'back-to-session' });
    expect(back).toMatchObject({
      phase: 'disconnected',
      recoveryAction: 'back-to-session',
      shouldCloseSession: false,
      shouldStopObservation: true,
    });
  });

  it('does not steal focus when completion arrives outside the current first-success surface', () => {
    const detected = run([
      {
        type: 'observation-updated',
        observation: observation({ state: 'signal-detected', revision: 2, observedSequence: 7 }),
      },
    ]);
    const completed = reduceFirstSuccessState(detected, {
      type: 'visible-device-sequence',
      attemptId: 'attempt_1',
      sessionId: 'sess_1',
      sequence: 7,
      focusPolicy: { canFocusTerminal: false },
    });

    expect(completed).toMatchObject({
      phase: 'completed',
      focusTerminal: false,
      goToTerminalAvailable: true,
    });
  });

  it('keeps repeated observation updates bounded to phase changes', () => {
    let state = run([{ type: 'observation-updated', observation: observation() }]);

    for (let revision = 2; revision < 1_000; revision += 1) {
      state = reduceFirstSuccessState(state, {
        type: 'observation-updated',
        observation: observation({ revision }),
      });
    }

    expect(state).toMatchObject({
      phase: 'waiting-for-output',
      observationRevision: 999,
    });
    expect(state.phaseHistory).toEqual(['checking', 'waiting-for-output']);
  });
});
