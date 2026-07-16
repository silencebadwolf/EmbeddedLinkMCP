import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import type { ToolSensitivity } from '../../mcp/versioning/version-check.js';
import type {
  ActivityFailureStage,
  ActivitySurface,
  OperationActor,
  OperationPhase,
  OperationProgress,
} from '../../shared/activity-contract.js';
import type { ControlWorkflowJobObservation } from '../../mcp/surfaces/control-workflow/job-manager.js';
import { redactResultClassification, redactToolObservation } from './audit-redactor.js';
import { resolveToolObservationPolicy } from './risk-policy.js';
import { ActivityHealthMonitor } from './activity-health.js';
import { OperationLedger } from './operation-ledger.js';
import type { ActivityEventDraft } from './activity-event.js';

export interface BeginMcpCallInput {
  readonly action: string;
  readonly declaredSensitivity: ToolSensitivity;
  readonly rawArgs: unknown;
}

export interface McpCallRecordingHandle {
  readonly operationId: string;
  readonly callId: string;
  readonly admission: 'start-before-handler' | 'defer-for-current-acknowledgement';
  start(): void;
  recordPolicyDrift(): void;
  reject(stage: ActivityFailureStage, code?: string): void;
  finishFailure(code?: string): void;
  finishSuccess(): void;
  finishSuccessWithDeliveryFailure(stage: 'response-construction' | 'response-serialization'): void;
  recordDeliveryFailure(stage: 'response-construction' | 'response-serialization'): void;
  runWithContext<T>(work: () => Promise<T> | T): Promise<T>;
}

export type OperationRecorderProvider = (input: BeginMcpCallInput) => McpCallRecordingHandle;

type RecorderContext = { readonly operationId: string };

type McpCommonDraftFields = Omit<
  ActivityEventDraft,
  'kind' | 'operationPhase' | 'callId' | 'callPhase' | 'progress'
>;

interface ActiveHandleOptions {
  readonly operationId: string;
  readonly callId: string;
  readonly admission: McpCallRecordingHandle['admission'];
  readonly common: McpCommonDraftFields;
  readonly ledger: OperationLedger;
  readonly health: ActivityHealthMonitor;
  readonly terminalDecision: () => void;
  readonly context: AsyncLocalStorage<RecorderContext>;
}

interface NoopHandleOptions {
  readonly operationId: string;
  readonly callId: string;
  readonly admission: McpCallRecordingHandle['admission'];
  readonly terminalDecision: () => void;
  readonly context: AsyncLocalStorage<RecorderContext>;
}

interface WorkflowJobRecordingState {
  readonly operationId: string;
  readonly common: McpCommonDraftFields;
  lastProgressSignature?: string;
}

const SAFE_ACTIVITY_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const WORKFLOW_JOB_TERMINALS = new Set<ControlWorkflowJobObservation['kind']>([
  'succeeded',
  'failed',
  'cancelled',
]);

function runInContext<T>(
  context: AsyncLocalStorage<RecorderContext>,
  operationId: string,
  work: () => Promise<T> | T,
): Promise<T> {
  try {
    return Promise.resolve(context.run({ operationId }, work));
  } catch (error) {
    return Promise.reject(error);
  }
}

function createNoopRecordingHandle(options: NoopHandleOptions): McpCallRecordingHandle {
  let finished = false;
  const finishOnce = (): void => {
    if (finished) return;
    finished = true;
    options.terminalDecision();
  };

  return Object.freeze({
    operationId: options.operationId,
    callId: options.callId,
    admission: options.admission,
    start: () => undefined,
    recordPolicyDrift: () => undefined,
    reject: () => finishOnce(),
    finishFailure: () => finishOnce(),
    finishSuccess: () => finishOnce(),
    finishSuccessWithDeliveryFailure: () => finishOnce(),
    recordDeliveryFailure: () => undefined,
    runWithContext: <T>(work: () => Promise<T> | T) =>
      runInContext(options.context, options.operationId, work),
  });
}

