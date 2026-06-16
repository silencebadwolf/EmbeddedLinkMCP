import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SessionManager } from '@/core/session/session-manager.js';
import { ControlProfileManager } from '@/core/workspace/index.js';
import { SerialDiscovery } from '@/transports/serial/serial-discovery.js';
import { createMcpServer } from '@/mcp/index.js';
import type { LinkTermMcpServer } from '@/mcp/server.js';
import type { SerialSessionConfig } from '@/shared/types.js';
import { createInMemoryMcpTransportPair } from '../../fixtures/mock-mcp-transport.js';
import { FakeJLinkBackend } from '../../fixtures/fake-jlink-backend.js';
import { JLinkOperationError } from '@/jlink/errors.js';

interface Harness {
  manager: SessionManager;
  serialDiscovery: SerialDiscovery;
  controlProfileManager: ControlProfileManager;
  fake: FakeJLinkBackend;
  mcp: LinkTermMcpServer;
  client: Client;
  root: string;
  openedSerialConfigs: SerialSessionConfig[];
}

async function setup(): Promise<Harness> {
  const root = await mkdtemp(path.join(tmpdir(), 'lt-control-profile-mcp-'));
  const manager = new SessionManager();
  const serialDiscovery = new SerialDiscovery({ listFn: async () => [] });
  const controlProfileManager = new ControlProfileManager();
  const fake = new FakeJLinkBackend();
  const openedSerialConfigs: SerialSessionConfig[] = [];
  const { server: serverTransport, client: clientTransport } = createInMemoryMcpTransportPair();
  const mcp = createMcpServer({
    sessionManager: manager,
    serialDiscovery,
    controlProfileManager,
    jlinkBackend: fake,
    controlProfileOpenSerial: async (config) => {
      openedSerialConfigs.push(config);
      return { sessionId: 'sess_control_serial', state: 'open' };
    },
    transportFactory: () => serverTransport,
  });
  await mcp.start();
  const client = new Client({ name: 'lt-control-profile-test', version: '0.0.0' });
  await client.connect(clientTransport);
  return { manager, serialDiscovery, controlProfileManager, fake, mcp, client, root, openedSerialConfigs };
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

describe('MCP control profile tools', () => {
  let h: Harness;

  beforeEach(async () => {
    h = await setup();
  });

  afterEach(async () => {
    await teardown(h);
  });

  it('init_control_profile creates a visible workspace file with hex flash baseAddress', async () => {
    const out = await callTool(h.client, 'init_control_profile', {
      root: h.root,
      profile: {
        serial: { enabled: true, port: 'COM3', baudRate: 115200, mode: 'terminal' },
        jlink: { enabled: true, target: 'AT32F435RGT7', interface: 'swd', speedKHz: 4000 },
        flash: { binary: 'build/app.bin', baseAddress: '0x08000000', verify: true },
        rtt: { enabled: false, channels: [0] },
      },
    });

    expect(out.success).toBe(true);
    const evidence = out.evidence as {
      kind: string;
      data: { root: string; path: string; profile: { flash: { baseAddress: string } } };
    };
    expect(evidence.kind).toBe('workspace_config');
    expect(evidence.data.root).toBe(h.root);
    expect(evidence.data.path.endsWith(path.join('.linkterm', 'control-profile.json'))).toBe(true);
    expect(evidence.data.profile.flash.baseAddress).toBe('0x08000000');

    const raw = await readFile(path.join(h.root, '.linkterm', 'control-profile.json'), 'utf-8');
    expect(JSON.parse(raw)).toMatchObject({ flash: { baseAddress: '0x08000000' } });
  });

  it('get_control_profile reads the persisted profile', async () => {
    await callTool(h.client, 'init_control_profile', {
      root: h.root,
      profile: { jlink: { enabled: true, target: 'STM32F407VG' } },
    });

    const out = await callTool(h.client, 'get_control_profile', { root: h.root });
    expect(out.success).toBe(true);
    const profile = (out.evidence as { data: { profile: { jlink: { target: string } } } }).data.profile;
    expect(profile.jlink.target).toBe('STM32F407VG');
  });

  it('activate_control_profile opens configured serial and connects J-Link without flashing', async () => {
    await callTool(h.client, 'init_control_profile', {
      root: h.root,
      profile: {
        serial: { enabled: true, port: 'COM7', baudRate: 921600, mode: 'terminal' },
        jlink: { enabled: true, target: 'AT32F435RGT7', interface: 'swd', speedKHz: 4000 },
        flash: { binary: 'build/app.bin', baseAddress: '0x08000000', verify: true },
      },
    });

    const out = await callTool(h.client, 'activate_control_profile', { root: h.root });

    expect(out.success).toBe(true);
    expect(h.openedSerialConfigs).toEqual([
      { type: 'serial', port: 'COM7', baudRate: 921600, mode: 'terminal', label: 'LinkTerm Control: serial' },
    ]);
    expect(h.fake.callsOf('probeConnect')).toHaveLength(1);
    expect(h.fake.callsOf('probeConnect')[0]!.args[0]).toEqual({
      target: 'AT32F435RGT7',
      interface: 'swd',
      speedKHz: 4000,
    });
    expect(h.fake.callsOf('flashDownload')).toHaveLength(0);

    const evidence = out.evidence as {
      data: { root: string; serial?: { sessionId: string }; jlink?: { probeId: string }; flash?: { baseAddress: string } };
    };
    expect(evidence.data.root).toBe(h.root);
    expect(evidence.data.serial?.sessionId).toBe('sess_control_serial');
    expect(evidence.data.jlink?.probeId).toMatch(/^[0-9a-f-]{36}$/);
    expect(evidence.data.flash?.baseAddress).toBe('0x08000000');
  });

  it('activate_control_profile tries descending J-Link speeds when profile speed is auto', async () => {
    h.fake.failOnce.set('probeConnect', new JLinkOperationError('speed too high', { operation: 'probeConnect' }));
    await callTool(h.client, 'init_control_profile', {
      root: h.root,
      profile: {
        serial: { enabled: false },
        jlink: { enabled: true, target: 'AT32F435RGT7', interface: 'swd', speedKHz: 'auto' },
      },
    });

    const out = await callTool(h.client, 'activate_control_profile', { root: h.root });

    expect(out.success).toBe(true);
    expect(h.fake.callsOf('probeConnect')).toHaveLength(2);
    expect(h.fake.callsOf('probeConnect')[0]!.args[0]).toEqual({
      target: 'AT32F435RGT7',
      interface: 'swd',
      speedKHz: 50000,
    });
    expect(h.fake.callsOf('probeConnect')[1]!.args[0]).toEqual({
      target: 'AT32F435RGT7',
      interface: 'swd',
      speedKHz: 25000,
    });
  });

  it('activate_control_profile reports CONTROL_PROFILE_NOT_FOUND for missing profile', async () => {
    const out = await callTool(h.client, 'activate_control_profile', { root: h.root });
    expect(out.success).toBe(false);
    expect((out.error as { code: string }).code).toBe('CONTROL_PROFILE_NOT_FOUND');
  });

  it('rejects decimal baseAddress at schema layer', async () => {
    const res = await h.client.callTool({
      name: 'init_control_profile',
      arguments: {
        root: h.root,
        profile: { flash: { binary: 'build/app.bin', baseAddress: '134217728' } },
      },
    });
    expect(res.isError).toBe(true);
  });

  it('inspect_control_profile reports missing fields when profile is absent', async () => {
    const out = await callTool(h.client, 'inspect_control_profile', { root: h.root });

    expect(out.success).toBe(true);
    const data = (out.evidence as { data: { exists: boolean; complete: boolean; missingFields: string[] } }).data;
    expect(data.exists).toBe(false);
    expect(data.complete).toBe(false);
    expect(data.missingFields).toContain('serial.port');
    expect(data.missingFields).toContain('jlink.target');
    expect(data.missingFields).toContain('flash.baseAddress');
  });

  it('prepare_control_profile_questions produces a human-facing question', async () => {
    const out = await callTool(h.client, 'prepare_control_profile_questions', { root: h.root });

    expect(out.success).toBe(true);
    const data = (out.evidence as { data: { question: string; missingFields: string[] } }).data;
    expect(data.question).toContain('0x08000000');
    expect(data.question).toContain('COM3');
    expect(data.missingFields).toContain('serial.port');
  });

  it('apply_control_profile_answer parses a human answer and writes the profile', async () => {
    const out = await callTool(h.client, 'apply_control_profile_answer', {
      root: h.root,
      answer: 'COM7，921600，AT32F435RGT7，SWD，4000kHz，build/app.bin，0x08000000',
    });

    expect(out.success).toBe(true);
    const data = (out.evidence as {
      data: {
        complete: boolean;
        needsClarification: boolean;
        parsedFields: string[];
        profile: { flash: { baseAddress: string }; serial: { port: string }; jlink: { target: string } };
      };
    }).data;
    expect(data.complete).toBe(true);
    expect(data.needsClarification).toBe(false);
    expect(data.parsedFields).toContain('jlink.target');
    expect(data.profile.serial.port).toBe('COM7');
    expect(data.profile.jlink.target).toBe('AT32F435RGT7');
    expect(data.profile.flash.baseAddress).toBe('0x08000000');

    const raw = await readFile(path.join(h.root, '.linkterm', 'control-profile.json'), 'utf-8');
    expect(JSON.parse(raw)).toMatchObject({
      serial: { enabled: true, port: 'COM7', baudRate: 921600, mode: 'terminal' },
      jlink: { enabled: true, target: 'AT32F435RGT7', interface: 'swd', speedKHz: 4000 },
      flash: { binary: 'build/app.bin', baseAddress: '0x08000000', verify: true },
    });
  });
});
