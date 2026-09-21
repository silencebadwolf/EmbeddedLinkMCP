import { z } from 'zod';

export const READINESS_SCHEMA_VERSION = '1.0.0' as const;

export const READINESS_MAX_LABEL_LENGTH = 128;
export const READINESS_MAX_PARAMS = 12;
export const READINESS_MAX_EVIDENCE_REFS = 8;
export const READINESS_MAX_CHECKS = 64;
export const READINESS_MAX_CANDIDATES = 128;
export const READINESS_MAX_RECENT_ITEMS = 32;
export const READINESS_MAX_DIAGNOSTICS = 32;
export const READINESS_MAX_COMPENSATION_SUMMARIES = 16;
export const READINESS_MAX_PROFILE_SUGGESTIONS = 16;

const READINESS_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u;
const READINESS_HASH_PREFIX_PATTERN = /^[a-f0-9]{8,64}$/u;
const SECRET_PARAM_KEY_PATTERN = /(?:token|secret|password|credential|auth|private)/iu;

export const SafeReadinessCodeSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(READINESS_ID_PATTERN);
export type SafeReadinessCode = z.infer<typeof SafeReadinessCodeSchema>;

export const SafeReadinessLabelSchema = z
  .string()
  .min(1)
  .max(READINESS_MAX_LABEL_LENGTH)
  .refine(
    (value) =>
      value !== '.' && value !== '..' && !/^[A-Za-z]:/u.test(value) && !/[\/\\\p{Cc}]/u.test(value),
  );
export type SafeReadinessLabel = z.infer<typeof SafeReadinessLabelSchema>;

const SafeIntegerSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const TimestampSchema = z.string().datetime({ offset: true });

const ReadinessParamSchema = z
  .object({
    key: SafeReadinessCodeSchema.refine((value) => !SECRET_PARAM_KEY_PATTERN.test(value)),
    value: SafeReadinessLabelSchema,
  })
  .strict()
  .readonly();
export type ReadinessParam = z.infer<typeof ReadinessParamSchema>;

export const ReadinessStatusSchema = z.enum([
  'unknown',
  'checking',
  'ready',
  'action-required',
  'blocked',
  'unavailable',
]);
export type ReadinessStatus = z.infer<typeof ReadinessStatusSchema>;

export const ReadinessScopeSchema = z.enum([
  'runtime',
  'workspace',
  'serial',
  'jlink',
  'firmware',
  'rtt',
  'profile',
  'session',
  'agent',
]);
export type ReadinessScope = z.infer<typeof ReadinessScopeSchema>;

export const ReadinessSeveritySchema = z.enum(['info', 'warning', 'error']);
export type ReadinessSeverity = z.infer<typeof ReadinessSeveritySchema>;

export const ReadinessEvidenceSchema = z
  .object({
    source: z.enum([
      'live-discovery',
      'workspace-profile',
      'control-profile',
      'saved-record',
      'runtime',
      'session',
      'agent-integration',
      'preference',
      'manual',
      'jlink-backend',
      'probe-detect',
      'device-catalog',
      'firmware-metadata',
      'rtt-config',
    ]),
    summaryCode: SafeReadinessCodeSchema,
    params: z.array(ReadinessParamSchema).max(READINESS_MAX_PARAMS).readonly().optional(),
  })
  .strict()
  .readonly();
export type ReadinessEvidence = z.infer<typeof ReadinessEvidenceSchema>;

export const ReadinessActionSchema = z
  .object({
    kind: z.enum([
      'refresh',
      'manual-entry',
      'advanced-connection',
      'copy-diagnostics',
      'open-existing-session',
      'review-details',
      'choose-profile',
      'choose-firmware',
      'edit-target',
      'review-download-plan',
      'open-rtt-log-session',
      'diagnose',
    ]),
    code: SafeReadinessCodeSchema,
    enabled: z.boolean().optional(),
    disabledReasonCode: SafeReadinessCodeSchema.optional(),
  })
  .strict()
  .readonly();
export type ReadinessAction = z.infer<typeof ReadinessActionSchema>;

export const ReadinessCheckSchema = z
  .object({
    id: SafeReadinessCodeSchema,
    scope: ReadinessScopeSchema,
    status: ReadinessStatusSchema,
    severity: ReadinessSeveritySchema,
    summaryCode: SafeReadinessCodeSchema,
    evidence: z.array(ReadinessEvidenceSchema).max(READINESS_MAX_EVIDENCE_REFS).readonly(),
    recommendedActions: z.array(ReadinessActionSchema).max(READINESS_MAX_PARAMS).readonly(),
    checkedAt: TimestampSchema,
  })
  .strict()
  .readonly();
export type ReadinessCheck = z.infer<typeof ReadinessCheckSchema>;

