import { Buffer } from 'node:buffer';
import { z } from 'zod';
import {
  ACTIVITY_MAX_ACTION_LENGTH,
  ACTIVITY_MAX_EVIDENCE_REFS,
  ACTIVITY_MAX_SUMMARY_ITEMS,
  ACTIVITY_MAX_SUMMARY_KEY_LENGTH,
  ACTIVITY_MAX_TARGETS,
  ACTIVITY_SCHEMA_VERSION,
  ActivityArgumentSummarySchema,
  ActivityEventViewSchema,
  ActivityFailureStageSchema,
  ActivityIdSchema,
  ActivitySafeErrorSchema,
  ActivitySurfaceSchema,
  ApprovalPolicySchema,
  CallAttemptPhaseSchema,
  OperationActorSchema,
  OperationPhaseSchema,
  OperationProgressSchema,
  OperationRiskSchema,
  OperationTargetRefSchema,
  type ActivityEventView,
} from '@linkterm/contracts/activity-contract';

const INTERNAL_SAFE_CODE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u;
const InternalSafeCodeSchema = z.string().min(1).max(128).regex(INTERNAL_SAFE_CODE_PATTERN);
const InternalSafeIntegerSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const InternalTimestampSchema = z.string().datetime({ offset: true });
const InternalDigestSchema = z
  .object({
    algorithm: z.literal('sha256'),
    basis: z.enum(['utf8', 'bytes']),
    hex: z.string().regex(/^[0-9a-f]{64}$/u),
  })
  .strict()
  .readonly();

const InternalArgumentDigestSchema = z
  .object({
    key: InternalSafeCodeSchema.max(ACTIVITY_MAX_SUMMARY_KEY_LENGTH),
    digest: InternalDigestSchema,
  })
  .strict()
  .readonly();

const RawFailureClassificationSchema = z
  .object({
    category: InternalSafeCodeSchema.max(64),
    retryable: z.boolean(),
  })
  .strict()
  .readonly();

const ActivityAccountingSchema = z
  .object({
    retainedByteLength: InternalSafeIntegerSchema,
    projectedByteLength: InternalSafeIntegerSchema,
    reducerByteLength: InternalSafeIntegerSchema,
  })
  .strict()
  .readonly();

const ActivityHealthReferenceSchema = z
  .object({
    stage: ActivityFailureStageSchema,
    code: InternalSafeCodeSchema.max(64),
  })
  .strict()
  .readonly();

const DraftCommonShape = {
  operationId: ActivityIdSchema,
  parentOperationId: ActivityIdSchema.optional(),
  actor: OperationActorSchema,
  surface: ActivitySurfaceSchema,
  action: InternalSafeCodeSchema.max(ACTIVITY_MAX_ACTION_LENGTH),
  risk: OperationRiskSchema,
  approvalPolicy: ApprovalPolicySchema,
  authorizationSource: z.literal('none'),
  clientAcknowledged: z.boolean().optional(),
  targets: z.array(OperationTargetRefSchema).min(1).max(ACTIVITY_MAX_TARGETS).readonly(),
  argumentSummary: ActivityArgumentSummarySchema.optional(),
  error: ActivitySafeErrorSchema.optional(),
  policyVersion: InternalSafeCodeSchema.optional(),
  argumentDigests: z
    .array(InternalArgumentDigestSchema)
    .max(ACTIVITY_MAX_SUMMARY_ITEMS)
    .readonly()
    .optional(),
  rawFailureClassification: RawFailureClassificationSchema.optional(),
} as const;

const OperationTransitionDraftSchema = z
  .object({
    ...DraftCommonShape,
    kind: z.literal('operation-transition'),
    operationPhase: OperationPhaseSchema,
  })
  .strict()
  .readonly();
export type OperationTransitionDraft = z.infer<typeof OperationTransitionDraftSchema>;

const CallTransitionDraftSchema = z
  .object({
    ...DraftCommonShape,
    kind: z.literal('call-transition'),
    callId: ActivityIdSchema,
    callPhase: CallAttemptPhaseSchema,
  })
  .strict()
  .readonly();
export type CallTransitionDraft = z.infer<typeof CallTransitionDraftSchema>;

const WorkflowMilestoneDraftSchema = z
  .object({
    ...DraftCommonShape,
    kind: z.literal('workflow-milestone'),
    progress: OperationProgressSchema,
  })
  .strict()
  .readonly();
export type WorkflowMilestoneDraft = z.infer<typeof WorkflowMilestoneDraftSchema>;

export type ActivityEventDraft =
  | OperationTransitionDraft
  | CallTransitionDraft
  | WorkflowMilestoneDraft;

