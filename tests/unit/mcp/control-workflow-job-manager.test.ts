import { describe, expect, it, vi } from 'vitest';
import { ControlWorkflowJobManager } from '@/mcp/surfaces/control-workflow/job-manager.js';
import type { ControlWorkflowData } from '@/mcp/surfaces/control-workflow/types.js';
import type { RunControlWorkflowInput } from '@/mcp/surfaces/control-workflow/schemas.js';
import { ToolError } from '@/mcp/registry.js';

function input(root = 'C:/workspace'): RunControlWorkflowInput {
  return { root, mode: 'flash-observe', confirm: true };
}

function data(root = 'C:/workspace', steps: Array<{ id: string; status: 'passed' | 'failed' | 'skipped' }> = []): ControlWorkflowData {
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
      debugCaptured: false,
    },
    nextActions: [],
  };
}

describe('ControlWorkflowJobManager', () => {
  it('runs a job through queued, running, and succeeded states with retained evidence', async () => {
    let now = 1_000;
    const manager = new ControlWorkflowJobManager({
      now: () => now,
      createId: () => 'job-1',
      ttlMs: 10_000,
    });

    const job = manager.create({ input: input(), correlationId: 'corr-1' });
    expect(job).toMatchObject({ jobId: 'job-1', state: 'queued', mode: 'flash-observe', root: 'C:/workspace' });

    const completion = manager.start('job-1', async ({ update }) => {
      now = 1_100;
      update(data('C:/workspace', [{ id: 'load_profile', status: 'passed' }]));
      return data('C:/workspace', [
        { id: 'load_profile', status: 'passed' },
        { id: 'flash', status: 'passed' },
      ]);
    });

    expect(manager.getStatus('job-1')).toMatchObject({ state: 'running', startedAt: 1_000, currentStepId: 'load_profile' });
    await completion;

    expect(manager.getStatus('job-1')).toMatchObject({
      state: 'succeeded',
      completedAt: 1_100,
      expiresAt: 11_100,
      currentStepId: 'flash',
    });
    expect(manager.read('job-1').workflow?.steps.map((step) => step.id)).toEqual(['load_profile', 'flash']);
  });

  it('rejects a second active job and never starts competing hardware work', () => {
    const manager = new ControlWorkflowJobManager({ createId: vi.fn().mockReturnValueOnce('job-1').mockReturnValueOnce('job-2') });

    manager.create({ input: input('C:/a') });

    expect(() => manager.create({ input: input('C:/b') })).toThrow(/active control workflow job/i);
    expect(manager.listJobs().map((job) => job.jobId)).toEqual(['job-1']);
  });

  it('cancels a running job with AbortSignal and keeps completed partial evidence', async () => {
    const manager = new ControlWorkflowJobManager({ createId: () => 'job-1' });
    manager.create({ input: input() });

    const completion = manager.start('job-1', async ({ signal, update }) => {
      update(data('C:/workspace', [{ id: 'connect_probe', status: 'passed' }]));
      await new Promise<void>((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new ToolError('ABORTED', 'cancelled')), { once: true });
      });
      return data();
    });

    const cancelled = manager.cancel('job-1');
    expect(cancelled).toMatchObject({ state: 'running', cancelRequested: true });
    await completion;

    expect(manager.getStatus('job-1')).toMatchObject({ state: 'cancelled', currentStepId: 'job_cancelled' });
    const evidence = manager.read('job-1').workflow;
    expect(evidence?.steps.map((step) => step.id)).toEqual(['connect_probe', 'job_cancelled']);
    expect(evidence?.steps.at(-1)).toMatchObject({ status: 'failed', error: { code: 'ABORTED' } });
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

    now = 200;
    expect(manager.cleanup({ expiredOnly: true })).toEqual({ removed: 1 });
    expect(() => manager.getStatus('job-2')).toThrow(/not found/i);
  });
});
