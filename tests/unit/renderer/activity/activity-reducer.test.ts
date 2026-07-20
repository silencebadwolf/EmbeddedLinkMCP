import { describe, expect, it } from 'vitest';
import {
  createInitialActivityCenterState,
  ingestActivityEvent,
  ingestActivitySnapshot,
  selectActivityItems,
  selectDefaultActivityGroups,
  type ActivityCenterState,
} from '@/renderer/features/activity/activity-reducer.js';
import {
  activitySnapshot,
  callEvent,
  callView,
  operationEvent,
  operationView,
  workflowEvent,
} from './activity-fixtures.js';

describe('activity center reducer', () => {
  it('groups active and attention operations while folding read-only bursts without losing queryability', () => {
    const state = ingestActivitySnapshot(
      createInitialActivityCenterState(),
      activitySnapshot([
        operationEvent({
          sequence: 1,
          operationId: 'operation_status_1',
          phase: 'succeeded',
          action: 'get_app_status',
          risk: 'read-only',
        }),
        operationEvent({
          sequence: 2,
          operationId: 'operation_status_2',
          phase: 'succeeded',
          action: 'get_app_status',
          risk: 'read-only',
        }),
        operationEvent({
          sequence: 3,
          operationId: 'operation_open_serial',
          phase: 'running',
          action: 'open_session',
          risk: 'state-affecting',
          targetKind: 'session',
          targetId: 'sess_1234',
          targetLabel: 'serial COM3',
        }),
        operationEvent({
          sequence: 4,
          operationId: 'operation_flash',
          phase: 'failed',
          action: 'run_control_workflow',
          risk: 'destructive-or-unknown',
          targetKind: 'job',
          targetId: 'job_flash',
          targetLabel: 'flash workflow',
          errorCode: 'WORKFLOW_FAILED',
        }),
      ]),
    );

    expect(selectDefaultActivityGroups(state)).toMatchObject([
      { kind: 'active', operationIds: ['operation_open_serial'] },
      { kind: 'attention', operationIds: ['operation_flash'] },
      { kind: 'read-only-burst', operationIds: ['operation_status_2', 'operation_status_1'] },
    ]);
    expect(selectActivityItems(state, { risk: 'read-only' }).map((item) => item.operationId)).toEqual(
      ['operation_status_2', 'operation_status_1'],
    );
  });

  it('returns the newest operations first for history, filters, and folded groups', () => {
    const state = ingestActivitySnapshot(
      createInitialActivityCenterState(),
      activitySnapshot([
        operationEvent({
          sequence: 1,
          operationId: 'operation_oldest_read',
          phase: 'succeeded',
          action: 'get_app_status',
          risk: 'read-only',
        }),
        operationEvent({
          sequence: 2,
          operationId: 'operation_middle_write',
          phase: 'succeeded',
          action: 'send',
          risk: 'state-affecting',
        }),
        operationEvent({
          sequence: 3,
          operationId: 'operation_newest_read',
          phase: 'succeeded',
          action: 'get_session_output',
          risk: 'read-only',
        }),
      ]),
    );

    expect(selectActivityItems(state, {}).map((item) => item.operationId)).toEqual([
      'operation_newest_read',
      'operation_middle_write',
      'operation_oldest_read',
    ]);
    expect(selectActivityItems(state, { risk: 'read-only' }).map((item) => item.operationId))
      .toEqual(['operation_newest_read', 'operation_oldest_read']);
    expect(selectDefaultActivityGroups(state)).toContainEqual({
      kind: 'read-only-burst',
      operationIds: ['operation_newest_read', 'operation_oldest_read'],
    });
  });

  it('records a sequence-gap diagnostic and does not append the out-of-order event', () => {
    const state = ingestActivitySnapshot(
      createInitialActivityCenterState(),
      activitySnapshot([
        operationEvent({
          sequence: 1,
          operationId: 'operation_status_1',
          phase: 'succeeded',
          action: 'get_app_status',
          risk: 'read-only',
        }),
      ]),
    );

    const next = ingestActivityEvent(
      state,
      operationEvent({
        sequence: 3,
        operationId: 'operation_status_3',
        phase: 'succeeded',
        action: 'get_app_status',
        risk: 'read-only',
      }),
    );

    expect(selectActivityItems(next, {}).map((item) => item.operationId)).toEqual([
      'operation_status_1',
    ]);
    expect(next.diagnostics.at(-1)).toMatchObject({
      code: 'sequence-gap',
      expectedSequence: 2,
      receivedSequence: 3,
    });
  });

  it('marks the retained history as truncated when the snapshot says older activity is unavailable', () => {
    const state = ingestActivitySnapshot(
      createInitialActivityCenterState(),
      activitySnapshot(
        [
          operationEvent({
            sequence: 8,
            operationId: 'operation_recent',
            phase: 'succeeded',
            action: 'get_app_status',
            risk: 'read-only',
          }),
        ],
        { sequence: 8, truncated: true },
      ),
    );

    expect(state.historyTruncated).toBe(true);
    expect(state.cursor).toEqual({ runtimeId: 'runtime_1', sequence: 8 });
  });

  it('records a safe runtime reset diagnostic from reset-required snapshots', () => {
    const state = ingestActivitySnapshot(
      createInitialActivityCenterState(),
      activitySnapshot([], { resetRequired: true }),
    );

    expect(state.diagnostics.at(-1)).toMatchObject({ code: 'runtime-reset' });
    expect(JSON.stringify(state)).not.toContain('raw');
  });

  it('attaches display-safe workflow progress to the operation summary', () => {
    const state = ingestActivitySnapshot(
      createInitialActivityCenterState(),
      activitySnapshot([
        operationEvent({
          sequence: 1,
          operationId: 'operation_flash',
          phase: 'running',
          action: 'run_control_workflow',
          risk: 'destructive-or-unknown',
          targetKind: 'job',
          targetId: 'job_flash',
          targetLabel: 'flash workflow',
        }),
        workflowEvent({
          sequence: 2,
          operationId: 'operation_flash',
          action: 'run_control_workflow',
          risk: 'destructive-or-unknown',
          current: 1,
          total: 4,
          percent: 25,
          stepId: 'flash_download',
          messageCode: 'workflow.flash.download',
          targetId: 'job_flash',
          targetLabel: 'flash workflow',
        }),
      ]),
    );

    expect(selectActivityItems(state, { operationId: 'operation_flash' })[0]?.progress).toEqual({
      current: 1,
      total: 4,
      percent: 25,
      stepId: 'flash_download',
      messageCode: 'workflow.flash.download',
      evidenceRefs: [],
    });
  });

  it('filters retained activity by actor, action, target kind, target id, and display text', () => {
    const state = ingestActivitySnapshot(
      createInitialActivityCenterState(),
      activitySnapshot([
        operationEvent({
          sequence: 1,
          operationId: 'operation_workspace_scan',
          phase: 'succeeded',
          action: 'inspect_workspace',
          risk: 'read-only',
          targetKind: 'workspace',
          targetId: 'workspace_linkterm',
          targetLabel: 'LinkTerm workspace',
          actorKind: 'agent',
        }),
        operationEvent({
          sequence: 2,
          operationId: 'operation_human_serial',
          phase: 'running',
          action: 'open_session',
          risk: 'state-affecting',
          targetKind: 'session',
          targetId: 'sess_human',
          targetLabel: 'human COM7',
          actorKind: 'human',
          actorChannel: 'desktop',
        }),
        operationEvent({
          sequence: 3,
          operationId: 'operation_ai_serial',
          phase: 'queued',
          action: 'open_session',
          risk: 'state-affecting',
          targetKind: 'session',
          targetId: 'sess_ai',
          targetLabel: 'AI COM9',
          actorKind: 'agent',
        }),
      ]),
    );

    expect(selectActivityItems(state, { actorKind: 'human' }).map((item) => item.operationId))
      .toEqual(['operation_human_serial']);
    expect(selectActivityItems(state, { action: 'open_session' }).map((item) => item.operationId))
      .toEqual(['operation_ai_serial', 'operation_human_serial']);
    expect(selectActivityItems(state, { targetKind: 'workspace' }).map((item) => item.operationId))
      .toEqual(['operation_workspace_scan']);
    expect(selectActivityItems(state, { targetId: 'sess_ai' }).map((item) => item.operationId))
      .toEqual(['operation_ai_serial']);
    expect(selectActivityItems(state, { text: 'linkterm' }).map((item) => item.operationId))
      .toEqual(['operation_workspace_scan']);
  });

  it('keeps retained call attempts queryable through their operation summary', () => {
    const state = ingestActivitySnapshot(
      createInitialActivityCenterState(),
      activitySnapshot([
        operationEvent({
          sequence: 1,
          operationId: 'operation_status',
          phase: 'succeeded',
          action: 'get_app_status',
          risk: 'read-only',
        }),
        callEvent({
          sequence: 2,
          operationId: 'operation_status',
          callId: 'call_status_1',
          phase: 'succeeded',
          action: 'get_app_status',
          risk: 'read-only',
        }),
      ]),
    );

    const [item] = selectActivityItems(state, { text: 'call_status_1' });
    expect(item?.operationId).toBe('operation_status');
    expect(item?.calls).toEqual([
      expect.objectContaining({
        callId: 'call_status_1',
        phase: 'succeeded',
        action: 'get_app_status',
      }),
    ]);
  });

  it('hydrates current operation and call views from a snapshot even when no new events are returned', () => {
    const state = ingestActivitySnapshot(
      createInitialActivityCenterState(),
      activitySnapshot([], {
        sequence: 12,
        operations: [
          operationView({
            sequence: 10,
            updatedSequence: 12,
            operationId: 'operation_reloaded',
            phase: 'running',
            action: 'open_session',
            risk: 'state-affecting',
            targetKind: 'session',
            targetId: 'sess_reloaded',
            targetLabel: 'Reloaded COM5',
          }),
        ],
        calls: [
          callView({
            sequence: 11,
            updatedSequence: 12,
            operationId: 'operation_reloaded',
            callId: 'call_reloaded',
            phase: 'started',
            action: 'open_session',
            risk: 'state-affecting',
            targetKind: 'session',
            targetId: 'sess_reloaded',
            targetLabel: 'Reloaded COM5',
          }),
        ],
      }),
    );

    const [item] = selectActivityItems(state, { text: 'call_reloaded' });
    expect(item).toMatchObject({
      operationId: 'operation_reloaded',
      phase: 'running',
      action: 'open_session',
    });
    expect(item?.targets[0]).toMatchObject({ kind: 'session', id: 'sess_reloaded' });
    expect(item?.calls[0]).toMatchObject({ callId: 'call_reloaded', phase: 'started' });
  });

  it('rejects unknown raw fields instead of retaining them in renderer state', () => {
    const state = createInitialActivityCenterState();
    const unsafe = {
      ...operationEvent({
        sequence: 1,
        operationId: 'operation_unsafe',
        phase: 'running',
        action: 'open_session',
        risk: 'state-affecting',
      }),
      rawEvidence: { transcript: 'secret terminal output' },
    };

    const next = ingestActivityEvent(state, unsafe);

    expect(selectActivityItems(next, {})).toEqual([]);
    expect(JSON.stringify(next)).not.toContain('secret terminal output');
    expect(next.diagnostics.at(-1)).toMatchObject({ code: 'invalid-event' });
  });

  it('bounds renderer-retained operations and marks local history truncated', () => {
    const state = ingestActivitySnapshot(
      createInitialActivityCenterState(),
      activitySnapshot(
        Array.from({ length: 1_005 }, (_, index) =>
          operationEvent({
            sequence: index + 1,
            operationId: `operation_${index}`,
            phase: 'succeeded',
            action: 'get_app_status',
            risk: 'read-only',
          }),
        ),
      ),
    );

    expect(selectActivityItems(state, {})).toHaveLength(1_000);
    expect(selectActivityItems(state, { operationId: 'operation_0' })).toHaveLength(0);
    expect(selectActivityItems(state, { operationId: 'operation_1004' })).toHaveLength(1);
    expect(state.historyTruncated).toBe(true);
  });

  it('bounds renderer-retained pushed events while keeping the latest cursor', () => {
    const seeded: ActivityCenterState = {
      ...createInitialActivityCenterState(),
      status: 'ready',
      runtimeId: 'runtime_1',
      cursor: { runtimeId: 'runtime_1', sequence: 5_000 },
      events: Array.from({ length: 5_000 }, (_, index) =>
        operationEvent({
          sequence: index + 1,
          operationId: 'operation_live',
          phase: 'running',
          action: 'open_session',
          risk: 'state-affecting',
        }),
      ),
    };
    const state = ingestActivityEvent(
      seeded,
      operationEvent({
        sequence: 5_001,
        operationId: 'operation_live',
        phase: 'running',
        action: 'open_session',
        risk: 'state-affecting',
      }),
    );

    expect(state.events).toHaveLength(5_000);
    expect(state.events[0]?.sequence).toBe(2);
    expect(state.cursor).toEqual({ runtimeId: 'runtime_1', sequence: 5_001 });
    expect(state.historyTruncated).toBe(true);
  });
});