function createActiveRecordingHandle(options: ActiveHandleOptions): McpCallRecordingHandle {
  let started = false;
  let finished = false;
  let policyDriftRecorded = false;
  let captureDisabled = false;

  const append = (drafts: readonly ActivityEventDraft[]): void => {
    if (captureDisabled) return;
    const result = options.ledger.appendBatch(drafts);
    if (!result.accepted) {
      captureDisabled = true;
    }
  };

  const finishOnce = (drafts: readonly ActivityEventDraft[]): void => {
    if (finished) return;
    finished = true;
    options.terminalDecision();
    append(drafts);
  };

  const failedError = (stage: ActivityFailureStage, code?: string) =>
    redactResultClassification({
      success: false,
      errorCode: code,
      failureStage: stage,
    });

  return Object.freeze({
    operationId: options.operationId,
    callId: options.callId,
    admission: options.admission,
    start: () => {
      if (started) return;
      started = true;
      append([
        { ...options.common, kind: 'operation-transition', operationPhase: 'running' },
        {
          ...options.common,
          kind: 'call-transition',
          callId: options.callId,
          callPhase: 'started',
        },
      ]);
    },
    recordPolicyDrift: () => {
      if (policyDriftRecorded) return;
      policyDriftRecorded = true;
      options.health.recordPolicyFailure();
    },
    reject: (stage: ActivityFailureStage, code = 'OPERATION_REJECTED') => {
      const error = failedError(stage, code);
      finishOnce([
        { ...options.common, kind: 'operation-transition', operationPhase: 'rejected', error },
        {
          ...options.common,
          kind: 'call-transition',
          callId: options.callId,
          callPhase: 'rejected',
          error,
        },
      ]);
    },
    finishFailure: (code = 'OPERATION_FAILED') => {
      const error = failedError('provider', code);
      finishOnce([
        { ...options.common, kind: 'operation-transition', operationPhase: 'failed', error },
        {
          ...options.common,
          kind: 'call-transition',
          callId: options.callId,
          callPhase: 'failed',
          error,
        },
      ]);
    },
    finishSuccess: () => {
      finishOnce([
        { ...options.common, kind: 'operation-transition', operationPhase: 'succeeded' },
        {
          ...options.common,
          kind: 'call-transition',
          callId: options.callId,
          callPhase: 'succeeded',
        },
      ]);
    },
    finishSuccessWithDeliveryFailure: (
      stage: 'response-construction' | 'response-serialization',
    ) => {
      const error = failedError(stage);
      finishOnce([
        { ...options.common, kind: 'operation-transition', operationPhase: 'succeeded' },
        {
          ...options.common,
          kind: 'call-transition',
          callId: options.callId,
          callPhase: 'failed',
          error,
        },
      ]);
    },
    recordDeliveryFailure: (stage: 'response-construction' | 'response-serialization') => {
      options.health.recordCaptureFailure(stage, 'delivery-failed', 0);
    },
    runWithContext: <T>(work: () => Promise<T> | T) =>
      runInContext(options.context, options.operationId, work),
  });
}

export class OperationRecorder {
  private readonly ledger: OperationLedger;
  private readonly health: ActivityHealthMonitor;
  private readonly context = new AsyncLocalStorage<RecorderContext>();
  private readonly workflowJobs = new Map<string, WorkflowJobRecordingState>();

  constructor(options: {
    readonly ledger: OperationLedger;
    readonly health: ActivityHealthMonitor;
  }) {
    this.ledger = options.ledger;
    this.health = options.health;
  }