export const ReadinessDiagnosticSchema = z
  .object({
    code: SafeReadinessCodeSchema,
    severity: ReadinessSeveritySchema,
    checkedAt: TimestampSchema,
  })
  .strict()
  .readonly();
export type ReadinessDiagnostic = z.infer<typeof ReadinessDiagnosticSchema>;

const SerialSettingsSchema = z
  .object({
    portLabel: SafeReadinessLabelSchema,
    baudRate: z.number().int().positive().max(12_000_000),
    dataBits: z.number().int().min(5).max(8),
    stopBits: z.union([z.literal(1), z.literal(1.5), z.literal(2)]),
    parity: z.enum(['none', 'even', 'odd', 'mark', 'space']),
  })
  .strict()
  .readonly();
export type SerialSettings = z.infer<typeof SerialSettingsSchema>;

const JLinkInterfaceSchema = z.enum(['swd', 'jtag', 'unknown']);

const JLinkCandidateSchema = z
  .object({
    probeLabel: SafeReadinessLabelSchema,
    targetLabel: SafeReadinessLabelSchema.optional(),
    interface: JLinkInterfaceSchema.optional(),
    speedKHz: z.number().int().positive().max(100_000).optional(),
  })
  .strict()
  .readonly();
export type JLinkCandidate = z.infer<typeof JLinkCandidateSchema>;

export const DeviceCandidateSchema = z
  .object({
    id: SafeReadinessCodeSchema,
    kind: z.enum(['serial', 'jlink', 'saved-profile', 'reusable-session', 'manual']),
    label: SafeReadinessLabelSchema,
    confidence: z.enum(['exact', 'likely', 'unknown']),
    requiresUserConfirmation: z.boolean(),
    evidence: z.array(ReadinessEvidenceSchema).max(READINESS_MAX_EVIDENCE_REFS).readonly(),
    serial: SerialSettingsSchema.optional(),
    jlink: JLinkCandidateSchema.optional(),
  })
  .strict()
  .readonly();
export type DeviceCandidate = z.infer<typeof DeviceCandidateSchema>;

const DraftParameterSourceSchema = z.enum([
  'live-discovery',
  'saved-profile',
  'workspace-profile',
  'control-profile',
  'device-catalog',
  'manual',
  'default',
  'reusable-session',
  'request',
]);

const NumberDraftParameterSchema = z
  .object({
    value: z.number().finite(),
    source: DraftParameterSourceSchema,
  })
  .strict()
  .readonly();

const ParityDraftParameterSchema = z
  .object({
    value: z.enum(['none', 'even', 'odd', 'mark', 'space']),
    source: DraftParameterSourceSchema,
  })
  .strict()
  .readonly();

export const SerialConnectionDraftSchema = z
  .object({
    schemaVersion: z.literal(READINESS_SCHEMA_VERSION),
    draftId: SafeReadinessCodeSchema,
    source: z.enum(['live-discovery', 'saved-profile', 'manual', 'reusable-session']),
    candidateId: SafeReadinessCodeSchema.optional(),
    candidateFingerprint: SafeReadinessCodeSchema.optional(),
    portLabel: SafeReadinessLabelSchema.optional(),
    parameters: z
      .object({
        baudRate: NumberDraftParameterSchema.refine((value) => value.value > 0 && value.value <= 12_000_000),
        dataBits: NumberDraftParameterSchema.refine(
          (value) => Number.isInteger(value.value) && value.value >= 5 && value.value <= 8,
        ),
        stopBits: NumberDraftParameterSchema.refine((value) =>
          [1, 1.5, 2].includes(value.value),
        ),
        parity: ParityDraftParameterSchema,
      })
      .strict()
      .readonly(),
    sideEffects: z
      .object({
        reservesPort: z.literal(true),
        sendsPayloadOnConnect: z.literal(false),
        controlLineBehaviorCode: SafeReadinessCodeSchema.optional(),
        mayResetBoard: z.boolean().optional(),
      })
      .strict()
      .readonly(),
    validation: z
      .object({
        status: z.enum(['ready', 'incomplete', 'conflict']),
        reasons: z.array(SafeReadinessCodeSchema).max(READINESS_MAX_PARAMS).readonly(),
      })
      .strict()
      .readonly(),
  })
  .strict()
  .readonly();
export type SerialConnectionDraft = z.infer<typeof SerialConnectionDraftSchema>;

const JLinkRttSourceSchema = z.enum([
  'live-discovery',
  'workspace-profile',
  'control-profile',
  'device-catalog',
  'manual',
  'default',
  'request',
]);

const HashSha256PrefixSchema = z.string().regex(READINESS_HASH_PREFIX_PATTERN);

