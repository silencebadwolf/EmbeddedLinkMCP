import {
  ACTIVITY_MAX_SNAPSHOT_EVENTS,
  ACTIVITY_MAX_SNAPSHOT_OPERATIONS,
  ActivityEventViewSchema,
  ActivitySnapshotViewSchema,
  type CallAttemptPhase,
  type CallAttemptView,
  type ActivityCursor,
  type ActivityEventView,
  type OperationView,
  type OperationActor,
  type OperationPhase,
  type OperationProgress,
  type OperationRisk,
  type OperationTargetRef,
  type ApprovalPolicy,
  type AuthorizationSource,
} from '../../../shared/activity-contract.js';

const ACTIVE_PHASES = new Set<OperationPhase>([
  'requested',
  'awaiting-approval',
  'blocked',
  'queued',
  'running',
  'cancel-requested',
]);

const ATTENTION_PHASES = new Set<OperationPhase>([
  'failed',
  'rejected',
  'denied',
  'expired',
  'superseded',
  'cancelled',
  'interrupted',
]);

export interface ActivityCenterDiagnostic {
  readonly code:
    | 'invalid-snapshot'
    | 'invalid-event'
    | 'runtime-reset'
    | 'sequence-gap'
    | 'subscribe-failed';
  readonly expectedSequence?: number;
  readonly receivedSequence?: number;
}

export interface ActivityItemSummary {
  readonly operationId: string;
  readonly actor: OperationActor;
  readonly action: string;
  readonly risk: OperationRisk;
  readonly approvalPolicy: ApprovalPolicy;
  readonly authorizationSource: AuthorizationSource;
  readonly clientAcknowledged: boolean;
  readonly phase: OperationPhase;
  readonly targets: readonly OperationTargetRef[];
  readonly firstSequence: number;
  readonly updatedSequence: number;
  readonly startedAt: string;
  readonly updatedAt: string;
  readonly errorCode?: string;
  readonly progress?: OperationProgress;
  readonly calls: readonly ActivityCallSummary[];
}

export interface ActivityCallSummary {
  readonly callId: string;
  readonly phase: CallAttemptPhase;
  readonly action: string;
  readonly risk: OperationRisk;
  readonly approvalPolicy: ApprovalPolicy;
  readonly authorizationSource: AuthorizationSource;
  readonly clientAcknowledged: boolean;
  readonly targets: readonly OperationTargetRef[];
  readonly updatedSequence: number;
  readonly updatedAt: string;
  readonly errorCode?: string;
}

export interface ActivityDefaultGroup {
  readonly kind: 'active' | 'attention' | 'read-only-burst';
  readonly operationIds: readonly string[];
}

export interface ActivityItemFilter {
  readonly actorKind?: OperationActor['kind'];
  readonly actorChannel?: OperationActor['channel'];
  readonly action?: string;
  readonly risk?: OperationRisk;
  readonly phase?: OperationPhase;
  readonly operationId?: string;
  readonly targetKind?: OperationTargetRef['kind'];
  readonly targetId?: string;
  readonly sessionId?: string;
  readonly workspaceId?: string;
  readonly text?: string;
}

export type ActivityCenterStatus = 'loading' | 'ready' | 'error';

export interface ActivityCenterState {
  readonly status: ActivityCenterStatus;
  readonly historyTruncated: boolean;
  readonly runtimeId?: string;
  readonly cursor?: ActivityCursor;
  readonly events: readonly ActivityEventView[];
  readonly operations: Readonly<Record<string, ActivityItemSummary>>;
  readonly diagnostics: readonly ActivityCenterDiagnostic[];
}

/** 创建空的 renderer-only Activity Center 状态。 */
export function createInitialActivityCenterState(): ActivityCenterState {
  return Object.freeze({
    status: 'loading' as const,
    historyTruncated: false,
    events: Object.freeze([]),
    operations: Object.freeze({}),
    diagnostics: Object.freeze([]),
  });
}

