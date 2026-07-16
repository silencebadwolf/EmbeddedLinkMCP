import { describe, expect, it, vi } from 'vitest';
import { SessionBase } from '@/core/session/session-base.js';
import { SessionManager } from '@/core/session/session-manager.js';
import { SessionUnresponsiveError } from '@/core/session/types.js';
import type { TranscriptEvent } from '@/core/transcript/types.js';
import type { SessionId } from '@/shared/types.js';
import { MockTransport } from '../../fixtures/mock-transport.js';

const utf8 = (s: string): Uint8Array => new TextEncoder().encode(s);

class TestSession extends SessionBase {
  // 直接暴露 transport 给测试，便于驱动事件
  constructor(id: SessionId, public readonly transport: MockTransport) {
    super({ id, transport });
  }
}

const makeSession = (transport = new MockTransport()): { session: TestSession; transport: MockTransport } => {
  let session!: TestSession;
  const factory = (id: SessionId): TestSession => {
    session = new TestSession(id, transport);
    return session;
  };
  // 不通过 manager 创建，直接 new，以便纯单测 SessionBase
  const id = 'sess_test';
  session = factory(id);
  return { session, transport };
};

describe('SessionBase', () => {
  it('starts in idle state', () => {
    const { session } = makeSession();
    expect(session.state).toBe('idle');
  });

  it('open() transitions idle → opening → open and emits state events', async () => {
    const { session } = makeSession();
    const states: string[] = [];
    session.on('state', (s) => states.push(s));
    await session.open();
    expect(session.state).toBe('open');
    expect(states).toEqual(['opening', 'open']);
  });

  it('records state transitions in transcript', async () => {
    const { session } = makeSession();
    await session.open();
    const result = session.read(0);
    const stateEvents = result.events.filter((e) => e.type === 'state');
    expect(stateEvents.length).toBeGreaterThanOrEqual(2);
    expect((stateEvents[0]!.meta as { to: string }).to).toBe('opening');
  });

  it('routes incoming transport data into transcript with origin=device', async () => {
    const { session, transport } = makeSession();
    await session.open();
    transport.pushIncoming(utf8('hello'));
    const events = session.read(0).events.filter((e) => e.type === 'data');
    expect(events).toHaveLength(1);
    expect(events[0]!.origin).toBe('device');
    expect(events[0]!.data).toEqual(utf8('hello'));
  });

  it('write() goes through queue and records outgoing data with origin', async () => {
    const { session, transport } = makeSession();
    await session.open();
    await session.write(utf8('cmd\n'), { origin: 'human' });
    expect(transport.writes).toHaveLength(1);
    const dataEvents = session.read(0).events.filter((e) => e.type === 'data');
    expect(dataEvents).toHaveLength(1);
    expect(dataEvents[0]!.origin).toBe('human');
  });

  it('write() rejects when session not open', async () => {
    const { session } = makeSession();
    await expect(session.write(utf8('x'), { origin: 'human' })).rejects.toThrow(/not open/);
  });

  it('serializes AI and human writes through a single queue', async () => {
    const { session, transport } = makeSession();
    await session.open();
    await Promise.all([
      session.write(utf8('h1'), { origin: 'human' }),
      session.write(utf8('a1'), { origin: 'ai' }),
      session.write(utf8('h2'), { origin: 'human' }),
    ]);
    const tags = transport.writes.map((b) => new TextDecoder().decode(b));
    expect(tags).toEqual(['h1', 'a1', 'h2']);
    const dataEvents = session.read(0).events.filter((e) => e.type === 'data');
    expect(dataEvents.map((e) => e.origin)).toEqual(['human', 'ai', 'human']);
  });

  it('records transport error and transitions to errored state', async () => {
    const { session, transport } = makeSession();
    await session.open();
    transport.pushError(new Error('cable unplugged'));
    expect(session.state).toBe('errored');
    const events = session.read(0).events;
    const errorEvent = events.find((e) => e.type === 'error');
    expect(errorEvent).toBeDefined();
    expect((errorEvent!.meta as { message: string }).message).toBe('cable unplugged');
  });

  it('releases transport and rejects further writes after transport error', async () => {
    const { session, transport } = makeSession();
    await session.open();
    transport.pushError(new Error('cable unplugged'));
    // 等微任务跑完，确保 fire-and-forget 的 transport.close() 已 settle
    await Promise.resolve();
    await Promise.resolve();
    expect(transport.isOpen()).toBe(false);
    await expect(session.write(utf8('x'), { origin: 'human' })).rejects.toThrow();
  });

  it('closes write queue when transport initiates close', async () => {
    const { session, transport } = makeSession();
    await session.open();
    transport.triggerClose();
    expect(session.state).toBe('closed');
    await Promise.resolve();
    await expect(session.write(utf8('x'), { origin: 'human' })).rejects.toThrow();
  });

  it('marks session closed on transport-initiated close', async () => {
    const { session, transport } = makeSession();
    await session.open();
    transport.triggerClose();
    expect(session.state).toBe('closed');
  });

  it('open() failure transitions to errored and records error', async () => {
    const transport = new MockTransport({ failOnOpen: new Error('no port') });
    const { session } = makeSession(transport);
    await expect(session.open()).rejects.toThrow('no port');
    expect(session.state).toBe('errored');
    const errors = session.read(0).events.filter((e) => e.type === 'error');
    expect(errors.length).toBeGreaterThanOrEqual(1);
  });

  it('open() failure releases transport (no leaked handle)', async () => {
    const transport = new MockTransport({ failOnOpen: new Error('handshake failed') });
    // 假装底层 open 部分初始化（mock 在 failOnOpen 时不置 #open=true，但仍可被 close 调用并 emit 'close'）
    const closeSpy = vi.spyOn(transport, 'close');
    const { session } = makeSession(transport);
    await expect(session.open()).rejects.toThrow('handshake failed');
    expect(closeSpy).toHaveBeenCalled();
  });

  it('close() drains writes before closing transport', async () => {
    let resolveWrite!: () => void;
    const writeGate = new Promise<void>((r) => {
      resolveWrite = r;
    });
    const transport = new MockTransport();
    // 拦截 write，让首个写入挂起
    const original = transport.write.bind(transport);
    let callCount = 0;
    transport.write = async (data: Uint8Array): Promise<void> => {
      callCount += 1;
      if (callCount === 1) await writeGate;
      return original(data);
    };
    const { session } = makeSession(transport);
    await session.open();
    const writePromise = session.write(utf8('slow'), { origin: 'human' });
    const closePromise = session.close();
    // 此时 close 应在等待 write 队列 drain
    expect(session.state).toBe('closing');
    resolveWrite();
    await writePromise;
    await closePromise;
    expect(session.state).toBe('closed');
    expect(transport.writes).toHaveLength(1);
  });

  it('clear() appends a clear event without erasing history', async () => {
    const { session } = makeSession();
    await session.open();
    await session.write(utf8('a'), { origin: 'human' });
    session.clear('human');
    await session.write(utf8('b'), { origin: 'human' });
    const events = session.read(0).events;
    const types = events.filter((e) => e.type === 'data' || e.type === 'clear').map((e) => e.type);
    expect(types).toEqual(['data', 'clear', 'data']);
  });
});

