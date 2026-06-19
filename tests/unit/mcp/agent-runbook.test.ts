import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SessionManager } from '@/core/session/session-manager.js';
import { ControlProfileManager, type FsPrimitives } from '@/core/workspace/index.js';
import { createAgentRunbook, sanitizeControlProfileForRunbook } from '@/mcp/surfaces/agent-runbook/runbook.js';
import { buildTerminalCommandToolsStatus } from '@/mcp/surfaces/agent-runbook/tools.js';
import { createMcpServer } from '@/mcp/index.js';
import type { ToolSetDiagnostics } from '@/mcp/tool-set.js';
import { LINKTERM_MCP_SCHEMA_VERSION } from '@/mcp/versioning/version-check.js';
import type { LinkTermMcpServer } from '@/mcp/server.js';
import type { CapturableWindow } from '@/mcp/surfaces/ui/types.js';
import { SerialDiscovery } from '@/transports/serial/serial-discovery.js';
import type { IJLinkBackend } from '@/jlink/types.js';
import { FakeJLinkBackend } from '../../fixtures/fake-jlink-backend.js';
import { createInMemoryMcpTransportPair } from '../../fixtures/mock-mcp-transport.js';

interface Harness {
  manager: SessionManager;
  serialDiscovery: SerialDiscovery;
  controlProfileManager: ControlProfileManager;
  mcp: LinkTermMcpServer;
  client: Client;
  root: string;
}

interface SetupOptions {
  includeControlProfileManager?: boolean;
  getActiveWindow?: () => CapturableWindow | null;
  controlProfileManager?: ControlProfileManager;
  jlinkBackend?: IJLinkBackend;
}

