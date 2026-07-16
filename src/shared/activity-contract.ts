import { z } from 'zod';

export const ACTIVITY_SCHEMA_VERSION = '1.0.0' as const;

export const ACTIVITY_MAX_ACTION_LENGTH = 128;
export const ACTIVITY_MAX_LABEL_LENGTH = 128;
export const ACTIVITY_MAX_TARGETS = 8;
export const ACTIVITY_MAX_SUMMARY_ITEMS = 16;
export const ACTIVITY_MAX_SUMMARY_KEY_LENGTH = 64;
export const ACTIVITY_MAX_EVIDENCE_REFS = 8;
export const ACTIVITY_MAX_SNAPSHOT_EVENTS = 5_000;
export const ACTIVITY_MAX_SNAPSHOT_OPERATIONS = 1_000;
export const ACTIVITY_MAX_SNAPSHOT_CALLS = 2_000;

const ACTIVITY_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u;

export const OperationRiskSchema = z.enum([
  'read-only',
  'state-affecting',
  'disruptive',
  'destructive-or-unknown',
]);
export type OperationRisk = z.infer<typeof OperationRiskSchema>;

export const ApprovalPolicySchema = z.enum(['none', 'notify', 'human-once']);
export type ApprovalPolicy = z.infer<typeof ApprovalPolicySchema>;

export const AuthorizationSourceSchema = z.enum(['none', 'human-grant', 'automation-policy']);
export type AuthorizationSource = z.infer<typeof AuthorizationSourceSchema>;

export const OperationPhaseSchema = z.enum([
  'requested',
  'awaiting-approval',
  'blocked',
  'queued',
  'running',
  'cancel-requested',
  'succeeded',
  'failed',
  'rejected',
  'denied',
  'expired',
  'superseded',
  'cancelled',
  'interrupted',
]);
export type OperationPhase = z.infer<typeof OperationPhaseSchema>;

export const CallAttemptPhaseSchema = z.enum([
  'received',
  'approval-required',
  'rejected',
  'started',
  'succeeded',
  'failed',
]);
export type CallAttemptPhase = z.infer<typeof CallAttemptPhaseSchema>;

export const ActivityFailureStageSchema = z.enum([
  'provider',
  'policy',
  'redaction',
  'schema',
  'reducer',
  'capacity',
  'response-construction',
  'response-serialization',
  'runtime-precondition',
  'listener',
  'ipc',
]);
export type ActivityFailureStage = z.infer<typeof ActivityFailureStageSchema>;

export const ActivitySurfaceSchema = z.enum([
  'runtime',
  'control-profile',
  'workflow',
  'debug',
  'terminal',
  'ui',
  'workspace',
]);
export type ActivitySurface = z.infer<typeof ActivitySurfaceSchema>;

export const ActivityIdSchema = z.string().min(1).max(128).regex(ACTIVITY_ID_PATTERN);
export type ActivityId = z.infer<typeof ActivityIdSchema>;

const SafeCodeSchema = z.string().min(1).max(128).regex(ACTIVITY_ID_PATTERN);
export type SafeCode = z.infer<typeof SafeCodeSchema>;

const SafeIntegerSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export type SafeInteger = z.infer<typeof SafeIntegerSchema>;

const SafeCode64Schema = SafeCodeSchema.max(64);
const TimestampSchema = z.string().datetime({ offset: true });
const DisplaySafeLabelSchema = z
  .string()
  .min(1)
  .max(ACTIVITY_MAX_LABEL_LENGTH)
  .refine(
    (value) =>
      value !== '.' && value !== '..' && !/^[A-Za-z]:/u.test(value) && !/[\/\\\p{Cc}]/u.test(value),
  );

export const OperationActorSchema = z
  .object({
    kind: z.enum(['agent', 'human', 'system']),
    channel: z.enum(['local-mcp', 'desktop', 'main']),
  })
  .strict()
  .readonly();
export type OperationActor = z.infer<typeof OperationActorSchema>;

export const OperationTargetRefSchema = z
  .object({
    kind: z.enum(['runtime', 'session', 'workspace', 'probe', 'file', 'ui', 'job']),
    id: ActivityIdSchema,
    label: DisplaySafeLabelSchema.optional(),
  })
  .strict()
  .readonly();
export type OperationTargetRef = z.infer<typeof OperationTargetRefSchema>;

export const EvidenceRefSchema = z
  .object({
    kind: z.enum(['transcript-cursor', 'job-step', 'artifact-digest']),
    id: ActivityIdSchema,
    cursorStart: SafeIntegerSchema.optional(),
    cursorEnd: SafeIntegerSchema.optional(),
  })
  .strict()
  .readonly();
export type EvidenceRef = z.infer<typeof EvidenceRefSchema>;

const DigestSchema = z
  .object({
    algorithm: z.literal('sha256'),
    basis: z.enum(['utf8', 'bytes']),
    hex: z.string().regex(/^[0-9a-f]{64}$/u),
  })
  .strict()
  .readonly();
