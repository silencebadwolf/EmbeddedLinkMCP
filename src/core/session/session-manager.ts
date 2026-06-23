import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import type { Origin, SessionId } from '../../shared/types.js';
import type { SessionMetadata, SessionSummary } from '../../shared/types.js';
import type { ReadResult, SequenceCursor, TranscriptEvent } from '../transcript/types.js';
import type { ISession, SessionWriteOptions } from './types.js';
import { SessionNotFoundError } from './types.js';

/**
 * Session 工厂函数。SessionManager 不感知具体的 transport 类型 —— 由调用层（IPC handler / MCP tool）
 * 在 create() 调用前根据 SessionConfig 准备好工厂。Phase 1 主要被测试 / mock-transport 使用。
 */
export type SessionFactory = (id: SessionId) => ISession;

/**
 * 长寿命 reader（IPC 渲染端订阅、MCP 客户端会话）的标识。
 * 由调用方自行决定（通常用 webContents id / MCP correlationId / UUID）。
 *
 * Manager 内部仅以此为 key 维护 `Map<subscriberId, Map<sessionId, cursor>>`，
 * 不关心字符串内容。
 */
export type SubscriberId = string;

/** 会话元信息默认值。 */
const DEFAULT_SESSION_METADATA: SessionMetadata = {
  connectionType: 'local-shell',
};

/**
 * `SessionManager.waitFor()` 的判定结果。
 *
 * - `match`:   匹配到目标事件，调用方拿到该事件本体。
 * - `timeout`: 超时未匹配，调用方拿到截至超时时刻该会话的最新 cursor。
 * - `closed`:  predicate 不命中之前会话进入终态（closed/errored），调用方拿到截至该时刻的最新 cursor。
 *              本字段使等待方能立即解除阻塞，而不必等满 timeoutMs。
 */
export type WaitForOutcome =
  | { kind: 'match'; event: TranscriptEvent }
  | { kind: 'timeout'; lastCursor: SequenceCursor }
  | { kind: 'closed'; lastCursor: SequenceCursor; state: 'closed' | 'errored' };

/** `SessionManager.waitFor()` 选项。 */
export interface WaitForOptions {
  /** 超时（毫秒）；缺省 30_000。0 / 负数视为非法。 */
  timeoutMs?: number;
  /**
   * 是否回放 cursor 到当前 latest 之间的历史事件给 predicate。
   * - `true`（默认）：先用 cursor 之后的历史事件喂 predicate；命中则立即 resolve。
   * - `false`：仅监听新到达的事件。
   *
   * 用于"先 readSince(cursor)，再 waitFor"两步式协议时关掉历史回放。
   */
  replayHistorySince?: SequenceCursor;
}

/**
 * 集中管理所有活跃会话：注册、查找、销毁，并把每个 session 的事件流转发到全局订阅者。
 *
 * 设计上不持有 transport 类型枚举：SessionManager 只关心 ISession 契约。
 * 这样 Phase 2/3 增加 SerialSession / SshSession 时无需修改本类。
 *
 * Phase 5 起额外承担两个职责：
 * 1. **多客户端 cursor 追踪**：通过 `subscribe()` / `unsubscribe()` / `readForSubscriber()`，
 *    每个长寿命 reader（渲染端订阅 / MCP 客户端会话）持有独立 cursor，互不干扰。
 * 2. **并发 waitFor 协调**：`waitFor()` 让调用方对 transcript 事件流做谓词等待，
 *    多个并发等待之间互相独立（Phase 7 的 sendAndWait 在此之上构建终端规则）。
 */
export class SessionManager extends EventEmitter {
  readonly #sessions: Map<SessionId, ISession> = new Map();
  readonly #sessionMetadata: Map<SessionId, SessionMetadata> = new Map();
  readonly #visibleSessions: Set<SessionId> = new Set();
  readonly #unsubscribers: Map<SessionId, () => void> = new Map();
  /**
   * 每个 subscriber 持有的 (sessionId → cursor) 映射。
   * subscriberId 由调用方自行命名（如 webContents id、MCP 客户端 ID）。
   */
  readonly #subscriberCursors: Map<SubscriberId, Map<SessionId, SequenceCursor>> = new Map();

