import { describe, expect, it } from 'vitest';
import {
  FIRST_SIGNAL_SCHEMA_VERSION,
  type FirstSignalObservation,
} from '../../../src/shared/first-signal-contract.js';
import { createMockPreloadAPI } from '../../fixtures/mock-preload-api.js';

describe('mock preload firstSignal helpers', () => {
  it('provides deterministic observations, events, invalid payloads, and deferred starts', async () => {
    const mock = createMockPreloadAPI();
    const received: number[] = [];
    const diagnostics: string[] = [];
    const initial = mock.firstSignalObservation({ revision: 1, state: 'waiting' });
    const detected = mock.firstSignalObservation({
      revision: 2,
      state: 'signal-detected',
      observedSequence: 7,
    });

    mock.setFirstSignalObservation(initial);
    await expect(mock.api.firstSignal.status({ attemptId: initial.attemptId })).resolves.toEqual({
      success: true,
      data: initial,
    });

    const unsubscribe = mock.api.firstSignal.onEvent(
      (event) => received.push(event.observation.revision),
      (diagnostic) => diagnostics.push(`${diagnostic.code}:${diagnostic.severity}`),
    );
    mock.emitFirstSignalEvent(detected);
    mock.emitInvalidFirstSignalPayload({ rawStack: 'C:/Users/Admin/private/token' });
    expect(received).toEqual([2]);
    expect(diagnostics).toEqual(['firstSignal.invalid_payload:error']);
    expect(JSON.stringify(diagnostics)).not.toMatch(/private|token|rawStack/i);
    unsubscribe();
    mock.emitFirstSignalEvent(
      mock.firstSignalObservation({ revision: 3, state: 'silent', silentSince: '2026-07-13T06:00:03.000Z' }),
    );
    expect(received).toEqual([2]);

    const pending = mock.deferFirstSignalStart();
    const promise = mock.api.firstSignal.start({
      schemaVersion: FIRST_SIGNAL_SCHEMA_VERSION,
      clientAttemptKey: 'client_1',
      sessionId: 'sess_1',
      ownsSession: true,
      baselineCursor: 0,
      timeoutMs: 1_000,
    });
    pending.resolve({ success: true, data: detected });
    await expect(promise).resolves.toEqual({ success: true, data: detected });
    expect(mock.spies.firstSignal.start).toHaveBeenCalledTimes(1);
  });

  it('keeps generated observation fields display-safe and revisioned', () => {
    const mock = createMockPreloadAPI();
    const observation: FirstSignalObservation = mock.firstSignalObservation({
      revision: 4,
      state: 'errored',
      error: {
        code: 'firstSignal.monitor_failed',
        messageCode: 'firstSignal.error.monitorFailed',
        stage: 'monitor',
      },
    });

    expect(observation).toMatchObject({
      schemaVersion: FIRST_SIGNAL_SCHEMA_VERSION,
      attemptId: 'attempt_1',
      clientAttemptKey: 'client_1',
      revision: 4,
      sessionId: 'sess_test',
      state: 'errored',
    });
    expect(JSON.stringify(observation)).not.toMatch(/stack|token|Users|raw/i);
  });
});
