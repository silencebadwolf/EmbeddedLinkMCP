import { describe, expect, it } from 'vitest';
import {
  ACTIVITY_MAX_ACTION_LENGTH,
  ACTIVITY_MAX_EVIDENCE_REFS,
  ACTIVITY_MAX_LABEL_LENGTH,
  ACTIVITY_MAX_SNAPSHOT_CALLS,
  ACTIVITY_MAX_SNAPSHOT_EVENTS,
  ACTIVITY_MAX_SNAPSHOT_OPERATIONS,
  ACTIVITY_MAX_SUMMARY_ITEMS,
  ACTIVITY_MAX_SUMMARY_KEY_LENGTH,
  ACTIVITY_MAX_TARGETS,
  ACTIVITY_SCHEMA_VERSION,
  ActivityArgumentSummarySchema,
  ActivityCursorRequestSchema,
  ActivityCursorSchema,
  ActivityEventViewSchema,
  ActivityFailureStageSchema,
  ActivityHealthSchema,
  ActivityIdSchema,
  ActivitySafeErrorSchema,
  ActivitySnapshotResultSchema,
  ActivitySnapshotViewSchema,
  ActivitySurfaceSchema,
  ActivityUnsubscribeRequestSchema,
  ActivityUnsubscribeResultSchema,
  ApprovalPolicySchema,
  CallAttemptPhaseSchema,
  CallAttemptViewSchema,
  EvidenceRefSchema,
  OperationActorSchema,
  OperationPhaseSchema,
  OperationProgressSchema,
  OperationRiskSchema,
  OperationTargetRefSchema,
  OperationViewSchema,
} from '@/shared/activity-contract.js';

const VALID_EVENT_COMMON = {
  schemaVersion: '1.0.0',
  runtimeId: 'runtime_1',
  sequence: 1,
  eventId: 'event_1',
  timestamp: '2026-07-12T00:00:00.000Z',
  operationId: 'operation_1',
  actor: { kind: 'agent', channel: 'local-mcp' },
  surface: 'runtime',
  action: 'get_app_status',
  risk: 'read-only',
  approvalPolicy: 'none',
  authorizationSource: 'none',
  targets: [{ kind: 'runtime', id: 'runtime_1', label: 'current-runtime' }],
} as const;

const ZERO_HEALTH = {
  captureFailureCount: 0,
  droppedEventCount: 0,
  evictedEventCount: 0,
  listenerFailureCount: 0,
  policyFailureCount: 0,
  incompleteLifecycleCount: 0,
} as const;

function operationEvent() {
  return {
    ...VALID_EVENT_COMMON,
    kind: 'operation-transition' as const,
    operationPhase: 'requested' as const,
  };
}

function callEvent() {
  return {
    ...VALID_EVENT_COMMON,
    kind: 'call-transition' as const,
    callId: 'call_1',
    callPhase: 'started' as const,
  };
}

function workflowEvent() {
  return {
    ...VALID_EVENT_COMMON,
    kind: 'workflow-milestone' as const,
    progress: {
      current: 1,
      total: 2,
      percent: 50,
      stepId: 'step_1',
      messageCode: 'workflow.running',
      evidenceRefs: [
        {
          kind: 'job-step' as const,
          id: 'job_1',
          cursorStart: 0,
          cursorEnd: 1,
        },
      ],
    },
  };
}

function operationView() {
  return {
    ...VALID_EVENT_COMMON,
    operationPhase: 'running' as const,
    updatedSequence: 1,
    progress: workflowEvent().progress,
  };
}

function callView() {
  return {
    ...VALID_EVENT_COMMON,
    callId: 'call_1',
    callPhase: 'started' as const,
    updatedSequence: 1,
  };
}

function emptySnapshot() {
  return {
    schemaVersion: ACTIVITY_SCHEMA_VERSION,
    cursor: { runtimeId: 'runtime_1', sequence: 0 },
    truncated: false,
    resetRequired: false,
    events: [],
    operations: [],
    calls: [],
    health: ZERO_HEALTH,
  };
}

function expectRejected(
  schema: { safeParse(value: unknown): { success: boolean } },
  value: unknown,
): void {
  expect(schema.safeParse(value).success).toBe(false);
}

