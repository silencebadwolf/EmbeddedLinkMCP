import { describe, expect, it, vi } from 'vitest';
import { ControlWorkflowJobManager } from '@/mcp/surfaces/control-workflow/job-manager.js';
import type { ControlWorkflowData } from '@/mcp/surfaces/control-workflow/types.js';
import type { RunControlWorkflowInput } from '@/mcp/surfaces/control-workflow/schemas.js';
import { ToolError } from '@/mcp/registry.js';
import type { CancellationCapability } from '@/shared/control-workflow-contract.js';

type ObservedWorkflowJob = {
  readonly kind: string;
  readonly jobId: string;
  readonly state: string;
  readonly mode: string;
  readonly activityOrigin: string;
  readonly createdAt: number;
  readonly startedAt?: number;
  readonly completedAt?: number;
  readonly updatedAt: number;
  readonly cancelRequested: boolean;
  readonly cancellationCapability: CancellationCapability;
  readonly stopState?: string;
  readonly currentStepId?: string;
  readonly stepCount: number;
  readonly steps: ReadonlyArray<{
    readonly id: string;
    readonly status: string;
    readonly durationMs: number;
    readonly errorCode?: string;
    readonly failureCode?: string;
  }>;
};

function input(root = 'C:/workspace'): RunControlWorkflowInput {
  return { root, mode: 'flash-observe', confirm: true };
}

function data(
  root = 'C:/workspace',
  steps: Array<{ id: string; status: 'passed' | 'failed' | 'skipped' }> = [],
): ControlWorkflowData {
  return {
    mode: 'flash-observe',
    root,
    steps: steps.map((step) => ({ ...step, durationMs: 1 })),
    summary: {
      serialOpened: false,
      probeConnected: false,
      gdbServerStarted: false,
      flashed: false,
      verified: false,
      reset: false,
      serialObserved: false,
      rttObserved: false,
      debugCaptured: false,
    },
    nextActions: [],
  };
}