  /** 当前活跃的 session id 列表（含 idle/open/errored）。 */
  list(): SessionId[] {
    return Array.from(this.#sessions.keys());
  }

  /**
   * 查询单个会话摘要。
   *
   * @param id 会话 id.
   * @returns 会话存在时返回 UI/MCP 可展示的非敏感摘要，否则返回 null.
   */
  summaryOf(id: SessionId): SessionSummary | null {
    if (!this.#visibleSessions.has(id)) return null;
    const session = this.#sessions.get(id);
    if (!session) return null;
    return this.#buildSummary(id, session);
  }

  /**
   * 列出当前会话的 UI 水合摘要。
   *
   * @returns 每个活跃会话的 id、状态和非敏感显示元信息。
   */
  listSummaries(): SessionSummary[] {
    return Array.from(this.#visibleSessions)
      .map((id) => this.summaryOf(id))
      .filter((summary): summary is SessionSummary => summary !== null);
  }

  /**
   * 按 id 查找会话。
   * @param id 会话 id
   * @returns 找到的 ISession；不存在返回 undefined
   */
  get(id: SessionId): ISession | undefined {
    return this.#sessions.get(id);
  }

  /**
   * 判断会话是否存在（不区分状态）。
   * @param id 会话 id
   */
  has(id: SessionId): boolean {
    return this.#sessions.has(id);
  }

  /**
   * 注册一个新会话。
   *
   * 调用方提供 factory：根据生成的 id 返回 ISession 实例（通常是 new SerialSession({ id, ... })）。
   * Manager 会自动订阅 'event' / 'state'，并以 ('session:event', sessionId, event) 形式向上转发。
   *
   * @param factory 工厂函数：接收已生成的 id，返回 ISession 实例（id 必须与传入一致，否则抛错）
   * @returns 已注册并完成事件桥接的 ISession 实例
   * @throws 当 factory 返回的 session.id 与生成的 id 不一致，或同一 id 重复注册时
   */
  create(factory: SessionFactory, metadata?: SessionMetadata): ISession {
    const session = this.#registerNew(factory, metadata);
    this.#visibleSessions.add(session.id);
    this.emit('session:created', session.id);
    return session;
  }

  /**
   * 创建会话并立即 open；只有 open 成功后才广播 `session:created`。
   *
   * 用于 MCP `open_session` 等"创建即开"的入口：
   * - open 成功 → manager 内可见，外界先看到 `session:created`，状态转换事件随后；
   * - open 失败 → 会话从未进入 manager，`session:created` / `session:destroyed` 都不广播，
   *   外界订阅者不会观察到"幽灵 session"。
   *
   * @param factory 工厂函数（同 {@link create}）
   * @returns 已 open 的 ISession
   * @throws factory 校验失败 / open 抛错时透传
   */
  async createAndOpen(factory: SessionFactory, metadata?: SessionMetadata): Promise<ISession> {
    const session = this.#registerNew(factory, metadata);
    try {
      await session.open();
    } catch (err) {
      // open 失败：撤销注册，不广播任何 session:* 事件
      this.#unsubscribers.get(session.id)?.();
      this.#unsubscribers.delete(session.id);
      this.#sessions.delete(session.id);
      this.#sessionMetadata.delete(session.id);
      this.#visibleSessions.delete(session.id);
      throw err;
    }
    this.#visibleSessions.add(session.id);
    this.emit('session:created', session.id);
    return session;
  }

  /** 内部：分配 id、订阅事件、入表，但**不**广播 'session:created'。供 create / createAndOpen 共用。 */
  #registerNew(factory: SessionFactory, metadata?: SessionMetadata): ISession {
    const id = `sess_${randomUUID()}`;
    const session = factory(id);
    if (session.id !== id) {
      throw new Error(
        `SessionFactory returned mismatched id: expected ${id}, got ${session.id}`,
      );
    }
    if (this.#sessions.has(id)) {
      throw new Error(`Duplicate session id: ${id}`);
    }
    this.#sessions.set(id, session);
    this.#sessionMetadata.set(id, sanitizeSessionMetadata(metadata));

    const onEvent = (event: TranscriptEvent): void => {
      if (this.#visibleSessions.has(id)) {
        this.emit('session:event', id, event);
      }
    };
    const onState = (state: ISession['state']): void => {
      if (this.#visibleSessions.has(id)) {
        this.emit('session:state', id, state);
      }
    };
    session.on('event', onEvent);
    session.on('state', onState);
    this.#unsubscribers.set(id, () => {
      const emitter = session as unknown as EventEmitter;
      emitter.off('event', onEvent);
      emitter.off('state', onState);
    });

    return session;
  }

