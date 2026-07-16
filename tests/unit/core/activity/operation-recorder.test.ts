import { setTimeout as delay } from 'node:timers/promises';
import { describe, expect, it, vi } from 'vitest';
import { ActivityHealthMonitor } from '@/core/activity/activity-health.js';
import { OperationLedger } from '@/core/activity/operation-ledger.js';
import { OperationRecorder, type BeginMcpCallInput } from '@/core/activity/operation-recorder.js';
import type { ActivityEventView } from '@/shared/activity-contract.js';
import type { ToolSensitivity } from '@/mcp/versioning/version-check.js';
import { ControlWorkflowJobManager } from '@/mcp/surfaces/control-workflow/job-manager.js';

const BASE_TIME_MS = Date.UTC(2026, 6, 13, 0, 0, 0);

interface RecorderHarness {
  readonly health: ActivityHealthMonitor;
  readonly ledger: OperationLedger;
  readonly recorder: OperationRecorder;
}

function createHarness(): RecorderHarness {
  let runtimeId = 0;
  let eventId = 0;
  let timestamp = 0;
  const now = () => new Date(BASE_TIME_MS + timestamp++).toISOString();
  const health = new ActivityHealthMonitor(now);
  const ledger = new OperationLedger({
    health,
    createRuntimeId: () => `runtime_${++runtimeId}`,
    createEventId: () => `event_${++eventId}`,
    now,
  });
  return { health, ledger, recorder: new OperationRecorder({ ledger, health }) };
}

function beginInput(
  action: string,
  declaredSensitivity: ToolSensitivity,
  rawArgs: unknown = {},
): BeginMcpCallInput {
  return { action, declaredSensitivity, rawArgs };
}

function events(ledger: OperationLedger): readonly ActivityEventView[] {
  return ledger.snapshot().events;
}

function phases(ledger: OperationLedger): readonly string[] {
  return events(ledger).map((event) => {
    if (event.kind === 'operation-transition') return `operation:${event.operationPhase}`;
    if (event.kind === 'call-transition') return `call:${event.callPhase}`;
    return `milestone:${event.progress.messageCode}`;
  });
}

function lastOperationEvent(
  ledger: OperationLedger,
): Extract<ActivityEventView, { kind: 'operation-transition' }> {
  const found = [...events(ledger)]
    .reverse()
    .find((event): event is Extract<ActivityEventView, { kind: 'operation-transition' }> => {
      return event.kind === 'operation-transition';
    });
  if (found === undefined) throw new Error('Expected operation event');
  return found;
}

function lastCallEvent(
  ledger: OperationLedger,
): Extract<ActivityEventView, { kind: 'call-transition' }> {
  const found = [...events(ledger)]
    .reverse()
    .find((event): event is Extract<ActivityEventView, { kind: 'call-transition' }> => {
      return event.kind === 'call-transition';
    });
  if (found === undefined) throw new Error('Expected call event');
  return found;
}

function expectZeroCaptureHealth(health: ActivityHealthMonitor): void {
  expect(health.snapshot()).toMatchObject({
    captureFailureCount: 0,
    droppedEventCount: 0,
    evictedEventCount: 0,
    listenerFailureCount: 0,
  });
}

function workflowInput(root = 'C:/repo'): {
  root: string;
  mode: 'flash-observe';
  confirm: true;
} {
  return { root, mode: 'flash-observe', confirm: true };
}

function workflowUpdate(root = 'C:/repo'): Record<string, unknown> {
  return {
    mode: 'flash-observe',
    root,
    steps: [
      { id: 'connect_probe', status: 'passed', durationMs: 1 },
      {
        id: 'flash',
        status: 'running',
        durationMs: 2,
        evidence: { raw: 'RAW_WORKFLOW_EVIDENCE_SHOULD_NOT_LEAK' },
      },
    ],
    summary: {
      serialOpened: false,
      probeConnected: true,
      gdbServerStarted: false,
      flashed: false,
      verified: false,
      reset: false,
      serialObserved: false,
      rttObserved: false,
      debugCaptured: false,
    },
    nextActions: [{ kind: 'user_action', message: 'private next action should not leak' }],
  };
}

