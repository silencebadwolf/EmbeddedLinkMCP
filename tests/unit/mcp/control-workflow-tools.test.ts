import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, symlink, truncate, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SessionBase } from '@/core/session/session-base.js';
import { SessionManager } from '@/core/session/session-manager.js';
import { ControlProfileManager } from '@/core/workspace/index.js';
import { JLinkNotImplementedError, JLinkOperationError } from '@/jlink/errors.js';
import type { FlashDownloadOptions, IJLinkBackend } from '@/jlink/types.js';
import type { JLinkDeviceCatalog } from '@/jlink/device-catalog.js';
import { createMcpServer } from '@/mcp/index.js';
import type { LinkTermMcpServer } from '@/mcp/server.js';
import { ControlWorkflowJobManager } from '@/mcp/surfaces/control-workflow/job-manager.js';
import type { SerialSessionConfig, SessionState } from '@/shared/types.js';
import { SerialDiscovery } from '@/transports/serial/serial-discovery.js';
import { cortexMVectorImage, elf32LeImage } from '../../fixtures/elf.js';
import { FakeJLinkBackend } from '../../fixtures/fake-jlink-backend.js';
import { intelHexRecord, intelHexText } from '../../fixtures/intel-hex.js';
import { createInMemoryMcpTransportPair } from '../../fixtures/mock-mcp-transport.js';
import { MockTransport } from '../../fixtures/mock-transport.js';

class TestSerialSession extends SessionBase {}

interface Harness {
  manager: SessionManager;
  serialDiscovery: SerialDiscovery;
  controlProfileManager: ControlProfileManager;
  fake: FakeJLinkBackend;
  jobManager: ControlWorkflowJobManager;
  mcp: LinkTermMcpServer;
  client: Client;
  root: string;
  transport: MockTransport;
  openSerialCalls: SerialSessionConfig[];
}

interface SetupOptions {
  jlinkBackend?: IJLinkBackend;
  jlinkDeviceCatalog?: JLinkDeviceCatalog;
  openSerial?: (config: SerialSessionConfig) => Promise<{ sessionId: string; state: SessionState }>;
  jobManager?: ControlWorkflowJobManager;
  hostPathResolver?: { toHostPath(inputPath: string): Promise<string> };
}

async function setup(options: SetupOptions = {}): Promise<Harness> {
  const root = await mkdtemp(path.join(tmpdir(), 'lt-control-workflow-mcp-'));
  const manager = new SessionManager();
  const serialDiscovery = new SerialDiscovery({ listFn: async () => [] });
  const controlProfileManager = new ControlProfileManager();
  const fake = new FakeJLinkBackend();
  const jobManager = options.jobManager ?? new ControlWorkflowJobManager();
  const transport = new MockTransport();
  const openSerialCalls: SerialSessionConfig[] = [];
  const { server: serverTransport, client: clientTransport } = createInMemoryMcpTransportPair();
  const mcp = createMcpServer({
    sessionManager: manager,
    serialDiscovery,
    controlProfileManager,
    jlinkBackend: options.jlinkBackend ?? fake,
    jlinkDeviceCatalog: options.jlinkDeviceCatalog,
    controlWorkflowJobManager: jobManager,
    controlProfileOpenSerial:
      options.openSerial ??
      (async (config) => {
        openSerialCalls.push(config);
        const session = await manager.createAndOpen(
          (id) => new TestSerialSession({ id, transport }),
          {
            connectionType: 'serial',
            label: config.label,
            createdBy: 'ai',
            serial: { port: config.port, baudRate: config.baudRate, mode: config.mode },
          } as unknown as Parameters<SessionManager['createAndOpen']>[1],
        );
        return { sessionId: session.id, state: session.state as SessionState };
      }),
    hostPathResolver: options.hostPathResolver,
    transportFactory: () => serverTransport,
  });
  await mcp.start();
  const client = new Client({ name: 'lt-control-workflow-test', version: '0.0.0' });
  await client.connect(clientTransport);
  return {
    manager,
    serialDiscovery,
    controlProfileManager,
    fake,
    jobManager,
    mcp,
    client,
    root,
    transport,
    openSerialCalls,
  };
}

async function teardown(h: Harness): Promise<void> {
  try {
    await h.client.close();
  } catch {
    /* ignore */
  }
  await h.mcp.stop();
  await h.manager.destroyAll();
  h.serialDiscovery.dispose();
  await rm(h.root, { recursive: true, force: true });
}

async function callTool(
  client: Client,
  name: string,
  args: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  const res = await client.callTool({ name, arguments: args });
  expect(res.structuredContent).toBeDefined();
  return res.structuredContent as Record<string, unknown>;
}

async function initProfile(h: Harness, opts: { speedKHz?: number | 'auto' } = {}): Promise<void> {
  await writeFile(path.join(h.root, 'rtthread.bin'), Buffer.from([0x01, 0x02, 0x03, 0x04]));
  await callTool(h.client, 'init_control_profile', {
    root: h.root,
    profile: {
      serial: { enabled: true, port: 'COM7', baudRate: 921600, mode: 'terminal' },
      jlink: {
        enabled: true,
        target: 'AT32F435RGT7',
        interface: 'swd',
        speedKHz: opts.speedKHz ?? 4000,
      },
      flash: { binary: 'rtthread.bin', baseAddress: '0x08008000', verify: true },
    },
  });
}