  beginMcpCall(input: BeginMcpCallInput): McpCallRecordingHandle {
    const terminalDecision = this.health.enterLifecycle();
    const operationId = `operation-${randomUUID()}`;
    const callId = `call-${randomUUID()}`;
    const noopOptions = (admission: McpCallRecordingHandle['admission']): NoopHandleOptions => ({
      operationId,
      callId,
      admission,
      terminalDecision,
      context: this.context,
    });

    try {
      const policy = resolveToolObservationPolicy(input);
      if (policy.hasDiagnostic) this.health.recordPolicyFailure();
      const redacted = redactToolObservation(policy, input.rawArgs);
      const common: McpCommonDraftFields = Object.freeze({
        operationId,
        actor: { kind: 'agent' as const, channel: 'local-mcp' as const },
        surface: policy.surface,
        action: policy.action,
        risk: policy.risk,
        approvalPolicy: policy.approvalPolicy,
        authorizationSource: 'none' as const,
        targets: redacted.targets,
        ...(redacted.argumentSummary === undefined
          ? {}
          : { argumentSummary: redacted.argumentSummary }),
        ...(redacted.clientAcknowledged === undefined
          ? {}
          : { clientAcknowledged: redacted.clientAcknowledged }),
      } satisfies McpCommonDraftFields);
      const begin = this.ledger.appendBatch([
        { ...common, kind: 'operation-transition', operationPhase: 'requested' },
        { ...common, kind: 'call-transition', callId, callPhase: 'received' },
      ]);
      const admission = policy.missingCurrentAcknowledgement
        ? 'defer-for-current-acknowledgement'
        : 'start-before-handler';
      if (!begin.accepted) {
        return createNoopRecordingHandle(noopOptions(admission));
      }
      return createActiveRecordingHandle({
        operationId,
        callId,
        common,
        ledger: this.ledger,
        health: this.health,
        terminalDecision,
        context: this.context,
        admission,
      });
    } catch {
      this.health.recordCaptureFailure('provider', 'capture-failed', 2);
      return createNoopRecordingHandle(noopOptions('start-before-handler'));
    }
  }

  observeWorkflowJob(observation: ControlWorkflowJobObservation): void {
    try {
      if (observation.kind === 'created') {
        this.recordWorkflowJobCreated(observation);
        return;
      }

      const state = this.workflowJobs.get(observation.jobId);
      if (state === undefined) return;

      if (observation.kind === 'updated') {
        this.recordWorkflowJobMilestone(state, observation);
        return;
      }

      if (WORKFLOW_JOB_TERMINALS.has(observation.kind)) {
        this.recordWorkflowJobTerminal(state, observation);
        return;
      }

      this.recordWorkflowJobTransition(state, observation.kind);
    } catch {
      this.health.recordCaptureFailure('provider', 'capture-failed', 1);
    }
  }

  private recordWorkflowJobCreated(observation: ControlWorkflowJobObservation): void {
    const operationId = `operation-${randomUUID()}`;
    const parentOperationId =
      observation.activityOrigin === 'agent' ? this.context.getStore()?.operationId : undefined;
    const common = createWorkflowJobCommonFields(observation, operationId, parentOperationId);
    const result = this.ledger.appendBatch([
      { ...common, kind: 'operation-transition', operationPhase: 'requested' },
      { ...common, kind: 'operation-transition', operationPhase: 'queued' },
    ]);
    if (!result.accepted) return;
    this.workflowJobs.set(observation.jobId, { operationId, common });
  }

  private recordWorkflowJobTransition(
    state: WorkflowJobRecordingState,
    kind: ControlWorkflowJobObservation['kind'],
  ): void {
    const operationPhase = operationPhaseForWorkflowJobKind(kind);
    if (operationPhase === undefined) return;
    this.ledger.appendBatch([{ ...state.common, kind: 'operation-transition', operationPhase }]);
  }

  private recordWorkflowJobMilestone(
    state: WorkflowJobRecordingState,
    observation: ControlWorkflowJobObservation,
  ): void {
    const progress = workflowProgressFromObservation(observation);
    if (progress === undefined) return;
    const signature = JSON.stringify(progress);
    if (state.lastProgressSignature === signature) return;
    const result = this.ledger.appendBatch([
      { ...state.common, kind: 'workflow-milestone', progress },
    ]);
    if (result.accepted) state.lastProgressSignature = signature;
  }