async function setup(options: SetupOptions = {}): Promise<Harness> {
  const root = await mkdtemp(path.join(tmpdir(), 'lt-agent-runbook-mcp-'));
  const manager = new SessionManager();
  const serialDiscovery = new SerialDiscovery({ listFn: async () => [] });
  const controlProfileManager = options.controlProfileManager ?? new ControlProfileManager();
  const { server: serverTransport, client: clientTransport } = createInMemoryMcpTransportPair();
  const includeControlProfileManager = options.includeControlProfileManager ?? true;
  const mcp = createMcpServer({
    sessionManager: manager,
    serialDiscovery,
    ...(includeControlProfileManager ? { controlProfileManager } : {}),
    ...(options.jlinkBackend ? { jlinkBackend: options.jlinkBackend } : {}),
    getActiveWindow: options.getActiveWindow,
    runtimeDiagnostics: () => ({
      identity: {
        runtimeId: 'test-runtime-id',
        pid: 1234,
        startedAt: '2026-06-18T00:00:00.000Z',
      },
      transport: { mode: 'in-memory' },
      metadata: {
        available: true,
        fresh: true,
        ageMs: 42,
        path: path.join(root, 'mcp-runtime.json'),
      },
    }),
    transportFactory: () => serverTransport,
  });
  await mcp.start();
  const client = new Client({ name: 'lt-agent-runbook-test', version: '0.0.0' });
  await client.connect(clientTransport);
  return { manager, serialDiscovery, controlProfileManager, mcp, client, root };
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

describe('agent runbook builder', () => {
  it('generates markdown and structured workflows with confirmation metadata', () => {
    const runbook = createAgentRunbook({ schemaVersion: LINKTERM_MCP_SCHEMA_VERSION });

    expect(runbook.markdown).toContain('LinkTerm MCP Agent Runbook');
    expect(runbook.markdown).toContain('serial');
    expect(runbook.markdown).toContain('J-Link');
    expect(runbook.markdown).toContain('RTT');
    expect(runbook.markdown).toContain('UI');
    expect(runbook.markdown).toContain('CONFIRMATION_REQUIRED');
    expect(runbook.markdown).toContain('MUST NOT bypass LinkTerm');
    expect(runbook.markdown).toContain('JLink.exe');
    expect(runbook.markdown).toContain('gdb');
    expect(runbook.markdown).toContain('VS Code task');
    expect(runbook.markdown).toContain('Call LinkTerm MCP tools sequentially');
    expect(runbook.markdown).toContain('lightweight health-check call');
    expect(runbook.markdown).toContain('get_app_status');
    expect(runbook.markdown).toContain('recommendedWorkflows');
    expect(runbook.markdown).toContain('profile_flash_observe');
    expect(runbook.markdown).toContain('write_to_session');
    expect(runbook.markdown).toContain('send_and_wait');
    expect(runbook.markdown).toContain('read_from_session');
    expect(runbook.markdown).toContain('read-only');
    expect(runbook.markdown).toContain('core tool');
    expect(runbook.markdown).toContain('missing core tools');
    expect(runbook.markdown).toContain('repair or restart');
    expect(runbook.markdown).toContain('Use ui_screenshot only when visual evidence is needed');
    expect(runbook.markdown).toContain('Commander script orchestration');
    expect(runbook.markdown).toContain('design reference only');
    expect(runbook.markdown).toContain('background');
    expect(runbook.markdown).toContain('get_control_workflow_job_status');
    expect(runbook.markdown).toContain('read_control_workflow_job');
    expect(runbook.markdown).toContain('cancel_control_workflow_job');
    expect(runbook.markdown).not.toMatch(/nRF52|cmds\.jlink|reference-repos|JLinkMCP\/main\.go/);

    expect(runbook.workflows.map((workflow) => workflow.id)).toEqual(
      expect.arrayContaining([
        'observe_serial',
        'flash_then_observe',
        'debug_diagnose',
        'recover_attach',
        'ui_assist',
      ]),
    );
    expect(runbook.workflows).toContainEqual(
      expect.objectContaining({
        id: 'flash_then_observe',
        recommendedTools: expect.arrayContaining([
          'run_control_workflow',
          'get_control_workflow_job_status',
          'read_control_workflow_job',
          'cancel_control_workflow_job',
        ]),
        riskLevel: 'high',
        requiresConfirmation: true,
        expectedEvidenceKind: 'debug_output',
      }),
    );
    expect(runbook.highImpactTools).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'flash_download', requiresConfirmation: true }),
        expect.objectContaining({ name: 'flash_write', requiresConfirmation: true }),
        expect.objectContaining({ name: 'flash_erase', requiresConfirmation: true }),
        expect.objectContaining({ name: 'cpu_reset', requiresConfirmation: true }),
        expect.objectContaining({ name: 'gdb_server_start', requiresConfirmation: true }),
      ]),
    );
  });

  it('sanitizes profile facts by whitelist and avoids path disclosure', () => {
    const profile = {
      schemaVersion: 'linkterm-control/1.0.0',
      serial: {
        enabled: true,
        port: 'COM6',
        baudRate: 115200,
        mode: 'terminal',
        password: 'serial-secret',
      },
      jlink: {
        enabled: true,
        target: 'AT32F435VGT7',
        interface: 'swd',
        speedKHz: 4000,
        serialNumber: 'JLINK-SECRET-SERIAL',
      },
      flash: {
        binary: 'D:/private/product/build/firmware.bin',
        baseAddress: '0x08008000',
        verify: true,
        token: 'flash-token',
      },
      rtt: { enabled: true, channels: [0], privateKey: 'key' },
      sshPassword: 'top-secret',
    };

    const summary = sanitizeControlProfileForRunbook(profile);

    expect(summary.sections).toMatchObject({
      serial: true,
      jlink: true,
      flash: true,
      rtt: true,
    });
    expect(summary.serial).toEqual({ enabled: true, port: 'COM6', baudRate: 115200, mode: 'terminal' });
    expect(summary.jlink).toEqual({ enabled: true, target: 'AT32F435VGT7', interface: 'swd', speedKHz: 4000 });
    expect(summary.flash).toEqual({ binaryConfigured: true, baseAddress: '0x08008000', verify: true });
    expect(summary.rtt).toEqual({ enabled: true, channels: [0] });

    const serialized = JSON.stringify(summary);
    expect(serialized).not.toContain('D:/private');
    expect(serialized).not.toContain('firmware.bin');
    expect(serialized).not.toContain('serial-secret');
    expect(serialized).not.toContain('JLINK-SECRET-SERIAL');
    expect(serialized).not.toContain('flash-token');
    expect(serialized).not.toContain('top-secret');
    expect(serialized).not.toContain('privateKey');
  });
});

