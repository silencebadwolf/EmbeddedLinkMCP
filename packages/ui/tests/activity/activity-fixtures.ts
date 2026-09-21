import type {
  ActivityEventView,
  ActivitySnapshotView,
  CallAttemptPhase,
  CallAttemptView,
  OperationActor,
  OperationProgress,
  OperationPhase,
  OperationRisk,
  OperationView,
} from '../../../../src/shared/activity-contract.js';

export const activityTimestamp = '2026-07-13T01:00:00.000Z';

export function operationEvent(input: {
  sequence: number;
  operationId: string;
  phase: OperationPhase;
  action: string;
  risk: OperationRisk;
  runtimeId?: string;
  targetKind?: 'runtime' | 'session' | 'workspace' | 'probe' | 'file' | 'ui' | 'job';
  targetId?: string;
  targetLabel?: string;
  actorKind?: OperationActor['kind'];
  actorChannel?: OperationActor['channel'];
  errorCode?: string;
}): ActivityEventView {
  return {
    schemaVersion: '1.0.0',
    runtimeId: input.runtimeId ?? 'runtime_1',
    sequence: input.sequence,
    eventId: `event_${input.runtimeId ?? 'runtime_1'}_${input.sequence}`,
    timestamp: activityTimestamp,
    operationId: input.operationId,
    actor: {
      kind: input.actorKind ?? 'agent',
      channel: input.actorChannel ?? 'local-mcp',
    },
    surface: 'runtime',
    action: input.action,
    risk: input.risk,
    approvalPolicy: 'none',
    authorizationSource: 'none',
    targets: [
      {
        kind: input.targetKind ?? 'runtime',
        id: input.targetId ?? 'current-runtime',
        label: input.targetLabel,
      },
    ],
    kind: 'operation-transition',
    operationPhase: input.phase,
    ...(input.errorCode === undefined
      ? {}
      : {
          error: {
            code: input.errorCode,
            messageCode: 'activity.failure',
            stage: 'provider',
          },
        }),
  };
}

export function workflowEvent(input: {
  sequence: number;
  operationId: string;
  action: string;
  risk: OperationRisk;
  current: number;
  total: number;
  percent: number;
  runtimeId?: string;
  stepId?: string;
  messageCode?: string;
  targetKind?: 'runtime' | 'session' | 'workspace' | 'probe' | 'file' | 'ui' | 'job';
  targetId?: string;
  targetLabel?: string;
  actorKind?: OperationActor['kind'];
  actorChannel?: OperationActor['channel'];
}): ActivityEventView {
  const progress: OperationProgress = {
    current: input.current,
    total: input.total,
    percent: input.percent,
    evidenceRefs: [],
    ...(input.stepId === undefined ? {} : { stepId: input.stepId }),
    ...(input.messageCode === undefined ? {} : { messageCode: input.messageCode }),
  };

  return {
    schemaVersion: '1.0.0',
    runtimeId: input.runtimeId ?? 'runtime_1',
    sequence: input.sequence,
    eventId: `event_${input.runtimeId ?? 'runtime_1'}_${input.sequence}`,
    timestamp: activityTimestamp,
    operationId: input.operationId,
    actor: {
      kind: input.actorKind ?? 'agent',
      channel: input.actorChannel ?? 'local-mcp',
    },
    surface: 'workflow',
    action: input.action,
    risk: input.risk,
    approvalPolicy: 'none',
    authorizationSource: 'none',
    targets: [
      {
        kind: input.targetKind ?? 'job',
        id: input.targetId ?? 'job_1',
        label: input.targetLabel,
      },
    ],
    kind: 'workflow-milestone',
    progress,
  };
}

export function callEvent(input: {
  sequence: number;
  operationId: string;
  callId: string;
  phase: CallAttemptPhase;
  action: string;
  risk: OperationRisk;
  runtimeId?: string;
  targetKind?: 'runtime' | 'session' | 'workspace' | 'probe' | 'file' | 'ui' | 'job';
  targetId?: string;
  targetLabel?: string;
  actorKind?: OperationActor['kind'];
  actorChannel?: OperationActor['channel'];
  errorCode?: string;
}): ActivityEventView {
  return {
    schemaVersion: '1.0.0',
    runtimeId: input.runtimeId ?? 'runtime_1',
    sequence: input.sequence,
    eventId: `event_${input.runtimeId ?? 'runtime_1'}_${input.sequence}`,
    timestamp: activityTimestamp,
    operationId: input.operationId,
    actor: {
      kind: input.actorKind ?? 'agent',
      channel: input.actorChannel ?? 'local-mcp',
    },
    surface: 'runtime',
    action: input.action,
    risk: input.risk,
    approvalPolicy: 'none',
    authorizationSource: 'none',
    targets: [
      {
        kind: input.targetKind ?? 'runtime',
        id: input.targetId ?? 'current-runtime',
        label: input.targetLabel,
      },
    ],
    kind: 'call-transition',
    callId: input.callId,
    callPhase: input.phase,
    ...(input.errorCode === undefined
      ? {}
      : {
          error: {
            code: input.errorCode,
            messageCode: 'activity.failure',
            stage: 'provider',
          },
        }),
  };
}

export function operationView(
  input: Parameters<typeof operationEvent>[0] & { updatedSequence?: number },
): OperationView {
  const event = operationEvent(input);
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
    operationPhase: event.operationPhase,
    updatedSequence: input.updatedSequence ?? event.sequence,
    ...(event.error === undefined ? {} : { error: event.error }),
  };
}

export function callView(
  input: Parameters<typeof callEvent>[0] & { updatedSequence?: number },
): CallAttemptView {
  const event = callEvent(input);
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
    callId: event.callId,
    callPhase: event.callPhase,
    updatedSequence: input.updatedSequence ?? event.sequence,
    ...(event.error === undefined ? {} : { error: event.error }),
  };
}

export function activitySnapshot(
  events: readonly ActivityEventView[],
  input: {
    runtimeId?: string;
    sequence?: number;
    truncated?: boolean;
    resetRequired?: boolean;
    operations?: readonly OperationView[];
    calls?: readonly CallAttemptView[];
  } = {},
): ActivitySnapshotView {
  return {
    schemaVersion: '1.0.0',
    cursor: {
      runtimeId: input.runtimeId ?? events.at(-1)?.runtimeId ?? 'runtime_1',
      sequence: input.sequence ?? events.at(-1)?.sequence ?? 0,
    },
    truncated: input.truncated ?? false,
    resetRequired: input.resetRequired ?? false,
    events,
    operations: input.operations ?? [],
    calls: input.calls ?? [],
    health: {
      captureFailureCount: 0,
      droppedEventCount: 0,
      evictedEventCount: 0,
      listenerFailureCount: 0,
      policyFailureCount: 0,
      incompleteLifecycleCount: 0,
    },
  };
}
