import {
  FIRST_SIGNAL_SCHEMA_VERSION,
  FirstSignalObservationSchema,
  type FirstSignalClosedReason,
  type FirstSignalFailureResult,
  type FirstSignalObservation,
  type FirstSignalSafeError,
  type FirstSignalStopReason,
} from '../../../shared/first-signal-contract.js';
import type { SessionId } from '../../../shared/types.js';
import type { SequenceCursor, TranscriptEvent } from '../../transcript/types.js';

export interface FirstSignalObservationStoreOptions {
  readonly now: () => string;
  readonly nowMs: () => number;
  readonly createAttemptId: () => string;
  readonly terminalRetentionMs: number;
}

export interface FirstSignalStartModelRequest {
  readonly clientAttemptKey: string;
  readonly sessionId: SessionId;
  readonly ownsSession: boolean;
  readonly baselineCursor: SequenceCursor;
  readonly timeoutMs: number;
}

export type FirstSignalStartModelResult =
  | { readonly status: 'started' | 'existing'; readonly observation: FirstSignalObservation }
  | { readonly status: 'conflict'; readonly error: FirstSignalFailureResult['error'] };

type Cleanup = () => void;

const TERMINAL_STATES = new Set<FirstSignalObservation['state']>([
  'closed',
  'errored',
  'stopped',
]);

const STRICT_UTF8_DECODER = new TextDecoder('utf-8', { fatal: true });

export function isFirstSignalDeviceTextEvent(event: TranscriptEvent): boolean {
  if (event.type !== 'data') return false;
  if (event.origin !== 'device') return false;
  if (!(event.data instanceof Uint8Array)) return false;
  if (event.data.byteLength === 0) return false;

  try {
    return STRICT_UTF8_DECODER.decode(event.data).length > 0;
  } catch {
    return false;
  }
}

export class FirstSignalObservationStore {
  readonly #now: () => string;
  readonly #nowMs: () => number;
  readonly #createAttemptId: () => string;
  readonly #terminalRetentionMs: number;
  readonly #observations = new Map<string, FirstSignalObservation>();
  readonly #attemptByClientKey = new Map<string, string>();
  readonly #terminalSinceMs = new Map<string, number>();
  readonly #cleanups = new Map<string, Cleanup[]>();
  readonly #cleanupRan = new Set<string>();

  constructor(options: FirstSignalObservationStoreOptions) {
    this.#now = options.now;
    this.#nowMs = options.nowMs;
    this.#createAttemptId = options.createAttemptId;
    this.#terminalRetentionMs = options.terminalRetentionMs;
  }

  start(request: FirstSignalStartModelRequest): FirstSignalStartModelResult {
    const existingAttemptId = this.#attemptByClientKey.get(request.clientAttemptKey);
    if (existingAttemptId !== undefined) {
      const existing = this.#observations.get(existingAttemptId);
      if (existing !== undefined && existing.sessionId === request.sessionId) {
        return { status: 'existing', observation: existing };
      }
      return {
        status: 'conflict',
        error: {
          code: 'firstSignal.conflict',
          message: 'First-signal request conflict',
        },
      };
    }

    const now = this.#now();
    const observation = FirstSignalObservationSchema.parse({
      schemaVersion: FIRST_SIGNAL_SCHEMA_VERSION,
      attemptId: this.#createAttemptId(),
      clientAttemptKey: request.clientAttemptKey,
      revision: 1,
      sessionId: request.sessionId,
      ownsSession: request.ownsSession,
      baselineCursor: request.baselineCursor,
      state: 'waiting',
      startedAt: now,
      updatedAt: now,
      timeoutMs: request.timeoutMs,
    });
    this.#observations.set(observation.attemptId, observation);
    this.#attemptByClientKey.set(observation.clientAttemptKey, observation.attemptId);
    return { status: 'started', observation };
  }

  get(attemptId: string): FirstSignalObservation | undefined {
    return this.#observations.get(attemptId);
  }

