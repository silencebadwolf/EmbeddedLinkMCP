import type {
  CallAttemptPhase,
  CallAttemptView,
  OperationPhase,
  OperationView,
} from '@linkterm/contracts/activity-contract';
import type {
  RetainedActivityEvent,
  RetainedCallTransition,
  RetainedOperationTransition,
} from './activity-event.js';

const OPERATION_EDGES: Partial<Record<OperationPhase, readonly OperationPhase[]>> = {
  requested: ['awaiting-approval', 'blocked', 'queued', 'running', 'rejected'],
  'awaiting-approval': ['blocked', 'queued', 'running', 'denied', 'expired', 'superseded'],
  blocked: ['queued', 'running', 'expired', 'superseded'],
  queued: ['running', 'cancel-requested', 'succeeded', 'failed', 'cancelled', 'interrupted'],
  running: ['cancel-requested', 'succeeded', 'failed', 'cancelled', 'interrupted'],
  'cancel-requested': ['succeeded', 'failed', 'cancelled', 'interrupted'],
};

const CALL_EDGES: Partial<Record<CallAttemptPhase, readonly CallAttemptPhase[]>> = {
  received: ['approval-required', 'rejected', 'started'],
  started: ['succeeded', 'failed'],
};

const OPERATION_TERMINALS = new Set<OperationPhase>([
  'succeeded',
  'failed',
  'rejected',
  'denied',
  'expired',
  'superseded',
  'cancelled',
  'interrupted',
]);

const CALL_TERMINALS = new Set<CallAttemptPhase>([
  'approval-required',
  'rejected',
  'succeeded',
  'failed',
]);

const WORKFLOW_OPERATION_KEYS = new Set([
  'workflow:control-workflow.job',
  'control-profile:control-profile.download-job',
]);

export type OperationStateRecord = Omit<OperationView, 'operationPhase'> & {
  readonly phase: OperationPhase;
};

export type CallAttemptStateRecord = Omit<CallAttemptView, 'callPhase'> & {
  readonly phase: CallAttemptPhase;
};

export interface ActivityReductionState {
  readonly operations: ReadonlyMap<string, OperationStateRecord>;
  readonly calls: ReadonlyMap<string, CallAttemptStateRecord>;
  /** Event ids in current retained window only; prefix eviction removes atomically. */
  readonly acceptedEventIds: ReadonlySet<string>;
}

export type ReductionFailureCode =
  | 'duplicate-event-id'
  | 'unknown-operation'
  | 'call-operation-mismatch'
  | 'illegal-operation-transition'
  | 'illegal-call-transition'
  | 'terminal-operation'
  | 'terminal-call'
  | 'milestone-non-workflow'
  | 'milestone-phase-change';

export type ReductionResult =
  | { readonly ok: true; readonly state: ActivityReductionState }
  | { readonly ok: false; readonly code: ReductionFailureCode };

type CommonStateRecord = Omit<OperationStateRecord, 'phase' | 'updatedSequence' | 'progress'>;

type RuntimeEndClassification =
  | {
      readonly operationId: string;
      readonly phase: 'rejected';
      readonly reason: 'runtime-ended-before-admission';
    }
  | {
      readonly operationId: string;
      readonly phase: 'expired';
      readonly reason: 'runtime-restart';
    }
  | {
      readonly operationId: string;
      readonly phase: 'interrupted';
      readonly reason: 'runtime-restart';
    };

function commonStateRecordFrom(event: RetainedActivityEvent): CommonStateRecord {
  return {
    schemaVersion: event.schemaVersion,
    runtimeId: event.runtimeId,
    sequence: event.sequence,
    eventId: event.eventId,
    timestamp: event.timestamp,
    operationId: event.operationId,
    actor: event.actor,
    surface: event.surface,
    action: event.action,
    risk: event.risk,
    approvalPolicy: event.approvalPolicy,
    authorizationSource: event.authorizationSource,
    targets: event.targets,
    ...(event.parentOperationId === undefined
      ? {}
      : { parentOperationId: event.parentOperationId }),
    ...(event.clientAcknowledged === undefined
      ? {}
      : { clientAcknowledged: event.clientAcknowledged }),
    ...(event.argumentSummary === undefined ? {} : { argumentSummary: event.argumentSummary }),
    ...(event.error === undefined ? {} : { error: event.error }),
  };
}

function operationRecordFrom(event: RetainedOperationTransition): OperationStateRecord {
  return {
    ...commonStateRecordFrom(event),
    phase: event.operationPhase,
    updatedSequence: event.sequence,
  };
}

function transitionCommonStateRecord(
  current: CommonStateRecord,
  event: RetainedActivityEvent,
): CommonStateRecord {
  return {
    schemaVersion: current.schemaVersion,
    runtimeId: current.runtimeId,
    sequence: event.sequence,
    eventId: event.eventId,
    timestamp: event.timestamp,
    operationId: current.operationId,
    actor: current.actor,
    surface: current.surface,
    action: current.action,
    risk: current.risk,
    approvalPolicy: current.approvalPolicy,
    authorizationSource: current.authorizationSource,
    targets: current.targets,
    ...(current.parentOperationId === undefined
      ? {}
      : { parentOperationId: current.parentOperationId }),
    ...(current.clientAcknowledged === undefined
      ? {}
      : { clientAcknowledged: current.clientAcknowledged }),
    ...(current.argumentSummary === undefined ? {} : { argumentSummary: current.argumentSummary }),
    ...(event.error === undefined ? {} : { error: event.error }),
  };
}

