import { describe, expect, it } from 'vitest';
import {
  FIRST_SIGNAL_MAX_DIAGNOSTICS,
  FIRST_SIGNAL_MAX_TIMEOUT_MS,
  FIRST_SIGNAL_SCHEMA_VERSION,
  FirstSignalClosedReasonSchema,
  FirstSignalEventSchema,
  FirstSignalFailureResultSchema,
  FirstSignalObservationSchema,
  FirstSignalObservationStateSchema,
  FirstSignalSafeErrorSchema,
  FirstSignalStartRequestSchema,
  FirstSignalStartResultSchema,
  FirstSignalStatusRequestSchema,
  FirstSignalStopReasonSchema,
  FirstSignalStopRequestSchema,
  FirstSignalSubscribeRequestSchema,
  FirstSignalUnsubscribeRequestSchema,
} from '@/shared/first-signal-contract.js';

function expectRejected(schema: { safeParse(value: unknown): { success: boolean } }, value: unknown) {
  expect(schema.safeParse(value).success).toBe(false);
}

const STARTED_AT = '2026-07-13T00:00:00.000Z';
const UPDATED_AT = '2026-07-13T00:00:01.000Z';

const safeError = {
  code: 'firstSignal.invalid_payload',
  messageCode: 'firstSignal.error.invalidPayload',
  stage: 'schema',
} as const;

const observation = {
  schemaVersion: FIRST_SIGNAL_SCHEMA_VERSION,
  attemptId: 'attempt_1',
  clientAttemptKey: 'client_1',
  revision: 1,
  sessionId: 'sess_1',
  ownsSession: true,
  baselineCursor: 4,
  state: 'waiting',
  startedAt: STARTED_AT,
  updatedAt: UPDATED_AT,
  timeoutMs: 3_000,
} as const;