const FirmwareFormatSchema = z.enum(['bin', 'hex', 'elf', 'unknown']);

const JLinkRttProfileRefSchema = z
  .object({
    id: SafeReadinessCodeSchema,
    label: SafeReadinessLabelSchema,
    revision: SafeIntegerSchema,
  })
  .strict()
  .readonly();

const JLinkRttTargetDraftSchema = z
  .object({
    targetLabel: SafeReadinessLabelSchema,
    interface: JLinkInterfaceSchema,
    speedKHz: z.number().int().positive().max(100_000),
    source: JLinkRttSourceSchema,
  })
  .strict()
  .readonly();

const JLinkRttFirmwareDraftSchema = z
  .object({
    displayName: SafeReadinessLabelSchema,
    hashSha256Prefix: HashSha256PrefixSchema.optional(),
    byteLength: SafeIntegerSchema,
    format: FirmwareFormatSchema,
    baseAddress: SafeIntegerSchema,
    verify: z.boolean(),
    source: JLinkRttSourceSchema,
  })
  .strict()
  .readonly();

const JLinkRttObservationDraftSchema = z
  .object({
    channelIndex: SafeIntegerSchema,
    maxBytes: z.number().int().positive().max(1_048_576),
    timeoutMs: z.number().int().positive().max(120_000),
    markers: z.array(SafeReadinessLabelSchema).max(READINESS_MAX_PARAMS).readonly(),
    source: JLinkRttSourceSchema,
  })
  .strict()
  .readonly();

export const JLinkRttDownloadObserveDraftSchema = z
  .object({
    schemaVersion: z.literal(READINESS_SCHEMA_VERSION),
    draftId: SafeReadinessCodeSchema,
    source: JLinkRttSourceSchema,
    candidateId: SafeReadinessCodeSchema.optional(),
    workspaceLabel: SafeReadinessLabelSchema.optional(),
    profile: JLinkRttProfileRefSchema.optional(),
    target: JLinkRttTargetDraftSchema,
    firmware: JLinkRttFirmwareDraftSchema,
    rtt: JLinkRttObservationDraftSchema.optional(),
    observationMode: z.enum(['rtt', 'serial', 'serial-and-rtt']),
    sideEffects: z
      .object({
        connectProbe: z.boolean(),
        flashFirmware: z.boolean(),
        resetTarget: z.boolean(),
        startsGdbServer: z.boolean(),
        connectsRtt: z.boolean(),
      })
      .strict()
      .readonly(),
    validation: z
      .object({
        status: z.enum(['ready', 'incomplete', 'conflict']),
        reasons: z.array(SafeReadinessCodeSchema).max(READINESS_MAX_PARAMS).readonly(),
      })
      .strict()
      .readonly(),
  })
  .strict()
  .readonly();
export type JLinkRttDownloadObserveDraft = z.infer<typeof JLinkRttDownloadObserveDraftSchema>;

const FirmwareSummarySchema = z
  .object({
    displayName: SafeReadinessLabelSchema,
    hashSha256Prefix: HashSha256PrefixSchema.optional(),
    byteLength: SafeIntegerSchema,
  })
  .strict()
  .readonly();

const CompensationEligibilitySchema = z
  .object({
    status: z.enum(['available', 'disabled', 'hidden']),
    reasonCode: SafeReadinessCodeSchema.optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.status !== 'available' && value.reasonCode === undefined) {
      context.addIssue({
        code: 'custom',
        path: ['reasonCode'],
        message: 'disabled or hidden compensation summaries require reasonCode',
      });
    }
  })
  .readonly();

export const CompensationCandidateSummarySchema = z
  .object({
    schemaVersion: z.literal(READINESS_SCHEMA_VERSION),
    candidateId: SafeReadinessCodeSchema,
    targetLabel: SafeReadinessLabelSchema,
    firmware: FirmwareSummarySchema,
    createdAt: TimestampSchema,
    expiresAt: TimestampSchema.optional(),
    eligibility: CompensationEligibilitySchema,
    actionCode: SafeReadinessCodeSchema.optional(),
  })
  .strict()
  .readonly();
export type CompensationCandidateSummary = z.infer<typeof CompensationCandidateSummarySchema>;

const ProfileSuggestionFieldSchema = z
  .object({
    code: SafeReadinessCodeSchema,
    label: SafeReadinessLabelSchema,
  })
  .strict()
  .readonly();

export const ProfileSuggestionSummarySchema = z
  .object({
    schemaVersion: z.literal(READINESS_SCHEMA_VERSION),
    suggestionId: SafeReadinessCodeSchema,
    profileLabel: SafeReadinessLabelSchema,
    provenance: z.enum(['verified-jlink-rtt-success']),
    fields: z.array(ProfileSuggestionFieldSchema).max(READINESS_MAX_PARAMS).readonly(),
    saveActionCode: SafeReadinessCodeSchema,
    skipActionCode: SafeReadinessCodeSchema,
  })
  .strict()
  .readonly();
