import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  FIRST_SIGNAL_SCHEMA_VERSION,
  type FirstSignalObservation,
} from '@/shared/first-signal-contract.js';
import type { ISession } from '@linkterm/runtime/core/session/types';
import type { ReadResult, SequenceCursor, TranscriptEvent } from '@linkterm/runtime/core/transcript/types';
import {
  FirstSignalObservationService,
  type FirstSignalObservationServiceOptions,
} from '@linkterm/runtime/core/session/first-signal-observation/first-signal-observation-service';

const START_MS = Date.parse('2026-07-13T00:00:00.000Z');

function dataEvent(sequence: number, text: string, timestamp = START_MS + sequence): TranscriptEvent {
  return {
    type: 'data',
    origin: 'device',
    evidenceKind: 'terminal_output',
    data: new TextEncoder().encode(text),
    sequence,
    timestamp,
  };
}

function ignoredEvent(sequence: number, overrides: Partial<TranscriptEvent>): TranscriptEvent {
  return {
    type: 'state',
    origin: 'system',
    sequence,
    timestamp: START_MS + sequence,
    ...overrides,
  };
}

class FakeObservableSession extends EventEmitter implements Pick<ISession, 'id' | 'state' | 'read' | 'on'> {
  readonly id = 'sess_1';
  state: ISession['state'] = 'open';
  subscriberCursor = 0;
  emitWhenRead?: TranscriptEvent;
  emitWhenFirstListenerAttaches?: TranscriptEvent;
  readonly events: TranscriptEvent[] = [];

  append(event: TranscriptEvent): void {
    this.events.push(event);
  }

  read(cursor: SequenceCursor): ReadResult {
    if (this.emitWhenRead !== undefined) {
      const event = this.emitWhenRead;
      this.emitWhenRead = undefined;
      this.append(event);
      this.emit('event', event);
    }
    const visible = this.events.filter((event) => event.sequence > cursor);
    return {
      events: visible,
      cursor: this.events.at(-1)?.sequence ?? cursor,
      truncated: false,
      oldestAvailableSequence: this.events[0]?.sequence ?? ((this.events.at(-1)?.sequence ?? cursor) + 1),
    };
  }

  override on(eventName: 'event', listener: (event: TranscriptEvent) => void): this;
  override on(eventName: 'state', listener: (state: ISession['state']) => void): this;
  override on(eventName: string | symbol, listener: (...args: unknown[]) => void): this {
    super.on(eventName, listener);
    if (eventName === 'event' && this.emitWhenFirstListenerAttaches !== undefined) {
      const event = this.emitWhenFirstListenerAttaches;
      this.emitWhenFirstListenerAttaches = undefined;
      this.append(event);
      this.emit('event', event);
    }
    return this;
  }

  emitTranscript(event: TranscriptEvent): void {
    this.append(event);
    this.emit('event', event);
  }

  emitState(state: ISession['state']): void {
    this.state = state;
    this.emit('state', state);
  }
}

function createService(session = new FakeObservableSession()) {
  let attemptIndex = 0;
  let currentMs = START_MS;
  const emitted: FirstSignalObservation[] = [];
  const options: FirstSignalObservationServiceOptions = {
    resolveSession: (sessionId) => (sessionId === session.id ? session : undefined),
    now: () => new Date(currentMs).toISOString(),
    nowMs: () => currentMs,
    createAttemptId: () => `attempt_${++attemptIndex}`,
    terminalRetentionMs: 5_000,
    emitObservation: (observation) => emitted.push(observation),
  };

  return {
    session,
    emitted,
    service: new FirstSignalObservationService(options),
    advance(ms: number) {
      currentMs += ms;
      vi.setSystemTime(currentMs);
    },
  };
}

function startRequest(overrides: Partial<Parameters<FirstSignalObservationService['start']>[0]> = {}) {
  return {
    schemaVersion: FIRST_SIGNAL_SCHEMA_VERSION,
    clientAttemptKey: 'client_1',
    sessionId: 'sess_1',
    ownsSession: true,
    baselineCursor: 0,
    timeoutMs: 1_000,
    ...overrides,
  } as const;
}