function eventsForAction(ledger: OperationLedger, action: string): readonly ActivityEventView[] {
  return events(ledger).filter((event) => event.action === action);
}

function countingProxy<T extends object>(
  target: T,
): { readonly proxy: T; readonly trapCount: () => number } {
  let count = 0;
  const proxy = new Proxy(target, {
    get(current, key, receiver) {
      count += 1;
      return Reflect.get(current, key, receiver);
    },
    getOwnPropertyDescriptor(current, key) {
      count += 1;
      return Reflect.getOwnPropertyDescriptor(current, key);
    },
    getPrototypeOf(current) {
      count += 1;
      return Reflect.getPrototypeOf(current);
    },
    ownKeys(current) {
      count += 1;
      return Reflect.ownKeys(current);
    },
  });
  return { proxy, trapCount: () => count };
}

describe('OperationRecorder MCP call handles', () => {
  it('uses server-generated unique ids and ignores caller-supplied correlation identity', () => {
    const { recorder, ledger } = createHarness();

    const first = recorder.beginMcpCall(
      beginInput('get_app_status', 'read-only', {
        runtimeId: 'runtime_input',
        operationId: 'same-untrusted-id',
        callId: 'same-untrusted-id',
      }),
    );
    const second = recorder.beginMcpCall(
      beginInput('get_app_status', 'read-only', {
        runtimeId: 'runtime_input',
        operationId: 'same-untrusted-id',
        callId: 'same-untrusted-id',
      }),
    );

    expect(first.operationId).toMatch(/^operation-[0-9a-f-]+$/u);
    expect(first.callId).toMatch(/^call-[0-9a-f-]+$/u);
    expect(second.operationId).not.toBe(first.operationId);
    expect(second.callId).not.toBe(first.callId);
    expect(events(ledger).map((event) => event.operationId)).toEqual([
      first.operationId,
      first.operationId,
      second.operationId,
      second.operationId,
    ]);
    expect(
      events(ledger).filter((event) => JSON.stringify(event).includes('same-untrusted-id')),
    ).toEqual([]);
  });

  it('records atomic requested and received events with ordinary read-only MCP metadata', () => {
    const { recorder, ledger, health } = createHarness();

    const handle = recorder.beginMcpCall(
      beginInput('get_app_status', 'read-only', { runtimeId: 'runtime_input' }),
    );

    expect(handle.admission).toBe('start-before-handler');
    expect(phases(ledger)).toEqual(['operation:requested', 'call:received']);
    const [readOnlyRequested, readOnlyReceived] = events(ledger);
    expect(readOnlyRequested).toMatchObject({
      actor: { kind: 'agent', channel: 'local-mcp' },
      action: 'get_app_status',
      surface: 'runtime',
      risk: 'read-only',
      approvalPolicy: 'none',
      authorizationSource: 'none',
      targets: [{ kind: 'runtime' }],
    });
    expect(readOnlyReceived).toMatchObject({
      operationId: handle.operationId,
      callId: handle.callId,
      action: 'get_app_status',
    });
    expect(health.snapshot().incompleteLifecycleCount).toBe(1);
    expectZeroCaptureHealth(health);
  });

  it('records state-affecting calls without client acknowledgement metadata', () => {
    const { recorder, ledger } = createHarness();

    recorder.beginMcpCall(
      beginInput('cpu_reset', 'state-affecting', {
        confirm: true,
        probeId: 'probe_1',
      }),
    );

    const [acknowledgedRequested] = events(ledger);
    expect(acknowledgedRequested).toMatchObject({
      actor: { kind: 'agent', channel: 'local-mcp' },
      action: 'cpu_reset',
      surface: 'debug',
      risk: 'disruptive',
      approvalPolicy: 'none',
      authorizationSource: 'none',
    });
  });

  it('records start and success once while decrementing the lifecycle gauge once', () => {
    const { recorder, ledger, health } = createHarness();
    const handle = recorder.beginMcpCall(beginInput('get_app_status', 'read-only'));

    handle.start();
    handle.start();
    handle.finishSuccess();
    handle.finishFailure('LATE_FAILURE');
    handle.reject('runtime-precondition', 'LATE_REJECTION');

    expect(phases(ledger)).toEqual([
      'operation:requested',
      'call:received',
      'operation:running',
      'call:started',
      'operation:succeeded',
      'call:succeeded',
    ]);
    expect(health.snapshot().incompleteLifecycleCount).toBe(0);
    expectZeroCaptureHealth(health);
  });

  it('records ordinary failure as failed Operation and failed Call terminal events', () => {
    const { recorder, ledger, health } = createHarness();
    const handle = recorder.beginMcpCall(beginInput('get_app_status', 'read-only'));

    handle.start();
    handle.finishFailure('APP_STATUS_FAILED');
    handle.finishSuccess();

    expect(lastOperationEvent(ledger)).toMatchObject({
      kind: 'operation-transition',
      operationPhase: 'failed',
      error: {
        code: 'APP_STATUS_FAILED',
        messageCode: 'operation.failed',
        stage: 'provider',
      },
    });
    expect(lastCallEvent(ledger)).toMatchObject({
      kind: 'call-transition',
      callPhase: 'failed',
      error: {
        code: 'APP_STATUS_FAILED',
        messageCode: 'operation.failed',
        stage: 'provider',
      },
    });
    expect(health.snapshot().incompleteLifecycleCount).toBe(0);
  });

  it('preserves failure terminal priority when later delivery handling fails', () => {
    const { recorder, ledger, health } = createHarness();
    const handle = recorder.beginMcpCall(beginInput('cpu_reset', 'state-affecting'));

    expect(handle.admission).toBe('start-before-handler');
    handle.start();
    handle.finishFailure('INVALID_STATE');
    handle.recordDeliveryFailure('response-serialization');
    handle.finishSuccessWithDeliveryFailure('response-construction');

    expect(lastOperationEvent(ledger)).toMatchObject({
      kind: 'operation-transition',
      operationPhase: 'failed',
      error: {
        code: 'INVALID_STATE',
        messageCode: 'operation.failed',
        stage: 'provider',
      },
    });
    expect(lastCallEvent(ledger)).toMatchObject({
      kind: 'call-transition',
      callPhase: 'failed',
      error: {
        code: 'INVALID_STATE',
        messageCode: 'operation.failed',
        stage: 'provider',
      },
    });
    expect(health.snapshot().incompleteLifecycleCount).toBe(0);
  });

  it('records successful business completion plus response delivery failure as Operation succeeded and Call failed', () => {
    const { recorder, ledger } = createHarness();
    const handle = recorder.beginMcpCall(beginInput('get_app_status', 'read-only'));

    handle.start();
    handle.finishSuccessWithDeliveryFailure('response-serialization');

    expect(lastOperationEvent(ledger)).toMatchObject({
      kind: 'operation-transition',
      operationPhase: 'succeeded',
    });
    expect(lastCallEvent(ledger)).toMatchObject({
      kind: 'call-transition',
      callPhase: 'failed',
      error: {
        code: 'OPERATION_FAILED',
        messageCode: 'operation.failed',
        stage: 'response-serialization',
      },
    });
  });

  it('returns a no-op handle when begin capture throws inside the provider path', () => {
    const { recorder, ledger } = createHarness();
    const append = vi.spyOn(ledger, 'appendBatch');
    append.mockImplementationOnce(() => {
      throw new Error('append unavailable');
    });

    const handle = recorder.beginMcpCall(beginInput('get_app_status', 'read-only'));
    handle.start();
    handle.finishFailure('AFTER_PROVIDER_FAILURE');
    handle.finishSuccessWithDeliveryFailure('response-construction');

    expect(append).toHaveBeenCalledTimes(1);
    expect(ledger.snapshot()).toMatchObject({
      events: [],
      health: {
        captureFailureCount: 1,
        droppedEventCount: 2,
        incompleteLifecycleCount: 0,
      },
    });
  });

  it('returns a no-op handle after a begin append failure and consumes finish-once without a second ledger attempt', () => {
    const health = new ActivityHealthMonitor(() => new Date(BASE_TIME_MS).toISOString());
    const ledger = new OperationLedger({
      health,
      createRuntimeId: () => 'runtime_1',
      createEventId: () => 'event_1',
      now: () => new Date(BASE_TIME_MS).toISOString(),
      maxEvents: 1,
    });
    const recorder = new OperationRecorder({ ledger, health });
    const append = vi.spyOn(ledger, 'appendBatch');

    const handle = recorder.beginMcpCall(beginInput('get_app_status', 'read-only'));
    handle.start();
    handle.finishFailure('AFTER_BEGIN_FAILURE');
    handle.finishSuccess();

    expect(handle.operationId).toMatch(/^operation-/u);
    expect(handle.callId).toMatch(/^call-/u);
    expect(append).toHaveBeenCalledTimes(1);
    expect(ledger.snapshot()).toMatchObject({
      events: [],
      health: {
        captureFailureCount: 1,
        droppedEventCount: 2,
        incompleteLifecycleCount: 0,
      },
    });
  });

  it('disables capture after the first active append rejection but still finishes the lifecycle once', () => {
    const { recorder, ledger, health } = createHarness();
    const handle = recorder.beginMcpCall(beginInput('get_app_status', 'read-only'));
    const append = vi.spyOn(ledger, 'appendBatch');
    append.mockImplementationOnce(() => ({ accepted: false, code: 'capacity-exceeded' }));

    handle.start();
    handle.finishFailure('AFTER_START_FAILURE');
    handle.finishSuccess();

    expect(append).toHaveBeenCalledTimes(1);
    expect(phases(ledger)).toEqual(['operation:requested', 'call:received']);
    expect(health.snapshot().incompleteLifecycleCount).toBe(0);
  });

  it('records policy drift at most once per active handle', () => {
    const { recorder, health } = createHarness();
    const handle = recorder.beginMcpCall(
      beginInput('get_app_status', 'state-affecting', { confirm: true }),
    );

    handle.recordPolicyDrift();
    handle.recordPolicyDrift();

    expect(health.snapshot().policyFailureCount).toBe(2);
  });

  it('does not trigger proxy traps or accessors across policy resolution and redaction', () => {
    const { recorder } = createHarness();
    const top = countingProxy({ confirm: true, probeId: 'probe_1' });
    const nested = countingProxy({ haltOnFailure: true });
    let confirmGetterCount = 0;
    const accessorArgs: Record<string, unknown> = {};
    Object.defineProperty(accessorArgs, 'confirm', {
      get() {
        confirmGetterCount += 1;
        return true;
      },
    });

    recorder.beginMcpCall(beginInput('cpu_reset', 'state-affecting', top.proxy));
    recorder.beginMcpCall(
      beginInput('run_control_workflow', 'state-affecting', {
        mode: 'flash-observe',
        debug: nested.proxy,
      }),
    );
    recorder.beginMcpCall(beginInput('cpu_reset', 'state-affecting', accessorArgs));

    expect(top.trapCount()).toBe(0);
    expect(nested.trapCount()).toBe(0);
    expect(confirmGetterCount).toBe(0);
  });

  it('runs sync and async work through the handle context without altering results', async () => {
    const { recorder } = createHarness();
    const handle = recorder.beginMcpCall(beginInput('get_app_status', 'read-only'));

    await expect(
      handle.runWithContext(async () => {
        await delay(0);
        return { operationId: handle.operationId };
      }),
    ).resolves.toEqual({ operationId: handle.operationId });
    await expect(handle.runWithContext(() => 42)).resolves.toBe(42);
  });

  it('records an MCP background workflow job as a child operation with detached later milestones', async () => {
    const { recorder, ledger } = createHarness();
    const launchHandle = recorder.beginMcpCall(
      beginInput('run_control_workflow', 'state-affecting', {
        root: 'C:/secret/repo',
        mode: 'flash-observe',
        confirm: true,
      }),
    );
    const manager = new ControlWorkflowJobManager({
      createId: () => 'job-mcp-child',
      observer: (observation) => recorder.observeWorkflowJob(observation),
    } as ConstructorParameters<typeof ControlWorkflowJobManager>[0]);

    launchHandle.start();
    const job = await launchHandle.runWithContext(() =>
      manager.create({
        input: workflowInput('C:/secret/repo'),
        activityOrigin: 'agent',
      } as Parameters<ControlWorkflowJobManager['create']>[0]),
    );
    launchHandle.finishSuccess();

    manager.update(job.jobId, workflowUpdate('C:/secret/repo') as never);
    manager.update(job.jobId, workflowUpdate('C:/secret/repo') as never);
    manager.cancel(job.jobId);

    const childEvents = eventsForAction(ledger, 'control-workflow.job');
    const childRequest = childEvents.find(
      (event) => event.kind === 'operation-transition' && event.operationPhase === 'requested',
    );
    expect(childRequest).toMatchObject({
      parentOperationId: launchHandle.operationId,
      actor: { kind: 'agent', channel: 'local-mcp' },
      surface: 'workflow',
      action: 'control-workflow.job',
      risk: 'destructive-or-unknown',
      approvalPolicy: 'none',
      authorizationSource: 'none',
      targets: [{ kind: 'job', id: 'job-mcp-child' }],
    });
    expect(childEvents.some((event) => 'callId' in event)).toBe(false);
    expect(
      childEvents
        .filter((event) => event.kind === 'operation-transition')
        .map((event) => event.operationPhase),
    ).toEqual(['requested', 'queued', 'cancel-requested', 'cancelled']);

    const flashMilestones = childEvents.filter(
      (event) => event.kind === 'workflow-milestone' && event.progress.stepId === 'flash',
    );
    expect(flashMilestones).toHaveLength(1);
    expect(flashMilestones[0]).toMatchObject({
      progress: {
        current: 2,
        total: 2,
        stepId: 'flash',
        evidenceRefs: [{ kind: 'job-step', id: 'flash' }],
      },
    });

    const serialized = JSON.stringify(childEvents);
    expect(serialized).not.toContain('C:/secret');
    expect(serialized).not.toContain('RAW_WORKFLOW_EVIDENCE_SHOULD_NOT_LEAK');
    expect(serialized).not.toContain('private next action');

    const beforeLateUpdate = eventsForAction(ledger, 'control-workflow.job').length;
    manager.update(job.jobId, {
      ...workflowUpdate('C:/secret/repo'),
      steps: [{ id: 'late_update', status: 'passed', durationMs: 1 }],
    } as never);
    expect(eventsForAction(ledger, 'control-workflow.job')).toHaveLength(beforeLateUpdate);
  });

  it('cleans workflow job recorder state after each sequential terminal job', async () => {
    const { recorder, ledger } = createHarness();
    const jobIds = ['job-seq-succeeded', 'job-seq-failed', 'job-seq-cancelled'];
    const manager = new ControlWorkflowJobManager({
      createId: () => jobIds.shift() ?? 'unexpected-job',
      observer: (observation) => recorder.observeWorkflowJob(observation),
    } as ConstructorParameters<typeof ControlWorkflowJobManager>[0]);
    const eventsForJob = (jobId: string): readonly ActivityEventView[] =>
      eventsForAction(ledger, 'control-workflow.job').filter((event) =>
        event.targets.some((target) => target.kind === 'job' && target.id === jobId),
      );
    const terminalCases = [
      {
        jobId: 'job-seq-succeeded',
        operationPhases: ['requested', 'queued', 'running', 'succeeded'],
        finish: async (jobId: string, root: string) => {
          await manager.start(jobId, async () => workflowUpdate(root) as never);
        },
      },
      {
        jobId: 'job-seq-failed',
        operationPhases: ['requested', 'queued', 'running', 'failed'],
        finish: async (jobId: string, root: string) => {
          await manager.start(
            jobId,
            async () =>
              ({
                ...workflowUpdate(root),
                steps: [{ id: 'flash', status: 'failed', durationMs: 3 }],
                failedStep: 'flash',
              }) as never,
          );
        },
      },
      {
        jobId: 'job-seq-cancelled',
        operationPhases: ['requested', 'queued', 'cancel-requested', 'cancelled'],
        finish: async (jobId: string) => {
          manager.cancel(jobId);
        },
      },
    ] as const;
    const operationIds: string[] = [];

    for (const testCase of terminalCases) {
      const root = `C:/seq/${testCase.jobId}`;
      const launchHandle = recorder.beginMcpCall(
        beginInput('run_control_workflow', 'state-affecting', {
          root,
          mode: 'flash-observe',
          confirm: true,
        }),
      );

      launchHandle.start();
      const job = await launchHandle.runWithContext(() =>
        manager.create({
          input: workflowInput(root),
          activityOrigin: 'agent',
        } as Parameters<ControlWorkflowJobManager['create']>[0]),
      );
      launchHandle.finishSuccess();

      expect(job.jobId).toBe(testCase.jobId);

      manager.update(job.jobId, workflowUpdate(root) as never);
      manager.update(job.jobId, workflowUpdate(root) as never);

      expect(
        eventsForJob(job.jobId).filter(
          (event) => event.kind === 'workflow-milestone' && event.progress.stepId === 'flash',
        ),
      ).toHaveLength(1);

      await testCase.finish(job.jobId, root);

      const jobEvents = eventsForJob(job.jobId);
      const request = jobEvents.find(
        (event) => event.kind === 'operation-transition' && event.operationPhase === 'requested',
      );
      expect(request).toBeDefined();
      operationIds.push(request?.operationId ?? 'missing-operation');
      expect(
        jobEvents
          .filter((event) => event.kind === 'operation-transition')
          .map((event) => event.operationPhase),
      ).toEqual(testCase.operationPhases);

      const afterTerminalCount = jobEvents.length;
      manager.update(job.jobId, {
        ...workflowUpdate(root),
        steps: [{ id: 'late_update', status: 'passed', durationMs: 1 }],
      } as never);
      expect(eventsForJob(job.jobId)).toHaveLength(afterTerminalCount);
    }

    expect(new Set(operationIds)).toHaveLength(terminalCases.length);
  });

  it('records trusted Main download jobs as human desktop operations without a parent', () => {
    const { recorder, ledger } = createHarness();
    const manager = new ControlWorkflowJobManager({
      createId: () => 'job-main-download',
      observer: (observation) => recorder.observeWorkflowJob(observation),
    } as ConstructorParameters<typeof ControlWorkflowJobManager>[0]);

    manager.create({
      input: workflowInput('C:/repo'),
      activityOrigin: 'human',
    } as Parameters<ControlWorkflowJobManager['create']>[0]);

    const mainChild = eventsForAction(ledger, 'control-profile.download-job').find(
      (event) => event.kind === 'operation-transition' && event.operationPhase === 'requested',
    );
    expect(mainChild).toMatchObject({
      actor: { kind: 'human', channel: 'desktop' },
      surface: 'control-profile',
      action: 'control-profile.download-job',
      risk: 'destructive-or-unknown',
      approvalPolicy: 'none',
      authorizationSource: 'none',
      targets: [{ kind: 'job', id: 'job-main-download' }],
    });
    expect(mainChild).not.toHaveProperty('parentOperationId');
  });
});