describe('SessionManager', () => {
  it('create() registers a session with a generated id', () => {
    const mgr = new SessionManager();
    const transport = new MockTransport();
    const session = mgr.create((id) => new TestSession(id, transport));
    expect(session.id).toMatch(/^sess_/);
    expect(mgr.list()).toContain(session.id);
    expect(mgr.has(session.id)).toBe(true);
  });

  it('forwards session events to manager listeners', async () => {
    const mgr = new SessionManager();
    const transport = new MockTransport();
    const events: TranscriptEvent[] = [];
    mgr.on('session:event', (_id, event: TranscriptEvent) => events.push(event));
    const session = mgr.create((id) => new TestSession(id, transport));
    await session.open();
    expect(events.some((e) => e.type === 'state')).toBe(true);
  });

  it('write() goes through SessionManager and reaches transport', async () => {
    const mgr = new SessionManager();
    const transport = new MockTransport();
    const session = mgr.create((id) => new TestSession(id, transport));
    await session.open();
    await mgr.write(session.id, utf8('hello'), { origin: 'ai' });
    expect(transport.writes).toHaveLength(1);
  });

  it('blocks AI writes after an unresponsive timeout but keeps human writes available', async () => {
    const mgr = new SessionManager();
    const transport = new MockTransport();
    const session = mgr.create((id) => new TestSession(id, transport));
    await session.open();

    mgr.markAiUnresponsive(session.id, { cursorBefore: 3, cursorAfter: 8 });

    await expect(mgr.write(session.id, utf8('retry'), { origin: 'ai' })).rejects.toBeInstanceOf(
      SessionUnresponsiveError,
    );
    await expect(mgr.write(session.id, utf8('human recovery input'), { origin: 'human' })).resolves
      .toBeUndefined();

    expect(transport.writes.map((bytes) => new TextDecoder().decode(bytes))).toEqual([
      'human recovery input',
    ]);

    // 新的设备输出证明链路仍然活着后，AI 写入恢复。
    transport.pushIncoming(utf8('device is alive'));
    await expect(mgr.write(session.id, utf8('retry-after-output'), { origin: 'ai' })).resolves
      .toBeUndefined();
  });

  it('clears the AI fuse when the session enters a terminal state', async () => {
    const mgr = new SessionManager();
    const transport = new MockTransport();
    const session = mgr.create((id) => new TestSession(id, transport));
    await session.open();

    mgr.markAiUnresponsive(session.id, { cursorBefore: 1, cursorAfter: 2 });
    await session.close();

    await expect(mgr.write(session.id, utf8('retry-on-closed'), { origin: 'ai' })).rejects.toMatchObject({
      code: 'NOT_OPEN',
    });
  });

  it('destroy() closes session and removes from registry', async () => {
    const mgr = new SessionManager();
    const transport = new MockTransport();
    const session = mgr.create((id) => new TestSession(id, transport));
    await session.open();
    const destroyed = vi.fn();
    mgr.on('session:destroyed', destroyed);
    await mgr.destroy(session.id);
    expect(mgr.has(session.id)).toBe(false);
    expect(destroyed).toHaveBeenCalledWith(session.id);
    expect(session.state).toBe('closed');
  });

  it('destroy() is idempotent for unknown ids', async () => {
    const mgr = new SessionManager();
    await expect(mgr.destroy('sess_nonexistent')).resolves.toBeUndefined();
  });

  it('write() throws for unknown session', async () => {
    const mgr = new SessionManager();
    await expect(
      mgr.write('sess_missing', utf8('x'), { origin: 'human' }),
    ).rejects.toThrow(/not found/);
  });

  it('destroyAll() closes every active session', async () => {
    const mgr = new SessionManager();
    const t1 = new MockTransport();
    const t2 = new MockTransport();
    const s1 = mgr.create((id) => new TestSession(id, t1));
    const s2 = mgr.create((id) => new TestSession(id, t2));
    await Promise.all([s1.open(), s2.open()]);
    await mgr.destroyAll();
    expect(mgr.list()).toEqual([]);
    expect(s1.state).toBe('closed');
    expect(s2.state).toBe('closed');
  });

  it('createAndOpen() emits session:created only after open succeeds', async () => {
    const mgr = new SessionManager();
    const transport = new MockTransport();
    const created = vi.fn();
    const destroyed = vi.fn();
    mgr.on('session:created', created);
    mgr.on('session:destroyed', destroyed);

    const session = await mgr.createAndOpen((id) => new TestSession(id, transport));
    expect(session.state).toBe('open');
    expect(created).toHaveBeenCalledWith(session.id);
    expect(destroyed).not.toHaveBeenCalled();
  });

  it('createAndOpen() rolls back without emitting any session:* event when open throws', async () => {
    const mgr = new SessionManager();
    const created = vi.fn();
    const destroyed = vi.fn();
    mgr.on('session:created', created);
    mgr.on('session:destroyed', destroyed);

    class FailingSession extends TestSession {
      override async open(): Promise<void> {
        throw new Error('boom');
      }
    }

    await expect(
      mgr.createAndOpen((id) => new FailingSession(id, new MockTransport())),
    ).rejects.toThrow(/boom/);

    expect(mgr.list()).toEqual([]);
    expect(created).not.toHaveBeenCalled();
    expect(destroyed).not.toHaveBeenCalled();
  });

  it('createAndOpen() suppresses session:event before a successful open', async () => {
    const mgr = new SessionManager();
    const events = vi.fn();
    mgr.on('session:event', events);

    await expect(
      mgr.createAndOpen(
        (id) => new TestSession(id, new MockTransport({ failOnOpen: new Error('no port') })),
      ),
    ).rejects.toThrow(/no port/);

    expect(mgr.list()).toEqual([]);
    expect(events).not.toHaveBeenCalled();
  });

  it('does not expose createAndOpen() sessions before open succeeds', async () => {
    const mgr = new SessionManager();
    let resolveOpen!: () => void;
    const openGate = new Promise<void>((resolve) => {
      resolveOpen = resolve;
    });
    const transport = new MockTransport();
    transport.open = async (): Promise<void> => {
      await openGate;
    };

    const pending = mgr.createAndOpen((id) => new TestSession(id, transport), {
      connectionType: 'serial',
      label: 'Pending COM',
    });

    expect(mgr.listSummaries()).toEqual([]);

    resolveOpen();
    const session = await pending;
    expect(mgr.listSummaries()).toEqual([
      {
        sessionId: session.id,
        state: 'open',
        connectionType: 'serial',
        label: 'Pending COM',
      },
    ]);
  });
});

describe('SessionManager summaries', () => {
  it('exposes RTT log metadata without serial fields', () => {
    const mgr = new SessionManager();
    const session = mgr.create((id) => new TestSession(id, new MockTransport()), {
      connectionType: 'rtt-log',
      label: 'RTT channel 0',
      rttLog: {
        probeId: 'probe-1',
        channelIndex: 0,
      },
    });

    expect(mgr.listSummaries()).toEqual([
      {
        sessionId: session.id,
        state: 'idle',
        connectionType: 'rtt-log',
        label: 'RTT channel 0',
        rttLog: {
          probeId: 'probe-1',
          channelIndex: 0,
        },
      },
    ]);
  });
});