function transitionOperationRecord(
  current: OperationStateRecord,
  event: RetainedOperationTransition,
): OperationStateRecord {
  return {
    ...transitionCommonStateRecord(current, event),
    phase: event.operationPhase,
    updatedSequence: event.sequence,
    ...(current.progress === undefined ? {} : { progress: current.progress }),
  };
}

function callRecordFrom(event: RetainedCallTransition): CallAttemptStateRecord {
  return {
    ...commonStateRecordFrom(event),
    callId: event.callId,
    phase: event.callPhase,
    updatedSequence: event.sequence,
  };
}

function transitionCallRecord(
  current: CallAttemptStateRecord,
  event: RetainedCallTransition,
): CallAttemptStateRecord {
  return {
    ...transitionCommonStateRecord(current, event),
    callId: current.callId,
    phase: event.callPhase,
    updatedSequence: event.sequence,
  };
}

function acceptedEventIdsWith(state: ActivityReductionState, eventId: string): ReadonlySet<string> {
  return new Set(state.acceptedEventIds).add(eventId);
}

export function createEmptyReductionState(): ActivityReductionState {
  return {
    operations: new Map(),
    calls: new Map(),
    acceptedEventIds: new Set(),
  };
}

export function reduceActivityEvent(
  state: ActivityReductionState,
  event: RetainedActivityEvent,
): ReductionResult {
  if (state.acceptedEventIds.has(event.eventId)) {
    return { ok: false, code: 'duplicate-event-id' };
  }

  if (event.kind === 'operation-transition') {
    const current = state.operations.get(event.operationId);
    if (current === undefined) {
      if (event.operationPhase !== 'requested') {
        return { ok: false, code: 'unknown-operation' };
      }
    } else {
      if (OPERATION_TERMINALS.has(current.phase)) {
        return { ok: false, code: 'terminal-operation' };
      }
      if (!OPERATION_EDGES[current.phase]?.includes(event.operationPhase)) {
        return { ok: false, code: 'illegal-operation-transition' };
      }
    }

    const operations = new Map(state.operations);
    operations.set(
      event.operationId,
      current === undefined
        ? operationRecordFrom(event)
        : transitionOperationRecord(current, event),
    );
    return {
      ok: true,
      state: {
        operations,
        calls: state.calls,
        acceptedEventIds: acceptedEventIdsWith(state, event.eventId),
      },
    };
  }

  if (event.kind === 'call-transition') {
    if (!state.operations.has(event.operationId)) {
      return { ok: false, code: 'unknown-operation' };
    }

    const current = state.calls.get(event.callId);
    if (current === undefined) {
      if (event.callPhase !== 'received') {
        return { ok: false, code: 'illegal-call-transition' };
      }
    } else {
      if (current.operationId !== event.operationId) {
        return { ok: false, code: 'call-operation-mismatch' };
      }
      if (CALL_TERMINALS.has(current.phase)) {
        return { ok: false, code: 'terminal-call' };
      }
      if (!CALL_EDGES[current.phase]?.includes(event.callPhase)) {
        return { ok: false, code: 'illegal-call-transition' };
      }
    }

    const calls = new Map(state.calls);
    calls.set(
      event.callId,
      current === undefined ? callRecordFrom(event) : transitionCallRecord(current, event),
    );
    return {
      ok: true,
      state: {
        operations: state.operations,
        calls,
        acceptedEventIds: acceptedEventIdsWith(state, event.eventId),
      },
    };
  }

  if (Object.prototype.hasOwnProperty.call(event, 'operationPhase')) {
    return { ok: false, code: 'milestone-phase-change' };
  }

  const current = state.operations.get(event.operationId);
  if (current === undefined) {
    return { ok: false, code: 'unknown-operation' };
  }
  if (OPERATION_TERMINALS.has(current.phase)) {
    return { ok: false, code: 'terminal-operation' };
  }
  if (
    !WORKFLOW_OPERATION_KEYS.has(`${current.surface}:${current.action}`) ||
    event.surface !== current.surface ||
    event.action !== current.action
  ) {
    return { ok: false, code: 'milestone-non-workflow' };
  }

  const operations = new Map(state.operations);
  operations.set(event.operationId, {
    ...current,
    progress: event.progress,
    updatedSequence: event.sequence,
  });
  return {
    ok: true,
    state: {
      operations,
      calls: state.calls,
      acceptedEventIds: acceptedEventIdsWith(state, event.eventId),
    },
  };
}

export function classifyOperationsAtRuntimeEnd(
  state: ActivityReductionState,
): ReadonlyArray<RuntimeEndClassification> {
  const classifications: RuntimeEndClassification[] = [];
  for (const [operationId, operation] of state.operations) {
    switch (operation.phase) {
      case 'requested':
        classifications.push({
          operationId,
          phase: 'rejected',
          reason: 'runtime-ended-before-admission',
        });
        break;
      case 'awaiting-approval':
      case 'blocked':
        classifications.push({ operationId, phase: 'expired', reason: 'runtime-restart' });
        break;
      case 'queued':
      case 'running':
      case 'cancel-requested':
        classifications.push({ operationId, phase: 'interrupted', reason: 'runtime-restart' });
        break;
    }
  }
  return classifications;
}
