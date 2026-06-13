import { describe, expect, it } from 'vitest';
import { SessionBase } from '@/core/session/session-base.js';
import { SessionManager } from '@/core/session/session-manager.js';
import type { ISession } from '@/core/session/types.js';
import { SessionNotOpenError } from '@/core/session/types.js';
import type { TranscriptEvent } from '@/core/transcript/types.js';
import type { SessionId } from '@/shared/types.js';
import { MockTransport } from '../fixtures/mock-transport.js';

const utf8 = (s: string): Uint8Array => new TextEncoder().encode(s);
const decode = (b?: Uint8Array): string => (b ? new TextDecoder().decode(b) : '');

class TestSession extends SessionBase {
  constructor(id: SessionId, public readonly transport: MockTransport) {
    super({ id, transport });
  }
}

interface Fixture {
  manager: SessionManager;
  session: ISession;
  transport: MockTransport;
}

const setup = async (): Promise<Fixture> => {
  const manager = new SessionManager();
  const transport = new MockTransport();
  const session = manager.create((id) => new TestSession(id, transport));
  await session.open();
  return { manager, session, transport };
};

describe('Phase 5 — AI/human cooperation', () => {
  /**
   * 场景 1：人写入 → AI 通过 MCP 可见
   *
   * 验证点：渲染端走 SessionManager.write({origin:'human'}) 后，
   * 任何使用 read() 的 MCP 客户端都能在 transcript 中看到该写入，origin 标记保留。
   */
  it('scenario 1: human write is visible to AI via SessionManager.read', async () => {
    const { manager, session } = await setup();
    await manager.write(session.id, utf8('ls -la\n'), { origin: 'human' });
    const result = manager.read(session.id, 0);
    const dataEvents = result.events.filter((e) => e.type === 'data');
    expect(dataEvents).toHaveLength(1);
    expect(dataEvents[0]!.origin).toBe('human');
    expect(decode(dataEvents[0]!.data)).toBe('ls -la\n');
  });

  /**
   * 场景 2：AI 写入 → 人在 UI 实时可见
   *
   * 验证点：MCP 工具走 SessionManager.write({origin:'ai'}) 后，
   * 通过 SessionManager 'session:event' 事件流（IPC 推送的源头）能立即接收到事件。
   */
  it('scenario 2: AI write is broadcast to human-facing event stream', async () => {
    const { manager, session } = await setup();
    const received: TranscriptEvent[] = [];
    manager.on('session:event', (_id, event: TranscriptEvent) => {
      received.push(event);
    });

    await manager.write(session.id, utf8('echo hi\n'), {
      origin: 'ai',
      correlationId: 'mcp-req-1',
    });
    const dataEvents = received.filter((e) => e.type === 'data');
    expect(dataEvents).toHaveLength(1);
    expect(dataEvents[0]!.origin).toBe('ai');
    expect((dataEvents[0]!.meta as { correlationId?: string }).correlationId).toBe('mcp-req-1');
  });

  /**
   * 场景 3：AI + 人几乎同时写入 → WriteQueue 单一有序序列
   *
   * 用 Promise.all 同步触发，验证 transcript 中事件 sequence 单调递增、
   * transport.writes 与 transcript data 事件顺序完全一致。
   */
  it('scenario 3: concurrent AI+human writes form a single ordered sequence', async () => {
    const { manager, session, transport } = await setup();
    await Promise.all([
      manager.write(session.id, utf8('h1'), { origin: 'human' }),
      manager.write(session.id, utf8('a1'), { origin: 'ai' }),
      manager.write(session.id, utf8('h2'), { origin: 'human' }),
      manager.write(session.id, utf8('a2'), { origin: 'ai' }),
      manager.write(session.id, utf8('h3'), { origin: 'human' }),
    ]);
    const tags = transport.writes.map((b) => new TextDecoder().decode(b));
    expect(tags).toEqual(['h1', 'a1', 'h2', 'a2', 'h3']);

    const dataEvents = manager
      .read(session.id, 0)
      .events.filter((e) => e.type === 'data' && e.origin !== 'device');
    expect(dataEvents.map((e) => decode(e.data))).toEqual(['h1', 'a1', 'h2', 'a2', 'h3']);
    // sequence 单调递增、无重复
    const seqs = dataEvents.map((e) => e.sequence);
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
    expect(new Set(seqs).size).toBe(seqs.length);
  });

  /**
   * 场景 4：人清屏 → MCP 收到 clear 事件、新 cursor 边界，历史不丢失
   *
   * 验证：
   * - clear 事件作为独立事件出现在 transcript 中（type==='clear'，meta.kind==='clear'）
   * - clear meta.precedingCursor 等于清屏前最后一条 sequence
   * - readSince(0) 仍能看到清屏前的所有数据
   */
  it('scenario 4: human clear preserves history with cursor boundary', async () => {
    const { manager, session } = await setup();
    await manager.write(session.id, utf8('before-clear'), { origin: 'human' });
    const cursorBeforeClear = manager.read(session.id, 0).cursor;
    const clearEvent = manager.clear(session.id, 'human');
    await manager.write(session.id, utf8('after-clear'), { origin: 'human' });

    expect(clearEvent.type).toBe('clear');
    expect(clearEvent.meta).toMatchObject({
      kind: 'clear',
      precedingCursor: cursorBeforeClear,
    });

    // AI 用 cursor=0 重读：仍然看到清屏前的 data + clear + 清屏后的 data
    const result = manager.read(session.id, 0);
    const types = result.events.map((e) => e.type);
    expect(types).toContain('clear');
    const dataEvents = result.events.filter(
      (e) => e.type === 'data' && (e.origin === 'human' || e.origin === 'ai'),
    );
    expect(dataEvents.map((e) => decode(e.data))).toEqual(['before-clear', 'after-clear']);
  });

  /**
   * 场景 5：多 MCP 客户端并发读取 → 独立 cursor，不丢事件
   *
   * 模拟两个 subscriber：客户端 A 实时读取（cursor 跟着推进），
   * 客户端 B 短暂掉线后重新拉取——两者读到的事件集合互不影响、内容一致。
   */
  it('scenario 5: multiple subscribers read independently without losing events', async () => {
    const { manager, session } = await setup();
    manager.subscribe('mcp-A');
    manager.subscribe('mcp-B');

    await manager.write(session.id, utf8('a'), { origin: 'ai' });
    await manager.write(session.id, utf8('b'), { origin: 'ai' });

    const aFirst = manager.readForSubscriber('mcp-A', session.id);
    expect(aFirst.events.length).toBeGreaterThan(0);

    // A 读完已经推进 cursor；B 还没读
    const bAllUpToNow = manager.readForSubscriber('mcp-B', session.id);
    // B 第一次读：拿到的事件数 == A 第一次读的事件数（都是从 0 开始）
    expect(bAllUpToNow.events.length).toBe(aFirst.events.length);

    // 再写两条
    await manager.write(session.id, utf8('c'), { origin: 'human' });
    await manager.write(session.id, utf8('d'), { origin: 'human' });

    // A 再读：仅拿到增量
    const aIncremental = manager.readForSubscriber('mcp-A', session.id);
    const aData = aIncremental.events.filter((e) => e.type === 'data');
    expect(aData.map((e) => decode(e.data))).toEqual(['c', 'd']);

    // B 再读：也仅拿到增量
    const bIncremental = manager.readForSubscriber('mcp-B', session.id);
    const bData = bIncremental.events.filter((e) => e.type === 'data');
    expect(bData.map((e) => decode(e.data))).toEqual(['c', 'd']);

    // 两条增量来自同一 sequence，不重复
    expect(aData.map((e) => e.sequence)).toEqual(bData.map((e) => e.sequence));
  });

  /**
   * 场景 6：MCP 客户端使用过期 cursor → 返回 truncated + oldestAvailableSequence
   *
   * 用容量受限的 buffer 模拟环形溢出，验证：
   * - readSince(stale) 返回 truncated:true
   * - oldestAvailableSequence 给出第一条仍可读的 sequence
   * - 客户端按 oldestAvailableSequence-1 续读后能拿到全部当前可读事件，且 truncated:false
   */
  it('scenario 6: expired cursor returns boundary info and is recoverable', async () => {
    const manager = new SessionManager();
    const transport = new MockTransport();
    class CappedSession extends SessionBase {
      constructor(id: SessionId) {
        super({ id, transport, transcriptCapacity: 4 });
      }
    }
    const session = manager.create((id) => new CappedSession(id));
    await session.open(); // open 触发 2 条 state 事件，sequence 1,2

    // 充满 buffer 并溢出：再写 5 条 data，sequence 3..7；buffer 容量 4，前 3 条被丢弃
    for (let i = 0; i < 5; i += 1) {
      await manager.write(session.id, utf8(`x${i}`), { origin: 'ai' });
    }

    const stale = manager.read(session.id, 1); // cursor=1 早已被淘汰
    expect(stale.truncated).toBe(true);
    expect(stale.oldestAvailableSequence).toBeGreaterThan(1);

    const recovery = manager.read(session.id, stale.oldestAvailableSequence - 1);
    expect(recovery.truncated).toBe(false);
    // 至少包含目前 buffer 中所有事件
    expect(recovery.events.length).toBe(4);
  });

  /**
   * 附加：waitFor 并发协调 —— 多个等待者互不"消费"事件，超时独立。
   */
  it('waitFor: multiple concurrent waiters all observe the same event', async () => {
    const { manager, session, transport } = await setup();
    const w1 = manager.waitFor(
      session.id,
      (e) => e.type === 'data' && e.origin === 'device',
      { timeoutMs: 1000 },
    );
    const w2 = manager.waitFor(
      session.id,
      (e) => e.type === 'data' && e.origin === 'device',
      { timeoutMs: 1000 },
    );
    transport.pushIncoming(utf8('boot ok'));
    const [r1, r2] = await Promise.all([w1, w2]);
    expect(r1.kind).toBe('match');
    expect(r2.kind).toBe('match');
    if (r1.kind === 'match') expect(decode(r1.event.data)).toBe('boot ok');
  });

  it('waitFor: independent timeout returns lastCursor without throwing', async () => {
    const { manager, session } = await setup();
    const outcome = await manager.waitFor(
      session.id,
      (e) => e.type === 'data' && e.origin === 'device',
      { timeoutMs: 30 },
    );
    expect(outcome.kind).toBe('timeout');
  });

  it('waitFor: settles with kind=closed quickly when session closes mid-wait', async () => {
    const { manager, session } = await setup();
    const start = Date.now();
    const pending = manager.waitFor(
      session.id,
      // 永远不会命中的 predicate
      () => false,
      { timeoutMs: 30_000 },
    );
    // 让 waitFor 先挂上监听
    await Promise.resolve();
    await session.close();
    const outcome = await pending;
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(500);
    expect(outcome.kind).toBe('closed');
    if (outcome.kind === 'closed') {
      expect(outcome.state).toBe('closed');
      expect(outcome.lastCursor).toBeGreaterThan(0);
    }
  });

  it('waitFor: settles immediately when session is already closed', async () => {
    const { manager, session } = await setup();
    await session.close();
    const start = Date.now();
    const outcome = await manager.waitFor(session.id, () => false, { timeoutMs: 30_000 });
    expect(Date.now() - start).toBeLessThan(100);
    expect(outcome.kind).toBe('closed');
  });

  it('waitFor: settles with kind=closed when transport-driven error puts session into errored', async () => {
    const { manager, session, transport } = await setup();
    const pending = manager.waitFor(session.id, () => false, { timeoutMs: 30_000 });
    await Promise.resolve();
    transport.pushError(new Error('cable unplugged'));
    const outcome = await pending;
    expect(outcome.kind).toBe('closed');
    if (outcome.kind === 'closed') {
      expect(outcome.state).toBe('errored');
    }
  });

  /**
   * M3：write 到非 open 状态的 session 抛 `SessionNotOpenError`，
   * 携带 `code: 'NOT_OPEN'` 与当前状态，便于 IPC/MCP 表层翻译为统一错误码
   * 而非落入通用 `INTERNAL` 桶。
   */
  it('write to a closed session throws SessionNotOpenError with code=NOT_OPEN', async () => {
    const { manager, session } = await setup();
    await session.close();
    expect(session.state).toBe('closed');
    let captured: unknown;
    try {
      await manager.write(session.id, utf8('x'), { origin: 'human' });
    } catch (err) {
      captured = err;
    }
    expect(captured).toBeInstanceOf(SessionNotOpenError);
    expect((captured as SessionNotOpenError).code).toBe('NOT_OPEN');
    expect((captured as SessionNotOpenError).sessionState).toBe('closed');
  });

  it('subscribers reading from different points do not lose events even with truncation', async () => {
    const manager = new SessionManager();
    const transport = new MockTransport();
    class CappedSession extends SessionBase {
      constructor(id: SessionId) {
        super({ id, transport, transcriptCapacity: 6 });
      }
    }
    const session = manager.create((id) => new CappedSession(id));
    await session.open();

    manager.subscribe('client-active');
    // active 客户端实时跟读
    await manager.write(session.id, utf8('1'), { origin: 'ai' });
    manager.readForSubscriber('client-active', session.id);

    // 模拟 client-stale 先读一次拿到当前 cursor，再"长时间不读"
    manager.subscribe('client-stale');
    const staleInitial = manager.readForSubscriber('client-stale', session.id);
    expect(staleInitial.truncated).toBe(false);

    // 大量写入触发覆盖；active 客户端实时跟读保持 cursor 不掉队
    for (let i = 0; i < 20; i += 1) {
      await manager.write(session.id, utf8(`y${i}`), { origin: 'ai' });
      // active 每次都读，保持自己 cursor 紧跟 latest
      manager.readForSubscriber('client-active', session.id);
    }

    const staleResult = manager.readForSubscriber('client-stale', session.id);
    // stale 第二次读：上次记的 cursor 已被环形覆盖
    expect(staleResult.truncated).toBe(true);
    expect(staleResult.oldestAvailableSequence).toBeGreaterThan(staleInitial.cursor);

    // active 增量读：不会 truncated，只是拿增量
    const activeResult = manager.readForSubscriber('client-active', session.id);
    expect(activeResult.truncated).toBe(false);
  });

  /**
   * H2：SessionBase.write({priority:'high'}) 真的把 high 透传到 WriteQueue 并优先 drain。
   *
   * 测法：让首项 'normal' 写入挂起（gate 阻塞 mock transport），
   * 在它运行期间堆积 normal + high；释放后观察实际写入顺序。
   */
  it('SessionBase.write forwards priority="high" so it preempts queued normal writes', async () => {
    const manager = new SessionManager();
    const transport = new MockTransport();
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const writeOriginal = transport.write.bind(transport);
    let callCount = 0;
    transport.write = async (data: Uint8Array): Promise<void> => {
      callCount += 1;
      if (callCount === 1) await gate; // 卡住第一项，让后续在队列中堆积
      return writeOriginal(data);
    };
    const session = manager.create((id) => new TestSession(id, transport));
    await session.open();

    // 首项 normal 把队列锁住
    const p0 = session.write(utf8('blocking'), { origin: 'human' });
    // 堆积：normal + normal + high
    const pn1 = session.write(utf8('n1'), { origin: 'ai' });
    const pn2 = session.write(utf8('n2'), { origin: 'ai' });
    const ph = session.write(utf8('h1'), { origin: 'human', priority: 'high' });

    release();
    await Promise.all([p0, pn1, pn2, ph]);
    const tags = transport.writes.map((b) => new TextDecoder().decode(b));
    // 锁住的 'blocking' 必先；'h1' 优先于剩余 normal 'n1','n2'
    expect(tags).toEqual(['blocking', 'h1', 'n1', 'n2']);
  });
});