describe('FirstSignalObservationService', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(START_MS);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('attaches listener before replay/status and returns data detected before start response', () => {
    const { service, session } = createService();
    session.emitWhenFirstListenerAttaches = dataEvent(2, 'boot before response');

    const result = service.start(startRequest());

    expect(result).toMatchObject({
      success: true,
      data: {
        attemptId: 'attempt_1',
        state: 'signal-detected',
        observedSequence: 2,
        revision: 2,
      },
    });
    expect(session.listenerCount('event')).toBe(1);
  });

  it('replays from baseline without advancing a renderer subscriber cursor', () => {
    const { service, session } = createService();
    session.subscriberCursor = 3;
    session.append(ignoredEvent(3, { type: 'state', origin: 'system', data: undefined }));
    session.append(dataEvent(4, 'historical boot'));

    const result = service.start(startRequest({ baselineCursor: 3 }));

    expect(result).toMatchObject({
      success: true,
      data: {
        state: 'signal-detected',
        baselineCursor: 3,
        observedSequence: 4,
      },
    });
    expect(session.subscriberCursor).toBe(3);
  });

  it('ignores empty, state, error, clear, and outgoing events while waiting for device text', () => {
    const { service, session } = createService();
    const started = service.start(startRequest());
    expect(started).toMatchObject({ success: true, data: { state: 'waiting' } });

    session.emitTranscript(ignoredEvent(2, { type: 'data', origin: 'device', data: new Uint8Array() }));
    session.emitTranscript(ignoredEvent(3, { type: 'data', origin: 'human', data: new TextEncoder().encode('cmd') }));
    session.emitTranscript(ignoredEvent(4, { type: 'state', origin: 'system', data: undefined }));
    session.emitTranscript(ignoredEvent(5, { type: 'error', origin: 'system', data: undefined }));
    session.emitTranscript(ignoredEvent(6, { type: 'clear', origin: 'human', data: undefined }));

    const status = service.status({ attemptId: 'attempt_1' });
    expect(status).toMatchObject({ success: true, data: { state: 'waiting', revision: 1 } });
  });

  it('keeps listening after silent timeout and accepts a late signal on the same attempt', async () => {
    const { service, session, advance } = createService();
    service.start(startRequest());

    advance(1_000);
    await vi.runOnlyPendingTimersAsync();
    expect(service.status({ attemptId: 'attempt_1' })).toMatchObject({
      success: true,
      data: { state: 'silent', revision: 2 },
    });
    expect(session.listenerCount('event')).toBe(1);

    session.emitTranscript(dataEvent(9, 'late banner', START_MS + 1_250));

    expect(service.status({ attemptId: 'attempt_1' })).toMatchObject({
      success: true,
      data: { state: 'signal-detected', observedSequence: 9, revision: 3 },
    });
    expect(session.listenerCount('event')).toBe(1);
  });

  it('maps session closed, errored, explicit stop, duplicate stop, and runtime shutdown to distinct cleanup-safe terminal states', () => {
    const { service, session } = createService();
    service.start(startRequest());

    session.emitState('closed');
    expect(service.status({ attemptId: 'attempt_1' })).toMatchObject({
      success: true,
      data: { state: 'closed', closedReason: 'session-closed' },
    });
    expect(session.listenerCount('event')).toBe(0);
    expect(session.listenerCount('state')).toBe(0);

    service.start(startRequest({ clientAttemptKey: 'client_2' }));
    session.emitState('errored');
    expect(service.status({ attemptId: 'attempt_2' })).toMatchObject({
      success: true,
      data: {
        state: 'errored',
        error: {
          code: 'firstSignal.session_errored',
          messageCode: 'firstSignal.error.sessionErrored',
          stage: 'session',
        },
      },
    });

    service.start(startRequest({ clientAttemptKey: 'client_3' }));
    expect(service.stop({ attemptId: 'attempt_3', reason: 'back-to-session' })).toMatchObject({
      success: true,
      data: { state: 'stopped', stopReason: 'back-to-session' },
    });
    expect(service.stop({ attemptId: 'attempt_3', reason: 'user' })).toMatchObject({
      success: true,
      data: { state: 'stopped', stopReason: 'back-to-session' },
    });

    service.start(startRequest({ clientAttemptKey: 'client_4' }));
    service.shutdown();
    expect(service.status({ attemptId: 'attempt_4' })).toMatchObject({
      success: true,
      data: { state: 'closed', closedReason: 'runtime-shutdown' },
    });
  });

  it('returns safe errors for malformed requests or missing sessions', () => {
    const { service } = createService();

    expect(service.start({ ...startRequest(), timeoutMs: 0 })).toEqual({
      success: false,
      error: { code: 'firstSignal.invalid_request', message: 'Invalid first-signal request' },
    });
    expect(service.start(startRequest({ sessionId: 'sess_missing' }))).toEqual({
      success: false,
      error: { code: 'firstSignal.session_not_found', message: 'First-signal observation not found' },
    });
    expect(service.status({ attemptId: 'missing' })).toEqual({
      success: false,
      error: { code: 'firstSignal.not_found', message: 'First-signal observation not found' },
    });
  });
});
