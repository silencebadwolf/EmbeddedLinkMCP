import { z } from 'zod';

export const FIRST_SIGNAL_SCHEMA_VERSION = '1.0.0' as const;

export const FIRST_SIGNAL_MAX_TIMEOUT_MS = 60_000;
export const FIRST_SIGNAL_MAX_DIAGNOSTICS = 8;

const FIRST_SIGNAL_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u;

const FirstSignalIdSchema = z.string().min(1).max(128).regex(FIRST_SIGNAL_ID_PATTERN);
const SafeIntegerSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const PositiveIntegerSchema = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const TimestampSchema = z.string().datetime({ offset: true });

export const FirstSignalObservationStateSchema = z.enum([
  'waiting',
  'signal-detected',
  'silent',
  'closed',
  'errored',
  'stopped',
]);
export type FirstSignalObservationState = z.infer<typeof FirstSignalObservationStateSchema>;

export const FirstSignalClosedReasonSchema = z.enum([
  'session-closed',
  'transport-closed',
  'user-disconnect',
  'runtime-shutdown',
  'superseded',
]);
export type FirstSignalClosedReason = z.infer<typeof FirstSignalClosedReasonSchema>;

export const FirstSignalStopReasonSchema = z.enum([
  'user',
  'retry',
  'disconnect-and-edit',
  'back-to-session',
  'session-dispose',
  'runtime-shutdown',
]);
export type FirstSignalStopReason = z.infer<typeof FirstSignalStopReasonSchema>;

export const FirstSignalSafeErrorSchema = z
  .object({
    code: FirstSignalIdSchema,
    messageCode: FirstSignalIdSchema,
    stage: z.enum(['schema', 'ipc', 'preload', 'monitor', 'session', 'runtime']),
  })
  .strict()
  .readonly();
export type FirstSignalSafeError = z.infer<typeof FirstSignalSafeErrorSchema>;

export const FirstSignalObservationSchema = z
  .object({
    schemaVersion: z.literal(FIRST_SIGNAL_SCHEMA_VERSION),
    attemptId: FirstSignalIdSchema,
    clientAttemptKey: FirstSignalIdSchema,
    revision: PositiveIntegerSchema,
    sessionId: FirstSignalIdSchema,
    ownsSession: z.boolean(),
    baselineCursor: SafeIntegerSchema,
    state: FirstSignalObservationStateSchema,
    startedAt: TimestampSchema,
    updatedAt: TimestampSchema,
    timeoutMs: PositiveIntegerSchema.max(FIRST_SIGNAL_MAX_TIMEOUT_MS),
    silentSince: TimestampSchema.optional(),
    observedAt: TimestampSchema.optional(),
    observedSequence: PositiveIntegerSchema.optional(),
    closedReason: FirstSignalClosedReasonSchema.optional(),
    stopReason: FirstSignalStopReasonSchema.optional(),
    error: FirstSignalSafeErrorSchema.optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.state === 'signal-detected') {
      if (value.observedAt === undefined) {
        context.addIssue({
          code: 'custom',
          path: ['observedAt'],
          message: 'signal-detected requires observedAt',
        });
      }
      if (value.observedSequence === undefined) {
        context.addIssue({
          code: 'custom',
          path: ['observedSequence'],
          message: 'signal-detected requires observedSequence',
        });
      }
    }

    if (value.state === 'closed' && value.closedReason === undefined) {
      context.addIssue({
        code: 'custom',
        path: ['closedReason'],
        message: 'closed requires closedReason',
      });
    }

    if (value.state === 'stopped' && value.stopReason === undefined) {
      context.addIssue({
        code: 'custom',
        path: ['stopReason'],
        message: 'stopped requires stopReason',
      });
    }

    if (value.state === 'errored' && value.error === undefined) {
      context.addIssue({
        code: 'custom',
        path: ['error'],
        message: 'errored requires error',
      });
    }
  })
  .readonly();
export type FirstSignalObservation = z.infer<typeof FirstSignalObservationSchema>;

export const FirstSignalStartRequestSchema = z
  .object({
    schemaVersion: z.literal(FIRST_SIGNAL_SCHEMA_VERSION),
    clientAttemptKey: FirstSignalIdSchema,
    sessionId: FirstSignalIdSchema,
    ownsSession: z.boolean(),
    baselineCursor: SafeIntegerSchema,
    timeoutMs: PositiveIntegerSchema.max(FIRST_SIGNAL_MAX_TIMEOUT_MS),
  })
  .strict()
  .readonly();
export type FirstSignalStartRequest = z.infer<typeof FirstSignalStartRequestSchema>;

export const FirstSignalStatusRequestSchema = z
  .object({
    attemptId: FirstSignalIdSchema,
  })
  .strict()
  .readonly();
export type FirstSignalStatusRequest = z.infer<typeof FirstSignalStatusRequestSchema>;

export const FirstSignalStopRequestSchema = z
  .object({
    attemptId: FirstSignalIdSchema,
    reason: FirstSignalStopReasonSchema,
  })
  .strict()
  .readonly();
export type FirstSignalStopRequest = z.infer<typeof FirstSignalStopRequestSchema>;

export const FirstSignalSubscribeRequestSchema = z
  .object({
    attemptId: FirstSignalIdSchema.optional(),
    sinceRevision: SafeIntegerSchema.optional(),
  })
  .strict()
  .readonly();
export type FirstSignalSubscribeRequest = z.infer<typeof FirstSignalSubscribeRequestSchema>;

export const FirstSignalUnsubscribeRequestSchema = z.object({}).strict().readonly();
export type FirstSignalUnsubscribeRequest = z.infer<typeof FirstSignalUnsubscribeRequestSchema>;

export const FirstSignalEventSchema = z
  .object({
    schemaVersion: z.literal(FIRST_SIGNAL_SCHEMA_VERSION),
    observation: FirstSignalObservationSchema,
  })
  .strict()
  .readonly();
export type FirstSignalEvent = z.infer<typeof FirstSignalEventSchema>;

const FirstSignalFailureMessageSchema = z.enum([
  'Invalid first-signal request',
  'Invalid first-signal cursor',
  'Invalid first-signal payload',
  'First-signal request conflict',
  'First-signal observation not found',
]);

export const FirstSignalFailureResultSchema = z
  .object({
    success: z.literal(false),
    error: z
      .object({
        code: FirstSignalIdSchema,
        message: FirstSignalFailureMessageSchema,
      })
      .strict()
      .readonly(),
  })
  .strict()
  .readonly();
export type FirstSignalFailureResult = z.infer<typeof FirstSignalFailureResultSchema>;

const FirstSignalObservationSuccessResultSchema = z
  .object({
    success: z.literal(true),
    data: FirstSignalObservationSchema,
  })
  .strict()
  .readonly();

export const FirstSignalStartResultSchema = z.discriminatedUnion('success', [
  FirstSignalObservationSuccessResultSchema,
  FirstSignalFailureResultSchema,
]);
export type FirstSignalStartResult = z.infer<typeof FirstSignalStartResultSchema>;

export const FirstSignalStatusResultSchema = FirstSignalStartResultSchema;
export type FirstSignalStatusResult = z.infer<typeof FirstSignalStatusResultSchema>;

export const FirstSignalStopResultSchema = FirstSignalStartResultSchema;
export type FirstSignalStopResult = z.infer<typeof FirstSignalStopResultSchema>;