  /**
   * 销毁会话：调用 close()，解除事件订阅，从注册表移除。
   * 找不到 id 时静默返回（幂等）。即便 close() 抛错也保证清理事件订阅与注册表。
   *
   * @param id 待销毁的会话 id
   */
  async destroy(id: SessionId): Promise<void> {
    const session = this.#sessions.get(id);
    if (!session) return;
    try {
      await session.close();
    } finally {
      this.#unsubscribers.get(id)?.();
      this.#unsubscribers.delete(id);
      this.#sessions.delete(id);
      this.#sessionMetadata.delete(id);
      this.#visibleSessions.delete(id);
      // 清掉所有订阅者持有的该 session cursor，避免下次 destroyed-then-recreated 时
      // 残留旧 sequence 让 readForSubscriber 误以为"已读到 N"
      for (const cursors of this.#subscriberCursors.values()) {
        cursors.delete(id);
      }
      this.emit('session:destroyed', id);
    }
  }

  /**
   * 写入会话 —— 这是 SessionManager 的关键安全边界：
   * 所有外部入口（IPC handler / MCP tool）必须通过本方法触达 transport，
   * 不允许直接持有 ISession 的引用绕过 origin 标记。
   *
   * @param id 目标会话 id
   * @param data 写入字节
   * @param options 必须包含 origin（human/ai/...）；correlationId 可选，AI 调用应填
   * @throws 会话不存在时抛 `Session not found`；底层 writer 失败按原异常透传
   */
  async write(id: SessionId, data: Uint8Array, options: SessionWriteOptions): Promise<void> {
    const session = this.#requireSession(id);
    await session.write(data, options);
  }

  /**
   * 从 cursor 之后读取指定会话的 transcript。
   *
   * @param id 会话 id
   * @param cursor 上次读取的最大 sequence；0 表示从最早可见事件开始
   * @returns ReadResult（events / cursor / truncated / oldestAvailableSequence）
   * @throws 会话不存在时抛 `Session not found`
   */
  read(id: SessionId, cursor: SequenceCursor): ReadResult {
    return this.#requireSession(id).read(cursor);
  }

  /**
   * 在指定会话写入 clear 事件。不会真正删除历史，AI 通过旧 cursor 仍能看见之前的输出（req §4.5）。
   *
   * @param id 会话 id
   * @param origin 触发方（human/ai/system）
   * @returns 已写入的 clear TranscriptEvent
   * @throws 会话不存在时抛 `Session not found`
   */
  clear(id: SessionId, origin: Origin): TranscriptEvent {
    return this.#requireSession(id).clear(origin);
  }

  /**
   * 注册一个长寿命 subscriber。幂等：同一个 subscriberId 多次调用不会重置已记录的 cursor。
   *
   * 用于 IPC `transcript:subscribe` 与 MCP 多客户端场景：每个 subscriber 各自维护
   * (sessionId → 已读 cursor)，避免单一全局 cursor 在多客户端下相互干扰。
   *
   * @param subscriberId 订阅者标识（webContents id / MCP correlationId / UUID）
   */
  subscribe(subscriberId: SubscriberId): void {
    if (!this.#subscriberCursors.has(subscriberId)) {
      this.#subscriberCursors.set(subscriberId, new Map());
    }
  }

  /**
   * 取消订阅，清掉该 subscriber 的所有 cursor 记录。幂等。
   * @param subscriberId 订阅者标识
   */
  unsubscribe(subscriberId: SubscriberId): void {
    this.#subscriberCursors.delete(subscriberId);
  }

