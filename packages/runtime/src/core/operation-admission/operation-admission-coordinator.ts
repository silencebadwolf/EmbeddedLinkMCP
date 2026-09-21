export type OperationAdmissionOrigin = 'ai' | 'human' | 'system';
export type OperationAdmissionMode =
  | 'read-only'
  | 'state-affecting'
  | 'disruptive'
  | 'destructive-or-unknown';

export interface OperationAdmissionCheckOk {
  readonly ok: true;
}

export interface OperationAdmissionCheckRejected {
  readonly ok: false;
  readonly reason: string;
}

export type OperationAdmissionCheckResult =
  | OperationAdmissionCheckOk
  | OperationAdmissionCheckRejected;

export interface OperationAdmissionRequest {
  readonly operationId: string;
  readonly principalId: string;
  readonly origin: OperationAdmissionOrigin;
  readonly mode: OperationAdmissionMode;
  readonly revalidate: () => Promise<OperationAdmissionCheckResult>;
}

export interface ExecutionAdmissionLease {
  readonly schemaVersion: '1.0.0';
  readonly leaseId: string;
  readonly runtimeId: string;
  readonly operationId: string;
  readonly principalId: string;
  readonly acquiredAt: string;
}

export interface OperationAdmissionCallbackContext {
  readonly lease?: ExecutionAdmissionLease;
}

export type OperationAdmissionResult<T> =
  | {
      readonly ok: true;
      readonly value: T;
    }
  | {
      readonly ok: false;
      readonly reason: 'revalidation-failed';
      readonly revision: number;
    };

export interface OperationAdmissionCoordinatorOptions {
  readonly runtimeId: string;
  readonly now?: () => string;
  readonly createLeaseId?: () => string;
}

function requiresAdmissionLease(request: OperationAdmissionRequest): boolean {
  return request.origin === 'ai' && request.mode !== 'read-only';
}

export class OperationAdmissionCoordinator {
  readonly #now: () => string;
  readonly #createLeaseId: () => string;
  #runtimeId: string;
  #queue: Promise<unknown> = Promise.resolve();
  readonly #activeLeases = new Set<ExecutionAdmissionLease>();
  #leaseSequence = 0;

  constructor(options: OperationAdmissionCoordinatorOptions) {
    this.#runtimeId = options.runtimeId;
    this.#now = options.now ?? (() => new Date().toISOString());
    this.#createLeaseId =
      options.createLeaseId ??
      (() => {
        this.#leaseSequence += 1;
        return `lease_${this.#leaseSequence}`;
      });
  }

  async withAdmission<T>(
    request: OperationAdmissionRequest,
    effectful: (context: OperationAdmissionCallbackContext) => Promise<T>,
  ): Promise<OperationAdmissionResult<T>> {
    const run = () => this.#runAdmission(request, effectful);
    const result = this.#queue.then(run, run);
    this.#queue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  releaseLease(lease: unknown): void {
    if (this.#isLease(lease)) {
      this.#activeLeases.delete(lease);
    }
  }

  restartRuntime(runtimeId: string): void {
    this.#runtimeId = runtimeId;
    this.#activeLeases.clear();
  }

  getActiveLeaseCount(): number {
    return this.#activeLeases.size;
  }

  async #runAdmission<T>(
    request: OperationAdmissionRequest,
    effectful: (context: OperationAdmissionCallbackContext) => Promise<T>,
  ): Promise<OperationAdmissionResult<T>> {
    const revalidated = await request.revalidate();
    if (!revalidated.ok) {
      return this.#blocked('revalidation-failed');
    }

    const lease = requiresAdmissionLease(request) ? this.#acquireLease(request) : undefined;
    try {
      const value = await effectful({ lease });
      return { ok: true, value };
    } finally {
      this.releaseLease(lease);
    }
  }

  #blocked(
    reason: 'revalidation-failed',
  ): OperationAdmissionResult<never> {
    return {
      ok: false,
      reason,
      revision: 1,
    };
  }

  #acquireLease(request: OperationAdmissionRequest): ExecutionAdmissionLease {
    const lease: ExecutionAdmissionLease = {
      schemaVersion: '1.0.0',
      leaseId: this.#createLeaseId(),
      runtimeId: this.#runtimeId,
      operationId: request.operationId,
      principalId: request.principalId,
      acquiredAt: this.#now(),
    };
    this.#activeLeases.add(lease);
    return lease;
  }

  #isLease(value: unknown): value is ExecutionAdmissionLease {
    return this.#activeLeases.has(value as ExecutionAdmissionLease);
  }
}
