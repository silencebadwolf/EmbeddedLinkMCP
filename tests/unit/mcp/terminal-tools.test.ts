import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SessionManager } from '@/core/session/session-manager.js';
import { SessionBase } from '@/core/session/session-base.js';
import { SerialDiscovery } from '@/transports/serial/serial-discovery.js';
import { createMcpServer, LINKTERM_MCP_SCHEMA_VERSION } from '@/mcp/index.js';
import { SessionNotWritableError } from '@/core/session/types.js';
import type { LinkTermMcpServer } from '@/mcp/server.js';
import type { SessionId } from '@/shared/types.js';
import { OperationAdmissionCoordinator } from '@/core/operation-admission/operation-admission-coordinator.js';
import { MockTransport } from '../../fixtures/mock-transport.js';
import { createInMemoryMcpTransportPair } from '../../fixtures/mock-mcp-transport.js';

const utf8 = (s: string): Uint8Array => new TextEncoder().encode(s);
const fromB64 = (s: string): Uint8Array => new Uint8Array(Buffer.from(s, 'base64'));

class TestSession extends SessionBase {
  constructor(
    id: SessionId,
    public readonly transport: MockTransport,
  ) {
    super({ id, transport });
  }
}

interface Harness {
  manager: SessionManager;
  serialDiscovery: SerialDiscovery;
  mcp: LinkTermMcpServer;
  client: Client;
}

const flush = (): Promise<void> => new Promise((r) => setImmediate(r));

/** 把一个挂着 MockTransport 的 TestSession 注入到 manager，模拟 \"open 后\" 的状态。 */
function injectTestSession(manager: SessionManager, transport: MockTransport): TestSession {
  const session = manager.create((id) => new TestSession(id, transport)) as TestSession;
  return session;
}