  /**
   * 查询 subscriber 当前持有的 cursor。未注册的 subscriber 返回 0。
   * @param subscriberId 订阅者标识
   * @param sessionId 会话 id
   */
  getSubscriberCursor(subscriberId: SubscriberId, sessionId: SessionId): SequenceCursor {
    return this.#subscriberCursors.get(subscriberId)?.get(sessionId) ?? 0;
  }

  /**
   * 以 subscriber 当前 cursor 为起点读取，并把 cursor 自动推进到本次返回的 latest。
   *
   * 第一次调用（cursor=0）相当于 `snapshot()`；之后每次只拿增量。
   * 跨多次调用之间不会丢事件（除非环形 buffer 早已淘汰），truncated=true 时
   * 调用方应当结合 `result.oldestAvailableSequence` 判断是否需要提示用户。
   *
   * 自动注册 subscriber（若尚未注册）。
   *
   * @param subscriberId 订阅者标识
   * @param sessionId 会话 id
   * @returns ReadResult（events / cursor / truncated / oldestAvailableSequence）
   * @throws 会话不存在时抛 `Session not found`
   */
  readForSubscriber(subscriberId: SubscriberId, sessionId: SessionId): ReadResult {
    this.subscribe(subscriberId);
    const session = this.#requireSession(sessionId);
    const cursors = this.#subscriberCursors.get(subscriberId);
    if (!cursors) {
      // 不应发生（subscribe() 刚保证存在），但留个 fallback 以免空指针
      throw new Error(`Subscriber state lost: ${subscriberId}`);
    }
    const lastCursor = cursors.get(sessionId) ?? 0;
    const result = session.read(lastCursor);
    cursors.set(sessionId, result.cursor);
    return result;
  }

  /**
   * 等待会话 transcript 中第一条满足 predicate 的事件。
   *
   * 多次并发 waitFor 互相独立 —— 每个调用持有自己的 listener 与 timer，
   * 第一次匹配的调用不会"消费"事件让其它调用看不到。
   *
   * 行为：
   * 1. 若提供 `replayHistorySince`，先把 `(replayHistorySince, latest]` 区间的历史事件
   *    依次喂给 predicate；命中则立即 resolve。
   * 2. 然后挂 EventEmitter 监听新事件，命中或超时为止。
   * 3. 监听 'state' 事件：若 session 在 predicate 命中前进入 closed/errored，
   *    立即返回 `{ kind: 'closed', lastCursor, state }`，避免调用方等满 timeoutMs。
   *    sendAndWait 之类的上层只需关心"目标设备已不可达"这一事实，无需区分原因。
   * 4. 超时返回 `{ kind: 'timeout', lastCursor }`，不抛错——调用方决定是否当作错误。
   *
   * @param sessionId 会话 id
   * @param predicate 谓词；第一条让它返回 true 的事件触发 resolve
   * @param options 超时与回放选项
   * @returns 匹配事件 / 超时 / session 中途关闭
   * @throws 会话不存在时抛 `Session not found`；timeoutMs 非法时抛
   */
  waitFor(
    sessionId: SessionId,
    predicate: (event: TranscriptEvent) => boolean,
    options: WaitForOptions = {},
  ): Promise<WaitForOutcome> {
    const session = this.#requireSession(sessionId);
    const timeoutMs = options.timeoutMs ?? 30_000;
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      return Promise.reject(new Error(`waitFor.timeoutMs must be positive, got ${timeoutMs}`));
    }

