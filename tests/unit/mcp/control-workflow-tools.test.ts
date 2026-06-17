import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm, symlink, truncate, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SessionBase } from '@/core/session/session-base.js';
import { SessionManager } from '@/core/session/session-manager.js';
import { ControlProfileManager } from '@/core/workspace/index.js';
import { JLinkNotImplementedError, JLinkOperationError } from '@/jlink/errors.js';
import type { FlashDownloadOptions, IJLinkBackend } from '@/jlink/types.js';
import { createMcpServer } from '@/mcp/index.js';
import type { LinkTermMcpServer } from '@/mcp/server.js';
import type { SerialSessionConfig, SessionState } from '@/shared/types.js';
import { SerialDiscovery } from '@/transports/serial/serial-discovery.js';
import { FakeJLinkBackend } from '../../fixtures/fake-jlink-backend.js';
import { createInMemoryMcpTransportPair } from '../../fixtures/mock-mcp-transport.js';
import { MockTransport } from '../../fixtures/mock-transport.js';

class TestSerialSession extends SessionBase {}

interface Harness {
  manager: SessionManager;
  serialDiscovery: SerialDiscovery;
  controlProfileManager: ControlProfileManager;
  fake: FakeJLinkBackend;
  mcp: LinkTermMcpServer;
  client: Client;
  root: string;
  transport: MockTransport;
  openSerialCalls: SerialSessionConfig[];
}

interface SetupOptions {
  jlinkBackend?: IJLinkBackend;
  openSerial?: (config: SerialSessionConfig) => Promise<{ sessionId: string; state: SessionState }>;
}

async function setup(options: SetupOptions = {}): Promise<Harness> {
  const root = await mkdtemp(path.join(tmpdir(), 'lt-control-workflow-mcp-'));
  const manager = new SessionManager();
  const serialDiscovery = new SerialDiscovery({ listFn: async () => [] });
  const controlProfileManager = new ControlProfileManager();
  const fake = new FakeJLinkBackend();
  const transport = new MockTransport();
  const openSerialCalls: SerialSessionConfig[] = [];
  const { server: serverTransport, client: clientTransport } = createInMemoryMcpTransportPair();
  const mcp = createMcpServer({
    sessionManager: manager,
    serialDiscovery,
    controlProfileManager,
    jlinkBackend: options.jlinkBackend ?? fake,
    controlProfileOpenSerial: options.openSerial ?? (async (config) => {
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
    transportFactory: () => serverTransport,
  });
  await mcp.start();
  const client = new Client({ name: 'lt-control-workflow-test', version: '0.0.0' });
  await client.connect(clientTransport);
  return { manager, serialDiscovery, controlProfileManager, fake, mcp, client, root, transport, openSerialCalls };
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
      jlink: { enabled: true, target: 'AT32F435RGT7', interface: 'swd', speedKHz: opts.speedKHz ?? 4000 },
      flash: { binary: 'rtthread.bin', baseAddress: '0x08008000', verify: true },
    },
  });
}