/** 用 Main 返回的 snapshot 切面替换本地状态；snapshot 解析失败时不保留原始 payload。 */
export function ingestActivitySnapshot(
  _state: ActivityCenterState,
  snapshot: unknown,
): ActivityCenterState {
  const parsed = ActivitySnapshotViewSchema.safeParse(snapshot);
  if (!parsed.success) {
    return withDiagnostic(
      createInitialActivityCenterState(),
      { code: 'invalid-snapshot' },
      'error',
    );
  }

  const seeded = seedSnapshotViews(
    createInitialActivityCenterState(),
    parsed.data.operations,
    parsed.data.calls,
  );
  const next = parsed.data.events.reduce(
    (state, event) => applyTrustedEvent(state, event),
    seeded,
  );

  const nextState = Object.freeze({
    ...next,
    status: 'ready' as const,
    historyTruncated: parsed.data.truncated || next.historyTruncated,
    runtimeId: parsed.data.cursor.runtimeId,
    cursor: parsed.data.cursor,
  });
  return parsed.data.resetRequired
    ? withDiagnostic(nextState, { code: 'runtime-reset' }, 'ready')
    : nextState;
}

function seedSnapshotViews(
  state: ActivityCenterState,
  operations: readonly OperationView[],
  calls: readonly CallAttemptView[],
): ActivityCenterState {
  const operationSummaries = operations.reduce<Readonly<Record<string, ActivityItemSummary>>>(
    (next, operation) =>
      Object.freeze({
        ...next,
        [operation.operationId]: operationSummaryFromView(operation),
      }),
    Object.freeze({}),
  );
  const withCalls = calls.reduce(updateCallViewSummary, operationSummaries);

  return Object.freeze({
    ...state,
    operations: withCalls,
  });
}

function operationSummaryFromView(operation: OperationView): ActivityItemSummary {
  return Object.freeze({
    operationId: operation.operationId,
    actor: operation.actor,
    action: operation.action,
    risk: operation.risk,
    approvalPolicy: operation.approvalPolicy,
    authorizationSource: operation.authorizationSource,
    clientAcknowledged: operation.clientAcknowledged === true,
    phase: operation.operationPhase,
    targets: operation.targets,
    firstSequence: operation.sequence,
    updatedSequence: operation.updatedSequence,
    startedAt: operation.timestamp,
    updatedAt: operation.timestamp,
    ...(operation.error?.code === undefined ? {} : { errorCode: operation.error.code }),
    ...(operation.progress === undefined ? {} : { progress: operation.progress }),
    calls: Object.freeze([]),
  });
}

/** 追加单个 pushed event；非连续、跨 runtime 或格式错误都只产生安全诊断。 */
export function ingestActivityEvent(
  state: ActivityCenterState,
  event: unknown,
): ActivityCenterState {
  const parsed = ActivityEventViewSchema.safeParse(event);
  if (!parsed.success) {
    return withDiagnostic(state, { code: 'invalid-event' }, 'error');
  }

  const activityEvent = parsed.data;
  if (state.runtimeId !== undefined && activityEvent.runtimeId !== state.runtimeId) {
    return withDiagnostic(createInitialActivityCenterState(), { code: 'runtime-reset' }, 'error');
  }

  const expectedSequence = (state.cursor?.sequence ?? 0) + 1;
  if (activityEvent.sequence !== expectedSequence) {
    return withDiagnostic(state, {
      code: 'sequence-gap',
      expectedSequence,
      receivedSequence: activityEvent.sequence,
    });
  }

  return applyTrustedEvent(
    {
      ...state,
      runtimeId: activityEvent.runtimeId,
    },
    activityEvent,
  );
}

/** 记录 renderer-only 安全诊断；调用方不得传入原始 Error、stack 或 payload。 */
export function recordActivityDiagnostic(
  state: ActivityCenterState,
  diagnostic: ActivityCenterDiagnostic,
  status: ActivityCenterStatus = state.status,
): ActivityCenterState {
  return withDiagnostic(state, diagnostic, status);
}