  private recordWorkflowJobTerminal(
    state: WorkflowJobRecordingState,
    observation: ControlWorkflowJobObservation,
  ): void {
    try {
      const operationPhase = operationPhaseForWorkflowJobKind(observation.kind);
      if (operationPhase === undefined) return;
      const progress = workflowProgressFromObservation(observation);
      const drafts: ActivityEventDraft[] = [];
      if (progress !== undefined) {
        const signature = JSON.stringify(progress);
        if (state.lastProgressSignature !== signature) {
          drafts.push({ ...state.common, kind: 'workflow-milestone', progress });
        }
      }
      drafts.push({ ...state.common, kind: 'operation-transition', operationPhase });
      this.ledger.appendBatch(drafts);
    } finally {
      this.workflowJobs.delete(observation.jobId);
    }
  }
}

function safeActivityId(value: string, fallback: string): string {
  return SAFE_ACTIVITY_ID_PATTERN.test(value) ? value : fallback;
}

function actorForWorkflowJob(
  origin: ControlWorkflowJobObservation['activityOrigin'],
): OperationActor {
  switch (origin) {
    case 'agent':
      return Object.freeze({ kind: 'agent', channel: 'local-mcp' });
    case 'human':
      return Object.freeze({ kind: 'human', channel: 'desktop' });
    case 'system':
      return Object.freeze({ kind: 'system', channel: 'main' });
  }
}

function surfaceForWorkflowJob(
  origin: ControlWorkflowJobObservation['activityOrigin'],
): ActivitySurface {
  return origin === 'human' ? 'control-profile' : 'workflow';
}

function actionForWorkflowJob(origin: ControlWorkflowJobObservation['activityOrigin']): string {
  return origin === 'human' ? 'control-profile.download-job' : 'control-workflow.job';
}

function createWorkflowJobCommonFields(
  observation: ControlWorkflowJobObservation,
  operationId: string,
  parentOperationId: string | undefined,
): McpCommonDraftFields {
  return Object.freeze({
    operationId,
    ...(parentOperationId === undefined ? {} : { parentOperationId }),
    actor: actorForWorkflowJob(observation.activityOrigin),
    surface: surfaceForWorkflowJob(observation.activityOrigin),
    action: actionForWorkflowJob(observation.activityOrigin),
    risk: 'destructive-or-unknown',
    approvalPolicy: 'none',
    authorizationSource: 'none',
    targets: Object.freeze([
      Object.freeze({ kind: 'job' as const, id: safeActivityId(observation.jobId, 'job-unknown') }),
    ]),
  } satisfies McpCommonDraftFields);
}

function operationPhaseForWorkflowJobKind(
  kind: ControlWorkflowJobObservation['kind'],
): OperationPhase | undefined {
  switch (kind) {
    case 'running':
      return 'running';
    case 'cancel-requested':
      return 'cancel-requested';
    case 'succeeded':
      return 'succeeded';
    case 'failed':
      return 'failed';
    case 'cancelled':
      return 'cancelled';
    case 'created':
    case 'updated':
      return undefined;
  }
}

function safeProgressCount(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) return 0;
  return value;
}

function workflowProgressFromObservation(
  observation: ControlWorkflowJobObservation,
): OperationProgress | undefined {
  const currentStepId = observation.currentStepId ?? observation.steps.at(-1)?.id;
  if (currentStepId === undefined && observation.stepCount === 0) return undefined;
  const current = safeProgressCount(observation.stepCount);
  const total = Math.max(current, 1);
  const terminal = WORKFLOW_JOB_TERMINALS.has(observation.kind);
  return Object.freeze({
    current,
    total,
    percent: terminal ? 100 : Math.min(99, Math.round((current / total) * 100)),
    ...(currentStepId === undefined ? {} : { stepId: currentStepId }),
    messageCode: `workflow.job.${observation.kind}`,
    evidenceRefs:
      currentStepId === undefined
        ? Object.freeze([])
        : Object.freeze([Object.freeze({ kind: 'job-step' as const, id: currentStepId })]),
  });
}