describe('activity display contract', () => {
  it('exports the frozen schema version, enum values, and fixed bounds', () => {
    expect(ACTIVITY_SCHEMA_VERSION).toBe('1.0.0');
    expect(OperationRiskSchema.options).toEqual([
      'read-only',
      'state-affecting',
      'disruptive',
      'destructive-or-unknown',
    ]);
    expect(ApprovalPolicySchema.options).toEqual(['none', 'notify', 'human-once']);
    expect(OperationPhaseSchema.options).toEqual([
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
    expect(CallAttemptPhaseSchema.options).toEqual([
      'received',
      'approval-required',
      'rejected',
      'started',
      'succeeded',
      'failed',
    ]);
    expect(ActivityFailureStageSchema.options).toEqual([
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
    expect(ActivitySurfaceSchema.options).toEqual([
      'runtime',
      'control-profile',
      'workflow',
      'debug',
      'terminal',
      'ui',
      'workspace',
    ]);
    expect({
      ACTIVITY_MAX_ACTION_LENGTH,
      ACTIVITY_MAX_LABEL_LENGTH,
      ACTIVITY_MAX_TARGETS,
      ACTIVITY_MAX_SUMMARY_ITEMS,
      ACTIVITY_MAX_SUMMARY_KEY_LENGTH,
      ACTIVITY_MAX_EVIDENCE_REFS,
      ACTIVITY_MAX_SNAPSHOT_EVENTS,
      ACTIVITY_MAX_SNAPSHOT_OPERATIONS,
      ACTIVITY_MAX_SNAPSHOT_CALLS,
    }).toEqual({
      ACTIVITY_MAX_ACTION_LENGTH: 128,
      ACTIVITY_MAX_LABEL_LENGTH: 128,
      ACTIVITY_MAX_TARGETS: 8,
      ACTIVITY_MAX_SUMMARY_ITEMS: 16,
      ACTIVITY_MAX_SUMMARY_KEY_LENGTH: 64,
      ACTIVITY_MAX_EVIDENCE_REFS: 8,
      ACTIVITY_MAX_SNAPSHOT_EVENTS: 5_000,
      ACTIVITY_MAX_SNAPSHOT_OPERATIONS: 1_000,
      ACTIVITY_MAX_SNAPSHOT_CALLS: 2_000,
    });
  });

  it('parses an operation transition in the requested phase', () => {
    expect(ActivityEventViewSchema.parse(operationEvent())).toEqual(operationEvent());
  });

  it('rejects operationPhase on a call transition with call identity and phase', () => {
    expectRejected(ActivityEventViewSchema, {
      ...callEvent(),
      operationPhase: 'running',
    });
  });

  it('rejects operationPhase on a workflow milestone with progress', () => {
    expectRejected(ActivityEventViewSchema, {
      ...workflowEvent(),
      operationPhase: 'running',
    });
  });

  it('accepts exactly the three closed event variants', () => {
    expect(ActivityEventViewSchema.parse(operationEvent()).kind).toBe('operation-transition');
    expect(ActivityEventViewSchema.parse(callEvent()).kind).toBe('call-transition');
    expect(ActivityEventViewSchema.parse(workflowEvent()).kind).toBe('workflow-milestone');
    expectRejected(ActivityEventViewSchema, { ...operationEvent(), kind: 'diagnostic' });
  });

  it.each([
    'schemaVersion',
    'runtimeId',
    'sequence',
    'eventId',
    'timestamp',
    'operationId',
    'actor',
    'surface',
    'action',
    'risk',
    'approvalPolicy',
    'authorizationSource',
    'targets',
  ] as const)('rejects an event missing mandatory common metadata %s', (field) => {
    const candidate: Record<string, unknown> = structuredClone(operationEvent());
    delete candidate[field];
    expectRejected(ActivityEventViewSchema, candidate);
  });

  it('enforces non-empty bounded display-safe targets', () => {
    expectRejected(ActivityEventViewSchema, { ...operationEvent(), targets: [] });
    expect(
      ActivityEventViewSchema.safeParse({
        ...operationEvent(),
        targets: Array.from({ length: ACTIVITY_MAX_TARGETS }, (_, index) => ({
          kind: 'runtime',
          id: `runtime_${index}`,
        })),
      }).success,
    ).toBe(true);
    expectRejected(ActivityEventViewSchema, {
      ...operationEvent(),
      targets: Array.from({ length: ACTIVITY_MAX_TARGETS + 1 }, (_, index) => ({
        kind: 'runtime',
        id: `runtime_${index}`,
      })),
    });
  });

  it('rejects path-like and control-character display labels while allowing safe display text', () => {
    const unsafeLabels = [
      String.raw`C:\Users\Admin\secret.pem`,
      String.raw`C:secret.pem`,
      '/home/alice/.ssh/id_rsa',
      String.raw`\\server\share\secret.bin`,
      'nested/file.bin',
      String.raw`nested\file.bin`,
      '.',
      '..',
      'secret\u0000.pem',
      'secret\n.pem',
      'secret\u007f.pem',
    ];

    for (const value of unsafeLabels) {
      expectRejected(OperationTargetRefSchema, {
        kind: 'file',
        id: 'file_1',
        label: value,
      });
      expectRejected(ActivityArgumentSummarySchema, {
        fieldCount: 1,
        items: [{ kind: 'basename', key: 'file', value }],
      });
    }

    expect(
      OperationTargetRefSchema.parse({ kind: 'runtime', id: 'runtime_1', label: '当前运行时' }),
    ).toEqual({ kind: 'runtime', id: 'runtime_1', label: '当前运行时' });
    for (const value of ['firmware image.bin', '.config']) {
      expect(
        ActivityArgumentSummarySchema.safeParse({
          fieldCount: 1,
          items: [{ kind: 'basename', key: 'file', value }],
        }).success,
      ).toBe(true);
    }
  });

  it('validates closed actors, targets, cursors, evidence, errors, and summaries', () => {
    expect(OperationActorSchema.parse(VALID_EVENT_COMMON.actor)).toEqual(VALID_EVENT_COMMON.actor);
    expect(OperationTargetRefSchema.parse(VALID_EVENT_COMMON.targets[0])).toEqual(
      VALID_EVENT_COMMON.targets[0],
    );
    expect(ActivityCursorSchema.parse({ runtimeId: 'runtime_1', sequence: 0 })).toEqual({
      runtimeId: 'runtime_1',
      sequence: 0,
    });
    expect(
      EvidenceRefSchema.parse({
        kind: 'transcript-cursor',
        id: 'session_1',
        cursorStart: 0,
        cursorEnd: 8,
      }),
    ).toEqual({
      kind: 'transcript-cursor',
      id: 'session_1',
      cursorStart: 0,
      cursorEnd: 8,
    });
    expect(
      ActivitySafeErrorSchema.parse({
        code: 'PROVIDER_FAILED',
        messageCode: 'operation.provider_failed',
        stage: 'provider',
      }),
    ).toEqual({
      code: 'PROVIDER_FAILED',
      messageCode: 'operation.provider_failed',
      stage: 'provider',
    });

    const items = [
      { kind: 'identifier', key: 'ports[0]', value: 'session_1' },
      { kind: 'basename', key: 'file', value: 'firmware image.bin' },
      { kind: 'number', key: 'baudRate', value: 115_200 },
      { kind: 'boolean', key: 'verify', value: true },
      {
        kind: 'content-metadata',
        key: 'script',
        contentType: 'script',
        byteLength: 42,
        lineCount: 3,
        digest: { algorithm: 'sha256', basis: 'utf8', hex: 'a'.repeat(64) },
      },
      { kind: 'omitted', key: 'password', category: 'protected' },
    ];

    for (const item of items) {
      expect(
        ActivityArgumentSummarySchema.safeParse({ fieldCount: 1, items: [item] }).success,
      ).toBe(true);
    }
    expect(ActivityArgumentSummarySchema.parse({ fieldCount: items.length, items })).toMatchObject({
      fieldCount: items.length,
    });
  });

  it('parses active Operation and CallAttempt views', () => {
    expect(OperationViewSchema.parse(operationView())).toMatchObject({
      operationId: 'operation_1',
      operationPhase: 'running',
      updatedSequence: 1,
    });
    expect(CallAttemptViewSchema.parse(callView())).toMatchObject({
      operationId: 'operation_1',
      callId: 'call_1',
      callPhase: 'started',
      updatedSequence: 1,
    });
  });

  it('parses empty, current, and reset-required snapshots', () => {
    const empty = ActivitySnapshotViewSchema.parse(emptySnapshot());
    expect(empty).toEqual(emptySnapshot());
    expect(empty).not.toHaveProperty('oldestAvailable');

    const current = ActivitySnapshotViewSchema.parse({
      schemaVersion: ACTIVITY_SCHEMA_VERSION,
      cursor: { runtimeId: 'runtime_1', sequence: 1 },
      oldestAvailable: { runtimeId: 'runtime_1', sequence: 1 },
      truncated: false,
      resetRequired: false,
      events: [operationEvent()],
      operations: [operationView()],
      calls: [callView()],
      health: {
        ...ZERO_HEALTH,
        lastFailure: {
          stage: 'listener',
          code: 'LISTENER_FAILED',
          timestamp: '2026-07-12T00:00:01.000+00:00',
        },
      },
    });
    expect(current.cursor.sequence).toBe(1);
    expect(current.events).toHaveLength(1);
    expect(current.operations).toHaveLength(1);
    expect(current.calls).toHaveLength(1);

    const reset = ActivitySnapshotViewSchema.parse({
      ...emptySnapshot(),
      cursor: { runtimeId: 'runtime_2', sequence: 4 },
      oldestAvailable: { runtimeId: 'runtime_2', sequence: 2 },
      truncated: true,
      resetRequired: true,
    });
    expect(reset).toMatchObject({
      cursor: { runtimeId: 'runtime_2', sequence: 4 },
      oldestAvailable: { runtimeId: 'runtime_2', sequence: 2 },
      truncated: true,
      resetRequired: true,
    });
  });

  it('rejects malformed, unsafe-future, and undeclared cursor request shapes', () => {
    for (const sequence of [
      -1,
      0.5,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.MAX_SAFE_INTEGER + 1,
    ]) {
      expectRejected(ActivityCursorSchema, { runtimeId: 'runtime_1', sequence });
    }
    expectRejected(ActivityCursorSchema, { runtimeId: 'bad runtime', sequence: 1 });
    expectRejected(ActivityCursorSchema, { runtimeId: 'runtime_1', sequence: 1, future: true });
    expect(ActivityCursorRequestSchema.parse({})).toEqual({});
    expect(
      ActivityCursorRequestSchema.parse({ cursor: { runtimeId: 'runtime_1', sequence: 1 } }),
    ).toEqual({ cursor: { runtimeId: 'runtime_1', sequence: 1 } });
    expectRejected(ActivityCursorRequestSchema, {
      cursor: { runtimeId: 'runtime_1', sequence: 1 },
      extra: 1,
    });
    expectRejected(ActivityCursorRequestSchema, {
      cursor: { runtimeId: 'runtime_1', sequence: 1, extra: 1 },
    });
  });

  it('rejects unknown keys at every nested event layer', () => {
    const summaryItem = {
      kind: 'content-metadata' as const,
      key: 'script',
      contentType: 'script' as const,
      byteLength: 42,
      digest: { algorithm: 'sha256' as const, basis: 'utf8' as const, hex: 'a'.repeat(64) },
    };
    const richEvent = {
      ...operationEvent(),
      actor: { ...VALID_EVENT_COMMON.actor },
      targets: [{ ...VALID_EVENT_COMMON.targets[0] }],
      argumentSummary: { fieldCount: 1, items: [summaryItem] },
      error: { code: 'FAILED', messageCode: 'operation.failed', stage: 'provider' as const },
    };

    const invalidEvents = [
      { ...richEvent, extra: true },
      { ...richEvent, actor: { ...richEvent.actor, extra: true } },
      { ...richEvent, targets: [{ ...richEvent.targets[0], extra: true }] },
      { ...richEvent, argumentSummary: { ...richEvent.argumentSummary, extra: true } },
      {
        ...richEvent,
        argumentSummary: {
          ...richEvent.argumentSummary,
          items: [{ ...summaryItem, extra: true }],
        },
      },
      {
        ...richEvent,
        argumentSummary: {
          ...richEvent.argumentSummary,
          items: [{ ...summaryItem, digest: { ...summaryItem.digest, extra: true } }],
        },
      },
      { ...richEvent, error: { ...richEvent.error, rawMessage: 'secret' } },
      { ...workflowEvent(), progress: { ...workflowEvent().progress, extra: true } },
      {
        ...workflowEvent(),
        progress: {
          ...workflowEvent().progress,
          evidenceRefs: [{ ...workflowEvent().progress.evidenceRefs[0], extra: true }],
        },
      },
    ];

    for (const candidate of invalidEvents) {
      expectRejected(ActivityEventViewSchema, candidate);
    }
  });

  it('rejects unknown keys at every snapshot and result layer', () => {
    const base = {
      schemaVersion: ACTIVITY_SCHEMA_VERSION,
      cursor: { runtimeId: 'runtime_1', sequence: 1 },
      oldestAvailable: { runtimeId: 'runtime_1', sequence: 1 },
      truncated: false,
      resetRequired: false,
      events: [operationEvent()],
      operations: [operationView()],
      calls: [callView()],
      health: {
        ...ZERO_HEALTH,
        lastFailure: {
          stage: 'schema' as const,
          code: 'SCHEMA_FAILED',
          timestamp: '2026-07-12T00:00:01.000Z',
        },
      },
    };

    const invalidSnapshots = [
      { ...base, extra: true },
      { ...base, cursor: { ...base.cursor, extra: true } },
      { ...base, oldestAvailable: { ...base.oldestAvailable, extra: true } },
      { ...base, events: [{ ...base.events[0], extra: true }] },
      { ...base, operations: [{ ...base.operations[0], extra: true }] },
      { ...base, calls: [{ ...base.calls[0], extra: true }] },
      { ...base, health: { ...base.health, extra: true } },
      {
        ...base,
        health: { ...base.health, lastFailure: { ...base.health.lastFailure, extra: true } },
      },
    ];
    for (const candidate of invalidSnapshots) {
      expectRejected(ActivitySnapshotViewSchema, candidate);
    }

    expectRejected(ActivitySnapshotResultSchema, {
      success: true,
      data: { ...emptySnapshot(), extra: true },
    });
    expectRejected(ActivitySnapshotResultSchema, {
      success: false,
      error: { code: 'INVALID_CURSOR', message: 'Invalid activity cursor', extra: true },
    });
    expectRejected(ActivitySnapshotResultSchema, {
      success: false,
      error: { code: 'INVALID_CURSOR', message: 'Invalid activity cursor' },
      extra: true,
    });
  });

  it('rejects excessive lengths, depths, and unsupported values', () => {
    expectRejected(ActivityIdSchema, '');
    expectRejected(ActivityIdSchema, 'bad id');
    expectRejected(ActivityIdSchema, 'a'.repeat(129));
    expectRejected(ActivityEventViewSchema, { ...operationEvent(), action: 'bad code' });
    expectRejected(OperationActorSchema, { kind: 'service', channel: 'local-mcp' });
    expectRejected(OperationActorSchema, { kind: 'agent', channel: 'http' });
    expectRejected(OperationTargetRefSchema, {
      kind: 'runtime',
      id: 'runtime_1',
      label: 'l'.repeat(ACTIVITY_MAX_LABEL_LENGTH + 1),
    });
    expectRejected(ActivityEventViewSchema, {
      ...operationEvent(),
      action: 'a'.repeat(ACTIVITY_MAX_ACTION_LENGTH + 1),
    });
    expectRejected(ActivityEventViewSchema, {
      ...operationEvent(),
      timestamp: '2026-07-12T00:00:00.000',
    });

    const invalidItems = [
      {
        kind: 'identifier',
        key: 'k'.repeat(ACTIVITY_MAX_SUMMARY_KEY_LENGTH + 1),
        value: 'value_1',
      },
      { kind: 'identifier', key: 'id', value: { nested: { too: { deep: true } } } },
      {
        kind: 'basename',
        key: 'file',
        value: 'f'.repeat(ACTIVITY_MAX_LABEL_LENGTH + 1),
      },
      { kind: 'number', key: 'n', value: Number.NaN },
      { kind: 'number', key: 'n', value: Number.POSITIVE_INFINITY },
      { kind: 'content-metadata', key: 'body', contentType: 'raw-text', byteLength: 1 },
      { kind: 'content-metadata', key: 'body', contentType: 'terminal', byteLength: -1 },
      {
        kind: 'content-metadata',
        key: 'body',
        contentType: 'terminal',
        byteLength: 1,
        digest: { algorithm: 'sha1', basis: 'utf8', hex: 'a'.repeat(64) },
      },
      {
        kind: 'content-metadata',
        key: 'body',
        contentType: 'terminal',
        byteLength: 1,
        digest: { algorithm: 'sha256', basis: 'utf8', hex: 'A'.repeat(64) },
      },
      { kind: 'omitted', key: 'unknown', category: 'raw' },
      { kind: 'raw', key: 'raw', value: 'secret' },
    ];
    for (const item of invalidItems) {
      expectRejected(ActivityArgumentSummarySchema, { fieldCount: 1, items: [item] });
    }
    expectRejected(ActivityArgumentSummarySchema, {
      fieldCount: ACTIVITY_MAX_SUMMARY_ITEMS + 1,
      items: Array.from({ length: ACTIVITY_MAX_SUMMARY_ITEMS + 1 }, (_, index) => ({
        kind: 'boolean',
        key: `flag_${index}`,
        value: true,
      })),
    });

    for (const progress of [
      { ...workflowEvent().progress, current: -1 },
      { ...workflowEvent().progress, total: 0 },
      { ...workflowEvent().progress, percent: 101 },
      { ...workflowEvent().progress, percent: Number.POSITIVE_INFINITY },
      {
        ...workflowEvent().progress,
        evidenceRefs: Array.from({ length: ACTIVITY_MAX_EVIDENCE_REFS + 1 }, (_, index) => ({
          kind: 'job-step',
          id: `job_${index}`,
        })),
      },
    ]) {
      expectRejected(OperationProgressSchema, progress);
    }
    expectRejected(EvidenceRefSchema, {
      kind: 'job-step',
      id: 'job_1',
      cursorStart: 0.5,
    });
  });

  it('enforces snapshot event, Operation, and CallAttempt bounds', () => {
    const base = emptySnapshot();
    expectRejected(ActivitySnapshotViewSchema, {
      ...base,
      events: Array(ACTIVITY_MAX_SNAPSHOT_EVENTS + 1).fill(operationEvent()),
    });
    expectRejected(ActivitySnapshotViewSchema, {
      ...base,
      operations: Array(ACTIVITY_MAX_SNAPSHOT_OPERATIONS + 1).fill(operationView()),
    });
    expectRejected(ActivitySnapshotViewSchema, {
      ...base,
      calls: Array(ACTIVITY_MAX_SNAPSHOT_CALLS + 1).fill(callView()),
    });
  });

  it('deep-freezes parsed events and detaches them from mutable input', () => {
    const input = {
      ...workflowEvent(),
      actor: { ...VALID_EVENT_COMMON.actor },
      targets: [{ ...VALID_EVENT_COMMON.targets[0] }],
      argumentSummary: {
        fieldCount: 1,
        items: [
          {
            kind: 'content-metadata' as const,
            key: 'script',
            contentType: 'script' as const,
            byteLength: 42,
            lineCount: 3,
            digest: { algorithm: 'sha256' as const, basis: 'utf8' as const, hex: 'b'.repeat(64) },
          },
        ],
      },
      error: { code: 'FAILED', messageCode: 'operation.failed', stage: 'provider' as const },
      progress: {
        ...workflowEvent().progress,
        evidenceRefs: [{ ...workflowEvent().progress.evidenceRefs[0] }],
      },
    };
    const parsed = ActivityEventViewSchema.parse(input);
    if (parsed.kind !== 'workflow-milestone' || parsed.argumentSummary === undefined) {
      throw new Error('Expected workflow milestone with argument summary');
    }

    expect(Object.isFrozen(parsed)).toBe(true);
    expect(Object.isFrozen(parsed.actor)).toBe(true);
    expect(Object.isFrozen(parsed.targets)).toBe(true);
    expect(Object.isFrozen(parsed.targets[0])).toBe(true);
    expect(Object.isFrozen(parsed.argumentSummary)).toBe(true);
    expect(Object.isFrozen(parsed.argumentSummary.items)).toBe(true);
    expect(Object.isFrozen(parsed.argumentSummary.items[0])).toBe(true);
    expect(Object.isFrozen(parsed.progress)).toBe(true);
    expect(Object.isFrozen(parsed.progress.evidenceRefs)).toBe(true);
    expect(Object.isFrozen(parsed.progress.evidenceRefs[0])).toBe(true);
    expect(Object.isFrozen(parsed.error)).toBe(true);

    const serialized = JSON.stringify(parsed);
    expect(() => {
      (parsed.actor as { kind: string }).kind = 'human';
    }).toThrow(TypeError);
    expect(() => {
      (parsed.targets as unknown as Array<unknown>).push({ kind: 'file', id: 'file_1' });
    }).toThrow(TypeError);
    expect(() => {
      (parsed.targets[0] as { label: string }).label = 'changed';
    }).toThrow(TypeError);
    expect(() => {
      (parsed.argumentSummary?.items as unknown as Array<unknown>).push({
        kind: 'omitted',
        key: 'secret',
        category: 'protected',
      });
    }).toThrow(TypeError);
    expect(() => {
      (parsed.progress as { percent: number }).percent = 100;
    }).toThrow(TypeError);
    expect(() => {
      (parsed.progress.evidenceRefs as unknown as Array<unknown>).push({
        kind: 'job-step',
        id: 'job_2',
      });
    }).toThrow(TypeError);
    expect(JSON.stringify(parsed)).toBe(serialized);

    input.actor.kind = 'human';
    input.targets[0].label = 'source-mutated';
    input.argumentSummary.items[0].byteLength = 9_999;
    input.progress.evidenceRefs[0].cursorEnd = 9_999;
    expect(JSON.stringify(parsed)).toBe(serialized);
  });

  it('freezes health, snapshots, requests, and success/failure result envelopes', () => {
    const health = ActivityHealthSchema.parse({
      ...ZERO_HEALTH,
      lastFailure: {
        stage: 'ipc',
        code: 'IPC_FAILED',
        timestamp: '2026-07-12T00:00:01.000Z',
      },
    });
    expect(Object.isFrozen(health)).toBe(true);
    expect(Object.isFrozen(health.lastFailure)).toBe(true);

    const snapshot = ActivitySnapshotViewSchema.parse(emptySnapshot());
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.cursor)).toBe(true);
    expect(Object.isFrozen(snapshot.events)).toBe(true);
    expect(Object.isFrozen(snapshot.operations)).toBe(true);
    expect(Object.isFrozen(snapshot.calls)).toBe(true);
    expect(Object.isFrozen(snapshot.health)).toBe(true);

    const request = ActivityCursorRequestSchema.parse({
      cursor: { runtimeId: 'runtime_1', sequence: 0 },
    });
    expect(Object.isFrozen(request)).toBe(true);
    expect(Object.isFrozen(request.cursor)).toBe(true);
    expect(Object.isFrozen(ActivityUnsubscribeRequestSchema.parse({}))).toBe(true);
    expectRejected(ActivityUnsubscribeRequestSchema, { subscriberId: 'private' });

    const snapshotSuccess = ActivitySnapshotResultSchema.parse({
      success: true,
      data: emptySnapshot(),
    });
    const snapshotFailure = ActivitySnapshotResultSchema.parse({
      success: false,
      error: { code: 'INVALID_CURSOR', message: 'Invalid activity cursor' },
    });
    const unsubscribeSuccess = ActivityUnsubscribeResultSchema.parse({
      success: true,
      data: { unsubscribed: true },
    });
    const unsubscribeFailure = ActivityUnsubscribeResultSchema.parse({
      success: false,
      error: { code: 'INVALID_ACTIVITY_REQUEST', message: 'Invalid activity request' },
    });
    expect(Object.isFrozen(snapshotSuccess)).toBe(true);
    expect(Object.isFrozen(snapshotSuccess.data)).toBe(true);
    expect(Object.isFrozen(snapshotFailure)).toBe(true);
    expect(Object.isFrozen(snapshotFailure.error)).toBe(true);
    expect(Object.isFrozen(unsubscribeSuccess)).toBe(true);
    expect(Object.isFrozen(unsubscribeSuccess.data)).toBe(true);
    expect(Object.isFrozen(unsubscribeFailure.error)).toBe(true);

    expectRejected(ActivityUnsubscribeResultSchema, {
      success: true,
      data: { unsubscribed: true, extra: true },
    });
    expectRejected(ActivityUnsubscribeResultSchema, {
      success: true,
      data: { unsubscribed: false },
    });
  });

  it('accepts only fixed display-safe failure messages in activity result envelopes', () => {
    const resultSchemas = [ActivitySnapshotResultSchema, ActivityUnsubscribeResultSchema];
    const safeMessages = [
      'Invalid activity request',
      'Invalid activity cursor',
      'Invalid activity payload',
    ];

    for (const schema of resultSchemas) {
      for (const message of safeMessages) {
        expect(
          schema.safeParse({
            success: false,
            error: { code: 'INVALID_ACTIVITY_REQUEST', message },
          }).success,
        ).toBe(true);
      }
      expectRejected(schema, {
        success: false,
        error: {
          code: 'INVALID_ACTIVITY_REQUEST',
          message: 'token=supersecret /home/alice/private',
        },
      });
      expectRejected(schema, {
        success: false,
        error: { code: 'INVALID_ACTIVITY_REQUEST', message: 'Unexpected activity failure' },
      });
    }
  });
});
