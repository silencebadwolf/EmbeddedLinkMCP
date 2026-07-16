import { describe, expect, it } from 'vitest';
import {
  AuditClearRequestSchema,
  AuditExportRequestSchema,
  AuditRecordEnvelopeSchema,
  AuditStoreStatusSchema,
} from '../../../src/shared/audit-contract.js';

const safeEvent = {
  schemaVersion: '1.0.0',
  kind: 'operation-transition',
  runtimeId: 'runtime_1',
  sequence: 1,
  eventId: 'event_1',
  timestamp: '2026-07-15T00:00:00.000Z',
  operationId: 'operation_1',
  actor: { kind: 'agent', channel: 'local-mcp' },
  surface: 'runtime',
  action: 'get_app_status',
  risk: 'read-only',
  approvalPolicy: 'none',
  authorizationSource: 'none',
  targets: [{ kind: 'runtime', id: 'runtime_1', label: 'current-runtime' }],
  operationPhase: 'succeeded',
} as const;

describe('audit contract', () => {
  it('accepts only the strict safe envelope and rejects internal fields', () => {
    expect(
      AuditRecordEnvelopeSchema.safeParse({
        schemaVersion: '1.0.0',
        recordType: 'activity-event',
        event: safeEvent,
      }).success,
    ).toBe(true);
    expect(
      AuditRecordEnvelopeSchema.safeParse({
        schemaVersion: '1.0.0',
        recordType: 'activity-event',
        event: { ...safeEvent, principalId: 'secret-principal' },
      }).success,
    ).toBe(false);
  });

  it('requires explicit clear confirmation and normalizes export defaults', () => {
    expect(AuditClearRequestSchema.safeParse({}).success).toBe(false);
    expect(AuditClearRequestSchema.safeParse({ confirm: true }).success).toBe(true);
    expect(AuditExportRequestSchema.parse({ format: 'jsonl' })).toEqual({
      format: 'jsonl',
      pathMode: 'basename',
    });
  });

  it('bounds status diagnostics and rejects an absolute path in status', () => {
    const status = AuditStoreStatusSchema.safeParse({
      schemaVersion: '1.0.0',
      enabled: true,
      retentionDays: 30,
      maxFileBytes: 10 * 1024 * 1024,
      eventCount: 0,
      fileCount: 0,
      byteCount: 0,
      warningCount: 0,
      warnings: [],
      windowsAclDefault: true,
    });
    expect(status.success).toBe(true);
    expect(AuditStoreStatusSchema.safeParse({ ...status.data, directory: 'C:\\secret' }).success).toBe(false);
  });
});