describe('first-signal display contract', () => {
  it('exports fixed schema version, enums, and bounds', () => {
    expect(FIRST_SIGNAL_SCHEMA_VERSION).toBe('1.0.0');
    expect(FIRST_SIGNAL_MAX_TIMEOUT_MS).toBe(60_000);
    expect(FIRST_SIGNAL_MAX_DIAGNOSTICS).toBe(8);
    expect(FirstSignalObservationStateSchema.options).toEqual([
      'waiting',
      'signal-detected',
      'silent',
      'closed',
      'errored',
      'stopped',
    ]);
    expect(FirstSignalClosedReasonSchema.options).toEqual([
      'session-closed',
      'transport-closed',
      'user-disconnect',
      'runtime-shutdown',
      'superseded',
    ]);
    expect(FirstSignalStopReasonSchema.options).toEqual([
      'user',
      'retry',
      'disconnect-and-edit',
      'back-to-session',
      'session-dispose',
      'runtime-shutdown',
    ]);
  });

  it('accepts strict observation lifecycle DTOs, requests, events, and result envelopes', () => {
    const detected = {
      ...observation,
      revision: 2,
      state: 'signal-detected',
      observedAt: UPDATED_AT,
      observedSequence: 9,
    } as const;

    expect(FirstSignalObservationSchema.parse(observation)).toEqual(observation);
    expect(FirstSignalObservationSchema.parse(detected)).toEqual(detected);
    expect(FirstSignalSafeErrorSchema.parse(safeError)).toEqual(safeError);
    expect(
      FirstSignalStartRequestSchema.parse({
        schemaVersion: FIRST_SIGNAL_SCHEMA_VERSION,
        clientAttemptKey: 'client_1',
        sessionId: 'sess_1',
        ownsSession: true,
        baselineCursor: 4,
        timeoutMs: 3_000,
      }),
    ).toEqual({
      schemaVersion: FIRST_SIGNAL_SCHEMA_VERSION,
      clientAttemptKey: 'client_1',
      sessionId: 'sess_1',
      ownsSession: true,
      baselineCursor: 4,
      timeoutMs: 3_000,
    });
    expect(FirstSignalStatusRequestSchema.parse({ attemptId: 'attempt_1' })).toEqual({
      attemptId: 'attempt_1',
    });
    expect(FirstSignalStopRequestSchema.parse({ attemptId: 'attempt_1', reason: 'retry' })).toEqual({
      attemptId: 'attempt_1',
      reason: 'retry',
    });
    expect(FirstSignalSubscribeRequestSchema.parse({ attemptId: 'attempt_1', sinceRevision: 1 }))
      .toEqual({
        attemptId: 'attempt_1',
        sinceRevision: 1,
      });
    expect(FirstSignalUnsubscribeRequestSchema.parse({})).toEqual({});
    expect(
      FirstSignalEventSchema.parse({
        schemaVersion: FIRST_SIGNAL_SCHEMA_VERSION,
        observation: detected,
      }),
    ).toMatchObject({
      schemaVersion: FIRST_SIGNAL_SCHEMA_VERSION,
      observation: { attemptId: 'attempt_1', state: 'signal-detected' },
    });
    expect(FirstSignalStartResultSchema.parse({ success: true, data: detected })).toMatchObject({
      success: true,
      data: { attemptId: 'attempt_1', observedSequence: 9 },
    });
    expect(
      FirstSignalFailureResultSchema.parse({
        success: false,
        error: { code: 'firstSignal.conflict', message: 'First-signal request conflict' },
      }),
    ).toEqual({
      success: false,
      error: { code: 'firstSignal.conflict', message: 'First-signal request conflict' },
    });
  });

  it('rejects unknown keys and raw/internal fields throughout nested DTOs', () => {
    expectRejected(FirstSignalObservationSchema, {
      ...observation,
      rawTranscriptData: new Uint8Array([1, 2, 3]),
    });
    expectRejected(FirstSignalObservationSchema, {
      ...observation,
      error: { ...safeError, stack: 'Error: token=secret' },
    });
    expectRejected(FirstSignalStartRequestSchema, {
      schemaVersion: FIRST_SIGNAL_SCHEMA_VERSION,
      clientAttemptKey: 'client_1',
      sessionId: 'sess_1',
      ownsSession: true,
      baselineCursor: 4,
      timeoutMs: 3_000,
      approvalGrant: { token: 'secret' },
    });
    expectRejected(FirstSignalEventSchema, {
      schemaVersion: FIRST_SIGNAL_SCHEMA_VERSION,
      observation,
      ipcRenderer: { send: true },
    });
  });

  it('enforces safe ids, timestamps, revision/cursor bounds, timeout bounds, and state evidence', () => {
    expectRejected(FirstSignalObservationSchema, { ...observation, attemptId: 'bad id' });
    expectRejected(FirstSignalObservationSchema, { ...observation, revision: 0 });
    expectRejected(FirstSignalObservationSchema, { ...observation, baselineCursor: -1 });
    expectRejected(FirstSignalObservationSchema, { ...observation, startedAt: '2026-07-13T00:00:00' });
    expectRejected(FirstSignalStartRequestSchema, {
      schemaVersion: FIRST_SIGNAL_SCHEMA_VERSION,
      clientAttemptKey: 'client_1',
      sessionId: 'sess_1',
      ownsSession: true,
      baselineCursor: 4,
      timeoutMs: FIRST_SIGNAL_MAX_TIMEOUT_MS + 1,
    });
    expectRejected(FirstSignalObservationSchema, {
      ...observation,
      state: 'signal-detected',
      observedAt: UPDATED_AT,
    });
    expectRejected(FirstSignalObservationSchema, {
      ...observation,
      state: 'closed',
    });
    expectRejected(FirstSignalObservationSchema, {
      ...observation,
      state: 'errored',
    });
  });

  it('keeps safe diagnostics code-only and rejects raw messages, paths, and secret-like values', () => {
    expectRejected(FirstSignalSafeErrorSchema, {
      code: 'firstSignal.invalid_payload',
      messageCode: 'firstSignal.error.invalidPayload',
      stage: 'schema',
      message: 'C:/Users/Admin/private token=secret',
    });
    expectRejected(FirstSignalSafeErrorSchema, {
      code: 'firstSignal.invalid_payload',
      messageCode: 'bad code',
      stage: 'schema',
    });
    expectRejected(FirstSignalFailureResultSchema, {
      success: false,
      error: {
        code: 'firstSignal.invalid_payload',
        message: 'C:/Users/Admin/private token=secret',
      },
    });
  });

  it('freezes parsed nested DTOs and detaches them from mutable inputs', () => {
    const mutable = structuredClone({
      ...observation,
      state: 'errored',
      error: safeError,
    });
    const parsed = FirstSignalObservationSchema.parse(mutable);

    expect(Object.isFrozen(parsed)).toBe(true);
    expect(Object.isFrozen(parsed.error)).toBe(true);

    const serialized = JSON.stringify(parsed);
    expect(() => {
      (parsed as { revision: number }).revision = 99;
    }).toThrow(TypeError);
    expect(() => {
      (parsed.error as { code: string }).code = 'changed';
    }).toThrow(TypeError);

    mutable.revision = 99;
    mutable.error.code = 'changed';
    expect(JSON.stringify(parsed)).toBe(serialized);
  });
});
