import type {
  SerialDataBits,
  SerialParity,
  SerialSessionConfig,
  SerialStopBits,
  SessionId,
  SessionState,
} from '../../shared/types.js';

const ACTIVE_SESSION_STATES = new Set<SessionState>(['idle', 'opening', 'open']);

/** Effective, non-sensitive serial identity used only inside Main. */
export interface NormalizedSerialSessionIdentity {
  readonly port: string;
  readonly portKey: string;
  readonly baudRate: number;
  readonly mode: SerialSessionConfig['mode'];
  readonly dataBits: SerialDataBits;
  readonly stopBits: SerialStopBits;
  readonly parity: SerialParity;
  readonly rtscts: boolean;
  readonly xon: boolean;
  readonly xoff: boolean;
}

export interface CoordinatedSerialOpenResult {
  readonly sessionId: SessionId;
  readonly state: SessionState;
  readonly reused: boolean;
}

export type SerialSessionOpener = () => Promise<{
  readonly sessionId: SessionId;
  readonly state: SessionState;
}>;

interface SessionStateRegistry {
  get(id: SessionId): { readonly state: SessionState } | undefined;
}

interface ActiveSerialSession {
  readonly sessionId: SessionId;
  readonly identity: NormalizedSerialSessionIdentity;
}

interface InFlightSerialOpen {
  readonly identity: NormalizedSerialSessionIdentity;
  readonly promise: Promise<CoordinatedSerialOpenResult>;
}

/** Stable conflict raised before a second transport or errored tab is created. */
export class SerialSessionConflictError extends Error {
  readonly code = 'SERIAL_SESSION_CONFLICT' as const;

  constructor(
    public readonly port: string,
    public readonly requested: NormalizedSerialSessionIdentity,
    public readonly existing: NormalizedSerialSessionIdentity,
    public readonly existingSessionId?: SessionId,
  ) {
    super(`Serial port ${port} is already active with a different configuration`);
    this.name = 'SerialSessionConflictError';
  }
}

/**
 * Main-owned serial resource arbiter shared by human and AI open entry points.
 *
 * The coordinator owns only identity and in-flight selection. The supplied opener retains each
 * entry's existing lifecycle/error semantics and still creates the actual Session through the
 * shared SessionManager.
 */
export class SerialSessionCoordinator {
  readonly #activeByPort = new Map<string, ActiveSerialSession>();
  readonly #inFlightByPort = new Map<string, InFlightSerialOpen>();

  constructor(private readonly sessions: SessionStateRegistry) {}

  async openOrReuse(
    config: SerialSessionConfig,
    open: SerialSessionOpener,
  ): Promise<CoordinatedSerialOpenResult> {
    const requested = normalizeSerialSessionIdentity(config);
    const inFlight = this.#inFlightByPort.get(requested.portKey);
    if (inFlight !== undefined) {
      assertCompatible(requested, inFlight.identity);
      const result = await inFlight.promise;
      return { ...result, reused: true };
    }

    const active = this.#activeByPort.get(requested.portKey);
    if (active !== undefined) {
      const state = this.sessions.get(active.sessionId)?.state;
      if (state !== undefined && ACTIVE_SESSION_STATES.has(state)) {
        assertCompatible(requested, active.identity, active.sessionId);
        return { sessionId: active.sessionId, state, reused: true };
      }
      this.#activeByPort.delete(requested.portKey);
    }

    const ownerPromise = Promise.resolve()
      .then(open)
      .then((result): CoordinatedSerialOpenResult => {
        if (ACTIVE_SESSION_STATES.has(result.state)) {
          this.#activeByPort.set(requested.portKey, {
            sessionId: result.sessionId,
            identity: requested,
          });
        }
        return { ...result, reused: false };
      });
    const reservation: InFlightSerialOpen = { identity: requested, promise: ownerPromise };
    this.#inFlightByPort.set(requested.portKey, reservation);

    try {
      return await ownerPromise;
    } finally {
      if (this.#inFlightByPort.get(requested.portKey) === reservation) {
        this.#inFlightByPort.delete(requested.portKey);
      }
    }
  }
}

/** Normalize omitted values to the defaults used by SerialTransport. */
export function normalizeSerialSessionIdentity(
  config: SerialSessionConfig,
): NormalizedSerialSessionIdentity {
  const port = config.port.trim();
  return {
    port,
    portKey: normalizePhysicalPortKey(port),
    baudRate: config.baudRate,
    mode: config.mode,
    dataBits: config.dataBits ?? 8,
    stopBits: config.stopBits ?? 1,
    parity: config.parity ?? 'none',
    rtscts: config.rtscts ?? false,
    xon: config.xon ?? false,
    xoff: config.xoff ?? false,
  };
}

function normalizePhysicalPortKey(port: string): string {
  return /^COM\d+$/i.test(port) ? port.toUpperCase() : port;
}

function assertCompatible(
  requested: NormalizedSerialSessionIdentity,
  existing: NormalizedSerialSessionIdentity,
  existingSessionId?: SessionId,
): void {
  if (serialIdentitiesEqual(requested, existing)) return;
  throw new SerialSessionConflictError(
    requested.port,
    requested,
    existing,
    existingSessionId,
  );
}

function serialIdentitiesEqual(
  left: NormalizedSerialSessionIdentity,
  right: NormalizedSerialSessionIdentity,
): boolean {
  return (
    left.portKey === right.portKey &&
    left.baudRate === right.baudRate &&
    left.mode === right.mode &&
    left.dataBits === right.dataBits &&
    left.stopBits === right.stopBits &&
    left.parity === right.parity &&
    left.rtscts === right.rtscts &&
    left.xon === right.xon &&
    left.xoff === right.xoff
  );
}