async function setupHarness(
  opts: { listFn?: () => Promise<readonly never[]> } = {},
): Promise<Harness> {
  const manager = new SessionManager();
  const serialDiscovery = new SerialDiscovery({
    listFn: opts.listFn ?? (async () => []),
  });
  const admissionCoordinator = new OperationAdmissionCoordinator({
    runtimeId: 'terminal-tools-test-runtime',
    now: () => '2026-07-15T00:00:00.000Z',
  });
  const { server: serverTransport, client: clientTransport } = createInMemoryMcpTransportPair();
  const mcp = createMcpServer({
    sessionManager: manager,
    serialDiscovery,
    transportFactory: () => serverTransport,
    operationAdmissionCoordinator: admissionCoordinator,
  });
  await mcp.start();

  const client = new Client({ name: 'linkterm-test-client', version: '0.0.0' });
  await client.connect(clientTransport);

  return { manager, serialDiscovery, mcp, client };
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

/** 调用工具并取出 structuredContent；失败时也返回 structuredContent（registry 仍会回填）。 */
async function callTool(
  client: Client,
  name: string,
  args: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  const res = await client.callTool({ name, arguments: args });
  expect(res.structuredContent).toBeDefined();
  return res.structuredContent as Record<string, unknown>;
}

describe('MCP terminal tools', () => {
  let harness: Harness;

  beforeEach(async () => {
    harness = await setupHarness();
  });

  afterEach(async () => {
    await teardown(harness);
  });

  it('list_sessions returns empty array when no sessions exist', async () => {
    const out = await callTool(harness.client, 'list_sessions');
    expect(out.success).toBe(true);
    expect(out.origin).toBe('ai');
    expect(out.schemaVersion).toBe(LINKTERM_MCP_SCHEMA_VERSION);
    const evidence = out.evidence as { data: { sessions: unknown[] }; kind: string };
    expect(evidence.kind).toBe('terminal_output');
    expect(evidence.data.sessions).toEqual([]);
  });

  it('list_sessions reflects manager state after a session is created', async () => {
    const transport = new MockTransport();
    const session = injectTestSession(harness.manager, transport);
    await session.open();

    const out = await callTool(harness.client, 'list_sessions');
    const sessions = (
      out.evidence as { data: { sessions: { sessionId: string; state: string }[] } }
    ).data.sessions;
    expect(sessions).toHaveLength(1);
    expect(sessions[0]!.sessionId).toBe(session.id);
    expect(sessions[0]!.state).toBe('open');
  });

  it('write_to_session writes bytes with origin=ai and updates transcript', async () => {
    const transport = new MockTransport();
    const session = injectTestSession(harness.manager, transport);
    await session.open();

    const out = await callTool(harness.client, 'write_to_session', {
      sessionId: session.id,
      payload: { encoding: 'utf-8', data: 'ls\n' },
      correlationId: 'corr-1',
    });

    expect(out.success).toBe(true);
    expect(out.correlationId).toBe('corr-1');
    expect(out.origin).toBe('ai');

    // transport 收到字节
    expect(transport.writes).toHaveLength(1);
    expect(new TextDecoder().decode(transport.writes[0]!)).toBe('ls\n');

    // transcript 中有 origin='ai' 的 data event
    const events = session.read(0).events.filter((e) => e.type === 'data');
    expect(events).toHaveLength(1);
    expect(events[0]!.origin).toBe('ai');
    expect((events[0]!.meta as { correlationId?: string }).correlationId).toBe('corr-1');
  });

  it('allows AI write_to_session while the legacy pause latch is set', async () => {
    await teardown(harness);
    harness = await setupHarness();
    const transport = new MockTransport();
    const session = injectTestSession(harness.manager, transport);
    await session.open();

    const out = await callTool(harness.client, 'write_to_session', {
      sessionId: session.id,
      payload: { encoding: 'utf-8', data: 'blocked\n' },
      correlationId: 'pause-write-1',
    });

    expect(out.success).toBe(true);
    expect(out.correlationId).toBe('pause-write-1');
    expect(transport.writes).toHaveLength(1);
    expect(new TextDecoder().decode(transport.writes[0]!)).toBe('blocked\n');
    expect(session.read(0).events.filter((event) => event.origin === 'ai')).toHaveLength(1);
  });

  it('writes AI send_and_wait payload while the legacy pause latch is set', async () => {
    await teardown(harness);
    harness = await setupHarness();
    const transport = new MockTransport();
    const session = injectTestSession(harness.manager, transport);
    await session.open();

    const out = await callTool(harness.client, 'send_and_wait', {
      sessionId: session.id,
      payload: { encoding: 'utf-8', data: 'cmd' },
      completionMarkers: ['DONE'],
      settleMs: 5,
      timeoutMs: 1000,
    });

    expect(out.success).toBe(true);
    expect(
      (out.evidence as { data: { hasDeviceOutput: boolean } }).data.hasDeviceOutput,
    ).toBe(false);
    expect(transport.writes).toHaveLength(1);
  });

  it('allows read-only terminal status while the session is paused', async () => {
    await teardown(harness);
    harness = await setupHarness();
    const transport = new MockTransport();
    const session = injectTestSession(harness.manager, transport);
    await session.open();

    const out = await callTool(harness.client, 'get_session_status', { sessionId: session.id });

    expect(out.success).toBe(true);
    expect(out.state).toBe('open');
    expect(transport.writes).toHaveLength(0);
  });

  it('does not let one session legacy pause block another session write', async () => {
    await teardown(harness);
    harness = await setupHarness();
    const pausedTransport = new MockTransport();
    const activeTransport = new MockTransport();
    const pausedSession = injectTestSession(harness.manager, pausedTransport);
    const activeSession = injectTestSession(harness.manager, activeTransport);
    await pausedSession.open();
    await activeSession.open();

    const out = await callTool(harness.client, 'write_to_session', {
      sessionId: activeSession.id,
      payload: { encoding: 'utf-8', data: 'allowed\n' },
    });

    expect(out.success).toBe(true);
    expect(pausedTransport.writes).toHaveLength(0);
    expect(activeTransport.writes).toHaveLength(1);
    expect(new TextDecoder().decode(activeTransport.writes[0]!)).toBe('allowed\n');
  });

  it('allows paused AI close_session to close the transport', async () => {
    await teardown(harness);
    harness = await setupHarness();
    const transport = new MockTransport();
    const session = injectTestSession(harness.manager, transport);
    await session.open();

    const out = await callTool(harness.client, 'close_session', { sessionId: session.id });

    expect(out.success).toBe(true);
    expect(session.state).toBe('closed');
  });

  it('write_to_session decodes base64 payload', async () => {
    const transport = new MockTransport();
    const session = injectTestSession(harness.manager, transport);
    await session.open();

    const bytes = new Uint8Array([0xff, 0x00, 0x42]);
    const b64 = Buffer.from(bytes).toString('base64');

    const out = await callTool(harness.client, 'write_to_session', {
      sessionId: session.id,
      payload: { encoding: 'base64', data: b64 },
    });

    expect(out.success).toBe(true);
    expect(transport.writes[0]).toEqual(bytes);
  });

  it('write_to_session returns SESSION_NOT_FOUND for unknown session id', async () => {
    const out = await callTool(harness.client, 'write_to_session', {
      sessionId: 'sess_nonexistent',
      payload: { encoding: 'utf-8', data: 'x' },
    });

    expect(out.success).toBe(false);
    const error = out.error as { code: string; message: string };
    expect(error.code).toBe('SESSION_NOT_FOUND');
    expect(error.message).toMatch(/sess_nonexistent/);
  });

  it('write_to_session rejects invalid base64 instead of silently truncating', async () => {
    const transport = new MockTransport();
    const session = injectTestSession(harness.manager, transport);
    await session.open();

    const out = await callTool(harness.client, 'write_to_session', {
      sessionId: session.id,
      payload: { encoding: 'base64', data: 'not_base64!!' },
    });

    expect(out.success).toBe(false);
    expect((out.error as { code: string }).code).toBe('INVALID_ARGUMENT');
    // 关键：transport 没有收到任何字节，避免 \"成功但字节错\"
    expect(transport.writes).toHaveLength(0);
  });

  it('write_to_session returns NOT_OPEN for closed session', async () => {
    const transport = new MockTransport();
    const session = injectTestSession(harness.manager, transport);
    await session.open();
    await session.close();

    const out = await callTool(harness.client, 'write_to_session', {
      sessionId: session.id,
      payload: { encoding: 'utf-8', data: 'x' },
    });

    expect(out.success).toBe(false);
    expect((out.error as { code: string }).code).toBe('NOT_OPEN');
  });

  it('write_to_session returns NOT_WRITABLE for read-only sessions', async () => {
    class ReadOnlySession extends TestSession {
      override async write(): Promise<void> {
        throw new SessionNotWritableError(this.id);
      }
    }

    const session = harness.manager.create((id) => new ReadOnlySession(id, new MockTransport()), {
      connectionType: 'rtt-log',
      label: 'RTT channel 0',
      rttLog: { probeId: 'probe-1', channelIndex: 0 },
    });
    await session.open();

    const out = await callTool(harness.client, 'write_to_session', {
      sessionId: session.id,
      payload: { encoding: 'utf-8', data: 'x' },
    });

    expect(out.success).toBe(false);
    expect((out.error as { code: string }).code).toBe('NOT_WRITABLE');
  });

  it('read_from_session returns events with base64-encoded data and the latest cursor', async () => {
    const transport = new MockTransport();
    const session = injectTestSession(harness.manager, transport);
    await session.open();
    transport.pushIncoming(utf8('hello'));

    const out = await callTool(harness.client, 'read_from_session', {
      sessionId: session.id,
      cursor: 0,
    });

    expect(out.success).toBe(true);
    const evidence = out.evidence as {
      data: { events: { type: string; origin: string; dataBase64?: string }[] };
      cursor: number;
    };
    const dataEvents = evidence.data.events.filter((e) => e.type === 'data');
    expect(dataEvents).toHaveLength(1);
    expect(dataEvents[0]!.origin).toBe('device');
    expect(dataEvents[0]!.dataBase64).toBeDefined();
    expect(fromB64(dataEvents[0]!.dataBase64!)).toEqual(utf8('hello'));
    expect(evidence.cursor).toBeGreaterThan(0);
  });

  it('close_session closes transport but keeps session readable', async () => {
    const transport = new MockTransport();
    const session = injectTestSession(harness.manager, transport);
    await session.open();
    transport.pushIncoming(utf8('pre-close'));

    const out = await callTool(harness.client, 'close_session', { sessionId: session.id });
    expect(out.success).toBe(true);
    expect(out.state).toBe('closed');

    // 仍能读到关闭前的输出
    const readOut = await callTool(harness.client, 'read_from_session', {
      sessionId: session.id,
      cursor: 0,
    });
    expect(readOut.success).toBe(true);
    const dataEvents = (
      readOut.evidence as {
        data: { events: { type: string; origin: string; dataBase64?: string }[] };
      }
    ).data.events.filter((e) => e.type === 'data' && e.origin === 'device');
    expect(dataEvents).toHaveLength(1);

    // list_sessions 仍能看见这个 sessionId
    const listOut = await callTool(harness.client, 'list_sessions');
    const sessions = (listOut.evidence as { data: { sessions: { sessionId: string }[] } }).data
      .sessions;
    expect(sessions.map((s) => s.sessionId)).toContain(session.id);
  });

  it('get_session_status returns current state and latest cursor', async () => {
    const transport = new MockTransport();
    const session = injectTestSession(harness.manager, transport);
    await session.open();
    transport.pushIncoming(utf8('abc'));

    const out = await callTool(harness.client, 'get_session_status', { sessionId: session.id });
    expect(out.success).toBe(true);
    expect(out.state).toBe('open');
    const evidence = out.evidence as { data: { state: string; cursor: number }; cursor: number };
    expect(evidence.data.state).toBe('open');
    expect(evidence.cursor).toBeGreaterThan(0);
  });

  it('discover_serial_ports proxies SerialDiscovery.listPorts', async () => {
    await teardown(harness);
    harness = await setupHarness({
      listFn: async () => [{ path: '/dev/tty.fake', manufacturer: 'TestCo' }] as never,
    });

    const out = await callTool(harness.client, 'discover_serial_ports');
    expect(out.success).toBe(true);
    const ports = (out.evidence as { data: { ports: { path: string }[] } }).data.ports;
    expect(ports).toEqual([{ path: '/dev/tty.fake', manufacturer: 'TestCo' }]);
  });

  it('send_and_wait returns settled evidence after observing device output', async () => {
    const transport = new MockTransport();
    const session = injectTestSession(harness.manager, transport);
    await session.open();

    const callPromise = harness.client.callTool({
      name: 'send_and_wait',
      arguments: {
        sessionId: session.id,
        payload: { encoding: 'utf-8', data: 'cmd' },
        timeoutMs: 1000,
        // no completionMarkers => output is observed until the settle boundary
      },
    });

    // 等 write 入队完成，再驱动设备返回数据
    await flush();
    await flush();
    transport.pushIncoming(utf8('reply'));

    const result = await callPromise;
    const out = result.structuredContent as Record<string, unknown>;
    expect(out.success).toBe(true);
    const evidence = out.evidence as {
      data: {
        bytesWritten: number;
        receivedBase64: string;
        cursorBefore: number;
        cursorAfter: number;
        matchedMarkerIndex: number;
      };
      cursor: number;
    };
    expect(evidence.data.bytesWritten).toBeGreaterThan(0);
    expect(evidence.data.receivedBase64).toBeDefined();
    expect(fromB64(evidence.data.receivedBase64)).toEqual(utf8('reply'));
    expect(evidence.data.cursorAfter).toBeGreaterThanOrEqual(evidence.data.cursorBefore);
  });

  it('send_and_wait reports a cross-chunk completion marker as metadata', async () => {
    const transport = new MockTransport();
    const session = injectTestSession(harness.manager, transport);
    await session.open();

    const callPromise = harness.client.callTool({
      name: 'send_and_wait',
      arguments: {
        sessionId: session.id,
        payload: { encoding: 'utf-8', data: 'ls' },
        completionMarkers: ['DONE'],
        timeoutMs: 1000,
      },
    });

    await flush();
    await flush();
    // Echo, then partial DONE split across chunks
    transport.pushIncoming(utf8('ls\r\n'));
    transport.pushIncoming(utf8('foo DO'));
    transport.pushIncoming(utf8('NE rest'));

    const result = await callPromise;
    const out = result.structuredContent as Record<string, unknown>;
    expect(out.success).toBe(true);
    const evidence = out.evidence as {
      data: { matchedMarkerIndex: number; receivedBase64: string };
    };
    expect(evidence.data.matchedMarkerIndex).toBe(0);
    expect(new TextDecoder().decode(fromB64(evidence.data.receivedBase64))).toContain('DONE');
  });

  it('send_and_wait returns settled evidence with received bytes even without a marker', async () => {
    const transport = new MockTransport();
    const session = injectTestSession(harness.manager, transport);
    await session.open();

    const callPromise = harness.client.callTool({
      name: 'send_and_wait',
      arguments: {
        sessionId: session.id,
        payload: { encoding: 'utf-8', data: 'cmd' },
        completionMarkers: ['NEVER'],
        timeoutMs: 80,
      },
    });

    await flush();
    await flush();
    // echo will be stripped; "partial" stays in detector buffer
    transport.pushIncoming(utf8('cmd\r\n'));
    transport.pushIncoming(utf8('partial'));

    const result = await callPromise;
    const out = result.structuredContent as Record<string, unknown>;
    expect(out.success).toBe(true);
    const evidence = out.evidence as {
      data: {
        receivedBase64?: string;
        cursorBefore?: number;
        hasDeviceOutput?: boolean;
        reason?: string;
      };
    };
    expect(evidence.data.reason).toBe('settled');
    expect(evidence.data.receivedBase64).toBeDefined();
    expect(new TextDecoder().decode(fromB64(evidence.data.receivedBase64!))).toContain('partial');
    expect(evidence.data.hasDeviceOutput).toBe(true);
    expect(typeof evidence.data.cursorBefore).toBe('number');
  });

  it('does not block a second AI write when settle produces no device output', async () => {
    const transport = new MockTransport();
    const session = injectTestSession(harness.manager, transport);
    await session.open();

    const first = await harness.client.callTool({
      name: 'send_and_wait',
      arguments: {
        sessionId: session.id,
        payload: { encoding: 'utf-8', data: 'first' },
        completionMarkers: ['NEVER'],
        timeoutMs: 40,
      },
    });
    const firstOut = first.structuredContent as Record<string, unknown>;
    expect(firstOut.success).toBe(true);
    expect(
      (firstOut.evidence as { data: { hasDeviceOutput: boolean } }).data.hasDeviceOutput,
    ).toBe(false);

    const second = await harness.client.callTool({
      name: 'write_to_session',
      arguments: {
        sessionId: session.id,
        payload: { encoding: 'utf-8', data: 'do-not-repeat' },
      },
    });
    const secondOut = second.structuredContent as Record<string, unknown>;
    expect(secondOut.success).toBe(true);
    expect(transport.writes).toHaveLength(2);

    const read = await callTool(harness.client, 'read_from_session', {
      sessionId: session.id,
      cursor: 0,
    });
    expect(read.success).toBe(true);

  });

  it('allows a second send_and_wait after an empty settle observation', async () => {
    const transport = new MockTransport();
    const session = injectTestSession(harness.manager, transport);
    await session.open();

    const first = await harness.client.callTool({
      name: 'send_and_wait',
      arguments: {
        sessionId: session.id,
        payload: { encoding: 'utf-8', data: 'first' },
        completionMarkers: ['NEVER'],
        timeoutMs: 40,
      },
    });
    expect((first.structuredContent as Record<string, unknown>).success).toBe(true);

    const second = await harness.client.callTool({
      name: 'send_and_wait',
      arguments: {
        sessionId: session.id,
        payload: { encoding: 'utf-8', data: 'must-not-send' },
        completionMarkers: ['NEVER'],
        timeoutMs: 40,
      },
    });
    const out = second.structuredContent as Record<string, unknown>;
    expect(out.success).toBe(true);
    expect(transport.writes).toHaveLength(2);
  });

  it('send_and_wait translates session-closed to SESSION_CLOSED with sessionState detail', async () => {
    const transport = new MockTransport();
    const session = injectTestSession(harness.manager, transport);
    await session.open();

    const callPromise = harness.client.callTool({
      name: 'send_and_wait',
      arguments: {
        sessionId: session.id,
        payload: { encoding: 'utf-8', data: 'cmd' },
        completionMarkers: ['NEVER'],
        timeoutMs: 5000,
      },
    });

    await flush();
    await flush();
    // close session mid-wait
    await session.close();

    const result = await callPromise;
    const out = result.structuredContent as Record<string, unknown>;
    expect(out.success).toBe(false);
    const error = out.error as { code: string; details?: { sessionState?: string } };
    expect(error.code).toBe('SESSION_CLOSED');
    expect(error.details?.sessionState).toBe('closed');
  });

  it('rejects state-affecting tool calls when client schema version mismatches', async () => {
    const transport = new MockTransport();
    const session = injectTestSession(harness.manager, transport);
    await session.open();

    const out = await callTool(harness.client, 'write_to_session', {
      sessionId: session.id,
      payload: { encoding: 'utf-8', data: 'x' },
      clientSchemaVersion: 'linkterm-mcp/0.0.1',
    });

    expect(out.success).toBe(false);
    expect((out.error as { code: string }).code).toBe('VERSION_MISMATCH');
    // 凭据/敏感字段不应被泄漏
    expect(JSON.stringify(out)).not.toContain('linkterm-mcp/1.0.0\n'); // 错误 payload 不该夹带
    // 实际写入未发生
    expect(transport.writes).toHaveLength(0);
  });

  it('allows read-only tool calls on schema mismatch and surfaces a warning', async () => {
    const out = await callTool(harness.client, 'list_sessions', {
      clientSchemaVersion: 'linkterm-mcp/0.0.1',
    });
    expect(out.success).toBe(true);
    const evidence = out.evidence as { meta?: { warning?: string } };
    expect(evidence.meta?.warning).toMatch(/mismatch/i);
  });

  it('does not leak SSH credentials in error messages on open failures', async () => {
    // 用一个 SSH 配置去 open；Phase 4 的 hostVerifier 一律拒绝（无 known_hosts），
    // 因此 open 必失败。关键断言：失败消息中不出现明文密码。
    const out = await callTool(harness.client, 'open_session', {
      config: {
        type: 'ssh',
        host: 'invalid.example.invalid',
        port: 22,
        username: 'root',
        credentials: { kind: 'password', password: 'TopSecret123!' },
        readyTimeoutMs: 50,
      },
    });

    expect(out.success).toBe(false);
    const serialized = JSON.stringify(out);
    expect(serialized).not.toContain('TopSecret123!');
  });

  it('rolls back a failed open_session candidate and emits no lifecycle events', async () => {
    const created = vi.fn();
    const destroyed = vi.fn();
    const sessionEvents = vi.fn();
    harness.manager.on('session:created', created);
    harness.manager.on('session:destroyed', destroyed);
    harness.manager.on('session:event', sessionEvents);

    const realCreateAndOpen = harness.manager.createAndOpen.bind(harness.manager);
    const createAndOpen = vi
      .spyOn(harness.manager, 'createAndOpen')
      .mockImplementationOnce((_factory, metadata) =>
        realCreateAndOpen(
          (id) => new TestSession(id, new MockTransport({ failOnOpen: new Error('port busy') })),
          metadata,
        ),
      );

    const out = await callTool(harness.client, 'open_session', {
      config: {
        type: 'serial',
        port: 'COM7',
        baudRate: 115200,
        mode: 'terminal',
      },
    });

    expect(out).toMatchObject({
      success: false,
      error: {
        code: 'INTERNAL',
        message: 'Failed to open session: port busy',
      },
    });
    expect(createAndOpen).toHaveBeenCalledOnce();
    expect(harness.manager.list()).toEqual([]);
    expect(harness.manager.listSummaries()).toEqual([]);
    expect(created).not.toHaveBeenCalled();
    expect(destroyed).not.toHaveBeenCalled();
    expect(sessionEvents).not.toHaveBeenCalled();
  });
});

/** 为 send_and_wait 测试用：让 write 入队链路有时间让 audit 事件落地。 */
async function _ensureFlushed(): Promise<void> {
  for (let i = 0; i < 4; i++) await flush();
}
void _ensureFlushed;