describe('MCP agent runbook tool', () => {
  let h: Harness;

  beforeEach(async () => {
    h = await setup();
  });

  afterEach(async () => {
    await teardown(h);
  });

  it('advertises actionable runbook guidance in initialize instructions', () => {
    const instructions = h.client.getInstructions();

    expect(instructions).toContain('LinkTerm MCP Agent Runbook');
    expect(instructions).toContain('LinkTerm MCP tools are the required path');
    expect(instructions).toContain('Call LinkTerm MCP tools sequentially');
    expect(instructions).toContain('lightweight health-check call');
    expect(instructions).toContain('get_app_status');
    expect(instructions).toContain('recommendedWorkflows');
    expect(instructions).toContain('profile_flash_observe');
    expect(instructions).toContain('write_to_session');
    expect(instructions).toContain('send_and_wait');
    expect(instructions).toContain('read_from_session');
    expect(instructions).toContain('read-only');
    expect(instructions).toContain('core tool-set diagnostics');
    expect(instructions).toContain('repair or restart the LinkTerm MCP runtime');
    expect(instructions).toContain('Use ui_screenshot only when visual evidence is needed');
    expect(instructions).toContain('run_control_workflow');
    expect(instructions).toContain('current workspace control profile');
    expect(instructions).toContain('omit firmware.filePath');
    expect(instructions).toContain('background job mode');
    expect(instructions).toContain('get_control_workflow_job_status');
    expect(instructions).toContain('read_control_workflow_job');
    expect(instructions).toContain('confirm=true');
    expect(instructions).toContain('get_agent_runbook');
  });

  it('is always registered and succeeds without a workspace root', async () => {
    const list = await h.client.listTools();
    expect(list.tools.map((tool) => tool.name)).toContain('get_agent_runbook');

    const out = await callTool(h.client, 'get_agent_runbook');

    expect(out.success).toBe(true);
    expect(out.origin).toBe('ai');
    expect(out.schemaVersion).toBe(LINKTERM_MCP_SCHEMA_VERSION);
    const evidence = out.evidence as {
      kind: string;
      cursor: number;
      data: {
        markdown: string;
        profileSummary: { status: string };
        workflows: Array<{ id: string }>;
      };
    };
    expect(evidence.kind).toBe('agent_runbook');
    expect(evidence.cursor).toBe(0);
    expect(evidence.data.markdown).toContain('LinkTerm MCP Agent Runbook');
    expect(evidence.data.profileSummary.status).toBe('root-not-provided');
    expect(evidence.data.workflows.length).toBeGreaterThan(0);
  });

  it('returns app status without screenshot or hardware side effects', async () => {
    const list = await h.client.listTools();
    expect(list.tools.map((tool) => tool.name)).toContain('get_app_status');

    const out = await callTool(h.client, 'get_app_status', { root: h.root });

    expect(out.success).toBe(true);
    expect(out.origin).toBe('ai');
    expect(out.schemaVersion).toBe(LINKTERM_MCP_SCHEMA_VERSION);
    const evidence = out.evidence as {
      kind: string;
      cursor: number;
      data: {
        app: {
          schemaVersion: string;
          mcpRunning: boolean;
          runtime: {
            identity: { runtimeId: string; pid: number; startedAt: string };
            transport: { mode: string };
            metadata: { available: boolean; fresh: boolean; ageMs: number; path: string };
            toolSet: {
              count: number;
              hash: string;
              core: { expected: string[]; complete: boolean; missing: string[] };
            };
          };
        };
        sessions: { count: number; items: unknown[] };
        serial: { portCount: number; ports: unknown[] };
        controlProfile: { status: string };
        jlink: { available: boolean; probeCount: number };
        ui: { available: boolean; screenshotCaptured: boolean };
        terminalCommandTools: {
          available: boolean;
          listSessions: string;
          openSession: string;
          status: string;
          write: string;
          sendAndWait: string;
          readTranscript: string;
          commandPath: string;
          missing: string[];
        };
      };
    };
    expect(evidence.kind).toBe('app_status');
    expect(evidence.cursor).toBe(0);
    expect(evidence.data.app.schemaVersion).toBe(LINKTERM_MCP_SCHEMA_VERSION);
    expect(evidence.data.app.mcpRunning).toBe(true);
    expect(evidence.data.app.runtime.identity).toEqual({
      runtimeId: 'test-runtime-id',
      pid: 1234,
      startedAt: '2026-06-18T00:00:00.000Z',
    });
    expect(evidence.data.app.runtime.transport).toEqual({ mode: 'in-memory' });
    expect(evidence.data.app.runtime.metadata).toMatchObject({ available: true, fresh: true, ageMs: 42 });
    expect(evidence.data.app.runtime.metadata.path).toBe(path.join(h.root, 'mcp-runtime.json'));
    expect(evidence.data.app.runtime.toolSet.count).toBeGreaterThan(40);
    expect(evidence.data.app.runtime.toolSet.hash).toMatch(/^[a-f0-9]{64}$/);
    expect(evidence.data.app.runtime.toolSet.core).toMatchObject({ complete: true, missing: [] });
    expect(evidence.data.app.runtime.toolSet.core.expected).toContain('get_app_status');
    expect(evidence.data.app.runtime.toolSet.core.expected).toContain('get_control_workflow_job_status');
    expect(evidence.data.app.runtime.toolSet.core.expected).toContain('read_control_workflow_job');
    expect(evidence.data.app.runtime.toolSet.core.expected).toContain('cancel_control_workflow_job');
    expect(evidence.data.app.runtime.toolSet.core.expected).toContain('cleanup_control_workflow_jobs');
    expect(evidence.data.sessions).toEqual({ count: 0, items: [] });
    expect(evidence.data.serial).toEqual({ portCount: 0, ports: [] });
    expect(evidence.data.controlProfile.status).toBe('profile-not-found');
    expect(evidence.data.jlink.available).toBe(false);
    expect(evidence.data.jlink.probeCount).toBe(0);
    expect(evidence.data.ui).toEqual({ available: false, screenshotCaptured: false });
    expect(evidence.data.terminalCommandTools).toEqual({
      available: true,
      listSessions: 'list_sessions',
      openSession: 'open_session',
      status: 'get_session_status',
      write: 'write_to_session',
      sendAndWait: 'send_and_wait',
      readTranscript: 'read_from_session',
      commandPath: 'write_to_session/send_and_wait -> SessionManager.write -> WriteQueue -> transport; read_from_session returns transcript evidence.',
      missing: [],
    });
  });

  it('reports missing terminal command tools in app status', () => {
    const diagnostics: ToolSetDiagnostics = {
      count: 3,
      hash: 'test-hash',
      core: {
        expected: [],
        complete: false,
        missing: ['write_to_session', 'send_and_wait'],
      },
    };

    expect(buildTerminalCommandToolsStatus(diagnostics)).toEqual({
      available: false,
      listSessions: 'list_sessions',
      openSession: 'open_session',
      status: 'get_session_status',
      write: 'write_to_session',
      sendAndWait: 'send_and_wait',
      readTranscript: 'read_from_session',
      commandPath: 'write_to_session/send_and_wait -> SessionManager.write -> WriteQueue -> transport; read_from_session returns transcript evidence.',
      missing: ['write_to_session', 'send_and_wait'],
    });
  });

  it('reports missing core tools when a runtime entry has an incomplete dependency set', async () => {
    await teardown(h);
    h = await setup({ includeControlProfileManager: false });

    const out = await callTool(h.client, 'get_app_status', { root: h.root });

    const data = (out.evidence as {
      data: {
        app: { runtime: { toolSet: { core: { complete: boolean; missing: string[] } } } };
        recommendedNextActions: string[];
      };
    }).data;
    expect(data.app.runtime.toolSet.core.complete).toBe(false);
    expect(data.app.runtime.toolSet.core.missing).toEqual(
      expect.arrayContaining(['activate_control_profile', 'run_control_workflow']),
    );
    expect(data.recommendedNextActions.join('\n')).toContain('repair or restart the LinkTerm MCP runtime');
    expect(data.recommendedNextActions.join('\n')).not.toMatch(/JLink\.exe|gdb|flash CLI|serial CLI|VS Code task/i);
  });

  it('checks UI availability without capturing a screenshot', async () => {
    await teardown(h);
    let captureCalls = 0;
    h = await setup({
      getActiveWindow: () => ({
        isDestroyed: () => false,
        webContents: {
          capturePage: async () => {
            captureCalls += 1;
            return {
              toPNG: () => Buffer.from([]),
              getSize: () => ({ width: 1, height: 1 }),
            };
          },
        },
      }),
    });

    const out = await callTool(h.client, 'get_app_status', { root: h.root });

    const data = (out.evidence as { data: { ui: { available: boolean; screenshotCaptured: boolean } } }).data;
    expect(data.ui).toEqual({ available: true, screenshotCaptured: false });
    expect(captureCalls).toBe(0);
  });

  it('keeps startup status read-only across sessions, UI, J-Link, and workspace profile state', async () => {
    await teardown(h);
    const workspaceWrites: string[] = [];
    const fs: FsPrimitives = {
      readFile: async () => {
        throw Object.assign(new Error('not found'), { code: 'ENOENT' });
      },
      writeFile: async () => {
        workspaceWrites.push('writeFile');
      },
      mkdir: async () => {
        workspaceWrites.push('mkdir');
      },
      rename: async () => {
        workspaceWrites.push('rename');
      },
      unlink: async () => {
        workspaceWrites.push('unlink');
      },
      stat: async () => {
        throw Object.assign(new Error('not found'), { code: 'ENOENT' });
      },
    };
    const controlProfileManager = new ControlProfileManager({ fs });
    const jlinkBackend = new FakeJLinkBackend();
    let captureCalls = 0;
    h = await setup({
      controlProfileManager,
      jlinkBackend,
      getActiveWindow: () => ({
        isDestroyed: () => false,
        webContents: {
          capturePage: async () => {
            captureCalls += 1;
            return {
              toPNG: () => Buffer.from([]),
              getSize: () => ({ width: 1, height: 1 }),
            };
          },
        },
      }),
    });
    const writeSpy = vi.spyOn(h.manager, 'write');
    const createSpy = vi.spyOn(h.manager, 'create');
    const createAndOpenSpy = vi.spyOn(h.manager, 'createAndOpen');

    const out = await callTool(h.client, 'get_app_status', { root: h.root });

    expect(out.success).toBe(true);
    expect(writeSpy).not.toHaveBeenCalled();
    expect(createSpy).not.toHaveBeenCalled();
    expect(createAndOpenSpy).not.toHaveBeenCalled();
    expect(captureCalls).toBe(0);
    expect(jlinkBackend.calls.map((call) => call.method)).toEqual(['probeDetect']);
    expect(workspaceWrites).toEqual([]);
  });

  it('summarizes a workspace control profile without touching hardware', async () => {
    await h.controlProfileManager.init(h.root, {
      serial: { enabled: true, port: 'COM7', baudRate: 921600, mode: 'terminal' },
      jlink: { enabled: true, target: 'AT32F435RGT7', interface: 'swd', speedKHz: 'auto' },
      flash: { binary: 'build/app.bin', baseAddress: '0x08008000', verify: true },
      rtt: { enabled: false, channels: [0] },
    });

    const out = await callTool(h.client, 'get_agent_runbook', { root: h.root });

    expect(out.success).toBe(true);
    const data = (out.evidence as {
      data: {
        profileSummary: {
          status: string;
          serial?: { port: string; baudRate: number; mode: string };
          jlink?: { target: string; speedKHz: string };
          flash?: { binaryConfigured: boolean; baseAddress: string };
        };
      };
    }).data;
    expect(data.profileSummary.status).toBe('loaded');
    expect(data.profileSummary.serial).toMatchObject({ port: 'COM7', baudRate: 921600, mode: 'terminal' });
    expect(data.profileSummary.jlink).toMatchObject({ target: 'AT32F435RGT7', speedKHz: 'auto' });
    expect(data.profileSummary.flash).toEqual({ binaryConfigured: true, baseAddress: '0x08008000', verify: true });
    expect(JSON.stringify(data.profileSummary)).not.toContain('build/app.bin');
  });

  it('returns a profile-first executable workflow recommendation in app status', async () => {
    await h.controlProfileManager.init(h.root, {
      serial: { enabled: true, port: 'COM7', baudRate: 921600, mode: 'terminal' },
      jlink: { enabled: true, target: 'AT32F435RGT7', interface: 'swd', speedKHz: 4000 },
      flash: { binary: 'build/app.bin', baseAddress: '0x08008000', verify: true },
      rtt: { enabled: false, channels: [0] },
    });

    const out = await callTool(h.client, 'get_app_status', { root: h.root });

    expect(out.success).toBe(true);
    const data = (out.evidence as {
      data: {
        recommendedNextActions: string[];
        recommendedWorkflows: Array<{
          id: string;
          ready: boolean;
          tool: string;
          arguments: Record<string, unknown>;
          requiresConfirmation: boolean;
          followUpTools: string[];
          reason: string;
        }>;
      };
    }).data;
    expect(data.recommendedNextActions.join('\n')).toContain('run_control_workflow');
    expect(data.recommendedWorkflows).toContainEqual(
      expect.objectContaining({
        id: 'profile_flash_observe',
        ready: true,
        tool: 'run_control_workflow',
        requiresConfirmation: true,
        followUpTools: ['get_control_workflow_job_status', 'read_control_workflow_job'],
        reason: expect.stringContaining('profile.flash.binary'),
        arguments: {
          root: h.root,
          mode: 'flash-observe',
          execution: { mode: 'background' },
          observe: { serial: true, clearBeforeObserve: true },
        },
      }),
    );
    expect(data.recommendedWorkflows[0]?.arguments).not.toHaveProperty('firmware');
  });

  it('allows read-only schema mismatch and attaches warning metadata', async () => {
    const out = await callTool(h.client, 'get_agent_runbook', {
      clientSchemaVersion: 'linkterm-mcp/0.0.1',
    });

    expect(out.success).toBe(true);
    const evidence = out.evidence as { meta?: { warning?: string } };
    expect(evidence.meta?.warning).toMatch(/schema version mismatch/i);
  });
});