function thrownToolError(run: () => unknown): ToolError {
  let thrown: unknown;
  try {
    run();
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(ToolError);
  return thrown as ToolError;
}

function managerWithObserver(
  options: ConstructorParameters<typeof ControlWorkflowJobManager>[0] & {
    observer: (observation: ObservedWorkflowJob) => void;
  },
): ControlWorkflowJobManager {
  return new ControlWorkflowJobManager(
    options as ConstructorParameters<typeof ControlWorkflowJobManager>[0],
  );
}

describe('ControlWorkflowJobManager', () => {
  it('notifies post-commit observer with detached immutable safe observations', async () => {
    let now = 10;
    const observations: ObservedWorkflowJob[] = [];
    const manager = managerWithObserver({
      now: () => now,
      createId: () => 'job-observed',
      observer: (observation) => {
        observations.push(observation);
        expect(Object.isFrozen(observation)).toBe(true);
        expect(Object.isFrozen(observation.steps)).toBe(true);
        for (const step of observation.steps) expect(Object.isFrozen(step)).toBe(true);
      },
    });

    const created = manager.create({
      input: input('C:/sensitive/workspace'),
      activityOrigin: 'agent',
    } as Parameters<ControlWorkflowJobManager['create']>[0]);
    now = 20;
    const completion = manager.start(created.jobId, async ({ update }) => {
      update({
        ...data('C:/sensitive/workspace'),
        steps: [
          {
            id: 'connect_probe',
            status: 'failed',
            durationMs: -5,
            evidence: { raw: 'RAW_EVIDENCE_SHOULD_NOT_LEAK' },
            error: {
              code: 'PROBE_BUSY',
              message: 'probe secret message',
              failureCode: 'probe_not_found',
              details: { root: 'C:/sensitive/workspace' },
            },
          },
        ],
        blockingReasons: [
          {
            kind: 'jlink_gdb_server_start_failed',
            code: 'PROBE_BUSY',
            message: 'blocking detail should stay private',
          },
        ],
        nextActions: [{ kind: 'user_action', message: 'do the private thing' }],
      });
      return data('C:/sensitive/workspace', [{ id: 'flash', status: 'passed' }]);
    });

    expect(created).toMatchObject({ state: 'queued', root: 'C:/sensitive/workspace' });
    await completion;

    expect(observations.map((observation) => observation.kind)).toEqual([
      'created',
      'running',
      'updated',
      'succeeded',
    ]);
    expect(observations[0]).toMatchObject({
      kind: 'created',
      state: 'queued',
      activityOrigin: 'agent',
      stepCount: 0,
      steps: [],
    });
    expect(observations[1]).toMatchObject({ kind: 'running', state: 'running' });
    expect(observations[2]).toMatchObject({
      kind: 'updated',
      state: 'running',
      currentStepId: 'connect_probe',
      stepCount: 1,
      steps: [
        {
          id: 'connect_probe',
          status: 'failed',
          durationMs: 0,
          errorCode: 'PROBE_BUSY',
          failureCode: 'probe_not_found',
        },
      ],
    });

    const serialized = JSON.stringify(observations);
    expect(serialized).not.toContain('C:/sensitive');
    expect(serialized).not.toContain('RAW_EVIDENCE_SHOULD_NOT_LEAK');
    expect(serialized).not.toContain('probe secret message');
    expect(serialized).not.toContain('blocking detail should stay private');
    expect(serialized).not.toContain('do the private thing');
  });

  it('defaults observation origin to system and sanitizes bounded step summaries', () => {
    const observations: ObservedWorkflowJob[] = [];
    const manager = managerWithObserver({
      createId: () => 'job-sanitize',
      observer: (observation) => observations.push(observation),
    });
    const job = manager.create({ input: input('C:/unsafe/root') });
    const steps = Array.from({ length: 70 }, (_, index) => ({
      id: `step_${index}`,
      status: 'passed' as const,
      durationMs: index,
    }));
    steps[10] = {
      id: 'C:/secret/project/private.bin',
      status: 'passed',
      durationMs: Number.MAX_SAFE_INTEGER + 1,
    };
    steps[11] = { id: 'x'.repeat(65), status: 'passed', durationMs: 1 };

    const updated = manager.update(job.jobId, { ...data('C:/unsafe/root'), steps });

    expect(updated.currentStepId).toBe('step_69');
    const [created, observedUpdate] = observations;
    expect(created).toMatchObject({ kind: 'created', activityOrigin: 'system' });
    expect(observedUpdate).toMatchObject({
      kind: 'updated',
      stepCount: 70,
      currentStepId: 'step_69',
    });
    expect(observedUpdate.steps).toHaveLength(64);
    expect(observedUpdate.steps.map((step) => step.id)).toContain('workflow-step-unknown');
    expect(JSON.stringify(observedUpdate)).not.toContain('secret');
    expect(JSON.stringify(observedUpdate)).not.toContain('private.bin');
    expect(JSON.stringify(observedUpdate)).not.toContain(
      'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
    );
    expect(observedUpdate.steps.every((step) => Number.isSafeInteger(step.durationMs))).toBe(true);
  });

  it('skips only malformed workflow projections while preserving manager semantics', () => {
    const observations: ObservedWorkflowJob[] = [];
    const manager = managerWithObserver({
      createId: () => 'job-malformed',
      observer: (observation) => observations.push(observation),
    });
    const job = manager.create({ input: input() });
    const malformed = {
      ...data(),
      steps: [{ id: 'bad_status', status: 'owned', durationMs: 1 }],
    } as unknown as ControlWorkflowData;

    const updated = manager.update(job.jobId, malformed);

    expect(updated).toMatchObject({ currentStepId: 'bad_status', workflow: malformed });
    expect(observations.map((observation) => observation.kind)).toEqual(['created']);
  });

  it('isolates observer throws and mutation attempts from returned snapshots and later transitions', async () => {
    const observations: ObservedWorkflowJob[] = [];
    const manager = managerWithObserver({
      createId: () => 'job-observer-throw',
      observer: (observation) => {
        observations.push(observation);
        (observation as { state: string }).state = 'failed';
        (
          observation.steps as ObservedWorkflowJob['steps'] & { push: (value: unknown) => void }
        ).push({
          id: 'mutated',
          status: 'failed',
          durationMs: 0,
        });
        throw new Error('observer failure must be swallowed');
      },
    });

    const created = manager.create({ input: input() });
    const final = await manager.start(created.jobId, async () =>
      data('C:/workspace', [{ id: 'flash', status: 'passed' }]),
    );

    expect(created.state).toBe('queued');
    expect(final.state).toBe('succeeded');
    expect(manager.read(created.jobId).workflow?.steps.map((step) => step.id)).toEqual(['flash']);
    expect(observations.map((observation) => observation.kind)).toEqual([
      'created',
      'running',
      'succeeded',
    ]);
  });

  it('queues re-entrant observer updates and cancellations without recursive notification', async () => {
    const observations: string[] = [];
    let activeObserverDepth = 0;
    let maxObserverDepth = 0;
    let cancelFromRunning = false;
    const manager = managerWithObserver({
      createId: () => 'job-reentrant',
      observer: (observation) => {
        activeObserverDepth += 1;
        maxObserverDepth = Math.max(maxObserverDepth, activeObserverDepth);
        try {
          observations.push(observation.kind);
          if (observation.kind === 'running' && !cancelFromRunning) {
            cancelFromRunning = true;
            manager.cancel(observation.jobId);
          }
        } finally {
          activeObserverDepth -= 1;
        }
      },
    });
    const job = manager.create({ input: input() });

    await manager.start(job.jobId, async ({ signal }) => {
      if (signal.aborted) throw new ToolError('ABORTED', 'cancelled before runner body');
      await new Promise<void>((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new ToolError('ABORTED', 'cancelled')), {
          once: true,
        });
      });
      return data();
    });

    expect(maxObserverDepth).toBe(1);
    expect(observations).toEqual(['created', 'running', 'cancel-requested', 'cancelled']);
    expect(manager.getStatus(job.jobId)).toMatchObject({
      state: 'cancelled',
      cancelRequested: true,
      currentStepId: 'job_cancelled',
    });
  });

  it('runs a job through queued, running, and succeeded states with retained evidence', async () => {
    let now = 1_000;
    const manager = new ControlWorkflowJobManager({
      now: () => now,
      createId: () => 'job-1',
      ttlMs: 10_000,
    });

    const job = manager.create({ input: input(), correlationId: 'corr-1' });
    expect(job).toMatchObject({
      jobId: 'job-1',
      state: 'queued',
      mode: 'flash-observe',
      root: 'C:/workspace',
    });
    expect(job.updatedAt).toBe(1_000);

    const completion = manager.start('job-1', async ({ update }) => {
      now = 1_100;
      update(
        data('C:/workspace', [
          { id: 'load_profile', status: 'passed' },
          { id: 'connect_probe', status: 'passed' },
        ]),
      );
      return data('C:/workspace', [
        { id: 'load_profile', status: 'passed' },
        { id: 'flash', status: 'passed' },
      ]);
    });

    const running = manager.getStatus('job-1');
    expect(running).toMatchObject({
      state: 'running',
      startedAt: 1_000,
      updatedAt: 1_100,
      currentStepId: 'connect_probe',
    });
    expect(running.updatedAt).toBeGreaterThan(job.updatedAt);
    await completion;

    expect(manager.getStatus('job-1')).toMatchObject({
      state: 'succeeded',
      completedAt: 1_100,
      expiresAt: 11_100,
      currentStepId: 'flash',
    });
    expect(manager.read('job-1').workflow?.steps.map((step) => step.id)).toEqual([
      'load_profile',
      'flash',
    ]);
  });

  it('rejects a second active job and never starts competing hardware work', () => {
    const manager = new ControlWorkflowJobManager({
      createId: vi.fn().mockReturnValueOnce('job-1').mockReturnValueOnce('job-2'),
    });

    manager.create({ input: input('C:/a') });

    const error = thrownToolError(() => manager.create({ input: input('C:/b') }));
    expect(error).toMatchObject({ code: 'INVALID_STATE' });
    expect(error.message).toMatch(/active control workflow job/i);
    expect(manager.listJobs().map((job) => job.jobId)).toEqual(['job-1']);
  });

  it('cancels a running job with AbortSignal and keeps completed partial evidence', async () => {
    const manager = new ControlWorkflowJobManager({ createId: () => 'job-1' });
    manager.create({ input: input() });

    const completion = manager.start('job-1', async ({ signal, update }) => {
      update(data('C:/workspace', [{ id: 'connect_probe', status: 'passed' }]));
      await new Promise<void>((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new ToolError('ABORTED', 'cancelled')), {
          once: true,
        });
      });
      return data();
    });

    const cancelled = manager.cancel('job-1');
    expect(cancelled).toMatchObject({
      state: 'running',
      cancelRequested: true,
      cancellationCapability: 'best-effort',
      stopState: 'stop-requested',
    });
    await completion;

    expect(manager.getStatus('job-1')).toMatchObject({
      state: 'cancelled',
      stopState: 'cancelled',
      currentStepId: 'job_cancelled',
    });
    const evidence = manager.read('job-1').workflow;
    expect(evidence?.steps.map((step) => step.id)).toEqual(['connect_probe', 'job_cancelled']);
    expect(evidence?.steps.at(-1)).toMatchObject({ status: 'failed', error: { code: 'ABORTED' } });
  });

  it('stores cancellation capability and refuses stop for non-stoppable active jobs', () => {
    const manager = new ControlWorkflowJobManager({ createId: () => 'job-no-stop' });
    const job = manager.create({ input: input(), cancellationCapability: 'none' });

    expect(job).toMatchObject({
      state: 'queued',
      cancellationCapability: 'none',
    });

    const error = thrownToolError(() => manager.cancel(job.jobId));
    expect(error).toMatchObject({ code: 'INVALID_STATE' });
    expect(manager.getStatus(job.jobId)).toMatchObject({
      state: 'queued',
      cancelRequested: false,
      cancellationCapability: 'none',
    });
  });

  it('distinguishes stop requested from succeeded after stop request', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const manager = new ControlWorkflowJobManager({ createId: () => 'job-succeeds-after-stop' });
    const job = manager.create({ input: input(), cancellationCapability: 'safe-point' });
    const completion = manager.start(job.jobId, async () => {
      await gate;
      return data();
    });

    expect(manager.cancel(job.jobId)).toMatchObject({
      state: 'running',
      cancelRequested: true,
      cancellationCapability: 'safe-point',
      stopState: 'stop-requested',
    });
    release();
    await completion;

    expect(manager.getStatus(job.jobId)).toMatchObject({
      state: 'succeeded',
      cancelRequested: true,
      cancellationCapability: 'safe-point',
      stopState: 'succeeded-after-stop-request',
    });
  });

  it('distinguishes failed after stop request from cancellation', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const manager = new ControlWorkflowJobManager({ createId: () => 'job-fails-after-stop' });
    const job = manager.create({ input: input(), cancellationCapability: 'best-effort' });
    const failed = {
      ...data('C:/workspace', [{ id: 'flash', status: 'failed' }]),
      failedStep: 'flash',
    };
    const completion = manager.start(job.jobId, async () => {
      await gate;
      return failed;
    });

    manager.cancel(job.jobId);
    release();
    await completion;

    expect(manager.getStatus(job.jobId)).toMatchObject({
      state: 'failed',
      cancelRequested: true,
      cancellationCapability: 'best-effort',
      stopState: 'failed-after-stop-request',
    });
  });

  it('cleans up expired completed jobs and enforces the retained job cap without removing active jobs', async () => {
    let now = 0;
    let nextId = 0;
    const manager = new ControlWorkflowJobManager({
      now: () => now,
      createId: () => `job-${++nextId}`,
      ttlMs: 100,
      maxRetainedJobs: 1,
    });

    const first = manager.create({ input: input('C:/one') });
    await manager.start(first.jobId, async () => data('C:/one'));
    now = 10;
    const second = manager.create({ input: input('C:/two') });
    await manager.start(second.jobId, async () => data('C:/two'));

    expect(manager.listJobs().map((job) => job.jobId)).toEqual(['job-2']);
    const active = manager.create({ input: input('C:/active') });

    now = 200;
    expect(manager.cleanup({ expiredOnly: true })).toEqual({ removed: 1 });
    expect(thrownToolError(() => manager.getStatus('job-2'))).toMatchObject({ code: 'NOT_FOUND' });
    expect(manager.getStatus(active.jobId).state).toBe('queued');
  });

  it('copies exactly the workflow structures owned by the current clone boundary', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const manager = new ControlWorkflowJobManager({ createId: () => 'job-copy' });
    manager.create({ input: input() });
    const nestedEvidence = { nested: { value: 'not-deep-cloned' } };
    const workflow: ControlWorkflowData = {
      ...data('C:/workspace'),
      steps: [
        {
          id: 'probe',
          status: 'failed',
          durationMs: 1,
          error: { code: 'PROBE_BUSY', message: 'busy' },
          evidence: nestedEvidence,
        },
      ],
      summary: { ...data().summary, probeConnected: true },
      nextActions: [{ kind: 'retry', message: 'Retry probe connection', tool: 'probe_connect' }],
      blockingReasons: [
        { kind: 'jlink_gdb_server_start_failed', code: 'PROBE_BUSY', message: 'busy' },
      ],
    };

    const completion = manager.start('job-copy', async ({ update }) => {
      update(workflow);
      await gate;
      return workflow;
    });

    const retained = manager.read('job-copy').workflow!;
    expect(retained).not.toBe(workflow);
    expect(retained.steps).not.toBe(workflow.steps);
    expect(retained.steps[0]).not.toBe(workflow.steps[0]);
    expect(retained.summary).not.toBe(workflow.summary);
    expect(retained.nextActions).not.toBe(workflow.nextActions);
    expect(retained.blockingReasons).not.toBe(workflow.blockingReasons);
    expect(retained.steps[0]!.evidence).toBe(nestedEvidence);

    workflow.root = 'C:/mutated-root';
    workflow.steps[0]!.id = 'mutated-step';
    workflow.steps[0]!.error!.message = 'mutated-error';
    workflow.steps.push({ id: 'added-step', status: 'passed', durationMs: 1 });
    workflow.summary.probeConnected = false;
    workflow.nextActions[0]!.tool = 'mutated-tool';
    workflow.nextActions.push({ kind: 'diagnose', message: 'added action' });
    workflow.blockingReasons![0]!.message = 'mutated-reason';
    workflow.blockingReasons!.push({
      kind: 'serial_open_failed',
      code: 'INTERNAL',
      message: 'added reason',
    });
    nestedEvidence.nested.value = 'mutated-through-deliberate-alias';

    expect(retained).toMatchObject({
      root: 'C:/workspace',
      steps: [{ id: 'probe', error: { message: 'busy' } }],
      summary: { probeConnected: true },
      nextActions: [{ tool: 'probe_connect' }],
      blockingReasons: [{ message: 'busy' }],
    });
    expect(retained.steps).toHaveLength(1);
    expect(retained.nextActions).toHaveLength(1);
    expect(retained.blockingReasons).toHaveLength(1);
    expect(retained.steps[0]!.evidence).toEqual({
      nested: { value: 'mutated-through-deliberate-alias' },
    });

    release();
    await completion;
  });

  it('marks a resolved workflow with failedStep as failed', async () => {
    const manager = new ControlWorkflowJobManager({ createId: () => 'job-failed-step' });
    manager.create({ input: input() });
    const failed = {
      ...data('C:/workspace', [
        { id: 'load_profile', status: 'passed' },
        { id: 'flash', status: 'failed' },
        { id: 'cleanup', status: 'skipped' },
      ]),
      failedStep: 'flash',
    };

    const result = await manager.start('job-failed-step', async () => failed);

    expect(result).toMatchObject({ state: 'failed', currentStepId: 'cleanup' });
    expect(result.workflow).toEqual(failed);
  });

  it.each([
    {
      label: 'ToolError',
      error: new ToolError('PROBE_BUSY', 'probe is busy'),
      code: 'PROBE_BUSY',
    },
    {
      label: 'unexpected error',
      error: new Error('runner exploded'),
      code: 'INTERNAL',
    },
  ])('appends job_failed for $label', async ({ error, code }) => {
    const manager = new ControlWorkflowJobManager({ createId: () => `job-throw-${code}` });
    const job = manager.create({ input: input() });

    const result = await manager.start(job.jobId, async () => {
      throw error;
    });

    expect(result).toMatchObject({ state: 'failed', currentStepId: 'job_failed' });
    expect(result.workflow?.steps.at(-1)).toMatchObject({
      id: 'job_failed',
      status: 'failed',
      error: { code },
    });
  });

  it('cancels a queued job without starting a runner', () => {
    const manager = new ControlWorkflowJobManager({ createId: () => 'job-queued' });
    manager.create({ input: input() });

    const result = manager.cancel('job-queued');

    expect(result).toMatchObject({
      state: 'cancelled',
      cancelRequested: true,
      currentStepId: 'job_cancelled',
    });
    expect(result.workflow?.steps.at(-1)).toMatchObject({
      id: 'job_cancelled',
      error: { code: 'ABORTED' },
    });
  });

  it.each(['succeeded', 'failed', 'cancelled'] as const)(
    'keeps cancellation idempotent for a %s terminal job',
    async (terminalState) => {
      let now = 100;
      const manager = new ControlWorkflowJobManager({
        now: () => now,
        createId: () => 'job-terminal',
      });
      manager.create({ input: input() });

      if (terminalState === 'succeeded') {
        await manager.start('job-terminal', async () => data());
      } else if (terminalState === 'failed') {
        await manager.start('job-terminal', async () => ({
          ...data('C:/workspace', [{ id: 'flash', status: 'failed' }]),
          failedStep: 'flash',
        }));
      } else {
        manager.cancel('job-terminal');
      }

      const before = manager.read('job-terminal');
      expect(before.state).toBe(terminalState);
      now = 999;

      expect(manager.cancel('job-terminal')).toEqual(before);
      expect(manager.read('job-terminal')).toEqual(before);
    },
  );

  it('uses the production 30-minute TTL without expiring active jobs', async () => {
    let now = 0;
    let nextId = 0;
    const manager = new ControlWorkflowJobManager({
      now: () => now,
      createId: () => `job-ttl-${++nextId}`,
    });
    const terminal = manager.create({ input: input('C:/terminal') });
    await manager.start(terminal.jobId, async () => data('C:/terminal'));
    const active = manager.create({ input: input('C:/active') });

    now = 30 * 60 * 1000 - 1;
    expect(manager.getStatus(terminal.jobId).state).toBe('succeeded');
    now = 30 * 60 * 1000;
    expect(thrownToolError(() => manager.getStatus(terminal.jobId))).toMatchObject({
      code: 'NOT_FOUND',
    });
    expect(manager.getStatus(active.jobId).state).toBe('queued');
  });

  it('enforces the production 32-job cap after runner completion by updatedAt', async () => {
    let now = 0;
    let nextId = 0;
    const manager = new ControlWorkflowJobManager({
      now: () => now,
      createId: () => `job-cap-${++nextId}`,
    });

    for (let index = 1; index <= 32; index += 1) {
      now = index;
      const job = manager.create({ input: input(`C:/job-${index}`) });
      await manager.start(job.jobId, async () => data(`C:/job-${index}`));
    }

    now = 1_000;
    manager.update('job-cap-1', data('C:/job-1'));

    now = 1_001;
    const newest = manager.create({ input: input('C:/job-33') });
    await manager.start(newest.jobId, async () => data('C:/job-33'));

    const ids = manager.listJobs().map((job) => job.jobId);
    expect(ids).toHaveLength(32);
    expect(ids).toContain('job-cap-1');
    expect(ids).not.toContain('job-cap-2');
    expect(ids).toContain('job-cap-33');
  });

  it('characterizes queued-cancellation over-cap retention until a later completion', async () => {
    let nextId = 0;
    const manager = new ControlWorkflowJobManager({
      createId: () => `job-cancel-cap-${++nextId}`,
    });

    for (let index = 1; index <= 33; index += 1) {
      const job = manager.create({ input: input(`C:/cancel-${index}`) });
      manager.cancel(job.jobId);
    }
    expect(manager.listJobs()).toHaveLength(33);

    const converging = manager.create({ input: input('C:/converge') });
    await manager.start(converging.jobId, async () => data('C:/converge'));
    expect(manager.listJobs()).toHaveLength(32);
  });

  it('cleanup removes matching terminal jobs but preserves active jobs', async () => {
    let nextId = 0;
    const manager = new ControlWorkflowJobManager({
      createId: () => `job-cleanup-${++nextId}`,
    });
    const terminal = manager.create({ input: input('C:/terminal') });
    await manager.start(terminal.jobId, async () => data('C:/terminal'));
    const active = manager.create({ input: input('C:/active') });

    expect(manager.cleanup({ jobId: active.jobId })).toEqual({ removed: 0 });
    expect(manager.getStatus(active.jobId).state).toBe('queued');
    expect(manager.cleanup({ jobId: terminal.jobId })).toEqual({ removed: 1 });
    expect(() => manager.getStatus(terminal.jobId)).toThrow(/not found/i);
    expect(manager.cleanup()).toEqual({ removed: 0 });
    expect(manager.getStatus(active.jobId).state).toBe('queued');
  });
});