/** 返回默认顶部展示组：active、attention，再折叠普通 read-only burst。 */
export function selectDefaultActivityGroups(
  state: ActivityCenterState,
): readonly ActivityDefaultGroup[] {
  const items = selectActivityItems(state, {});
  const active = items
    .filter((item) => ACTIVE_PHASES.has(item.phase))
    .map((item) => item.operationId);
  const attention = items
    .filter((item) => ATTENTION_PHASES.has(item.phase))
    .map((item) => item.operationId);
  const readOnly = items
    .filter(
      (item) =>
        item.risk === 'read-only' &&
        !ACTIVE_PHASES.has(item.phase) &&
        !ATTENTION_PHASES.has(item.phase),
    )
    .map((item) => item.operationId);

  return Object.freeze([
    ...(active.length === 0 ? [] : [{ kind: 'active' as const, operationIds: Object.freeze(active) }]),
    ...(attention.length === 0
      ? []
      : [{ kind: 'attention' as const, operationIds: Object.freeze(attention) }]),
    ...(readOnly.length === 0
      ? []
      : [{ kind: 'read-only-burst' as const, operationIds: Object.freeze(readOnly) }]),
  ]);
}

/** 查询 retained window 中的 operation summary；折叠只影响默认展示，不影响这里。 */
export function selectActivityItems(
  state: ActivityCenterState,
  filter: ActivityItemFilter,
): readonly ActivityItemSummary[] {
  const text = filter.text?.trim().toLowerCase();
  return Object.freeze(
    Object.values(state.operations)
      .filter((item) => filter.operationId === undefined || item.operationId === filter.operationId)
      .filter((item) => filter.actorKind === undefined || item.actor.kind === filter.actorKind)
      .filter(
        (item) => filter.actorChannel === undefined || item.actor.channel === filter.actorChannel,
      )
      .filter((item) => filter.action === undefined || item.action === filter.action)
      .filter((item) => filter.risk === undefined || item.risk === filter.risk)
      .filter((item) => filter.phase === undefined || item.phase === filter.phase)
      .filter(
        (item) =>
          filter.targetKind === undefined ||
          item.targets.some((target) => target.kind === filter.targetKind),
      )
      .filter(
        (item) =>
          filter.targetId === undefined ||
          item.targets.some((target) => target.id === filter.targetId),
      )
      .filter(
        (item) =>
          filter.sessionId === undefined ||
          item.targets.some((target) => target.kind === 'session' && target.id === filter.sessionId),
      )
      .filter(
        (item) =>
          filter.workspaceId === undefined ||
          item.targets.some(
            (target) => target.kind === 'workspace' && target.id === filter.workspaceId,
          ),
      )
      .filter(
        (item) =>
          text === undefined ||
          item.operationId.toLowerCase().includes(text) ||
          item.action.toLowerCase().includes(text) ||
          item.actor.kind.toLowerCase().includes(text) ||
          item.actor.channel.toLowerCase().includes(text) ||
          item.risk.toLowerCase().includes(text) ||
          item.phase.toLowerCase().includes(text) ||
          item.calls.some(
            (call) =>
              call.callId.toLowerCase().includes(text) ||
              call.phase.toLowerCase().includes(text) ||
              call.action.toLowerCase().includes(text) ||
              call.risk.toLowerCase().includes(text) ||
              call.targets.some(
                (target) =>
                  target.id.toLowerCase().includes(text) ||
                  target.kind.toLowerCase().includes(text) ||
                  target.label?.toLowerCase().includes(text),
              ),
          ) ||
          item.targets.some(
            (target) =>
              target.id.toLowerCase().includes(text) ||
              target.kind.toLowerCase().includes(text) ||
              target.label?.toLowerCase().includes(text),
          ),
      )
      .sort((left, right) => right.firstSequence - left.firstSequence),
  );
}

function applyTrustedEvent(
  state: ActivityCenterState,
  event: ActivityEventView,
): ActivityCenterState {
  const nextEvents = [...state.events, event];
  const eventOverflow = nextEvents.length > ACTIVITY_MAX_SNAPSHOT_EVENTS;
  const events = Object.freeze(nextEvents.slice(-ACTIVITY_MAX_SNAPSHOT_EVENTS));
  const operationCap = capOperationSummaries(updateOperationSummaries(state.operations, event));

  return Object.freeze({
    ...state,
    status: 'ready' as const,
    historyTruncated: state.historyTruncated || eventOverflow || operationCap.truncated,
    runtimeId: event.runtimeId,
    cursor: Object.freeze({ runtimeId: event.runtimeId, sequence: event.sequence }),
    events,
    operations: operationCap.operations,
  });
}

