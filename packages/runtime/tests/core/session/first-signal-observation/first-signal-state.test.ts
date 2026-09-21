import { describe, expect, it } from 'vitest';
import { FIRST_SIGNAL_SCHEMA_VERSION } from '@/shared/first-signal-contract.js';
import type { TranscriptEvent } from '@linkterm/runtime/core/transcript/types';
import {
  FirstSignalObservationStore,
  isFirstSignalDeviceTextEvent,
} from '@linkterm/runtime/core/session/first-signal-observation/first-signal-state';

const START_MS = Date.parse('2026-07-13T00:00:00.000Z');

function event(overrides: Partial<TranscriptEvent>): TranscriptEvent {
  return {
    type: 'data',
    origin: 'device',
    evidenceKind: 'terminal_output',
    data: new TextEncoder().encode('boot ok'),
    sequence: 5,
    timestamp: START_MS + 500,
    ...overrides,
  };
}

function createStore() {
  let attemptIndex = 0;
  let currentMs = START_MS;
  const store = new FirstSignalObservationStore({
    now: () => new Date(currentMs).toISOString(),
    nowMs: () => currentMs,
    createAttemptId: () => `attempt_${++attemptIndex}`,
    terminalRetentionMs: 5_000,
  });

  return {
    store,
    advance(ms: number) {
      currentMs += ms;
    },
  };
}

