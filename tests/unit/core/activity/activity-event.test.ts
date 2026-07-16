import { Buffer } from 'node:buffer';
import { describe, expect, it } from 'vitest';
import * as activityApi from '@/core/activity/index.js';
import {
  ActivityEventDraftSchema,
  RetainedActivityEventSchema,
  projectedEventByteLength,
  toActivityEventView,
  type RetainedActivityEvent,
} from '@/core/activity/index.js';
import { ACTIVITY_SCHEMA_VERSION, ActivityEventViewSchema } from '@/shared/activity-contract.js';

const DRAFT_COMMON = {
  operationId: 'operation_1',
  actor: { kind: 'agent', channel: 'local-mcp' },
  surface: 'runtime',
  action: 'get_app_status',
  risk: 'read-only',
  approvalPolicy: 'none',
  authorizationSource: 'none',
  targets: [{ kind: 'runtime', id: 'runtime_1', label: 'current-runtime' }],
  argumentSummary: {
    fieldCount: 2,
    items: [
      { kind: 'identifier', key: 'sessionId', value: 'session_1' },
      {
        kind: 'content-metadata',
        key: 'script',
        contentType: 'script',
        byteLength: 42,
        lineCount: 3,
        digest: { algorithm: 'sha256', basis: 'utf8', hex: 'b'.repeat(64) },
      },
    ],
  },
  policyVersion: 'internal-policy-secret-v9',
  argumentDigests: [
    {
      key: 'private.payload',
      digest: { algorithm: 'sha256', basis: 'bytes', hex: 'a'.repeat(64) },
    },
  ],
  rawFailureClassification: {
    category: 'internal-provider-secret',
    retryable: false,
  },
} as const;

const RETAINED_COMMON = {
  ...DRAFT_COMMON,
  schemaVersion: '1.0.0',
  runtimeId: 'runtime_1',
  sequence: 1,
  eventId: 'event_1',
  timestamp: '2026-07-12T00:00:00.000Z',
  accounting: {
    retainedByteLength: 987_654_321,
    projectedByteLength: 876_543_210,
    reducerByteLength: 765_432_109,
  },
  healthReferences: [
    {
      stage: 'schema',
      code: 'internal-health-secret',
    },
  ],
} as const;

function draftOperation() {
  return {
    ...DRAFT_COMMON,
    kind: 'operation-transition' as const,
    operationPhase: 'requested' as const,
  };
}

function draftCall() {
  return {
    ...DRAFT_COMMON,
    kind: 'call-transition' as const,
    callId: 'call_1',
    callPhase: 'received' as const,
  };
}

function draftWorkflow() {
  return {
    ...DRAFT_COMMON,
    kind: 'workflow-milestone' as const,
    progress: {
      current: 1,
      total: 4,
      percent: 25,
      stepId: 'step_1',
      messageCode: 'workflow.running',
      evidenceRefs: [{ kind: 'job-step' as const, id: 'job_1', cursorStart: 0, cursorEnd: 1 }],
    },
  };
}

function retainedOperation() {
  return {
    ...RETAINED_COMMON,
    kind: 'operation-transition' as const,
    operationPhase: 'requested' as const,
  };
}

function retainedCall() {
  return {
    ...RETAINED_COMMON,
    kind: 'call-transition' as const,
    callId: 'call_1',
    callPhase: 'started' as const,
  };
}

function retainedWorkflow() {
  return {
    ...RETAINED_COMMON,
    kind: 'workflow-milestone' as const,
    progress: {
      current: 1,
      total: 4,
      percent: 25,
      stepId: 'step_1',
      messageCode: 'workflow.running',
      evidenceRefs: [{ kind: 'job-step' as const, id: 'job_1', cursorStart: 0, cursorEnd: 1 }],
    },
  };
}

describe('internal activity events', () => {
  it('keeps the activity index export surface narrow', () => {
    expect(Object.keys(activityApi).sort()).toEqual([
      'ActivityEventDraftSchema',
      'RetainedActivityEventSchema',
      'projectedEventByteLength',
      'toActivityEventView',
    ]);
  });

  it('validates and freezes all three strict draft variants', () => {
    for (const draft of [draftOperation(), draftCall(), draftWorkflow()]) {
      const parsed = ActivityEventDraftSchema.parse(draft);
      expect(Object.isFrozen(parsed)).toBe(true);
      expect(Object.isFrozen(parsed.actor)).toBe(true);
      expect(Object.isFrozen(parsed.targets)).toBe(true);
      expect(Object.isFrozen(parsed.targets[0])).toBe(true);
      expect(Object.isFrozen(parsed.argumentDigests)).toBe(true);
      expect(Object.isFrozen(parsed.argumentDigests?.[0])).toBe(true);
    }
    expect(
      ActivityEventDraftSchema.safeParse({ ...draftCall(), operationPhase: 'running' }).success,
    ).toBe(false);
    expect(
      ActivityEventDraftSchema.safeParse({ ...draftWorkflow(), operationPhase: 'running' }).success,
    ).toBe(false);
    expect(
      ActivityEventDraftSchema.safeParse({ ...draftOperation(), runtimeId: 'producer-spoof' })
        .success,
    ).toBe(false);
  });

  it('validates and freezes all three strict retained variants', () => {
    for (const retained of [retainedOperation(), retainedCall(), retainedWorkflow()]) {
      const parsed = RetainedActivityEventSchema.parse(retained);
      expect(Object.isFrozen(parsed)).toBe(true);
      expect(Object.isFrozen(parsed.accounting)).toBe(true);
      expect(Object.isFrozen(parsed.healthReferences)).toBe(true);
      expect(Object.isFrozen(parsed.healthReferences?.[0])).toBe(true);
    }
    expect(
      RetainedActivityEventSchema.safeParse({ ...retainedCall(), operationPhase: 'running' })
        .success,
    ).toBe(false);
    expect(
      RetainedActivityEventSchema.safeParse({ ...retainedWorkflow(), operationPhase: 'running' })
        .success,
    ).toBe(false);
    expect(
      RetainedActivityEventSchema.safeParse({ ...retainedOperation(), extra: 'private' }).success,
    ).toBe(false);
  });
});