async function waitForJobState(
  client: Client,
  jobId: string,
  terminalStates: string[],
): Promise<Record<string, unknown>> {
  const started = Date.now();
  for (;;) {
    const out = await callTool(client, 'get_control_workflow_job_status', { jobId });
    const data = (out.evidence as { data: Record<string, unknown> }).data;
    if (terminalStates.includes(String(data.state))) return data;
    if (Date.now() - started > 2000) throw new Error(`Timed out waiting for job ${jobId}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

async function waitForJobStep(client: Client, jobId: string, stepId: string): Promise<void> {
  const started = Date.now();
  for (;;) {
    const out = await callTool(client, 'read_control_workflow_job', { jobId });
    const data = (out.evidence as { data: { workflow?: { steps: Array<{ id: string }> } } }).data;
    if (data.workflow?.steps.some((step) => step.id === stepId) === true) return;
    if (Date.now() - started > 2000)
      throw new Error(`Timed out waiting for job ${jobId} step ${stepId}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe('MCP control workflow tool', () => {
  let h: Harness;

  beforeEach(async () => {
    h = await setup();
  });

  afterEach(async () => {
    await teardown(h);
  });

  it('starts a background workflow job quickly and preserves synchronous workflow compatibility', async () => {
    await initProfile(h);
    h.fake.delayMs = 50;

    const out = await callTool(h.client, 'run_control_workflow', {
      root: h.root,
      mode: 'debug-diagnose',
      execution: { mode: 'background' },
      confirm: true,
    });

    expect(out.success).toBe(true);
    const started = (
      out.evidence as {
        data: {
          jobId: string;
          state: string;
          tools: Record<string, string>;
        };
      }
    ).data;
    expect(started.jobId).toMatch(/^cwjob-/);
    expect(['queued', 'running']).toContain(started.state);
    expect(started.tools).toMatchObject({
      status: 'get_control_workflow_job_status',
      read: 'read_control_workflow_job',
      cancel: 'cancel_control_workflow_job',
      cleanup: 'cleanup_control_workflow_jobs',
    });

    const finalStatus = await waitForJobState(h.client, started.jobId, [
      'succeeded',
      'failed',
      'cancelled',
    ]);
    expect(finalStatus).toMatchObject({ state: 'succeeded', currentStepId: 'gdb_server_stop' });

    const sync = await callTool(h.client, 'run_control_workflow', {
      root: h.root,
      mode: 'debug-diagnose',
      confirm: true,
    });
    expect(sync.success).toBe(true);
    const syncData = (sync.evidence as { data: { steps: Array<{ id: string }> } }).data;
    expect(syncData.steps.map((step) => step.id)).toContain('debug_diagnose');
    expect(syncData).not.toHaveProperty('jobId');
  });

  it('does not create a background job when high-impact confirmation is missing', async () => {
    await initProfile(h);

    const out = await callTool(h.client, 'run_control_workflow', {
      root: h.root,
      mode: 'flash-observe-diagnose',
      execution: { mode: 'background' },
      confirm: false,
    });

    expect(out.success).toBe(false);
    expect((out.error as { code: string }).code).toBe('CONFIRMATION_REQUIRED');
    expect(h.jobManager.listJobs()).toHaveLength(0);
    expect(h.openSerialCalls).toHaveLength(0);
    expect(h.fake.callsOf('probeConnect')).toHaveLength(0);
    expect(h.fake.callsOf('flashDownload')).toHaveLength(0);
    expect(h.fake.callsOf('cpuReset')).toHaveLength(0);
  });

  it('reads background job status and evidence and reports unknown jobs structurally', async () => {
    await initProfile(h);
    h.fake.delayMs = 20;

    const out = await callTool(h.client, 'run_control_workflow', {
      root: h.root,
      mode: 'debug-diagnose',
      execution: { mode: 'background' },
      confirm: true,
    });
    const jobId = (out.evidence as { data: { jobId: string } }).data.jobId;

    const active = await callTool(h.client, 'get_control_workflow_job_status', { jobId });
    expect(active.success).toBe(true);
    expect(
      (active.evidence as { data: { jobId: string; state: string; workflow?: unknown } }).data,
    ).toMatchObject({
      jobId,
      state: expect.stringMatching(/queued|running|succeeded/),
    });
    expect((active.evidence as { data: { workflow?: unknown } }).data.workflow).toBeUndefined();

    await waitForJobState(h.client, jobId, ['succeeded']);
    const evidence = await callTool(h.client, 'read_control_workflow_job', { jobId });
    const data = (evidence.evidence as { data: { workflow: { steps: Array<{ id: string }> } } })
      .data;
    expect(data.workflow.steps.map((step) => step.id)).toEqual([
      'load_profile',
      'preflight',
      'connect_probe',
      'gdb_server_start',
      'debug_diagnose',
      'gdb_server_stop',
    ]);

    const missing = await callTool(h.client, 'get_control_workflow_job_status', {
      jobId: 'missing-job',
    });
    expect(missing.success).toBe(false);
    expect((missing.error as { code: string }).code).toBe('NOT_FOUND');
  });

  it('cancels an active background job and keeps completed partial evidence', async () => {
    await initProfile(h);
    h.fake.delayMs = 10_000;

    const out = await callTool(h.client, 'run_control_workflow', {
      root: h.root,
      mode: 'debug-diagnose',
      execution: { mode: 'background' },
      confirm: true,
    });
    const jobId = (out.evidence as { data: { jobId: string } }).data.jobId;
    await waitForJobStep(h.client, jobId, 'connect_probe');

    const cancelled = await callTool(h.client, 'cancel_control_workflow_job', { jobId });
    expect(cancelled.success).toBe(true);
    expect(
      (cancelled.evidence as { data: { cancelRequested: boolean } }).data.cancelRequested,
    ).toBe(true);

    const finalStatus = await waitForJobState(h.client, jobId, ['cancelled']);
    expect(finalStatus.state).toBe('cancelled');
    const evidence = await callTool(h.client, 'read_control_workflow_job', { jobId });
    const steps = (
      evidence.evidence as {
        data: { workflow: { steps: Array<{ id: string; error?: { code: string } }> } };
      }
    ).data.workflow.steps;
    expect(steps.map((step) => step.id)).toContain('connect_probe');
    expect(steps.at(-1)).toMatchObject({ id: 'job_cancelled', error: { code: 'ABORTED' } });
  });

  it('reports flash as the current background step while a download is in progress', async () => {
    await writeFile(path.join(h.root, 'rtthread.bin'), cortexMVectorImage(0x08008000));
    await callTool(h.client, 'init_control_profile', {
      root: h.root,
      profile: {
        serial: { enabled: false },
        jlink: { enabled: true, target: 'AT32F435RGT7', interface: 'swd', speedKHz: 4000 },
        flash: { binary: 'rtthread.bin', baseAddress: '0x08008000', verify: true },
      },
    });
    h.fake.delayMs = 10_000;

    const out = await callTool(h.client, 'run_control_workflow', {
      root: h.root,
      mode: 'flash-observe',
      observe: { serial: false },
      execution: { mode: 'background' },
      confirm: true,
    });
    const jobId = (out.evidence as { data: { jobId: string } }).data.jobId;
    await waitForJobStep(h.client, jobId, 'flash');

    const status = await callTool(h.client, 'get_control_workflow_job_status', { jobId });
    const data = (
      status.evidence as {
        data: {
          currentStepId?: string;
        };
      }
    ).data;
    expect(data.currentStepId).toBe('flash');
    const evidence = await callTool(h.client, 'read_control_workflow_job', { jobId });
    const workflow = (
      evidence.evidence as {
        data: { workflow?: { steps: Array<{ id: string; status: string }> } };
      }
    ).data.workflow;
    expect(workflow?.steps.find((step) => step.id === 'flash')).toMatchObject({
      status: 'running',
    });

    const cancelled = await callTool(h.client, 'cancel_control_workflow_job', { jobId });
    expect(cancelled.success).toBe(true);
    await waitForJobState(h.client, jobId, ['cancelled']);
  });

  it('applies schema version policy to background job tools by sensitivity', async () => {
    await initProfile(h);

    const out = await callTool(h.client, 'run_control_workflow', {
      root: h.root,
      mode: 'debug-diagnose',
      execution: { mode: 'background' },
      confirm: true,
    });
    const jobId = (out.evidence as { data: { jobId: string } }).data.jobId;
    await waitForJobState(h.client, jobId, ['succeeded']);

    const status = await callTool(h.client, 'get_control_workflow_job_status', {
      jobId,
      clientSchemaVersion: 'linkterm-mcp/0.0.0',
    });
    expect(status.success).toBe(true);
    expect((status.evidence as { meta?: { warning?: string } }).meta?.warning).toMatch(
      /schema version mismatch/i,
    );

    const cleanup = await callTool(h.client, 'cleanup_control_workflow_jobs', {
      jobId,
      clientSchemaVersion: 'linkterm-mcp/0.0.0',
    });
    expect(cleanup.success).toBe(false);
    expect((cleanup.error as { code: string }).code).toBe('VERSION_MISMATCH');
  });

  it('requires confirm=true before debug-diagnose starts a managed GDB server', async () => {
    await initProfile(h);

    const out = await callTool(h.client, 'run_control_workflow', {
      root: h.root,
      mode: 'debug-diagnose',
      confirm: false,
    });

    expect(out.success).toBe(false);
    expect((out.error as { code: string }).code).toBe('CONFIRMATION_REQUIRED');
    expect(h.fake.callsOf('probeConnect')).toHaveLength(0);
    expect(h.fake.callsOf('gdbServerStart')).toHaveLength(0);
  });

  it('starts a managed GDB server before debug diagnosis', async () => {
    await initProfile(h);

    const out = await callTool(h.client, 'run_control_workflow', {
      root: h.root,
      mode: 'debug-diagnose',
      confirm: true,
    });

    expect(out.success).toBe(true);
    const data = (
      out.evidence as {
        data: {
          summary: Record<string, boolean>;
          steps: Array<{ id: string; status: string; evidence?: Record<string, unknown> }>;
        };
      }
    ).data;
    expect(data.summary).toMatchObject({
      probeConnected: true,
      gdbServerStarted: true,
      debugCaptured: true,
    });
    expect(data.steps.map((step) => step.id)).toEqual([
      'load_profile',
      'preflight',
      'connect_probe',
      'gdb_server_start',
      'debug_diagnose',
      'gdb_server_stop',
    ]);
    expect(data.steps.find((step) => step.id === 'gdb_server_start')?.evidence).toMatchObject({
      handle: { host: '127.0.0.1', port: 2331 },
    });
    expect(h.fake.callsOf('gdbServerStart')).toHaveLength(1);
    expect(h.fake.callsOf('gdbServerStop')).toHaveLength(1);
    expect(h.fake.callsOf('registerList')).toHaveLength(1);
  });

  it('skips GDB server start deterministically when backend support is missing', async () => {
    class NoGdbBackend extends FakeJLinkBackend {
      async gdbServerStart(): Promise<never> {
        throw new JLinkNotImplementedError('gdbServerStart');
      }
    }
    await teardown(h);
    const backend = new NoGdbBackend();
    h = await setup({ jlinkBackend: backend });
    await initProfile(h);

    const out = await callTool(h.client, 'run_control_workflow', {
      root: h.root,
      mode: 'debug-diagnose',
      confirm: true,
    });

    expect(out.success).toBe(true);
    const data = (
      out.evidence as {
        data: {
          steps: Array<{ id: string; status: string }>;
          nextActions: Array<{ tool?: string; message: string }>;
        };
      }
    ).data;
    expect(data.steps).toContainEqual(
      expect.objectContaining({ id: 'gdb_server_start', status: 'skipped' }),
    );
    expect(data.nextActions).toContainEqual(
      expect.objectContaining({
        tool: 'gdb_server_start',
        message: expect.stringContaining('GDB server'),
      }),
    );
    expect(backend.callsOf('registerList')).toHaveLength(1);
  });

  it('runs flash-observe-diagnose from profile without base64 chunking', async () => {
    await initProfile(h);

    const pending = callTool(h.client, 'run_control_workflow', {
      root: h.root,
      mode: 'flash-observe-diagnose',
      observe: { markers: ['RT-Thread', 'msh'], timeoutMs: 1000 },
      confirm: true,
    });
    const timer = setInterval(() => {
      h.transport.pushIncoming(Buffer.from('\\r\\nRT-Thread 5.0\\r\\nmsh />'));
    }, 20);

    const out = await pending.finally(() => clearInterval(timer));

    expect(out.success).toBe(true);
    const data = (
      out.evidence as {
        data: { summary: Record<string, boolean>; steps: Array<{ id: string; status: string }> };
      }
    ).data;
    expect(data.summary).toMatchObject({
      serialOpened: true,
      probeConnected: true,
      flashed: true,
      verified: true,
      reset: true,
      serialObserved: true,
    });
    expect(data.steps.map((step) => step.id)).toEqual([
      'load_profile',
      'preflight',
      'open_serial',
      'connect_probe',
      'flash',
      'cpu_reset',
      'observe_serial',
    ]);
    expect(data.steps.find((step) => step.id === 'flash')).toMatchObject({
      evidence: {
        verification: {
          requested: true,
          method: 'commander-verifybin-plus-savebin-readback',
          postDownloadReadbackRequired: true,
        },
      },
    });
    expect(h.fake.callsOf('flashDownload')[0]!.args).toMatchObject([
      expect.any(String),
      4,
      { address: 0x08008000, verify: true },
    ]);
    expect(h.fake.callsOf('cpuReset')).toHaveLength(1);
  });

  it('decodes Intel HEX firmware before raw flash download', async () => {
    class CapturingBackend extends FakeJLinkBackend {
      downloadedBinary: Buffer | undefined;

      override async flashDownload(
        probeId: string,
        binary: Buffer,
        opts?: FlashDownloadOptions,
        signal?: AbortSignal,
      ): Promise<{ bytesWritten: number; verified: boolean }> {
        this.downloadedBinary = Buffer.from(binary);
        return super.flashDownload(probeId, binary, opts, signal);
      }
    }
    await teardown(h);
    const backend = new CapturingBackend();
    h = await setup({ jlinkBackend: backend });
    const decoded = Buffer.from([
      0x00, 0x00, 0x00, 0x20, 0x11, 0x80, 0x00, 0x08, 0xaa, 0xbb, 0xcc, 0xdd, 0x10, 0x11, 0x12,
      0x13, 0x14, 0x15, 0x16, 0x17,
    ]);
    await writeFile(
      path.join(h.root, 'rtthread.hex'),
      intelHexText([
        intelHexRecord(0, 0x04, [0x08, 0x00]),
        intelHexRecord(0x8000, 0x00, Array.from(decoded)),
        intelHexRecord(0, 0x01, []),
      ]),
    );
    await callTool(h.client, 'init_control_profile', {
      root: h.root,
      profile: {
        serial: { enabled: false },
        jlink: { enabled: true, target: 'AT32F435RGT7', interface: 'swd', speedKHz: 4000 },
        flash: { binary: 'rtthread.hex', baseAddress: '0x08008000', verify: true },
      },
    });

    const out = await callTool(h.client, 'run_control_workflow', {
      root: h.root,
      mode: 'flash-observe',
      observe: { serial: false },
      confirm: true,
    });

    expect(out.success).toBe(true);
    expect(backend.downloadedBinary).toEqual(decoded);
    expect(backend.callsOf('flashDownload')[0]!.args).toMatchObject([
      expect.any(String),
      decoded.byteLength,
      { address: 0x08008000, verify: true },
    ]);
    const data = (
      out.evidence as {
        data: { steps: Array<{ id: string; evidence?: Record<string, unknown> }> };
      }
    ).data;
    expect(data.steps.find((step) => step.id === 'flash')?.evidence).toMatchObject({
      address: 0x08008000,
      firmwareFormat: 'intel-hex',
    });
  });

  it('decodes ELF firmware before raw flash download', async () => {
    class CapturingBackend extends FakeJLinkBackend {
      downloadedBinary: Buffer | undefined;

      override async flashDownload(
        probeId: string,
        binary: Buffer,
        opts?: FlashDownloadOptions,
        signal?: AbortSignal,
      ): Promise<{ bytesWritten: number; verified: boolean }> {
        this.downloadedBinary = Buffer.from(binary);
        return super.flashDownload(probeId, binary, opts, signal);
      }
    }
    await teardown(h);
    const backend = new CapturingBackend();
    h = await setup({ jlinkBackend: backend });
    const decoded = cortexMVectorImage(0x08008000);
    await writeFile(
      path.join(h.root, 'rtthread.elf'),
      elf32LeImage([{ paddr: 0x08008000, data: decoded }]),
    );
    await callTool(h.client, 'init_control_profile', {
      root: h.root,
      profile: {
        serial: { enabled: false },
        jlink: { enabled: true, target: 'AT32F435RGT7', interface: 'swd', speedKHz: 4000 },
        flash: { binary: 'rtthread.elf', baseAddress: '0x08008000', verify: true },
      },
    });

    const out = await callTool(h.client, 'run_control_workflow', {
      root: h.root,
      mode: 'flash-observe',
      observe: { serial: false },
      confirm: true,
    });

    expect(out.success).toBe(true);
    expect(backend.downloadedBinary).toEqual(decoded);
    expect(backend.callsOf('flashDownload')[0]!.args).toMatchObject([
      expect.any(String),
      decoded.byteLength,
      { address: 0x08008000, verify: true },
    ]);
    const data = (
      out.evidence as {
        data: { steps: Array<{ id: string; evidence?: Record<string, unknown> }> };
      }
    ).data;
    expect(data.steps.find((step) => step.id === 'flash')?.evidence).toMatchObject({
      address: 0x08008000,
      firmwareFormat: 'elf',
    });
  });

  it('rejects ELF firmware when the configured base address differs from the image address', async () => {
    await writeFile(
      path.join(h.root, 'rtthread.elf'),
      elf32LeImage([{ paddr: 0x08008000, data: cortexMVectorImage(0x08008000) }]),
    );
    await callTool(h.client, 'init_control_profile', {
      root: h.root,
      profile: {
        serial: { enabled: false },
        jlink: { enabled: true, target: 'AT32F435RGT7', interface: 'swd', speedKHz: 4000 },
        flash: { binary: 'rtthread.elf', baseAddress: '0x08000000', verify: true },
      },
    });

    const out = await callTool(h.client, 'run_control_workflow', {
      root: h.root,
      mode: 'flash-observe',
      observe: { serial: false },
      confirm: true,
    });

    expect(out.success).toBe(false);
    expect((out.error as { code: string; message: string }).code).toBe('INVALID_ARGUMENT');
    expect((out.error as { message: string }).message).toContain(
      'ELF image base address 0x08008000',
    );
    expect(h.fake.callsOf('probeConnect')).toHaveLength(0);
    expect(h.fake.callsOf('flashDownload')).toHaveLength(0);
  });

  it('rejects Intel HEX firmware when the configured base address differs from the image address', async () => {
    await writeFile(
      path.join(h.root, 'rtthread.hex'),
      intelHexText([
        intelHexRecord(0, 0x04, [0x08, 0x00]),
        intelHexRecord(0x8000, 0x00, [0x00, 0x00, 0x00, 0x20, 0x11, 0x80, 0x00, 0x08]),
        intelHexRecord(0, 0x01, []),
      ]),
    );
    await callTool(h.client, 'init_control_profile', {
      root: h.root,
      profile: {
        serial: { enabled: false },
        jlink: { enabled: true, target: 'AT32F435RGT7', interface: 'swd', speedKHz: 4000 },
        flash: { binary: 'rtthread.hex', baseAddress: '0x08000000', verify: true },
      },
    });

    const out = await callTool(h.client, 'run_control_workflow', {
      root: h.root,
      mode: 'flash-observe',
      observe: { serial: false },
      confirm: true,
    });

    expect(out.success).toBe(false);
    expect((out.error as { code: string; message: string }).code).toBe('INVALID_ARGUMENT');
    expect((out.error as { message: string }).message).toContain('0x08008000');
    expect(h.fake.callsOf('probeConnect')).toHaveLength(0);
    expect(h.fake.callsOf('flashDownload')).toHaveLength(0);
  });

  it('runs flash-observe-diagnose without serial when RTT debug observation is requested', async () => {
    await writeFile(path.join(h.root, 'rtthread.bin'), Buffer.from([0x01, 0x02, 0x03, 0x04]));
    await callTool(h.client, 'init_control_profile', {
      root: h.root,
      profile: {
        serial: { enabled: false, port: 'COM7', baudRate: 921600, mode: 'terminal' },
        jlink: { enabled: true, target: 'AT32F435RGT7', interface: 'swd', speedKHz: 4000 },
        flash: { binary: 'rtthread.bin', baseAddress: '0x08008000', verify: true },
        rtt: { enabled: true },
      },
    });

    const out = await callTool(h.client, 'run_control_workflow', {
      root: h.root,
      mode: 'flash-observe-diagnose',
      observe: { serial: false, markers: ['hello-rtt'], timeoutMs: 100 },
      debug: { readRegisters: true, rttRead: true },
      confirm: true,
    });

    expect(out.success).toBe(true);
    const data = (
      out.evidence as {
        data: {
          summary: Record<string, boolean>;
          steps: Array<{ id: string; status: string; evidence?: Record<string, unknown> }>;
        };
      }
    ).data;
    expect(data.summary).toMatchObject({
      serialOpened: false,
      probeConnected: true,
      flashed: true,
      verified: true,
      reset: true,
      rttObserved: true,
      debugCaptured: true,
    });
    expect(data.steps.map((step) => step.id)).toEqual([
      'load_profile',
      'preflight',
      'connect_probe',
      'flash',
      'gdb_server_start',
      'connect_rtt',
      'cpu_reset',
      'observe_rtt',
      'debug_diagnose',
      'gdb_server_stop',
    ]);
    expect(h.openSerialCalls).toHaveLength(0);
    expect(h.fake.callsOf('gdbServerStart')).toHaveLength(1);
    expect(h.fake.callsOf('rttConnect')).toHaveLength(2);
    expect(h.fake.callsOf('rttClear')).toHaveLength(1);
    expect(h.fake.callsOf('rttRead').length).toBeGreaterThanOrEqual(2);
    expect(data.steps.find((step) => step.id === 'debug_diagnose')?.evidence).toMatchObject({
      rtt: {
        channelIndex: 0,
        dataBase64: Buffer.from('hello-rtt').toString('base64'),
        truncated: false,
      },
    });
  });

  it('does not require serial observation when the profile uses RTT', async () => {
    await writeFile(path.join(h.root, 'rtthread.bin'), Buffer.from([0x01, 0x02, 0x03, 0x04]));
    await callTool(h.client, 'init_control_profile', {
      root: h.root,
      profile: {
        jlink: { enabled: true, target: 'AT32F435RGT7', interface: 'swd', speedKHz: 4000 },
        flash: { binary: 'rtthread.bin', baseAddress: '0x08008000', verify: true },
        rtt: { enabled: true },
      },
    });

    const out = await callTool(h.client, 'run_control_workflow', {
      root: h.root,
      mode: 'flash-observe',
      observe: { markers: ['hello-rtt'], timeoutMs: 100 },
      confirm: true,
    });

    expect(out.success).toBe(true);
    const data = (
      out.evidence as {
        data: {
          summary: Record<string, boolean>;
          steps: Array<{ id: string; status: string; evidence?: unknown }>;
        };
      }
    ).data;
    expect(data.summary).toMatchObject({
      serialOpened: false,
      probeConnected: true,
      flashed: true,
      verified: true,
      reset: true,
      serialObserved: false,
      rttObserved: true,
    });
    expect(data.steps.map((step) => step.id)).toEqual([
      'load_profile',
      'preflight',
      'connect_probe',
      'flash',
      'gdb_server_start',
      'connect_rtt',
      'cpu_reset',
      'observe_rtt',
      'gdb_server_stop',
    ]);
    expect(data.steps.find((step) => step.id === 'preflight')?.evidence).toMatchObject({
      needsSerial: false,
      needsRtt: true,
      needsFlash: true,
    });
    expect(data.steps.find((step) => step.id === 'observe_rtt')?.evidence).toMatchObject({
      channelIndex: 0,
      outputPreview: expect.stringContaining('hello-rtt'),
    });
    expect(h.openSerialCalls).toHaveLength(0);
    expect(h.fake.callsOf('gdbServerStart')).toHaveLength(1);
    expect(h.fake.callsOf('rttConnect')).toHaveLength(1);
    expect(h.fake.callsOf('rttClear')).toHaveLength(1);
    expect(h.fake.callsOf('rttRead')).toHaveLength(1);
  });

  it('can run a verified flash workflow without RTT observation for download-only callers', async () => {
    await writeFile(path.join(h.root, 'rtthread.bin'), Buffer.from([0x01, 0x02, 0x03, 0x04]));
    await callTool(h.client, 'init_control_profile', {
      root: h.root,
      profile: {
        jlink: { enabled: true, target: 'AT32F435RGT7', interface: 'swd', speedKHz: 4000 },
        flash: { binary: 'rtthread.bin', baseAddress: '0x08008000', verify: true },
        rtt: { enabled: true },
      },
    });

    const out = await callTool(h.client, 'run_control_workflow', {
      root: h.root,
      mode: 'flash-observe',
      observe: { enabled: false },
      confirm: true,
    });

    expect(out.success).toBe(true);
    const data = (
      out.evidence as {
        data: {
          summary: Record<string, boolean>;
          steps: Array<{ id: string; status: string }>;
        };
      }
    ).data;
    expect(data.summary).toMatchObject({
      probeConnected: true,
      flashed: true,
      verified: true,
      reset: true,
      rttObserved: false,
    });
    expect(data.steps.map((step) => step.id)).toEqual([
      'load_profile',
      'preflight',
      'connect_probe',
      'flash',
      'cpu_reset',
    ]);
    expect(h.fake.callsOf('gdbServerStart')).toHaveLength(0);
    expect(h.fake.callsOf('rttConnect')).toHaveLength(0);
    expect(h.fake.callsOf('gdbServerStop')).toHaveLength(0);
  });

  it('classifies RTT connect failures after verified flash and stops the managed GDB server', async () => {
    await writeFile(path.join(h.root, 'rtthread.bin'), Buffer.from([0x01, 0x02, 0x03, 0x04]));
    await callTool(h.client, 'init_control_profile', {
      root: h.root,
      profile: {
        jlink: { enabled: true, target: 'AT32F435RGT7', interface: 'swd', speedKHz: 4000 },
        flash: { binary: 'rtthread.bin', baseAddress: '0x08008000', verify: true },
        rtt: { enabled: true },
      },
    });
    h.fake.failOnce.set(
      'rttConnect',
      new JLinkOperationError('Failed to connect to J-Link RTT telnet endpoint', {
        operation: 'rttConnect',
      }),
    );

    const out = await callTool(h.client, 'run_control_workflow', {
      root: h.root,
      mode: 'flash-observe',
      observe: { markers: ['hello-rtt'], timeoutMs: 100 },
      confirm: true,
    });

    expect(out.success).toBe(true);
    const data = (
      out.evidence as {
        data: {
          failedStep?: string;
          failureCode?: string;
          summary: Record<string, boolean>;
          steps: Array<{ id: string; status: string; error?: { failureCode?: string } }>;
          nextActions: Array<{ kind: string; tool?: string; requiresConfirm?: boolean }>;
        };
      }
    ).data;
    expect(data.summary).toMatchObject({
      flashed: true,
      verified: true,
      gdbServerStarted: true,
      reset: false,
      rttObserved: false,
    });
    expect(data.failedStep).toBe('connect_rtt');
    expect(data.failureCode).toBe('rtt_connect_failed');
    expect(data.steps.find((step) => step.id === 'connect_rtt')).toMatchObject({
      status: 'failed',
      error: { failureCode: 'rtt_connect_failed' },
    });
    expect(data.steps.find((step) => step.id === 'gdb_server_stop')).toMatchObject({
      status: 'passed',
    });
    expect(data.nextActions).toContainEqual(
      expect.objectContaining({
        kind: 'diagnose',
        tool: 'run_control_workflow',
        requiresConfirm: true,
      }),
    );
    expect(h.fake.callsOf('gdbServerStop')).toHaveLength(1);
  });

  it('rejects flash workflows when a Cortex-M vector table reset address does not match the flash base', async () => {
    const firmware = Buffer.alloc(64, 0xff);
    firmware.writeUInt32LE(0x24000d20, 0);
    firmware.writeUInt32LE(0x080a8141, 4);
    await writeFile(path.join(h.root, 'rtthread.bin'), firmware);
    await callTool(h.client, 'init_control_profile', {
      root: h.root,
      profile: {
        serial: { enabled: true, port: 'COM7', baudRate: 921600, mode: 'terminal' },
        jlink: { enabled: true, target: 'STM32H743II', interface: 'swd', speedKHz: 4000 },
        flash: { binary: 'rtthread.bin', baseAddress: '0x08008000', verify: true },
      },
    });

    const out = await callTool(h.client, 'run_control_workflow', {
      root: h.root,
      mode: 'flash-observe',
      observe: { timeoutMs: 50 },
      confirm: true,
    });

    expect(out.success).toBe(false);
    expect((out.error as { code: string; message: string }).code).toBe('INVALID_ARGUMENT');
    expect((out.error as { message: string }).message).toContain('reset vector');
    expect(h.fake.callsOf('probeConnect')).toHaveLength(0);
    expect(h.fake.callsOf('flashDownload')).toHaveLength(0);
  });

  it('reports profile and request parameter sources for J-Link and firmware inputs', async () => {
    await initProfile(h);
    await writeFile(path.join(h.root, 'override.bin'), Buffer.from([0x05, 0x06]));

    const pending = callTool(h.client, 'run_control_workflow', {
      root: h.root,
      mode: 'flash-observe',
      firmware: { filePath: 'override.bin', baseAddress: '0x08009000', verify: false },
      observe: { markers: ['msh'], timeoutMs: 1000 },
      confirm: true,
    });
    const timer = setInterval(() => {
      h.transport.pushIncoming(Buffer.from('msh />'));
    }, 20);

    const out = await pending.finally(() => clearInterval(timer));

    expect(out.success).toBe(true);
    expect(h.fake.callsOf('probeConnect')[0]!.args[0]).toMatchObject({
      target: 'AT32F435RGT7',
      interface: 'swd',
      speedKHz: 4000,
    });
    expect(h.fake.callsOf('flashDownload')[0]!.args).toMatchObject([
      expect.any(String),
      2,
      { address: 0x08009000, verify: false },
    ]);
    const data = (
      out.evidence as {
        data: { steps: Array<{ id: string; evidence?: Record<string, unknown> }> };
      }
    ).data;
    expect(data.steps.find((step) => step.id === 'connect_probe')?.evidence).toMatchObject({
      parameterSources: { target: 'profile', interface: 'profile', speedKHz: 'profile' },
    });
    expect(data.steps.find((step) => step.id === 'flash')?.evidence).toMatchObject({
      parameterSources: { filePath: 'request', baseAddress: 'request', verify: 'request' },
    });
    expect(JSON.stringify(data)).not.toMatch(/nRF52|JLinkMCP/);
  });

  it('normalizes STM32 order-code targets before workflow preflight and probe connection', async () => {
    await writeFile(path.join(h.root, 'rtthread.bin'), Buffer.from([0x01, 0x02, 0x03, 0x04]));
    await mkdir(path.join(h.root, '.linkterm'), { recursive: true });
    await writeFile(
      path.join(h.root, '.linkterm', 'control-profile.json'),
      JSON.stringify(
        {
          schemaVersion: 'linkterm-control/1.0.0',
          serial: { enabled: false },
          jlink: { enabled: true, target: 'STM32H743IIT6', interface: 'swd', speedKHz: 4000 },
          flash: { binary: 'rtthread.bin', baseAddress: '0x08008000', verify: true },
        },
        null,
        2,
      ),
    );
    await h.controlProfileManager.load(h.root);

    const out = await callTool(h.client, 'run_control_workflow', {
      root: h.root,
      mode: 'debug-diagnose',
      confirm: true,
    });

    expect(out.success).toBe(true);
    expect(h.fake.callsOf('probeConnect')[0]!.args[0]).toMatchObject({
      target: 'STM32H743II',
      interface: 'swd',
      speedKHz: 4000,
    });
    const data = (
      out.evidence as {
        data: { steps: Array<{ id: string; evidence?: Record<string, unknown> }> };
      }
    ).data;
    expect(data.steps.find((step) => step.id === 'connect_probe')?.evidence).toMatchObject({
      targetNormalization: {
        originalTarget: 'STM32H743IIT6',
        normalizedTarget: 'STM32H743II',
      },
    });
  });

  it('persists normalized STM32 order-code targets before new workflow profiles run', async () => {
    await writeFile(path.join(h.root, 'rtthread.bin'), Buffer.from([0x01, 0x02, 0x03, 0x04]));
    await callTool(h.client, 'init_control_profile', {
      root: h.root,
      profile: {
        jlink: { enabled: true, target: 'STM32H743IIT6', interface: 'swd', speedKHz: 4000 },
        flash: { binary: 'rtthread.bin', baseAddress: '0x08008000', verify: true },
      },
    });

    const out = await callTool(h.client, 'run_control_workflow', {
      root: h.root,
      mode: 'debug-diagnose',
      confirm: true,
    });

    expect(out.success).toBe(true);
    expect(h.fake.callsOf('probeConnect')[0]!.args[0]).toMatchObject({
      target: 'STM32H743II',
      interface: 'swd',
      speedKHz: 4000,
    });
  });

  it('defaults flash workflow firmware verification on when profile and request omit verify', async () => {
    await writeFile(path.join(h.root, 'rtthread.bin'), Buffer.from([0x01, 0x02, 0x03, 0x04]));
    await callTool(h.client, 'init_control_profile', {
      root: h.root,
      profile: {
        serial: { enabled: true, port: 'COM7', baudRate: 921600, mode: 'terminal' },
        jlink: { enabled: true, target: 'AT32F435RGT7', interface: 'swd', speedKHz: 4000 },
        flash: { binary: 'rtthread.bin', baseAddress: '0x08008000' },
      },
    });

    const pending = callTool(h.client, 'run_control_workflow', {
      root: h.root,
      mode: 'flash-observe',
      observe: { markers: ['msh'], timeoutMs: 1000 },
      confirm: true,
    });
    const timer = setInterval(() => {
      h.transport.pushIncoming(Buffer.from('msh />'));
    }, 20);

    const out = await pending.finally(() => clearInterval(timer));

    expect(out.success).toBe(true);
    expect(h.fake.callsOf('flashDownload')[0]!.args).toMatchObject([
      expect.any(String),
      4,
      { address: 0x08008000, verify: true },
    ]);
    const data = (
      out.evidence as {
        data: { steps: Array<{ id: string; evidence?: Record<string, unknown> }> };
      }
    ).data;
    expect(data.steps.find((step) => step.id === 'flash')?.evidence).toMatchObject({
      verified: true,
      parameterSources: { verify: 'default' },
    });
  });

  it('passes firmware timeout to flash backend and reports the request source', async () => {
    await initProfile(h);

    const pending = callTool(h.client, 'run_control_workflow', {
      root: h.root,
      mode: 'flash-observe',
      firmware: { timeoutMs: 90_000 },
      observe: { markers: ['msh'], timeoutMs: 1000 },
      confirm: true,
    });
    const timer = setInterval(() => {
      h.transport.pushIncoming(Buffer.from('msh />'));
    }, 20);

    const out = await pending.finally(() => clearInterval(timer));

    expect(out.success).toBe(true);
    expect(h.fake.callsOf('flashDownload')[0]!.args).toMatchObject([
      expect.any(String),
      4,
      { address: 0x08008000, verify: true, timeoutMs: 90_000 },
    ]);
    const data = (
      out.evidence as {
        data: { steps: Array<{ id: string; evidence?: Record<string, unknown> }> };
      }
    ).data;
    expect(data.steps.find((step) => step.id === 'flash')?.evidence).toMatchObject({
      timeoutMs: 90_000,
      parameterSources: { timeoutMs: 'request' },
    });
  });

  it('uses safe 4000 kHz speed for raw flash workflows when profile speed is auto', async () => {
    await initProfile(h, { speedKHz: 'auto' });

    const pending = callTool(h.client, 'run_control_workflow', {
      root: h.root,
      mode: 'flash-observe',
      observe: { markers: ['msh'], timeoutMs: 1000 },
      confirm: true,
    });
    const timer = setInterval(() => {
      h.transport.pushIncoming(Buffer.from('msh />'));
    }, 20);

    const out = await pending.finally(() => clearInterval(timer));

    expect(out.success).toBe(true);
    expect(h.fake.callsOf('probeConnect')[0]!.args[0]).toMatchObject({
      target: 'AT32F435RGT7',
      interface: 'swd',
      speedKHz: 4000,
    });
    const data = (
      out.evidence as {
        data: { steps: Array<{ id: string; evidence?: Record<string, unknown> }> };
      }
    ).data;
    expect(data.steps.find((step) => step.id === 'connect_probe')?.evidence).toMatchObject({
      speedPolicy: { profileSpeedKHz: 'auto', resolvedSpeedKHz: 4000, reason: 'safe-raw-flash' },
    });
  });

  it('classifies flash RAM preserve failures and returns a machine-readable retry action', async () => {
    class RamPreserveFailureBackend extends FakeJLinkBackend {
      async flashDownload(
        probeId: string,
        binary: Buffer,
        opts?: FlashDownloadOptions,
        signal?: AbortSignal,
      ): Promise<{ bytesWritten: number; verified: boolean }> {
        await super.flashDownload(probeId, binary, opts, signal);
        throw new JLinkOperationError(
          'J-Link flashDownload failed: Failed to preserve target RAM @ 0x20000000-0x2000FFFF\nFailed to prepare for programming',
          { operation: 'flashDownload' },
        );
      }
    }
    await teardown(h);
    const backend = new RamPreserveFailureBackend();
    h = await setup({ jlinkBackend: backend });
    await initProfile(h, { speedKHz: 'auto' });

    const out = await callTool(h.client, 'run_control_workflow', {
      root: h.root,
      mode: 'flash-observe',
      confirm: true,
    });

    expect(out.success).toBe(true);
    const data = (
      out.evidence as {
        data: {
          failedStep?: string;
          failureCode?: string;
          steps: Array<{ id: string; status: string; error?: { failureCode?: string } }>;
          nextActions: Array<{
            kind: string;
            tool?: string;
            requiresConfirm?: boolean;
            argsPatch?: Record<string, unknown>;
          }>;
        };
      }
    ).data;
    expect(data.failedStep).toBe('flash');
    expect(data.failureCode).toBe('flash_ram_preserve_failed');
    expect(data.steps.find((step) => step.id === 'flash')).toMatchObject({
      status: 'failed',
      error: { failureCode: 'flash_ram_preserve_failed' },
    });
    expect(data.nextActions).toContainEqual(
      expect.objectContaining({
        kind: 'retry',
        tool: 'run_control_workflow',
        requiresConfirm: true,
        argsPatch: expect.objectContaining({ jlink: expect.objectContaining({ speedKHz: 4000 }) }),
      }),
    );
  });

  it('does not suggest the same 4000 kHz retry when RAM preserve already failed at safe speed', async () => {
    class RamPreserveAtSafeSpeedBackend extends FakeJLinkBackend {
      async flashDownload(
        probeId: string,
        binary: Buffer,
        opts?: FlashDownloadOptions,
        signal?: AbortSignal,
      ): Promise<{ bytesWritten: number; verified: boolean }> {
        await super.flashDownload(probeId, binary, opts, signal);
        throw new JLinkOperationError(
          'J-Link flashDownload failed: Failed to preserve target RAM @ 0x20000000-0x2000FFFF\nFailed to prepare for programming',
          { operation: 'flashDownload' },
        );
      }
    }
    await teardown(h);
    const backend = new RamPreserveAtSafeSpeedBackend();
    h = await setup({ jlinkBackend: backend });
    await initProfile(h, { speedKHz: 4000 });

    const out = await callTool(h.client, 'run_control_workflow', {
      root: h.root,
      mode: 'flash-observe',
      confirm: true,
    });

    expect(out.success).toBe(true);
    const data = (
      out.evidence as {
        data: {
          failureCode?: string;
          nextActions: Array<{
            kind: string;
            message: string;
            argsPatch?: Record<string, unknown>;
          }>;
        };
      }
    ).data;
    expect(data.failureCode).toBe('flash_ram_preserve_failed');
    expect(data.nextActions).toContainEqual(
      expect.objectContaining({
        kind: 'user_action',
        message: expect.stringContaining('4000 kHz'),
      }),
    );
    expect(data.nextActions).not.toContainEqual(
      expect.objectContaining({
        argsPatch: expect.objectContaining({ jlink: expect.objectContaining({ speedKHz: 4000 }) }),
      }),
    );
  });

  it('classifies flash sector erase RAMCode timeouts without suggesting the already-used safe speed', async () => {
    class SectorEraseTimeoutBackend extends FakeJLinkBackend {
      async flashDownload(
        probeId: string,
        binary: Buffer,
        opts?: FlashDownloadOptions,
        signal?: AbortSignal,
      ): Promise<{ bytesWritten: number; verified: boolean }> {
        await super.flashDownload(probeId, binary, opts, signal);
        throw new JLinkOperationError(
          'J-Link flashDownload failed: Timeout while erasing sectors, RAMCode did not respond in time!\nFailed to erase sectors.',
          { operation: 'flashDownload' },
        );
      }
    }
    await teardown(h);
    const backend = new SectorEraseTimeoutBackend();
    h = await setup({ jlinkBackend: backend });
    await initProfile(h, { speedKHz: 4000 });

    const out = await callTool(h.client, 'run_control_workflow', {
      root: h.root,
      mode: 'flash-observe',
      confirm: true,
    });

    expect(out.success).toBe(true);
    const data = (
      out.evidence as {
        data: {
          failedStep?: string;
          failureCode?: string;
          steps: Array<{ id: string; status: string; error?: { failureCode?: string } }>;
          nextActions: Array<{
            kind: string;
            tool?: string;
            message: string;
            argsPatch?: Record<string, unknown>;
          }>;
        };
      }
    ).data;
    expect(data.failedStep).toBe('flash');
    expect(data.failureCode).toBe('flash_sector_erase_timeout');
    expect(data.steps.find((step) => step.id === 'flash')).toMatchObject({
      status: 'failed',
      error: { failureCode: 'flash_sector_erase_timeout' },
    });
    expect(data.nextActions).toContainEqual(
      expect.objectContaining({
        kind: 'user_action',
        message: expect.stringContaining('SEGGER'),
      }),
    );
    expect(data.nextActions).not.toContainEqual(
      expect.objectContaining({
        argsPatch: expect.objectContaining({ jlink: expect.objectContaining({ speedKHz: 4000 }) }),
      }),
    );
  });

  it('requires confirm=true before complete high-impact flash and reset workflow operations', async () => {
    await initProfile(h);

    const out = await callTool(h.client, 'run_control_workflow', {
      root: h.root,
      mode: 'flash-observe-diagnose',
      confirm: false,
    });

    expect(out.success).toBe(false);
    expect((out.error as { code: string }).code).toBe('CONFIRMATION_REQUIRED');
    expect(h.fake.callsOf('flashDownload')).toHaveLength(0);
    expect(h.fake.callsOf('cpuReset')).toHaveLength(0);
  });

  it.each([
    ['target', { enabled: true, interface: 'swd' as const, speedKHz: 4000 }, 'jlink.target'],
    ['interface', { enabled: true, target: 'AT32F435RGT7', speedKHz: 4000 }, 'jlink.interface'],
    [
      'speed',
      { enabled: true, target: 'AT32F435RGT7', interface: 'swd' as const },
      'jlink.speedKHz',
    ],
  ])(
    'rejects missing J-Link %s without applying reference defaults',
    async (_name, jlink, expectedField) => {
      await callTool(h.client, 'init_control_profile', {
        root: h.root,
        profile: { jlink },
      });

      const out = await callTool(h.client, 'run_control_workflow', {
        root: h.root,
        mode: 'debug-diagnose',
        confirm: true,
      });

      expect(out.success).toBe(false);
      expect((out.error as { code: string; message: string }).code).toBe('INVALID_ARGUMENT');
      expect((out.error as { message: string }).message).toContain(expectedField);
      expect(h.fake.callsOf('probeConnect')).toHaveLength(0);
      expect(h.fake.callsOf('gdbServerStart')).toHaveLength(0);
    },
  );

  it('reports missing J-Link Commander as a preflight block without opening serial or touching the probe', async () => {
    class UnavailableCommanderBackend extends FakeJLinkBackend {
      checkCommanderAvailability() {
        return {
          available: false,
          reason: 'not-found',
          message: 'J-Link Commander executable not found',
        };
      }
    }
    await teardown(h);
    const backend = new UnavailableCommanderBackend();
    h = await setup({ jlinkBackend: backend });
    await initProfile(h);

    const out = await callTool(h.client, 'run_control_workflow', {
      root: h.root,
      mode: 'flash-observe',
      confirm: true,
    });

    expect(out.success).toBe(true);
    const data = (
      out.evidence as {
        data: {
          failedStep?: string;
          blockingReasons?: Array<{ kind: string; code: string }>;
          nextActions: Array<{ kind: string; message: string }>;
        };
      }
    ).data;
    expect(data.failedStep).toBe('preflight');
    expect(data.blockingReasons).toContainEqual(
      expect.objectContaining({
        kind: 'jlink_commander_unavailable',
        code: 'JLINK_OPERATION_FAILED',
      }),
    );
    expect(data.nextActions).toContainEqual(
      expect.objectContaining({
        kind: 'user_action',
        message: expect.stringContaining('J-Link Commander'),
      }),
    );
    expect(h.openSerialCalls).toHaveLength(0);
    expect(backend.callsOf('probeConnect')).toHaveLength(0);
    expect(backend.callsOf('flashDownload')).toHaveLength(0);
  });

  it('reports unsupported J-Link target as a preflight block without opening serial or touching the probe', async () => {
    class UnsupportedTargetBackend extends FakeJLinkBackend {
      seenTarget: string | undefined;

      checkCommanderAvailability(target?: string) {
        this.seenTarget = target;
        return {
          available: false,
          reason: 'target-unsupported',
          target,
          message: `SEGGER J-Link device database does not contain target ${target}`,
        };
      }
    }
    await teardown(h);
    const backend = new UnsupportedTargetBackend();
    h = await setup({ jlinkBackend: backend });
    await initProfile(h);

    const out = await callTool(h.client, 'run_control_workflow', {
      root: h.root,
      mode: 'flash-observe',
      confirm: true,
    });

    expect(out.success).toBe(true);
    const data = (
      out.evidence as {
        data: {
          failedStep?: string;
          blockingReasons?: Array<{ kind: string; code: string; details?: { target?: string } }>;
          nextActions: Array<{ kind: string; message: string }>;
        };
      }
    ).data;
    expect(backend.seenTarget).toBe('AT32F435RGT7');
    expect(data.failedStep).toBe('preflight');
    expect(data.blockingReasons).toContainEqual(
      expect.objectContaining({
        kind: 'jlink_target_unsupported',
        code: 'JLINK_OPERATION_FAILED',
        details: expect.objectContaining({ target: 'AT32F435RGT7' }),
      }),
    );
    expect(data.nextActions).toContainEqual(
      expect.objectContaining({
        kind: 'user_action',
        message: expect.stringContaining('SEGGER device add-on'),
      }),
    );
    expect(h.openSerialCalls).toHaveLength(0);
    expect(backend.callsOf('probeConnect')).toHaveLength(0);
    expect(backend.callsOf('flashDownload')).toHaveLength(0);
  });

  it('continues flash workflow when target is absent from XML catalog and records advisory evidence', async () => {
    await teardown(h);
    const backend = new FakeJLinkBackend();
    h = await setup({
      jlinkBackend: backend,
      jlinkDeviceCatalog: {
        search: async () => ({
          available: true,
          sourceFiles: ['JLinkDevices.xml'],
          devices: [
            { name: 'STM32H743ZI', vendor: 'ST', sourceFile: 'JLinkDevices.xml', flashBanks: [] },
          ],
        }),
        get: async () => undefined,
        has: async () => false,
        refresh: async () => undefined,
      },
    });
    await writeFile(path.join(h.root, 'rtthread.bin'), Buffer.from([0x01, 0x02, 0x03, 0x04]));
    await h.controlProfileManager.init(
      h.root,
      {
        jlink: { enabled: true, target: 'STM32H743IIT6', interface: 'swd', speedKHz: 4000 },
        flash: { binary: 'rtthread.bin', baseAddress: '0x08000000', verify: true },
      },
      { force: true },
    );

    const out = await callTool(h.client, 'run_control_workflow', {
      root: h.root,
      mode: 'flash-observe',
      observe: { serial: false },
      confirm: true,
    });

    expect(out.success).toBe(true);
    const data = (
      out.evidence as {
        data: {
          failedStep?: string;
          steps: Array<{ id: string; evidence?: Record<string, unknown> }>;
          blockingReasons?: unknown[];
        };
      }
    ).data;
    expect(data.failedStep).toBeUndefined();
    expect(data.blockingReasons).toBeUndefined();
    expect(data.steps.find((step) => step.id === 'preflight')?.evidence).toMatchObject({
      targetResolution: {
        target: 'STM32H743II',
        warnings: [expect.objectContaining({ kind: 'jlink_target_not_in_catalog' })],
      },
    });
    expect(data.steps.find((step) => step.id === 'connect_probe')?.evidence).toMatchObject({
      probe: { target: 'STM32H743II' },
    });
    expect(backend.callsOf('probeConnect')).toEqual([
      {
        method: 'probeConnect',
        args: [{ target: 'STM32H743II', interface: 'swd', speedKHz: 4000 }],
      },
    ]);
  });

  it('runs flash workflows from a WSL Linux root without requiring agents to copy firmware to a Windows temp folder', async () => {
    await teardown(h);
    const linuxRoot = '/home/jianyin/code/FNA1000';
    const hostRoot = await mkdtemp(path.join(tmpdir(), 'lt-control-workflow-wsl-host-'));
    h = await setup({
      hostPathResolver: {
        async toHostPath(inputPath: string): Promise<string> {
          if (inputPath === linuxRoot) return hostRoot;
          if (inputPath.startsWith(`${linuxRoot}/`)) {
            return path.join(hostRoot, ...inputPath.slice(linuxRoot.length + 1).split('/'));
          }
          return inputPath;
        },
      },
    });
    await writeFile(path.join(hostRoot, 'rtthread.bin'), Buffer.from([0x01, 0x02, 0x03, 0x04]));
    await h.controlProfileManager.init(
      hostRoot,
      {
        jlink: { enabled: true, target: 'STM32H743IIT6', interface: 'swd', speedKHz: 4000 },
        flash: { binary: 'rtthread.bin', baseAddress: '0x08000000', verify: true },
      },
      { force: true },
    );

    const out = await callTool(h.client, 'run_control_workflow', {
      root: linuxRoot,
      mode: 'flash-observe',
      observe: { serial: false },
      confirm: true,
    });

    expect(out.success).toBe(true);
    const data = (
      out.evidence as {
        data: { root: string; steps: Array<{ id: string; evidence?: Record<string, unknown> }> };
      }
    ).data;
    expect(data.root).toBe(linuxRoot);
    expect(data.steps.map((step) => step.id)).toEqual([
      'load_profile',
      'preflight',
      'connect_probe',
      'flash',
      'cpu_reset',
    ]);
    expect(data.steps.find((step) => step.id === 'load_profile')?.evidence).toMatchObject({
      root: linuxRoot,
      hostRoot,
      rootResolved: true,
    });
    expect(data.steps.find((step) => step.id === 'flash')?.evidence).toMatchObject({
      firmwarePath: path.join(hostRoot, 'rtthread.bin'),
    });
    expect(h.fake.callsOf('flashDownload')[0]!.args).toMatchObject([
      expect.any(String),
      4,
      { address: 0x08000000, verify: true },
    ]);
  });

  it('runs flash workflows when the control profile stores an absolute WSL Linux firmware path', async () => {
    await teardown(h);
    const linuxRoot = `/home/linkterm-${Date.now()}/code/FNA1000`;
    const linuxFirmware = `${linuxRoot}/build/gcc-arm-debug/rtthread.bin`;
    const hostRoot = await mkdtemp(path.join(tmpdir(), 'lt-control-workflow-wsl-bin-host-'));
    const hostFirmware = path.join(hostRoot, 'build', 'gcc-arm-debug', 'rtthread.bin');
    h = await setup({
      hostPathResolver: {
        async toHostPath(inputPath: string): Promise<string> {
          if (inputPath === linuxRoot) return hostRoot;
          if (inputPath.startsWith(`${linuxRoot}/`)) {
            return path.join(hostRoot, ...inputPath.slice(linuxRoot.length + 1).split('/'));
          }
          return inputPath;
        },
      },
    });
    await mkdir(path.dirname(hostFirmware), { recursive: true });
    await writeFile(hostFirmware, Buffer.from([0x01, 0x02, 0x03, 0x04]));
    await h.controlProfileManager.init(
      hostRoot,
      {
        jlink: { enabled: true, target: 'STM32H743IIT6', interface: 'swd', speedKHz: 4000 },
        flash: { binary: linuxFirmware, baseAddress: '0x08000000', verify: true },
      },
      { force: true },
    );

    const out = await callTool(h.client, 'run_control_workflow', {
      root: linuxRoot,
      mode: 'flash-observe',
      observe: { serial: false },
      confirm: true,
    });

    expect(out.success).toBe(true);
    const data = (
      out.evidence as {
        data: { steps: Array<{ id: string; evidence?: Record<string, unknown> }> };
      }
    ).data;
    expect(data.steps.find((step) => step.id === 'flash')?.evidence).toMatchObject({
      firmwarePath: hostFirmware,
      parameterSources: { filePath: 'profile' },
    });
    expect(h.fake.callsOf('flashDownload')[0]!.args).toMatchObject([
      expect.any(String),
      4,
      { address: 0x08000000, verify: true },
    ]);
  });

  it('reports serial access denied as a structured block before probe connection or flash', async () => {
    await teardown(h);
    const backend = new FakeJLinkBackend();
    h = await setup({
      jlinkBackend: backend,
      openSerial: async () => {
        throw new Error('Access denied: COM7');
      },
    });
    await initProfile(h);

    const out = await callTool(h.client, 'run_control_workflow', {
      root: h.root,
      mode: 'flash-observe',
      confirm: true,
    });

    expect(out.success).toBe(true);
    const data = (
      out.evidence as {
        data: {
          failedStep?: string;
          blockingReasons?: Array<{
            kind: string;
            code: string;
            details?: Record<string, unknown>;
          }>;
          nextActions: Array<{ kind: string; message: string }>;
        };
      }
    ).data;
    expect(data.failedStep).toBe('open_serial');
    expect(data.blockingReasons).toContainEqual(
      expect.objectContaining({
        kind: 'serial_open_failed',
        code: 'INVALID_STATE',
        details: expect.objectContaining({ port: 'COM7', baudRate: 921600 }),
      }),
    );
    expect(data.nextActions).toContainEqual(
      expect.objectContaining({ kind: 'user_action', message: expect.stringContaining('COM7') }),
    );
    expect(backend.callsOf('probeConnect')).toHaveLength(0);
    expect(backend.callsOf('flashDownload')).toHaveLength(0);
  });

  it('reuses an already open matching serial session instead of opening the port twice', async () => {
    await initProfile(h);
    const existing = await h.manager.createAndOpen(
      (id) => new TestSerialSession({ id, transport: h.transport }),
      {
        connectionType: 'serial',
        label: 'Existing COM7',
        createdBy: 'human',
        serial: { port: 'COM7', baudRate: 921600, mode: 'terminal' },
      } as unknown as Parameters<SessionManager['createAndOpen']>[1],
    );

    const pending = callTool(h.client, 'run_control_workflow', {
      root: h.root,
      mode: 'flash-observe',
      observe: { markers: ['msh'], timeoutMs: 1000 },
      confirm: true,
    });
    const timer = setInterval(() => {
      h.transport.pushIncoming(Buffer.from('msh />'));
    }, 20);

    const out = await pending.finally(() => clearInterval(timer));

    expect(out.success).toBe(true);
    const data = (
      out.evidence as {
        data: { steps: Array<{ id: string; evidence?: Record<string, unknown> }> };
      }
    ).data;
    expect(data.steps.find((step) => step.id === 'open_serial')?.evidence).toMatchObject({
      sessionId: existing.id,
      reused: true,
    });
    expect(h.openSerialCalls).toHaveLength(0);
  });

  it('allows an absolute firmware path saved in the control profile', async () => {
    const outsideRoot = await mkdtemp(path.join(tmpdir(), 'lt-control-workflow-profile-bin-'));
    try {
      const absoluteFirmware = path.join(outsideRoot, 'rtthread.bin');
      await writeFile(absoluteFirmware, Buffer.from([0x0a, 0x0b, 0x0c]));
      await callTool(h.client, 'init_control_profile', {
        root: h.root,
        profile: {
          serial: { enabled: true, port: 'COM7', baudRate: 921600, mode: 'terminal' },
          jlink: { enabled: true, target: 'AT32F435RGT7', interface: 'swd', speedKHz: 4000 },
          flash: { binary: absoluteFirmware, baseAddress: '0x08008000', verify: true },
        },
      });

      const pending = callTool(h.client, 'run_control_workflow', {
        root: h.root,
        mode: 'flash-observe',
        observe: { markers: ['msh'], timeoutMs: 1000 },
        confirm: true,
      });
      const timer = setInterval(() => {
        h.transport.pushIncoming(Buffer.from('msh />'));
      }, 20);

      const out = await pending.finally(() => clearInterval(timer));

      expect(out.success).toBe(true);
      expect(h.fake.callsOf('flashDownload')[0]!.args).toMatchObject([
        expect.any(String),
        3,
        { address: 0x08008000, verify: true },
      ]);
      const data = (
        out.evidence as {
          data: { steps: Array<{ id: string; evidence?: Record<string, unknown> }> };
        }
      ).data;
      expect(data.steps.find((step) => step.id === 'flash')?.evidence).toMatchObject({
        firmwarePath: absoluteFirmware,
        parameterSources: { filePath: 'profile' },
      });
    } finally {
      await rm(outsideRoot, { recursive: true, force: true });
    }
  });

  it('rejects request firmware paths outside the workspace root', async () => {
    await initProfile(h);

    const outsideRoot = await mkdtemp(path.join(tmpdir(), 'lt-control-workflow-request-bin-'));
    try {
      const absoluteFirmware = path.join(outsideRoot, 'outside.bin');
      await writeFile(absoluteFirmware, Buffer.from([0xaa]));

      const out = await callTool(h.client, 'run_control_workflow', {
        root: h.root,
        mode: 'flash-observe',
        firmware: { filePath: absoluteFirmware },
        confirm: true,
      });

      expect(out.success).toBe(false);
      expect((out.error as { code: string }).code).toBe('INVALID_ARGUMENT');
      expect(h.fake.callsOf('flashDownload')).toHaveLength(0);
    } finally {
      await rm(outsideRoot, { recursive: true, force: true });
    }
  });

  it('rejects firmware paths outside the workspace root', async () => {
    await initProfile(h);

    const out = await callTool(h.client, 'run_control_workflow', {
      root: h.root,
      mode: 'flash-observe',
      firmware: { filePath: '../outside.bin' },
      confirm: true,
    });

    expect(out.success).toBe(false);
    expect((out.error as { code: string }).code).toBe('INVALID_ARGUMENT');
    expect(h.fake.callsOf('flashDownload')).toHaveLength(0);
  });

  it('rejects firmware symlinks that resolve outside the workspace root', async () => {
    await initProfile(h);
    const outsideRoot = await mkdtemp(path.join(tmpdir(), 'lt-control-workflow-outside-'));
    try {
      await writeFile(path.join(outsideRoot, 'outside.bin'), Buffer.from([0xaa]));
      await symlink(outsideRoot, path.join(h.root, 'linked-dir'), 'junction');

      const out = await callTool(h.client, 'run_control_workflow', {
        root: h.root,
        mode: 'flash-observe',
        firmware: { filePath: 'linked-dir/outside.bin' },
        observe: { timeoutMs: 100 },
        confirm: true,
      });

      expect(out.success).toBe(false);
      expect((out.error as { code: string }).code).toBe('INVALID_ARGUMENT');
      expect(h.fake.callsOf('flashDownload')).toHaveLength(0);
    } finally {
      await rm(outsideRoot, { recursive: true, force: true });
    }
  });

  it('rejects oversized firmware before reading it into memory or touching J-Link', async () => {
    await initProfile(h);
    const bigFile = path.join(h.root, 'big.bin');
    await writeFile(bigFile, Buffer.alloc(0));
    await truncate(bigFile, 16 * 1024 * 1024 + 1);

    const out = await callTool(h.client, 'run_control_workflow', {
      root: h.root,
      mode: 'flash-observe',
      firmware: { filePath: 'big.bin' },
      confirm: true,
    });

    expect(out.success).toBe(false);
    expect((out.error as { code: string }).code).toBe('BUFFER_TOO_LARGE');
    expect(h.fake.callsOf('probeConnect')).toHaveLength(0);
    expect(h.fake.callsOf('flashDownload')).toHaveLength(0);
  });

  it('rejects missing firmware as invalid input without leaking host paths', async () => {
    await initProfile(h);

    const out = await callTool(h.client, 'run_control_workflow', {
      root: h.root,
      mode: 'flash-observe',
      firmware: { filePath: 'missing.bin' },
      confirm: true,
    });

    expect(out.success).toBe(false);
    expect((out.error as { code: string; message: string }).code).toBe('INVALID_ARGUMENT');
    expect((out.error as { message: string }).message).not.toContain(h.root);
    expect(h.fake.callsOf('flashDownload')).toHaveLength(0);
  });

  it('continues observing serial when cpu_reset is not implemented', async () => {
    await initProfile(h);
    h.fake.failOnce.set('cpuReset', new JLinkNotImplementedError('cpuReset'));

    const pending = callTool(h.client, 'run_control_workflow', {
      root: h.root,
      mode: 'flash-observe-diagnose',
      observe: { markers: ['msh'], timeoutMs: 1000 },
      confirm: true,
    });
    const timer = setInterval(() => {
      h.transport.pushIncoming(Buffer.from('msh />'));
    }, 20);

    const out = await pending.finally(() => clearInterval(timer));

    expect(out.success).toBe(true);
    const data = (
      out.evidence as {
        data: {
          summary: Record<string, boolean>;
          steps: Array<{ id: string; status: string }>;
          nextActions: Array<{ kind: string; tool?: string }>;
        };
      }
    ).data;
    expect(data.summary.reset).toBe(false);
    expect(data.summary.serialObserved).toBe(true);
    expect(data.steps.find((step) => step.id === 'cpu_reset')?.status).toBe('skipped');
    expect(data.nextActions).toContainEqual(
      expect.objectContaining({ kind: 'diagnose', tool: 'cpu_reset' }),
    );
  });

  it('plans a flash workflow in dryRun without touching hardware', async () => {
    await initProfile(h);

    const out = await callTool(h.client, 'run_control_workflow', {
      root: h.root,
      mode: 'flash-observe',
      dryRun: true,
    });

    expect(out.success).toBe(true);
    const data = (
      out.evidence as {
        data: { steps: Array<{ id: string; status: string; evidence?: Record<string, unknown> }> };
      }
    ).data;
    expect(data.steps.find((step) => step.id === 'flash')?.status).toBe('skipped');
    expect(data.steps.find((step) => step.id === 'flash')?.evidence).toMatchObject({
      dryRun: true,
      firmwarePath: path.join(h.root, 'rtthread.bin'),
      address: 0x08008000,
      verify: true,
      parameterSources: {
        filePath: 'profile',
        baseAddress: 'profile',
        verify: 'profile',
        timeoutMs: 'default',
      },
    });
    expect(h.fake.callsOf('probeConnect')).toHaveLength(0);
    expect(h.fake.callsOf('flashDownload')).toHaveLength(0);
  });

  it('runs debug-diagnose with explicit high-impact confirmation', async () => {
    await callTool(h.client, 'init_control_profile', {
      root: h.root,
      profile: {
        jlink: { enabled: true, target: 'AT32F435RGT7', interface: 'swd', speedKHz: 4000 },
      },
    });

    const out = await callTool(h.client, 'run_control_workflow', {
      root: h.root,
      mode: 'debug-diagnose',
      debug: { readRegisters: true },
      confirm: true,
    });

    expect(out.success).toBe(true);
    const data = (out.evidence as { data: { summary: Record<string, boolean> } }).data;
    expect(data.summary).toMatchObject({
      probeConnected: true,
      gdbServerStarted: true,
      flashed: false,
      reset: false,
      debugCaptured: true,
    });
    expect(h.fake.callsOf('gdbServerStart')).toHaveLength(1);
    expect(h.fake.callsOf('registerList')).toHaveLength(1);
    expect(h.fake.callsOf('flashDownload')).toHaveLength(0);
    expect(h.fake.callsOf('cpuReset')).toHaveLength(0);
  });

  it('keeps boot output emitted during reset by preparing observation before reset', async () => {
    await initProfile(h);
    const originalReset = h.fake.cpuReset.bind(h.fake);
    h.fake.cpuReset = async (...args) => {
      await originalReset(...args);
      h.transport.pushIncoming(Buffer.from('msh />'));
    };

    const out = await callTool(h.client, 'run_control_workflow', {
      root: h.root,
      mode: 'flash-observe',
      observe: { markers: ['msh'], timeoutMs: 200 },
      confirm: true,
    });

    expect(out.success).toBe(true);
    const data = (out.evidence as { data: { summary: Record<string, boolean> } }).data;
    expect(data.summary.reset).toBe(true);
    expect(data.summary.serialObserved).toBe(true);
  });
});
