import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SessionManager } from '@/core/session/session-manager.js';
import { ControlProfileManager } from '@/core/workspace/control-profile-manager.js';
import { SerialDiscovery } from '@/transports/serial/serial-discovery.js';
import { createMcpServer, LINKTERM_MCP_SCHEMA_VERSION } from '@/mcp/index.js';
import type { LinkTermMcpServer } from '@/mcp/server.js';
import type { ISession, SessionWriteOptions } from '@/core/session/types.js';
import type { ReadResult, SequenceCursor, TranscriptEvent } from '@/core/transcript/types.js';
import type { Origin, SessionId, SessionState } from '@/shared/types.js';
import { FakeJLinkBackend } from '../../fixtures/fake-jlink-backend.js';
import { createInMemoryMcpTransportPair } from '../../fixtures/mock-mcp-transport.js';

interface Harness {
  manager: SessionManager;
  serialDiscovery: SerialDiscovery;
  controlProfileManager: ControlProfileManager;
  fake: FakeJLinkBackend;
  mcp: LinkTermMcpServer;
  client: Client;
}

async function setupHarness(): Promise<Harness> {
  const manager = new SessionManager();
  const serialDiscovery = new SerialDiscovery({ listFn: async () => [] });
  const controlProfileManager = new ControlProfileManager();
  const fake = new FakeJLinkBackend();
  const { server: serverTransport, client: clientTransport } = createInMemoryMcpTransportPair();
  const mcp = createMcpServer({
    sessionManager: manager,
    serialDiscovery,
    controlProfileManager,
    jlinkBackend: fake,
    transportFactory: () => serverTransport,
  });
  await mcp.start();

  const client = new Client({ name: 'linkterm-rtt-log-test-client', version: '0.0.0' });
  await client.connect(clientTransport);
  return { manager, serialDiscovery, controlProfileManager, fake, mcp, client };
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

describe('MCP RTT log session tools', () => {
  let harness: Harness;

  beforeEach(async () => {
    harness = await setupHarness();
  });

  afterEach(async () => {
    await teardown(harness);
  });

  it('opens an RTT log session and exposes transcript bytes through read_from_session', async () => {
    const probe = await harness.fake.probeConnect({ target: 'AT32F435VGT7' });

    const out = await callTool(harness.client, 'open_rtt_log_session', {
      probeId: probe.probeId,
      channelIndex: 0,
      pollIntervalMs: 50,
      maxBytesPerRead: 32,
      label: 'RTT channel 0',
    });

    expect(out.success).toBe(true);
    expect(out.origin).toBe('ai');
    expect(out.schemaVersion).toBe(LINKTERM_MCP_SCHEMA_VERSION);
    const evidence = out.evidence as {
      kind: string;
      data: { sessionId: string; connectionType: string; reused: boolean };
    };
    expect(evidence.kind).toBe('terminal_output');
    expect(evidence.data.connectionType).toBe('rtt-log');
    expect(evidence.data.reused).toBe(false);

    const readOut = await callTool(harness.client, 'read_from_session', {
      sessionId: evidence.data.sessionId,
      cursor: 0,
    });
    const events = (readOut.evidence as {
      data: { events: Array<{ type: string; origin: string; dataBase64?: string }> };
    }).data.events;
    const systemEvent = events.find((event) => event.type === 'data' && event.origin === 'system');
    expect(Buffer.from(systemEvent?.dataBase64 ?? '', 'base64').toString('utf8')).toContain(
      'RTT log connected',
    );
    const dataEvent = events.find((event) => event.type === 'data' && event.origin === 'device');
    expect(dataEvent?.origin).toBe('device');
    expect(Buffer.from(dataEvent?.dataBase64 ?? '', 'base64').toString('utf8')).toBe('hello-rtt');
  });

  it('opens an App-visible RTT log session from a workspace profile without a separate GDB tool call', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'lt-rtt-mcp-root-'));
    try {
      await harness.controlProfileManager.init(root, {
        jlink: { enabled: true, target: 'STM32H743IIT6', interface: 'swd', speedKHz: 4000 },
        rtt: { enabled: true, channels: [0], controlBlockAddress: '0x24005310' },
      } as Parameters<ControlProfileManager['init']>[1]);

      const out = await callTool(harness.client, 'open_rtt_log_session', {
        root,
        label: 'Profile RTT channel 0',
        pollIntervalMs: 50,
        maxBytesPerRead: 32,
      });

      expect(out.success).toBe(true);
      const evidence = out.evidence as {
        data: {
          sessionId: string;
          connectionType: string;
          probeId: string;
          channelIndex: number;
          reused: boolean;
          gdbServerStarted?: boolean;
        };
      };
      expect(evidence.data.connectionType).toBe('rtt-log');
      expect(evidence.data.channelIndex).toBe(0);
      expect(evidence.data.reused).toBe(false);
      expect(evidence.data.gdbServerStarted).toBe(true);

      expect(harness.fake.callsOf('probeConnect')).toEqual([
        {
          method: 'probeConnect',
          args: [{ target: 'STM32H743II', interface: 'swd', speedKHz: 4000 }],
        },
      ]);
      expect(harness.fake.callsOf('gdbServerStart')).toHaveLength(1);
      expect(harness.fake.callsOf('rttConnect')).toEqual([
        {
          method: 'rttConnect',
          args: [evidence.data.probeId, { controlBlockAddress: 0x24005310 }],
        },
      ]);
      const methods = harness.fake.calls.map((call) => call.method);
      expect(methods.indexOf('gdbServerStart')).toBeGreaterThan(methods.indexOf('probeConnect'));
      expect(methods.indexOf('rttConnect')).toBeGreaterThan(methods.indexOf('gdbServerStart'));
      expect(harness.manager.listSummaries()).toEqual([
        expect.objectContaining({
          sessionId: evidence.data.sessionId,
          connectionType: 'rtt-log',
          label: 'Profile RTT channel 0',
          rttLog: { probeId: evidence.data.probeId, channelIndex: 0 },
        }),
      ]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('reuses the existing RTT log session for the same probe and channel', async () => {
    const probe = await harness.fake.probeConnect({ target: 'AT32F435VGT7' });

    const first = await callTool(harness.client, 'open_rtt_log_session', {
      probeId: probe.probeId,
      channelIndex: 0,
    });
    const firstSessionId = (first.evidence as { data: { sessionId: string } }).data.sessionId;

    const second = await callTool(harness.client, 'open_rtt_log_session', {
      probeId: probe.probeId,
      channelIndex: 0,
    });
    const secondEvidence = second.evidence as { data: { sessionId: string; reused: boolean } };

    expect(secondEvidence.data.sessionId).toBe(firstSessionId);
    expect(secondEvidence.data.reused).toBe(true);
    expect(harness.manager.listSummaries()).toHaveLength(1);
  });

  it('opens a separate RTT log session for a different channel on the same probe', async () => {
    const probe = await harness.fake.probeConnect({ target: 'AT32F435VGT7' });

    const first = await callTool(harness.client, 'open_rtt_log_session', {
      probeId: probe.probeId,
      channelIndex: 0,
    });
    const second = await callTool(harness.client, 'open_rtt_log_session', {
      probeId: probe.probeId,
      channelIndex: 1,
    });
    const firstSessionId = (first.evidence as { data: { sessionId: string } }).data.sessionId;
    const secondEvidence = second.evidence as {
      data: { sessionId: string; reused: boolean; channelIndex: number };
    };

    expect(secondEvidence.data.sessionId).not.toBe(firstSessionId);
    expect(secondEvidence.data.reused).toBe(false);
    expect(secondEvidence.data.channelIndex).toBe(1);
    expect(harness.manager.listSummaries()).toEqual([
      expect.objectContaining({ rttLog: { probeId: probe.probeId, channelIndex: 0 } }),
      expect.objectContaining({ rttLog: { probeId: probe.probeId, channelIndex: 1 } }),
    ]);
  });

  it('returns NOT_WRITABLE when generic MCP writes target a real RTT log session', async () => {
    const probe = await harness.fake.probeConnect({ target: 'AT32F435VGT7' });
    const opened = await callTool(harness.client, 'open_rtt_log_session', {
      probeId: probe.probeId,
      channelIndex: 0,
    });
    const sessionId = (opened.evidence as { data: { sessionId: string } }).data.sessionId;

    const out = await callTool(harness.client, 'write_to_session', {
      sessionId,
      payload: { encoding: 'utf-8', data: 'x' },
    });

    expect(out.success).toBe(false);
    expect((out.error as { code: string }).code).toBe('NOT_WRITABLE');
  });

  it('diagnoses a banner-only RTT log session without touching hardware again', async () => {
    const probe = await harness.fake.probeConnect({ target: 'AT32F435VGT7' });
    const banner =
      'SEGGER J-Link V7.92 - Real time terminal output\r\n' +
      'SEGGER J-Link V11.0, SN=123456789\r\n' +
      'Process: JLinkGDBServerCL.exe\r\n';
    vi.spyOn(harness.fake, 'rttRead').mockResolvedValueOnce({
      channelIndex: 0,
      data: Buffer.from(banner, 'utf8'),
      truncated: false,
    });
    const opened = await callTool(harness.client, 'open_rtt_log_session', {
      probeId: probe.probeId,
      channelIndex: 0,
    });
    const sessionId = (opened.evidence as { data: { sessionId: string } }).data.sessionId;
    const callsBeforeDiagnose = harness.fake.calls.length;

    const out = await callTool(harness.client, 'diagnose_rtt_log_session', { sessionId });

    expect(out.success).toBe(true);
    const evidence = out.evidence as {
      kind: string;
      data: {
        classification: string;
        transportConnected: boolean;
        seggerBannerSeen: boolean;
        firmwareBytes: number;
        nextActions: string[];
      };
    };
    expect(evidence.kind).toBe('debug_output');
    expect(evidence.data.classification).toBe('transport_connected_firmware_silent');
    expect(evidence.data.transportConnected).toBe(true);
    expect(evidence.data.seggerBannerSeen).toBe(true);
    expect(evidence.data.firmwareBytes).toBe(0);
    expect(evidence.data.nextActions.join('\n')).toContain('do not repeat flash');
    expect(harness.fake.calls).toHaveLength(callsBeforeDiagnose);
  });

  it('rejects RTT diagnosis for a non-RTT session without reading hardware', async () => {
    const session = harness.manager.create((id) => new StaticSession(id), {
      connectionType: 'local-shell',
      label: 'not RTT',
    });

    const out = await callTool(harness.client, 'diagnose_rtt_log_session', {
      sessionId: session.id,
    });

    expect(out.success).toBe(false);
    expect((out.error as { code: string }).code).toBe('INVALID_ARGUMENT');
    expect(harness.fake.calls).toEqual([]);
  });
});

class StaticSession extends EventEmitter implements ISession {
  readonly id: SessionId;
  readonly state: SessionState = 'open';

  constructor(id: SessionId) {
    super();
    this.id = id;
  }

  async open(): Promise<void> {
    return undefined;
  }

  async close(): Promise<void> {
    return undefined;
  }

  async write(_data: Uint8Array, _options: SessionWriteOptions): Promise<void> {
    return undefined;
  }

  read(cursor: SequenceCursor): ReadResult {
    return { events: [], cursor, truncated: false, oldestAvailableSequence: cursor + 1 };
  }

  clear(origin: Origin): TranscriptEvent {
    return {
      sequence: 1,
      timestamp: Date.now(),
      type: 'clear',
      origin,
    };
  }
}