describe('activity event projection', () => {
  it('projects each retained variant through the strict display schema', () => {
    const operation = toActivityEventView(RetainedActivityEventSchema.parse(retainedOperation()));
    const call = toActivityEventView(RetainedActivityEventSchema.parse(retainedCall()));
    const workflow = toActivityEventView(RetainedActivityEventSchema.parse(retainedWorkflow()));

    expect(operation).toMatchObject({
      kind: 'operation-transition',
      schemaVersion: ACTIVITY_SCHEMA_VERSION,
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
      operationPhase: 'requested',
    });
    expect(call).toMatchObject({ kind: 'call-transition', callId: 'call_1', callPhase: 'started' });
    expect(call).not.toHaveProperty('operationPhase');
    expect(workflow).toMatchObject({
      kind: 'workflow-milestone',
      progress: { current: 1, total: 4, percent: 25 },
    });
    expect(workflow).not.toHaveProperty('operationPhase');
    expect(ActivityEventViewSchema.safeParse(operation).success).toBe(true);
    expect(ActivityEventViewSchema.safeParse(call).success).toBe(true);
    expect(ActivityEventViewSchema.safeParse(workflow).success).toBe(true);
  });

  it('allowlists fields and omits every internal fixture value from serialized output', () => {
    const parsed = RetainedActivityEventSchema.parse(retainedWorkflow());
    const withUnknownInternal = {
      ...parsed,
      rawPrivateHandle: 'internal-undeclared-handle-secret',
    } as unknown as RetainedActivityEvent;
    const serialized = JSON.stringify(toActivityEventView(withUnknownInternal));

    for (const internalValue of [
      'internal-policy-secret-v9',
      'private.payload',
      'a'.repeat(64),
      'internal-provider-secret',
      '987654321',
      '876543210',
      '765432109',
      'internal-health-secret',
      'internal-undeclared-handle-secret',
    ]) {
      expect(serialized).not.toContain(internalValue);
    }
    expect(serialized).not.toContain('policyVersion');
    expect(serialized).not.toContain('argumentDigests');
    expect(serialized).not.toContain('rawFailureClassification');
    expect(serialized).not.toContain('accounting');
    expect(serialized).not.toContain('healthReferences');
    expect(serialized).toContain('b'.repeat(64));
  });

  it('returns a detached deeply frozen view that cannot be changed through nested aliases', () => {
    const mutable = structuredClone(retainedWorkflow()) as unknown as RetainedActivityEvent;
    const view = toActivityEventView(mutable);
    if (view.kind !== 'workflow-milestone' || view.argumentSummary === undefined) {
      throw new Error('Expected workflow milestone with summary');
    }

    expect(Object.isFrozen(view)).toBe(true);
    expect(Object.isFrozen(view.actor)).toBe(true);
    expect(Object.isFrozen(view.targets)).toBe(true);
    expect(Object.isFrozen(view.targets[0])).toBe(true);
    expect(Object.isFrozen(view.argumentSummary)).toBe(true);
    expect(Object.isFrozen(view.argumentSummary.items)).toBe(true);
    expect(Object.isFrozen(view.progress)).toBe(true);
    expect(Object.isFrozen(view.progress.evidenceRefs)).toBe(true);

    const before = JSON.stringify(view);
    (mutable.actor as { kind: 'agent' | 'human' | 'system' }).kind = 'human';
    (
      mutable.targets as unknown as Array<{ kind: 'runtime'; id: string; label?: string }>
    )[0].label = 'source-mutated';
    if (mutable.kind === 'workflow-milestone') {
      (mutable.progress as { percent: number }).percent = 100;
      (mutable.progress.evidenceRefs as unknown as Array<unknown>).push({
        kind: 'job-step',
        id: 'job_2',
      });
    }
    expect(JSON.stringify(view)).toBe(before);

    expect(() => {
      (view.actor as { kind: string }).kind = 'human';
    }).toThrow(TypeError);
    expect(() => {
      (view.targets as unknown as Array<unknown>).push({ kind: 'runtime', id: 'runtime_2' });
    }).toThrow(TypeError);
    expect(() => {
      (view.progress as { percent: number }).percent = 100;
    }).toThrow(TypeError);
    expect(() => {
      (view.progress.evidenceRefs as unknown as Array<unknown>).push({
        kind: 'job-step',
        id: 'job_2',
      });
    }).toThrow(TypeError);
    expect(JSON.stringify(view)).toBe(before);
  });

  it('measures the exact UTF-8 byte length of the projected serialized view', () => {
    const event = {
      ...retainedOperation(),
      targets: [{ kind: 'runtime' as const, id: 'runtime_1', label: '当前运行时' }],
    };
    const retained = RetainedActivityEventSchema.parse(event);
    const json = JSON.stringify(toActivityEventView(retained));
    const expected = Buffer.byteLength(json, 'utf8');

    expect(projectedEventByteLength(retained)).toBe(expected);
    expect(expected).toBeGreaterThan(json.length);
  });
});