export type ProfileSuggestionSummary = z.infer<typeof ProfileSuggestionSummarySchema>;

const ReusableSessionSchema = z
  .object({
    id: SafeReadinessCodeSchema,
    label: SafeReadinessLabelSchema,
    kind: z.enum(['serial', 'local-shell', 'ssh', 'rtt-log']),
  })
  .strict()
  .readonly();
export type ReusableSession = z.infer<typeof ReusableSessionSchema>;

const ReusableProfileSchema = z
  .object({
    id: SafeReadinessCodeSchema,
    label: SafeReadinessLabelSchema,
    kind: z.enum(['control-profile', 'connection-profile']),
  })
  .strict()
  .readonly();
export type ReusableProfile = z.infer<typeof ReusableProfileSchema>;

export const RuntimeReadinessSnapshotSchema = z
  .object({
    schemaVersion: z.literal(READINESS_SCHEMA_VERSION),
    snapshotId: SafeReadinessCodeSchema,
    generation: SafeIntegerSchema,
    status: ReadinessStatusSchema,
    generatedAt: TimestampSchema,
    checks: z.array(ReadinessCheckSchema).max(READINESS_MAX_CHECKS).readonly(),
    deviceCandidates: z.array(DeviceCandidateSchema).max(READINESS_MAX_CANDIDATES).readonly(),
    reusableSessions: z.array(ReusableSessionSchema).max(READINESS_MAX_RECENT_ITEMS).readonly(),
    reusableProfiles: z.array(ReusableProfileSchema).max(READINESS_MAX_RECENT_ITEMS).readonly(),
    blockers: z.array(SafeReadinessCodeSchema).max(READINESS_MAX_PARAMS).readonly(),
    diagnostics: z.array(ReadinessDiagnosticSchema).max(READINESS_MAX_DIAGNOSTICS).readonly(),
    compensationCandidates: z
      .array(CompensationCandidateSummarySchema)
      .max(READINESS_MAX_COMPENSATION_SUMMARIES)
      .readonly()
      .optional(),
    profileSuggestions: z
      .array(ProfileSuggestionSummarySchema)
      .max(READINESS_MAX_PROFILE_SUGGESTIONS)
      .readonly()
      .optional(),
  })
  .strict()
  .readonly();
export type RuntimeReadinessSnapshot = z.infer<typeof RuntimeReadinessSnapshotSchema>;

const RecentWorkspaceSchema = z
  .object({
    id: SafeReadinessCodeSchema,
    label: SafeReadinessLabelSchema,
  })
  .strict()
  .readonly();

export const ReadinessPreferencesSchema = z
  .object({
    schemaVersion: z.literal(READINESS_SCHEMA_VERSION),
    recentWorkspaces: z.array(RecentWorkspaceSchema).max(READINESS_MAX_RECENT_ITEMS).readonly(),
    recentProfiles: z.array(ReusableProfileSchema).max(READINESS_MAX_RECENT_ITEMS).readonly(),
    dismissedHints: z.array(SafeReadinessCodeSchema).max(READINESS_MAX_RECENT_ITEMS).readonly(),
  })
  .strict()
  .readonly();
export type ReadinessPreferences = z.infer<typeof ReadinessPreferencesSchema>;

export const ReadinessEventSchema = z
  .object({
    schemaVersion: z.literal(READINESS_SCHEMA_VERSION),
    snapshot: RuntimeReadinessSnapshotSchema,
  })
  .strict()
  .readonly();
export type ReadinessEvent = z.infer<typeof ReadinessEventSchema>;

const ReadinessFailureMessageSchema = z.enum([
  'Invalid readiness request',
  'Invalid readiness cursor',
  'Invalid readiness payload',
]);

export const ReadinessFailureResultSchema = z
  .object({
    success: z.literal(false),
    error: z
      .object({
        code: SafeReadinessCodeSchema,
        message: ReadinessFailureMessageSchema,
      })
      .strict()
      .readonly(),
  })
  .strict()
  .readonly();
export type ReadinessFailureResult = z.infer<typeof ReadinessFailureResultSchema>;

const ReadinessSuccessResultSchema = z
  .object({
    success: z.literal(true),
    data: RuntimeReadinessSnapshotSchema,
  })
  .strict()
  .readonly();

export const ReadinessRefreshResultSchema = z.discriminatedUnion('success', [
  ReadinessSuccessResultSchema,
  ReadinessFailureResultSchema,
]);
export type ReadinessRefreshResult = z.infer<typeof ReadinessRefreshResultSchema>;
