import { z } from 'zod';
import { ActivityEventViewSchema, type ActivityEventView } from './activity-contract.js';

/** Durable audit 文件与 IPC DTO 的版本；迁移时必须新增版本而不是放宽旧 schema。 */
export const AUDIT_SCHEMA_VERSION = '1.0.0' as const;
/** 默认保留天数，产品决策冻结为 30 天。 */
export const AUDIT_DEFAULT_RETENTION_DAYS = 30;
/** 单个 JSONL 文件的默认上限，单位为字节（10 MiB）。 */
export const AUDIT_DEFAULT_MAX_FILE_BYTES = 10 * 1024 * 1024;
/** 启动恢复与导出状态的最大诊断条数。 */
export const AUDIT_MAX_DIAGNOSTICS = 16;
/** 单次恢复允许物化的最大 event 数，避免 renderer 邻接 I/O 无限增长。 */
export const AUDIT_DEFAULT_MAX_READ_EVENTS = 10_000;
/** 启动恢复允许读取的总字节预算，防止损坏/膨胀日志拖垮 Main。 */
export const AUDIT_DEFAULT_MAX_READ_BYTES = 16 * 1024 * 1024;

const DisplayFileNameSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/u);

export const AuditRecordEnvelopeSchema = z
  .object({
    schemaVersion: z.literal(AUDIT_SCHEMA_VERSION),
    recordType: z.literal('activity-event'),
    event: ActivityEventViewSchema,
  })
  .strict()
  .readonly();
export type AuditRecordEnvelope = z.infer<typeof AuditRecordEnvelopeSchema>;

export const AuditPathModeSchema = z.enum(['basename', 'full']);
export type AuditPathMode = z.infer<typeof AuditPathModeSchema>;

export const AuditFormatSchema = z.enum(['jsonl', 'json']);
export type AuditFormat = z.infer<typeof AuditFormatSchema>;

export const AuditWarningCodeSchema = z.enum([
  'trailing-line-recovered',
  'invalid-line-skipped',
  'retention-delete-failed',
  'append-failed',
  'export-failed',
  'clear-failed',
  'directory-failed',
]);
export type AuditWarningCode = z.infer<typeof AuditWarningCodeSchema>;

export const AuditWarningSchema = z
  .object({
    code: AuditWarningCodeSchema,
    count: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  })
  .strict()
  .readonly();
export type AuditWarning = z.infer<typeof AuditWarningSchema>;

export const AuditStoreStatusSchema = z
  .object({
    schemaVersion: z.literal(AUDIT_SCHEMA_VERSION),
    enabled: z.boolean(),
    retentionDays: z.number().int().nonnegative().max(3650),
    maxFileBytes: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    eventCount: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    fileCount: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    byteCount: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    warningCount: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    lastWarningCode: AuditWarningCodeSchema.optional(),
    warnings: z.array(AuditWarningSchema).max(AUDIT_MAX_DIAGNOSTICS).readonly(),
    windowsAclDefault: z.boolean(),
  })
  .strict()
  .readonly();
export type AuditStoreStatus = z.infer<typeof AuditStoreStatusSchema>;

export const AuditExportRequestSchema = z
  .object({
    format: AuditFormatSchema,
    pathMode: AuditPathModeSchema.default('basename'),
  })
  .strict()
  .readonly();
export type AuditExportRequest = z.input<typeof AuditExportRequestSchema>;

export const AuditExportResultSchema = z
  .object({
    schemaVersion: z.literal(AUDIT_SCHEMA_VERSION),
    fileName: DisplayFileNameSchema,
    format: AuditFormatSchema,
    pathMode: AuditPathModeSchema,
    eventCount: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    redacted: z.literal(true),
  })
  .strict()
  .readonly();
export type AuditExportResult = z.infer<typeof AuditExportResultSchema>;

export const AuditClearResultSchema = z
  .object({
    schemaVersion: z.literal(AUDIT_SCHEMA_VERSION),
    cleared: z.literal(true),
    deletedFileCount: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  })
  .strict()
  .readonly();
export type AuditClearResult = z.infer<typeof AuditClearResultSchema>;

export const AuditClearRequestSchema = z
  .object({ confirm: z.literal(true) })
  .strict()
  .readonly();
export type AuditClearRequest = z.infer<typeof AuditClearRequestSchema>;

export const AuditStatusResultSchema = z
  .object({
    status: AuditStoreStatusSchema,
  })
  .strict()
  .readonly();
export type AuditStatusResult = z.infer<typeof AuditStatusResultSchema>;

const AuditFailureResultSchema = z
  .object({
    success: z.literal(false),
    error: z
      .object({ code: z.string().min(1).max(128), message: z.string().min(1).max(256) })
      .strict()
      .readonly(),
  })
  .strict()
  .readonly();

export const AuditStatusResultEnvelopeSchema = z.discriminatedUnion('success', [
  z.object({ success: z.literal(true), data: AuditStatusResultSchema }).strict().readonly(),
  AuditFailureResultSchema,
]);
export const AuditExportResultEnvelopeSchema = z.discriminatedUnion('success', [
  z.object({ success: z.literal(true), data: AuditExportResultSchema }).strict().readonly(),
  AuditFailureResultSchema,
]);
export const AuditClearResultEnvelopeSchema = z.discriminatedUnion('success', [
  z.object({ success: z.literal(true), data: AuditClearResultSchema }).strict().readonly(),
  AuditFailureResultSchema,
]);

export function createAuditRecord(event: ActivityEventView): AuditRecordEnvelope {
  return AuditRecordEnvelopeSchema.parse({
    schemaVersion: AUDIT_SCHEMA_VERSION,
    recordType: 'activity-event',
    event,
  });
}