    return new Promise<WaitForOutcome>((resolve) => {
      let settled = false;
      const timerRef: { current: ReturnType<typeof setTimeout> | undefined } = {
        current: undefined,
      };
      const sessionEmitter = session as unknown as EventEmitter;

      const cleanup = (): void => {
        if (timerRef.current !== undefined) clearTimeout(timerRef.current);
        sessionEmitter.off('event', onEvent);
        sessionEmitter.off('state', onState);
      };

      const finish = (outcome: WaitForOutcome): void => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(outcome);
      };

      const readLastCursor = (): SequenceCursor => {
        try {
          return session.read(0).cursor;
        } catch {
          return 0;
        }
      };

      const onEvent = (event: TranscriptEvent): void => {
        try {
          if (predicate(event)) finish({ kind: 'match', event });
        } catch {
          // predicate 抛错视为不匹配，不污染等待方
        }
      };

      const onState = (next: ISession['state']): void => {
        if (next === 'closed' || next === 'errored') {
          finish({ kind: 'closed', lastCursor: readLastCursor(), state: next });
        }
      };

      // 进入函数前 session 可能已经处于终态——避免错过通知
      if (session.state === 'closed' || session.state === 'errored') {
        finish({
          kind: 'closed',
          lastCursor: readLastCursor(),
          state: session.state,
        });
        return;
      }

      // Step 1：历史回放
      if (options.replayHistorySince !== undefined) {
        const history = session.read(options.replayHistorySince);
        for (const event of history.events) {
          try {
            if (predicate(event)) {
              finish({ kind: 'match', event });
              return;
            }
          } catch {
            // 同上
          }
        }
      }

      // Step 2：监听新事件 + 状态终态
      sessionEmitter.on('event', onEvent);
      sessionEmitter.on('state', onState);

      // Step 3：超时
      timerRef.current = setTimeout(() => {
        finish({ kind: 'timeout', lastCursor: readLastCursor() });
      }, timeoutMs);
    });
  }

  /** 销毁所有 session（应用退出 / 测试 teardown）。并行执行，不区分单个 destroy 的成败。 */
  async destroyAll(): Promise<void> {
    const ids = this.list();
    await Promise.all(ids.map((id) => this.destroy(id)));
  }

  /** 内部：按 id 取 session，找不到立即抛具名错误。供需要"必须存在"语义的方法（write/read/clear）共用。 */
  #requireSession(id: SessionId): ISession {
    const session = this.#sessions.get(id);
    if (!session) throw new SessionNotFoundError(id);
    return session;
  }

  /** 内部：按当前状态和元信息构造非敏感会话摘要。 */
  #buildSummary(id: SessionId, session: ISession): SessionSummary {
    const meta = this.#sessionMetadata.get(id) ?? DEFAULT_SESSION_METADATA;
    return {
      sessionId: id,
      state: session.state,
      connectionType: meta.connectionType,
      label: meta.label ?? defaultSessionLabel(id, meta.connectionType),
      ...(meta.createdBy ? { createdBy: meta.createdBy } : {}),
      ...(meta.serial ? { serial: meta.serial } : {}),
      ...(meta.rttLog ? { rttLog: meta.rttLog } : {}),
    };
  }
}

/**
 * 清理并补全 SessionManager 保存的非敏感会话元信息。
 *
 * @param metadata 创建入口传入的元信息。
 * @returns 可安全跨 IPC/MCP 边界展示的元信息。
 */
function sanitizeSessionMetadata(metadata: SessionMetadata | undefined): SessionMetadata {
  const serial = metadata?.connectionType === 'serial' && metadata.serial !== undefined
    ? {
        port: metadata.serial.port,
        baudRate: metadata.serial.baudRate,
        mode: metadata.serial.mode,
      }
    : undefined;
  const rttLog = metadata?.connectionType === 'rtt-log' && metadata.rttLog !== undefined
    ? {
        probeId: metadata.rttLog.probeId,
        channelIndex: metadata.rttLog.channelIndex,
      }
    : undefined;
  return {
    connectionType: metadata?.connectionType ?? DEFAULT_SESSION_METADATA.connectionType,
    ...(metadata?.label ? { label: metadata.label } : {}),
    ...(metadata?.createdBy ? { createdBy: metadata.createdBy } : {}),
    ...(serial ? { serial } : {}),
    ...(rttLog ? { rttLog } : {}),
  };
}

/**
 * 生成没有显式 label 时的稳定 UI 默认名。
 *
 * @param id 会话 id.
 * @param connectionType 连接类型.
 * @returns 面向 tab 的简短显示名.
 */
function defaultSessionLabel(id: SessionId, connectionType: SessionMetadata['connectionType']): string {
  const suffix = id.slice(-4);
  return `${connectionType}:${suffix}`;
}