export type Digest = z.infer<typeof DigestSchema>;

const ArgumentSummaryKeySchema = z.string().min(1).max(ACTIVITY_MAX_SUMMARY_KEY_LENGTH);

const IdentifierArgumentItemSchema = z
  .object({
    kind: z.literal('identifier'),
    key: ArgumentSummaryKeySchema,
    value: SafeCodeSchema,
  })
  .strict()
  .readonly();

const BasenameArgumentItemSchema = z
  .object({
    kind: z.literal('basename'),
    key: ArgumentSummaryKeySchema,
    value: DisplaySafeLabelSchema,
  })
  .strict()
  .readonly();

const NumberArgumentItemSchema = z
  .object({
    kind: z.literal('number'),
    key: ArgumentSummaryKeySchema,
    value: z.number().finite(),
  })
  .strict()
  .readonly();

const BooleanArgumentItemSchema = z
  .object({
    kind: z.literal('boolean'),
    key: ArgumentSummaryKeySchema,
    value: z.boolean(),
  })
  .strict()
  .readonly();

const ContentMetadataArgumentItemSchema = z
  .object({
    kind: z.literal('content-metadata'),
    key: ArgumentSummaryKeySchema,
    contentType: z.enum(['script', 'binary', 'firmware', 'screenshot', 'terminal', 'memory']),
    byteLength: SafeIntegerSchema,
    lineCount: SafeIntegerSchema.optional(),
    digest: DigestSchema.optional(),
  })
  .strict()
  .readonly();

const OmittedArgumentItemSchema = z
  .object({
    kind: z.literal('omitted'),
    key: ArgumentSummaryKeySchema,
    category: z.enum(['protected', 'unsupported', 'oversized']),
  })
  .strict()
  .readonly();

const ActivityArgumentItemSchema = z.discriminatedUnion('kind', [
  IdentifierArgumentItemSchema,
  BasenameArgumentItemSchema,
  NumberArgumentItemSchema,
  BooleanArgumentItemSchema,
  ContentMetadataArgumentItemSchema,
  OmittedArgumentItemSchema,
]);
export type ActivityArgumentItem = z.infer<typeof ActivityArgumentItemSchema>;

export const ActivityArgumentSummarySchema = z
  .object({
    fieldCount: SafeIntegerSchema,
    items: z.array(ActivityArgumentItemSchema).max(ACTIVITY_MAX_SUMMARY_ITEMS).readonly(),
  })
  .strict()
  .readonly();
export type ActivityArgumentSummary = z.infer<typeof ActivityArgumentSummarySchema>;

export const ActivitySafeErrorSchema = z
  .object({
    code: SafeCode64Schema,
    messageCode: SafeCodeSchema,
    stage: ActivityFailureStageSchema,
  })
  .strict()
  .readonly();
export type ActivitySafeError = z.infer<typeof ActivitySafeErrorSchema>;

export const OperationProgressSchema = z
  .object({
    current: SafeIntegerSchema,
    total: SafeIntegerSchema.positive(),
    percent: z.number().finite().min(0).max(100),
    stepId: SafeCode64Schema.optional(),
    messageCode: SafeCodeSchema.optional(),
    evidenceRefs: z.array(EvidenceRefSchema).max(ACTIVITY_MAX_EVIDENCE_REFS).readonly(),
  })
  .strict()
  .readonly();
export type OperationProgress = z.infer<typeof OperationProgressSchema>;

export const ActivityCursorSchema = z
  .object({
    runtimeId: ActivityIdSchema,
    sequence: SafeIntegerSchema,
  })
  .strict()
  .readonly();
export type ActivityCursor = z.infer<typeof ActivityCursorSchema>;

const ActivityCommonShape = {
  schemaVersion: z.literal(ACTIVITY_SCHEMA_VERSION),
  runtimeId: ActivityIdSchema,
  sequence: SafeIntegerSchema,
  eventId: ActivityIdSchema,
  timestamp: TimestampSchema,
  operationId: ActivityIdSchema,
  parentOperationId: ActivityIdSchema.optional(),
  actor: OperationActorSchema,
  surface: ActivitySurfaceSchema,
  action: SafeCodeSchema.max(ACTIVITY_MAX_ACTION_LENGTH),
  risk: OperationRiskSchema,
  approvalPolicy: ApprovalPolicySchema,
  authorizationSource: AuthorizationSourceSchema,
  clientAcknowledged: z.boolean().optional(),
  targets: z.array(OperationTargetRefSchema).min(1).max(ACTIVITY_MAX_TARGETS).readonly(),
  argumentSummary: ActivityArgumentSummarySchema.optional(),
  error: ActivitySafeErrorSchema.optional(),
} as const;

const OperationTransitionViewSchema = z
  .object({
    ...ActivityCommonShape,
    kind: z.literal('operation-transition'),
    operationPhase: OperationPhaseSchema,
  })
  .strict()
  .readonly();

