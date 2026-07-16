import {
  FirstSignalStartRequestSchema,
  FirstSignalStatusRequestSchema,
  FirstSignalStopRequestSchema,
  type FirstSignalFailureResult,
  type FirstSignalObservation,
  type FirstSignalStartRequest,
  type FirstSignalStartResult,
  type FirstSignalStatusRequest,
  type FirstSignalStatusResult,
  type FirstSignalStopRequest,
  type FirstSignalStopResult,
} from '../../../shared/first-signal-contract.js';
import type { SessionId, SessionState } from '../../../shared/types.js';
import type { ISession } from '../types.js';
import type { TranscriptEvent } from '../../transcript/types.js';
import { FirstSignalObservationStore } from './first-signal-state.js';

export interface FirstSignalObservableSession extends ISession {
  off(event: 'event', listener: (event: TranscriptEvent) => void): this;
  off(event: 'state', listener: (state: SessionState) => void): this;
}

export interface FirstSignalObservationServiceOptions {
  readonly resolveSession: (sessionId: SessionId) => FirstSignalObservableSession | undefined;
  readonly now: () => string;
  readonly nowMs: () => number;
  readonly createAttemptId: () => string;
  readonly terminalRetentionMs?: number;
  readonly emitObservation?: (observation: FirstSignalObservation) => void;
}

interface AttachedObservation {
  readonly attemptId: string;
  readonly session: FirstSignalObservableSession;
  readonly onEvent: (event: TranscriptEvent) => void;
  readonly onState: (state: SessionState) => void;
  readonly timer: ReturnType<typeof setTimeout>;
}

const DEFAULT_TERMINAL_RETENTION_MS = 30_000;

export class FirstSignalObservationService {
  readonly #resolveSession: FirstSignalObservationServiceOptions['resolveSession'];
  readonly #emitObservation: (observation: FirstSignalObservation) => void;
  readonly #observationListeners = new Set<(observation: FirstSignalObservation) => void>();
  readonly #store: FirstSignalObservationStore;
  readonly #attached = new Map<string, AttachedObservation>();
  readonly #activeAttemptIds = new Set<string>();

