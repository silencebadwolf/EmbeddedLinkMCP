import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SessionManager } from '@/core/session/session-manager.js';
import { SerialDiscovery } from '@/transports/serial/serial-discovery.js';
import { createMcpServer, LINKTERM_MCP_SCHEMA_VERSION } from '@/mcp/index.js';
import type { LinkTermMcpServer } from '@/mcp/server.js';
import { FakeJLinkBackend } from '../../fixtures/fake-jlink-backend.js';
import { createInMemoryMcpTransportPair } from '../../fixtures/mock-mcp-transport.js';

interface Harness {
  manager: SessionManager;
  serialDiscovery: SerialDiscovery;
  fake: FakeJLinkBackend;
  mcp: LinkTermMcpServer;
  client: Client;
}

async function setupHarness(): Promise<Harness> {
  const manager = new SessionManager();
  const serialDiscovery = new SerialDiscovery({ listFn: async () => [] });
  const fake = new FakeJLinkBackend();
  const { server: serverTransport, client: clientTransport } = createInMemoryMcpTransportPair();
  const mcp = createMcpServer({
    sessionManager: manager,
    serialDiscovery,
    jlinkBackend: fake,
    transportFactory: () => serverTransport,
  });
  await mcp.start();

  const client = new Client({ name: 'linkterm-rtt-log-test-client', version: '0.0.0' });
  await client.connect(clientTransport);
  return { manager, serialDiscovery, fake, mcp, client };
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
});
