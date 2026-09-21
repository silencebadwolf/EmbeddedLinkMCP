import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRuntime, ToolError, type Runtime, type RuntimeOptions } from '@linkterm/runtime';
import { SessionBase } from '@linkterm/runtime/core/session/session-base';
import { AuditStore } from '@linkterm/runtime/core/activity/audit-store';
import { NullJLinkBackend } from '@linkterm/runtime/jlink/null-backend';
import { createAndOpenSession } from '@linkterm/runtime/services/session-open';
import { MockTransport } from '../../../tests/fixtures/mock-transport.js';
import { createMockPtyFactory } from '../../../tests/fixtures/mock-pty.js';

class TestSession extends SessionBase {}
const roots: string[] = [];
const runtimes: Runtime[] = [];

async function fixture(overrides: Partial<RuntimeOptions> = {}) {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'linkterm-runtime-'));
  roots.push(dataDir);
  const pty = createMockPtyFactory();
  const options: RuntimeOptions = {
    dataDir,
    nativeBindings: {
      createPty: pty.factory,
      createSerialPort: () => {
        throw new Error('No hardware in this fixture');
      },
      listSerialPorts: async () => [],
    },
    secretCodec: {
      isAvailable: () => false,
      encryptUtf8: () => {
        throw new Error('Credential storage disabled');
      },
      decryptUtf8: () => {
        throw new Error('Credential storage disabled');
      },
    },
    jlinkBackend: new NullJLinkBackend(),
    ...overrides,
  };
  return { options, pty };
}

async function openRuntime(overrides: Partial<RuntimeOptions> = {}) {
  const { options, pty } = await fixture(overrides);
  const runtime = await createRuntime(options);
  runtimes.push(runtime);
  return { runtime, pty };
}

afterEach(async () => {
  for (const runtime of runtimes.splice(0)) await runtime.dispose().catch(() => undefined);
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

describe('host-owned runtime lifecycle', () => {
  it('uses independently injected native factories and disposes each runtime once', async () => {
    const first = await openRuntime();
    const second = await openRuntime();
    const opened = await createAndOpenSession(first.runtime.sessionManager, {
      type: 'local-shell',
    });
    expect(opened.state).toBe('open');
    expect(first.pty.created).toHaveLength(1);
    expect(second.pty.created).toHaveLength(0);
    expect(second.runtime.sessionManager.list()).toEqual([]);
    const disposing = first.runtime.dispose();
    expect(first.runtime.dispose()).toBe(disposing);
    await disposing;
    expect(first.pty.created[0].killCalls).toBe(1);
    expect(() =>
      first.runtime.sessionManager.create(() => {
        throw new Error('must not run');
      }),
    ).toThrow('shutting down');
    expect(() =>
      first.runtime.controlWorkflowJobManager.create({
        input: { root: first.runtime.dataDir, mode: 'flash-observe' },
      }),
    ).toThrow('shutting down');
  });

  it('waits for an in-flight open and releases the late transport without publishing a session', async () => {
    let finishOpen!: () => void;
    const gate = new Promise<void>((resolve) => {
      finishOpen = resolve;
    });
    const transport = new MockTransport();
    const originalOpen = transport.open.bind(transport);
    vi.spyOn(transport, 'open').mockImplementation(async () => {
      await gate;
      await originalOpen();
    });
    const close = vi.spyOn(transport, 'close');
    const { runtime } = await openRuntime({
      sessionFactory: (id) => new TestSession({ id, transport }),
    });
    const published = vi.fn();
    runtime.sessionManager.on('session:created', published);
    const opening = runtime.sessionManager.createAndOpen((id) =>
      runtime.sessionManager.sessionFactory!(id, { type: 'local-shell' }),
    );
    const rejected = expect(opening).rejects.toThrow('shut down');
    let disposed = false;
    const disposing = runtime.dispose().then(() => {
      disposed = true;
    });
    await Promise.resolve();
    expect(disposed).toBe(false);
    finishOpen();
    await rejected;
    await disposing;
    expect(close).toHaveBeenCalled();
    expect(transport.isOpen()).toBe(false);
    expect(published).not.toHaveBeenCalled();
    expect(runtime.sessionManager.list()).toEqual([]);
  });

  it('waits for background cancellation cleanup and retains terminal job evidence', async () => {
    const { runtime } = await openRuntime();
    let finishCleanup!: () => void;
    const cleanup = new Promise<void>((resolve) => {
      finishCleanup = resolve;
    });
    const cancelled = vi.fn();
    const job = runtime.controlWorkflowJobManager.create({
      input: { root: runtime.dataDir, mode: 'flash-observe' },
    });
    const running = runtime.controlWorkflowJobManager.start(
      job.jobId,
      ({ signal }) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener(
            'abort',
            () => {
              cancelled();
              void cleanup.then(() => reject(new ToolError('ABORTED', 'test cancellation')));
            },
            { once: true },
          );
        }),
    );
    let disposed = false;
    const disposing = runtime.dispose().then(() => {
      disposed = true;
    });
    await Promise.resolve();
    expect(cancelled).toHaveBeenCalledOnce();
    expect(disposed).toBe(false);
    finishCleanup();
    expect((await running).state).toBe('cancelled');
    await disposing;
  });

  it('rolls back resources when audit initialization fails', async () => {
    const releaseBackend = vi.fn(async () => undefined);
    const { options } = await fixture({ disposeJLinkBackend: releaseBackend });
    const flush = vi.spyOn(AuditStore.prototype, 'dispose');
    vi.spyOn(AuditStore.prototype, 'initialize').mockRejectedValueOnce(
      new Error('injected initialization failure'),
    );
    await expect(createRuntime(options)).rejects.toThrow('injected initialization failure');
    expect(releaseBackend).toHaveBeenCalledOnce();
    expect(flush).toHaveBeenCalledOnce();
  });

  it('flushes audit records and closes sessions even if backend disposal fails', async () => {
    const { runtime, pty } = await openRuntime({
      disposeJLinkBackend: async () => {
        throw new Error('injected disposal failure');
      },
    });
    await createAndOpenSession(runtime.sessionManager, { type: 'local-shell' });
    const auditDispose = vi.spyOn(runtime.auditStore, 'dispose');
    await expect(runtime.dispose()).rejects.toThrow('Runtime resource disposal failed');
    expect(pty.created[0].killCalls).toBe(1);
    expect(auditDispose).toHaveBeenCalledOnce();
    expect(runtime.sessionManager.list()).toEqual([]);
  });
});