function capOperationSummaries(
  operations: Readonly<Record<string, ActivityItemSummary>>,
): {
  readonly operations: Readonly<Record<string, ActivityItemSummary>>;
  readonly truncated: boolean;
} {
  const entries = Object.entries(operations);
  if (entries.length <= ACTIVITY_MAX_SNAPSHOT_OPERATIONS) {
    return { operations, truncated: false };
  }

  const kept = entries
    .sort(([, left], [, right]) => right.updatedSequence - left.updatedSequence)
    .slice(0, ACTIVITY_MAX_SNAPSHOT_OPERATIONS);

  return {
    operations: Object.freeze(Object.fromEntries(kept)),
    truncated: true,
  };
}

function updateOperationSummaries(
  operations: Readonly<Record<string, ActivityItemSummary>>,
  event: ActivityEventView,
): Readonly<Record<string, ActivityItemSummary>> {
  if (event.kind === 'operation-transition') {
    return updateOperationSummary(operations, event);
  }

  if (event.kind === 'call-transition') {
    return updateCallSummary(operations, event);
  }

  if (event.kind === 'workflow-milestone') {
    return updateOperationProgress(operations, event);
  }

  return operations;
}

function updateOperationSummary(
  operations: Readonly<Record<string, ActivityItemSummary>>,
  event: Extract<ActivityEventView, { kind: 'operation-transition' }>,
): Readonly<Record<string, ActivityItemSummary>> {
  const existing = operations[event.operationId];
  return Object.freeze({
    ...operations,
    [event.operationId]: Object.freeze({
      operationId: event.operationId,
      actor: event.actor,
    action: event.action,
    risk: event.risk,
    approvalPolicy: event.approvalPolicy,
    authorizationSource: event.authorizationSource,
    clientAcknowledged: event.clientAcknowledged === true,
    phase: event.operationPhase,
      targets: event.targets,
      firstSequence: existing?.firstSequence ?? event.sequence,
      updatedSequence: event.sequence,
      startedAt: existing?.startedAt ?? event.timestamp,
      updatedAt: event.timestamp,
      ...(event.error?.code === undefined ? {} : { errorCode: event.error.code }),
      ...(existing?.progress === undefined ? {} : { progress: existing.progress }),
      calls: existing?.calls ?? Object.freeze([]),
    }),
  });
}

function updateCallSummary(
  operations: Readonly<Record<string, ActivityItemSummary>>,
  event: Extract<ActivityEventView, { kind: 'call-transition' }>,
): Readonly<Record<string, ActivityItemSummary>> {
  const existing = operations[event.operationId];
  const callSummary = Object.freeze({
    callId: event.callId,
    phase: event.callPhase,
    action: event.action,
    risk: event.risk,
    approvalPolicy: event.approvalPolicy,
    authorizationSource: event.authorizationSource,
    clientAcknowledged: event.clientAcknowledged === true,
    targets: event.targets,
    updatedSequence: event.sequence,
    updatedAt: event.timestamp,
    ...(event.error?.code === undefined ? {} : { errorCode: event.error.code }),
  });
  const calls = upsertCallSummary(existing?.calls ?? Object.freeze([]), callSummary);

  return Object.freeze({
    ...operations,
    [event.operationId]: Object.freeze({
      operationId: event.operationId,
      actor: existing?.actor ?? event.actor,
      action: existing?.action ?? event.action,
      risk: existing?.risk ?? event.risk,
      approvalPolicy: existing?.approvalPolicy ?? event.approvalPolicy,
      authorizationSource: existing?.authorizationSource ?? event.authorizationSource,
      clientAcknowledged: existing?.clientAcknowledged ?? (event.clientAcknowledged === true),
      phase: existing?.phase ?? operationPhaseFromCallPhase(event.callPhase),
      targets: existing?.targets ?? event.targets,
      firstSequence: existing?.firstSequence ?? event.sequence,
      updatedSequence: event.sequence,
      startedAt: existing?.startedAt ?? event.timestamp,
      updatedAt: event.timestamp,
      ...(existing?.errorCode === undefined ? {} : { errorCode: existing.errorCode }),
      ...(existing?.progress === undefined ? {} : { progress: existing.progress }),
      calls,
    }),
  });
}