  registerCleanup(attemptId: string, cleanup: Cleanup): void {
    const cleanups = this.#cleanups.get(attemptId) ?? [];
    cleanups.push(cleanup);
    this.#cleanups.set(attemptId, cleanups);
  }

  markSilent(attemptId: string): FirstSignalObservation {
    const current = this.#require(attemptId);
    if (current.state !== 'waiting') return current;
    const now = this.#now();
    return this.#save({
      ...current,
      revision: current.revision + 1,
      state: 'silent',
      silentSince: now,
      updatedAt: now,
    });
  }

  observeTranscriptEvent(attemptId: string, event: TranscriptEvent): FirstSignalObservation {
    const current = this.#require(attemptId);
    if (TERMINAL_STATES.has(current.state)) return current;
    if (current.state === 'signal-detected') return current;
    if (!isFirstSignalDeviceTextEvent(event)) return current;

    return this.#save({
      ...current,
      revision: current.revision + 1,
      state: 'signal-detected',
      observedAt: new Date(event.timestamp).toISOString(),
      observedSequence: event.sequence,
      updatedAt: new Date(event.timestamp).toISOString(),
    });
  }

  close(attemptId: string, reason: FirstSignalClosedReason): FirstSignalObservation {
    const current = this.#require(attemptId);
    if (TERMINAL_STATES.has(current.state)) return current;
    return this.#terminal({
      ...current,
      revision: current.revision + 1,
      state: 'closed',
      closedReason: reason,
      updatedAt: this.#now(),
    });
  }

  stop(attemptId: string, reason: FirstSignalStopReason): FirstSignalObservation {
    const current = this.#require(attemptId);
    if (TERMINAL_STATES.has(current.state)) return current;
    return this.#terminal({
      ...current,
      revision: current.revision + 1,
      state: 'stopped',
      stopReason: reason,
      updatedAt: this.#now(),
    });
  }

  markErrored(attemptId: string, error: FirstSignalSafeError): FirstSignalObservation {
    const current = this.#require(attemptId);
    if (TERMINAL_STATES.has(current.state)) return current;
    return this.#terminal({
      ...current,
      revision: current.revision + 1,
      state: 'errored',
      error,
      updatedAt: this.#now(),
    });
  }

  pruneTerminal(): number {
    const nowMs = this.#nowMs();
    let pruned = 0;
    for (const [attemptId, terminalSinceMs] of this.#terminalSinceMs) {
      if (nowMs - terminalSinceMs <= this.#terminalRetentionMs) continue;
      const observation = this.#observations.get(attemptId);
      if (observation !== undefined && this.#attemptByClientKey.get(observation.clientAttemptKey) === attemptId) {
        this.#attemptByClientKey.delete(observation.clientAttemptKey);
      }
      this.#observations.delete(attemptId);
      this.#terminalSinceMs.delete(attemptId);
      this.#cleanups.delete(attemptId);
      this.#cleanupRan.delete(attemptId);
      pruned += 1;
    }
    return pruned;
  }

  #require(attemptId: string): FirstSignalObservation {
    const observation = this.#observations.get(attemptId);
    if (observation === undefined) {
      throw new Error(`First-signal observation not found: ${attemptId}`);
    }
    return observation;
  }

  #save(candidate: FirstSignalObservation): FirstSignalObservation {
    const parsed = FirstSignalObservationSchema.parse(candidate);
    this.#observations.set(parsed.attemptId, parsed);
    return parsed;
  }

  #terminal(candidate: FirstSignalObservation): FirstSignalObservation {
    const parsed = this.#save(candidate);
    this.#terminalSinceMs.set(parsed.attemptId, this.#nowMs());
    this.#runCleanup(parsed.attemptId);
    return parsed;
  }

  #runCleanup(attemptId: string): void {
    if (this.#cleanupRan.has(attemptId)) return;
    this.#cleanupRan.add(attemptId);
    for (const cleanup of this.#cleanups.get(attemptId) ?? []) {
      cleanup();
    }
  }
}