describe('MCP control workflow tool', () => {
  let h: Harness;

  beforeEach(async () => {
    h = await setup();
  });

  afterEach(async () => {
    await teardown(h);
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
    const data = (out.evidence as {
      data: { summary: Record<string, boolean>; steps: Array<{ id: string; status: string; evidence?: Record<string, unknown> }> };
    }).data;
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
    ]);
    expect(data.steps.find((step) => step.id === 'gdb_server_start')?.evidence).toMatchObject({
      handle: { host: '127.0.0.1', port: 2331 },
    });
    expect(h.fake.callsOf('gdbServerStart')).toHaveLength(1);
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
    const data = (out.evidence as {
      data: { steps: Array<{ id: string; status: string }>; nextActions: Array<{ tool?: string; message: string }> };
    }).data;
    expect(data.steps).toContainEqual(expect.objectContaining({ id: 'gdb_server_start', status: 'skipped' }));
    expect(data.nextActions).toContainEqual(
      expect.objectContaining({ tool: 'gdb_server_start', message: expect.stringContaining('GDB server') }),
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
    const data = (out.evidence as { data: { summary: Record<string, boolean>; steps: Array<{ id: string; status: string }> } }).data;
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
    expect(h.fake.callsOf('flashDownload')[0]!.args).toMatchObject([
      expect.any(String),
      4,
      { address: 0x08008000, verify: true },
    ]);
    expect(h.fake.callsOf('cpuReset')).toHaveLength(1);
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
    const data = (out.evidence as {
      data: { steps: Array<{ id: string; evidence?: Record<string, unknown> }> };
    }).data;
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
    await initProfile(h);

    const out = await callTool(h.client, 'run_control_workflow', {
      root: h.root,
      mode: 'flash-observe',
      confirm: true,
    });

    expect(out.success).toBe(true);
    const data = (out.evidence as {
      data: {
        failedStep?: string;
        failureCode?: string;
        steps: Array<{ id: string; status: string; error?: { failureCode?: string } }>;
        nextActions: Array<{ kind: string; tool?: string; requiresConfirm?: boolean; argsPatch?: Record<string, unknown> }>;
      };
    }).data;
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

  it('requires confirm=true before high-impact workflow operations', async () => {
    await initProfile(h);

    const out = await callTool(h.client, 'run_control_workflow', {
      root: h.root,
      mode: 'flash-observe',
      confirm: false,
    });

    expect(out.success).toBe(false);
    expect((out.error as { code: string }).code).toBe('CONFIRMATION_REQUIRED');
    expect(h.fake.callsOf('flashDownload')).toHaveLength(0);
  });

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
    const data = (out.evidence as {
      data: {
        failedStep?: string;
        blockingReasons?: Array<{ kind: string; code: string }>;
        nextActions: Array<{ kind: string; message: string }>;
      };
    }).data;
    expect(data.failedStep).toBe('preflight');
    expect(data.blockingReasons).toContainEqual(
      expect.objectContaining({ kind: 'jlink_commander_unavailable', code: 'JLINK_OPERATION_FAILED' }),
    );
    expect(data.nextActions).toContainEqual(
      expect.objectContaining({ kind: 'user_action', message: expect.stringContaining('J-Link Commander') }),
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
    const data = (out.evidence as {
      data: {
        failedStep?: string;
        blockingReasons?: Array<{ kind: string; code: string; details?: { target?: string } }>;
        nextActions: Array<{ kind: string; message: string }>;
      };
    }).data;
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
      expect.objectContaining({ kind: 'user_action', message: expect.stringContaining('SEGGER device add-on') }),
    );
    expect(h.openSerialCalls).toHaveLength(0);
    expect(backend.callsOf('probeConnect')).toHaveLength(0);
    expect(backend.callsOf('flashDownload')).toHaveLength(0);
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
    const data = (out.evidence as {
      data: {
        failedStep?: string;
        blockingReasons?: Array<{ kind: string; code: string; details?: Record<string, unknown> }>;
        nextActions: Array<{ kind: string; message: string }>;
      };
    }).data;
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
    const data = (out.evidence as {
      data: { steps: Array<{ id: string; evidence?: Record<string, unknown> }> };
    }).data;
    expect(data.steps.find((step) => step.id === 'open_serial')?.evidence).toMatchObject({
      sessionId: existing.id,
      reused: true,
    });
    expect(h.openSerialCalls).toHaveLength(0);
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
    const data = (out.evidence as {
      data: {
        summary: Record<string, boolean>;
        steps: Array<{ id: string; status: string }>;
        nextActions: Array<{ kind: string; tool?: string }>;
      };
    }).data;
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
    const data = (out.evidence as {
      data: { steps: Array<{ id: string; status: string; evidence?: Record<string, unknown> }> };
    }).data;
    expect(data.steps.find((step) => step.id === 'flash')?.status).toBe('skipped');
    expect(data.steps.find((step) => step.id === 'flash')?.evidence).toMatchObject({ dryRun: true });
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