  constructor(options: FirstSignalObservationServiceOptions) {
    this.#resolveSession = options.resolveSession;
    this.#emitObservation = (observation) => {
      options.emitObservation?.(observation);
      for (const listener of this.#observationListeners) {
        listener(observation);
      }
    };
    this.#store = new FirstSignalObservationStore({
      now: options.now,
      nowMs: options.nowMs,
      createAttemptId: options.createAttemptId,
      terminalRetentionMs: options.terminalRetentionMs ?? DEFAULT_TERMINAL_RETENTION_MS,
    });
  }

  onObservation(listener: (observation: FirstSignalObservation) => void): () => void {
    this.#observationListeners.add(listener);
    return () => {
      this.#observationListeners.delete(listener);
    };
  }

  start(request: FirstSignalStartRequest): FirstSignalStartResult {
    const parsed = FirstSignalStartRequestSchema.safeParse(request);
    if (!parsed.success) {
      return failure('firstSignal.invalid_request', 'Invalid first-signal request');
    }

    const session = this.#resolveSession(parsed.data.sessionId);
    if (session === undefined) {
      return failure('firstSignal.session_not_found', 'First-signal observation not found');
    }

    const started = this.#store.start({
      clientAttemptKey: parsed.data.clientAttemptKey,
      sessionId: parsed.data.sessionId,
      ownsSession: parsed.data.ownsSession,
      baselineCursor: parsed.data.baselineCursor,
      timeoutMs: parsed.data.timeoutMs,
    });
    if (started.status === 'conflict') {
      return { success: false, error: started.error };
    }
    if (started.status === 'started') {
      this.#activeAttemptIds.add(started.observation.attemptId);
      this.#attach(started.observation, session);
      this.#emitObservation(this.#requireObservation(started.observation.attemptId));
    }

    return { success: true, data: this.#requireObservation(started.observation.attemptId) };
  }

  status(request: FirstSignalStatusRequest): FirstSignalStatusResult {
    const parsed = FirstSignalStatusRequestSchema.safeParse(request);
    if (!parsed.success) {
      return failure('firstSignal.invalid_request', 'Invalid first-signal request');
    }
    const observation = this.#store.get(parsed.data.attemptId);
    if (observation === undefined) {
      return failure('firstSignal.not_found', 'First-signal observation not found');
    }
    return { success: true, data: observation };
  }

  stop(request: FirstSignalStopRequest): FirstSignalStopResult {
    const parsed = FirstSignalStopRequestSchema.safeParse(request);
    if (!parsed.success) {
      return failure('firstSignal.invalid_request', 'Invalid first-signal request');
    }
    const observation = this.#store.get(parsed.data.attemptId);
    if (observation === undefined) {
      return failure('firstSignal.not_found', 'First-signal observation not found');
    }
    const stopped = this.#store.stop(parsed.data.attemptId, parsed.data.reason);
    this.#emitIfChanged(observation, stopped);
    return { success: true, data: stopped };
  }

  shutdown(): void {
    for (const attemptId of [...this.#activeAttemptIds]) {
      const observation = this.#store.get(attemptId);
      if (observation === undefined) continue;
      const closed = this.#store.close(attemptId, 'runtime-shutdown');
      this.#emitIfChanged(observation, closed);
    }
  }

  pruneTerminal(): number {
    return this.#store.pruneTerminal();
  }

  #attach(observation: FirstSignalObservation, session: FirstSignalObservableSession): void {
    if (this.#attached.has(observation.attemptId)) return;

    const onEvent = (event: TranscriptEvent): void => {
      this.#observeTranscriptEvent(observation.attemptId, event);
    };
    const onState = (state: SessionState): void => {
      this.#observeSessionState(observation.attemptId, state);
    };
    const timer = setTimeout(() => {
      const before = this.#store.get(observation.attemptId);
      if (before === undefined) return;
      const silent = this.#store.markSilent(observation.attemptId);
      this.#emitIfChanged(before, silent);
    }, observation.timeoutMs);

    const attached: AttachedObservation = {
      attemptId: observation.attemptId,
      session,
      onEvent,
      onState,
      timer,
    };
    this.#attached.set(observation.attemptId, attached);
    this.#store.registerCleanup(observation.attemptId, () => this.#detach(observation.attemptId));

    session.on('event', onEvent);
    session.on('state', onState);

    const replay = session.read(observation.baselineCursor);
    for (const event of replay.events) {
      this.#observeTranscriptEvent(observation.attemptId, event);
    }
  }

  #detach(attemptId: string): void {
    const attached = this.#attached.get(attemptId);
    if (attached === undefined) return;
    clearTimeout(attached.timer);
    attached.session.off('event', attached.onEvent);
    attached.session.off('state', attached.onState);
    this.#attached.delete(attemptId);
    this.#activeAttemptIds.delete(attemptId);
  }

  #observeTranscriptEvent(attemptId: string, event: TranscriptEvent): void {
    const before = this.#store.get(attemptId);
    if (before === undefined) return;
    const after = this.#store.observeTranscriptEvent(attemptId, event);
    this.#emitIfChanged(before, after);
  }

  #observeSessionState(attemptId: string, state: SessionState): void {
    const before = this.#store.get(attemptId);
    if (before === undefined) return;
    if (state === 'closed') {
      const after = this.#store.close(attemptId, 'session-closed');
      this.#emitIfChanged(before, after);
      return;
    }
    if (state === 'errored') {
      const after = this.#store.markErrored(attemptId, {
        code: 'firstSignal.session_errored',
        messageCode: 'firstSignal.error.sessionErrored',
        stage: 'session',
      });
      this.#emitIfChanged(before, after);
    }
  }

  #emitIfChanged(before: FirstSignalObservation, after: FirstSignalObservation): void {
    if (after.revision !== before.revision) {
      this.#emitObservation(after);
    }
  }

  #requireObservation(attemptId: string): FirstSignalObservation {
    const observation = this.#store.get(attemptId);
    if (observation === undefined) {
      throw new Error(`First-signal observation not found: ${attemptId}`);
    }
    return observation;
  }
}

function failure(
  code: FirstSignalFailureResult['error']['code'],
  message: FirstSignalFailureResult['error']['message'],
): FirstSignalFailureResult {
  return {
    success: false,
    error: {
      code,
      message,
    },
  };
}