function updateCallViewSummary(
  operations: Readonly<Record<string, ActivityItemSummary>>,
  call: CallAttemptView,
): Readonly<Record<string, ActivityItemSummary>> {
  const existing = operations[call.operationId];
  const callSummary = Object.freeze({
    callId: call.callId,
    phase: call.callPhase,
    action: call.action,
    risk: call.risk,
    approvalPolicy: call.approvalPolicy,
    authorizationSource: call.authorizationSource,
    clientAcknowledged: call.clientAcknowledged === true,
    targets: call.targets,
    updatedSequence: call.updatedSequence,
    updatedAt: call.timestamp,
    ...(call.error?.code === undefined ? {} : { errorCode: call.error.code }),
  });
  const calls = upsertCallSummary(existing?.calls ?? Object.freeze([]), callSummary);

  return Object.freeze({
    ...operations,
    [call.operationId]: Object.freeze({
      operationId: call.operationId,
      actor: existing?.actor ?? call.actor,
      action: existing?.action ?? call.action,
      risk: existing?.risk ?? call.risk,
      approvalPolicy: existing?.approvalPolicy ?? call.approvalPolicy,
      authorizationSource: existing?.authorizationSource ?? call.authorizationSource,
      clientAcknowledged: existing?.clientAcknowledged ?? (call.clientAcknowledged === true),
      phase: existing?.phase ?? operationPhaseFromCallPhase(call.callPhase),
      targets: existing?.targets ?? call.targets,
      firstSequence: existing?.firstSequence ?? call.sequence,
      updatedSequence: Math.max(existing?.updatedSequence ?? call.updatedSequence, call.updatedSequence),
      startedAt: existing?.startedAt ?? call.timestamp,
      updatedAt: call.timestamp,
      ...(existing?.errorCode === undefined ? {} : { errorCode: existing.errorCode }),
      ...(existing?.progress === undefined ? {} : { progress: existing.progress }),
      calls,
    }),
  });
}

function upsertCallSummary(
  calls: readonly ActivityCallSummary[],
  next: ActivityCallSummary,
): readonly ActivityCallSummary[] {
  return Object.freeze(
    [...calls.filter((call) => call.callId !== next.callId), next].sort(
      (left, right) => left.updatedSequence - right.updatedSequence,
    ),
  );
}

function operationPhaseFromCallPhase(phase: CallAttemptPhase): OperationPhase {
  switch (phase) {
    case 'received':
      return 'requested';
    case 'approval-required':
      return 'awaiting-approval';
    case 'started':
      return 'running';
    case 'succeeded':
      return 'succeeded';
    case 'failed':
      return 'failed';
    case 'rejected':
      return 'rejected';
  }
}

function updateOperationProgress(
  operations: Readonly<Record<string, ActivityItemSummary>>,
  event: Extract<ActivityEventView, { kind: 'workflow-milestone' }>,
): Readonly<Record<string, ActivityItemSummary>> {
  const existing = operations[event.operationId];
  if (existing === undefined) return operations;

  return Object.freeze({
    ...operations,
    [event.operationId]: Object.freeze({
      ...existing,
      updatedSequence: event.sequence,
      updatedAt: event.timestamp,
      progress: event.progress,
    }),
  });
}

function withDiagnostic(
  state: ActivityCenterState,
  diagnostic: ActivityCenterDiagnostic,
  status: ActivityCenterStatus = state.status,
): ActivityCenterState {
  return Object.freeze({
    ...state,
    status,
    diagnostics: Object.freeze([...state.diagnostics, Object.freeze(diagnostic)]),
  });
}