const CallTransitionViewSchema = z
  .object({
    ...ActivityCommonShape,
    kind: z.literal('call-transition'),
    callId: ActivityIdSchema,
    callPhase: CallAttemptPhaseSchema,
  })
  .strict()
  .readonly();

const WorkflowMilestoneViewSchema = z
  .object({
    ...ActivityCommonShape,
    kind: z.literal('workflow-milestone'),
    progress: OperationProgressSchema,
  })
  .strict()
  .readonly();

export const ActivityEventViewSchema = z.discriminatedUnion('kind', [
  OperationTransitionViewSchema,
  CallTransitionViewSchema,
  WorkflowMilestoneViewSchema,
]);
export type ActivityEventView = z.infer<typeof ActivityEventViewSchema>;

export const OperationViewSchema = z
  .object({
    ...ActivityCommonShape,
    operationPhase: OperationPhaseSchema,
    updatedSequence: SafeIntegerSchema,
    progress: OperationProgressSchema.optional(),
  })
  .strict()
  .readonly();
export type OperationView = z.infer<typeof OperationViewSchema>;

export const CallAttemptViewSchema = z
  .object({
    ...ActivityCommonShape,
    callId: ActivityIdSchema,
    callPhase: CallAttemptPhaseSchema,
    updatedSequence: SafeIntegerSchema,
  })
  .strict()
  .readonly();
export type CallAttemptView = z.infer<typeof CallAttemptViewSchema>;

const ActivityLastFailureSchema = z
  .object({
    stage: ActivityFailureStageSchema,
    code: SafeCode64Schema,
    timestamp: TimestampSchema,
  })
  .strict()
  .readonly();

export const ActivityHealthSchema = z
  .object({
    captureFailureCount: SafeIntegerSchema,
    droppedEventCount: SafeIntegerSchema,
    evictedEventCount: SafeIntegerSchema,
    listenerFailureCount: SafeIntegerSchema,
    policyFailureCount: SafeIntegerSchema,
    incompleteLifecycleCount: SafeIntegerSchema,
    lastFailure: ActivityLastFailureSchema.optional(),
  })
  .strict()
  .readonly();
export type ActivityHealth = z.infer<typeof ActivityHealthSchema>;

export const ActivitySnapshotViewSchema = z
  .object({
    schemaVersion: z.literal(ACTIVITY_SCHEMA_VERSION),
    cursor: ActivityCursorSchema,
    oldestAvailable: ActivityCursorSchema.optional(),
    truncated: z.boolean(),
    resetRequired: z.boolean(),
    events: z.array(ActivityEventViewSchema).max(ACTIVITY_MAX_SNAPSHOT_EVENTS).readonly(),
    operations: z.array(OperationViewSchema).max(ACTIVITY_MAX_SNAPSHOT_OPERATIONS).readonly(),
    calls: z.array(CallAttemptViewSchema).max(ACTIVITY_MAX_SNAPSHOT_CALLS).readonly(),
    health: ActivityHealthSchema,
  })
  .strict()
  .readonly();
export type ActivitySnapshotView = z.infer<typeof ActivitySnapshotViewSchema>;

export const ActivityCursorRequestSchema = z
  .object({
    cursor: ActivityCursorSchema.optional(),
  })
  .strict()
  .readonly();
export type ActivityCursorRequest = z.infer<typeof ActivityCursorRequestSchema>;

export const ActivityUnsubscribeRequestSchema = z.object({}).strict().readonly();
export type ActivityUnsubscribeRequest = z.infer<typeof ActivityUnsubscribeRequestSchema>;

const ActivityFailureMessageSchema = z.enum([
  'Invalid activity request',
  'Invalid activity cursor',
  'Invalid activity payload',
]);

const ActivityFailureResultSchema = z
  .object({
    success: z.literal(false),
    error: z
      .object({
        code: SafeCode64Schema,
        message: ActivityFailureMessageSchema,
      })
      .strict()
      .readonly(),
  })
  .strict()
  .readonly();

const ActivitySnapshotSuccessResultSchema = z
  .object({
    success: z.literal(true),
    data: ActivitySnapshotViewSchema,
  })
  .strict()
  .readonly();

export const ActivitySnapshotResultSchema = z.discriminatedUnion('success', [
  ActivitySnapshotSuccessResultSchema,
  ActivityFailureResultSchema,
]);
export type ActivitySnapshotResult = z.infer<typeof ActivitySnapshotResultSchema>;

const ActivityUnsubscribeSuccessResultSchema = z
  .object({
    success: z.literal(true),
    data: z
      .object({ unsubscribed: z.literal(true) })
      .strict()
      .readonly(),
  })
  .strict()
  .readonly();

export const ActivityUnsubscribeResultSchema = z.discriminatedUnion('success', [
  ActivityUnsubscribeSuccessResultSchema,
  ActivityFailureResultSchema,
]);
export type ActivityUnsubscribeResult = z.infer<typeof ActivityUnsubscribeResultSchema>;