export const ActivityEventDraftSchema: z.ZodType<ActivityEventDraft> = z.discriminatedUnion(
  'kind',
  [OperationTransitionDraftSchema, CallTransitionDraftSchema, WorkflowMilestoneDraftSchema],
);

const RetainedCommonShape = {
  schemaVersion: z.literal(ACTIVITY_SCHEMA_VERSION),
  runtimeId: ActivityIdSchema,
  sequence: InternalSafeIntegerSchema,
  eventId: ActivityIdSchema,
  timestamp: InternalTimestampSchema,
  operationId: ActivityIdSchema,
  parentOperationId: ActivityIdSchema.optional(),
  actor: OperationActorSchema,
  surface: ActivitySurfaceSchema,
  action: InternalSafeCodeSchema.max(ACTIVITY_MAX_ACTION_LENGTH),
  risk: OperationRiskSchema,
  approvalPolicy: ApprovalPolicySchema,
  authorizationSource: z.literal('none'),
  clientAcknowledged: z.boolean().optional(),
  targets: z.array(OperationTargetRefSchema).min(1).max(ACTIVITY_MAX_TARGETS).readonly(),
  argumentSummary: ActivityArgumentSummarySchema.optional(),
  error: ActivitySafeErrorSchema.optional(),
  policyVersion: InternalSafeCodeSchema.optional(),
  argumentDigests: z
    .array(InternalArgumentDigestSchema)
    .max(ACTIVITY_MAX_SUMMARY_ITEMS)
    .readonly()
    .optional(),
  rawFailureClassification: RawFailureClassificationSchema.optional(),
  accounting: ActivityAccountingSchema.optional(),
  healthReferences: z
    .array(ActivityHealthReferenceSchema)
    .max(ACTIVITY_MAX_EVIDENCE_REFS)
    .readonly()
    .optional(),
} as const;

const RetainedOperationTransitionSchema = z
  .object({
    ...RetainedCommonShape,
    kind: z.literal('operation-transition'),
    operationPhase: OperationPhaseSchema,
  })
  .strict()
  .readonly();
export type RetainedOperationTransition = z.infer<typeof RetainedOperationTransitionSchema>;

const RetainedCallTransitionSchema = z
  .object({
    ...RetainedCommonShape,
    kind: z.literal('call-transition'),
    callId: ActivityIdSchema,
    callPhase: CallAttemptPhaseSchema,
  })
  .strict()
  .readonly();
export type RetainedCallTransition = z.infer<typeof RetainedCallTransitionSchema>;

const RetainedWorkflowMilestoneSchema = z
  .object({
    ...RetainedCommonShape,
    kind: z.literal('workflow-milestone'),
    progress: OperationProgressSchema,
  })
  .strict()
  .readonly();
export type RetainedWorkflowMilestone = z.infer<typeof RetainedWorkflowMilestoneSchema>;

export type RetainedActivityEvent =
  | RetainedOperationTransition
  | RetainedCallTransition
  | RetainedWorkflowMilestone;

export const RetainedActivityEventSchema: z.ZodType<RetainedActivityEvent> = z.discriminatedUnion(
  'kind',
  [
    RetainedOperationTransitionSchema,
    RetainedCallTransitionSchema,
    RetainedWorkflowMilestoneSchema,
  ],
);

function projectCommonFields(event: RetainedActivityEvent): Record<string, unknown> {
  const projected: Record<string, unknown> = {
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
  };

  if (event.parentOperationId !== undefined) {
    projected.parentOperationId = event.parentOperationId;
  }
  if (event.clientAcknowledged !== undefined) {
    projected.clientAcknowledged = event.clientAcknowledged;
  }
  if (event.argumentSummary !== undefined) {
    projected.argumentSummary = event.argumentSummary;
  }
  if (event.error !== undefined) {
    projected.error = event.error;
  }

  return projected;
}

export function toActivityEventView(event: RetainedActivityEvent): ActivityEventView {
  const projected = projectCommonFields(event);

  switch (event.kind) {
    case 'operation-transition':
      projected.kind = 'operation-transition';
      projected.operationPhase = event.operationPhase;
      break;
    case 'call-transition':
      projected.kind = 'call-transition';
      projected.callId = event.callId;
      projected.callPhase = event.callPhase;
      break;
    case 'workflow-milestone':
      projected.kind = 'workflow-milestone';
      projected.progress = event.progress;
      break;
  }

  return ActivityEventViewSchema.parse(projected);
}

export function projectedEventByteLength(event: RetainedActivityEvent): number {
  const view = toActivityEventView(event);
  return Buffer.byteLength(JSON.stringify(view), 'utf8');
}