describe('first-signal pure lifecycle state', () => {
  it('starts an attempt, keeps same client key/session idempotent, and rejects key reuse for another session', () => {
    const { store } = createStore();

    const first = store.start({
      clientAttemptKey: 'client_1',
      sessionId: 'sess_1',
      ownsSession: true,
      baselineCursor: 4,
      timeoutMs: 3_000,
    });
    const duplicate = store.start({
      clientAttemptKey: 'client_1',
      sessionId: 'sess_1',
      ownsSession: true,
      baselineCursor: 9,
      timeoutMs: 10_000,
    });
    const conflict = store.start({
      clientAttemptKey: 'client_1',
      sessionId: 'sess_2',
      ownsSession: false,
      baselineCursor: 0,
      timeoutMs: 3_000,
    });

    expect(first.status).toBe('started');
    expect(first.observation).toMatchObject({
      schemaVersion: FIRST_SIGNAL_SCHEMA_VERSION,
      attemptId: 'attempt_1',
      revision: 1,
      state: 'waiting',
      sessionId: 'sess_1',
      ownsSession: true,
      baselineCursor: 4,
    });
    expect(duplicate.status).toBe('existing');
    expect(duplicate.observation.attemptId).toBe(first.observation.attemptId);
    expect(duplicate.observation.baselineCursor).toBe(4);
    expect(conflict.status).toBe('conflict');
    expect(conflict.error).toEqual({
      code: 'firstSignal.conflict',
      message: 'First-signal request conflict',
    });
  });

  it('detects only non-empty decodable device text and ignores empty, outgoing, state, error, and incomplete UTF-8 events', () => {
    const { store } = createStore();
    const start = store.start({
      clientAttemptKey: 'client_1',
      sessionId: 'sess_1',
      ownsSession: true,
      baselineCursor: 0,
      timeoutMs: 1_000,
    });

    expect(isFirstSignalDeviceTextEvent(event({ data: new Uint8Array() }))).toBe(false);
    expect(isFirstSignalDeviceTextEvent(event({ origin: 'human' }))).toBe(false);
    expect(isFirstSignalDeviceTextEvent(event({ type: 'state', origin: 'system', data: undefined }))).toBe(false);
    expect(isFirstSignalDeviceTextEvent(event({ type: 'error', origin: 'system', data: undefined }))).toBe(false);
    expect(isFirstSignalDeviceTextEvent(event({ data: new Uint8Array([0xe4, 0xb8]) }))).toBe(false);

    store.observeTranscriptEvent(start.observation.attemptId, event({ data: new Uint8Array() }));
    store.observeTranscriptEvent(
      start.observation.attemptId,
      event({ type: 'state', origin: 'system', data: undefined, sequence: 6 }),
    );
    const detected = store.observeTranscriptEvent(
      start.observation.attemptId,
      event({ sequence: 7, data: new TextEncoder().encode('hello from device') }),
    );

    expect(detected).toMatchObject({
      state: 'signal-detected',
      observedSequence: 7,
      observedAt: '2026-07-13T00:00:00.500Z',
      revision: 2,
    });
  });

  it('treats silent as non-terminal and lets late signal advance the same attempt', () => {
    const { store, advance } = createStore();
    const start = store.start({
      clientAttemptKey: 'client_1',
      sessionId: 'sess_1',
      ownsSession: true,
      baselineCursor: 0,
      timeoutMs: 1_000,
    });

    advance(1_000);
    const silent = store.markSilent(start.observation.attemptId);
    expect(silent).toMatchObject({
      attemptId: start.observation.attemptId,
      state: 'silent',
      revision: 2,
      silentSince: '2026-07-13T00:00:01.000Z',
    });

    advance(250);
    const late = store.observeTranscriptEvent(
      start.observation.attemptId,
      event({
        sequence: 11,
        timestamp: START_MS + 1_250,
        data: new TextEncoder().encode('late boot banner'),
      }),
    );

    expect(late).toMatchObject({
      attemptId: start.observation.attemptId,
      state: 'signal-detected',
      observedSequence: 11,
      revision: 3,
    });
  });

  it('separates closed, stopped, and errored terminal states and runs cleanup exactly once', () => {
    const { store } = createStore();
    const cleanupCalls: string[] = [];
    const first = store.start({
      clientAttemptKey: 'client_1',
      sessionId: 'sess_1',
      ownsSession: true,
      baselineCursor: 0,
      timeoutMs: 1_000,
    });
    store.registerCleanup(first.observation.attemptId, () => cleanupCalls.push('first'));

    const closed = store.close(first.observation.attemptId, 'session-closed');
    const closeAgain = store.close(first.observation.attemptId, 'transport-closed');
    const ignoredAfterClose = store.observeTranscriptEvent(
      first.observation.attemptId,
      event({ sequence: 20 }),
    );

    expect(closed).toMatchObject({ state: 'closed', closedReason: 'session-closed', revision: 2 });
    expect(closeAgain.revision).toBe(closed.revision);
    expect(ignoredAfterClose.revision).toBe(closed.revision);
    expect(cleanupCalls).toEqual(['first']);

    const second = store.start({
      clientAttemptKey: 'client_2',
      sessionId: 'sess_2',
      ownsSession: false,
      baselineCursor: 0,
      timeoutMs: 1_000,
    });
    const stopped = store.stop(second.observation.attemptId, 'back-to-session');
    expect(stopped).toMatchObject({ state: 'stopped', stopReason: 'back-to-session' });

    const third = store.start({
      clientAttemptKey: 'client_3',
      sessionId: 'sess_3',
      ownsSession: true,
      baselineCursor: 0,
      timeoutMs: 1_000,
    });
    const errored = store.markErrored(third.observation.attemptId, {
      code: 'firstSignal.monitor_failed',
      messageCode: 'firstSignal.error.monitorFailed',
      stage: 'monitor',
    });
    expect(errored).toMatchObject({
      state: 'errored',
      error: {
        code: 'firstSignal.monitor_failed',
        messageCode: 'firstSignal.error.monitorFailed',
        stage: 'monitor',
      },
    });
  });

  it('retains terminal observations for a bounded reload window and then expires them', () => {
    const { store, advance } = createStore();
    const start = store.start({
      clientAttemptKey: 'client_1',
      sessionId: 'sess_1',
      ownsSession: true,
      baselineCursor: 0,
      timeoutMs: 1_000,
    });

    store.stop(start.observation.attemptId, 'user');
    advance(4_999);
    expect(store.pruneTerminal()).toBe(0);
    expect(store.get(start.observation.attemptId)?.state).toBe('stopped');

    advance(2);
    expect(store.pruneTerminal()).toBe(1);
    expect(store.get(start.observation.attemptId)).toBeUndefined();
  });
});
