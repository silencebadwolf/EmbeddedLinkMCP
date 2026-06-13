import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import type { Origin, SessionId } from '../../shared/types.js';
import type { SequenceCursor, TranscriptEvent } from '../transcript/types.js';
import type { ISession, SessionWriteOptions } from './types.js';

/**
 * Session 工厂函数。SessionManager 不感知具体的 transport 类型 —— 由调用层（IPC handler / MCP tool）
 * 在 create() 调用前根据 SessionConfig 准备好工厂。Phase 1 主要被测试 / mock-transport 使用。
 */
export type SessionFactory = (id: SessionId) => ISession;

/**
 * 集中管理所有活跃会话：注册、查找、销毁，并把每个 session 的事件流转发到全局订阅者。
 *
 * 设计上不持有 transport 类型枚举：SessionManager 只关心 ISession 契约。
 * 这样 Phase 2/3 增加 SerialSession / SshSession 时无需修改本类。
 */
export class SessionManager extends EventEmitter {
  readonly #sessions: Map<SessionId, ISession> = new Map();
  readonly #unsubscribers: Map<SessionId, () => void> = new Map();

  /** 当前活跃的 session id 列表（含 idle/open/errored）。 */
  list(): SessionId[] {
    return Array.from(this.#sessions.keys());
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
  create(factory: SessionFactory): ISession {
    const session = this.#registerNew(factory);
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
  async createAndOpen(factory: SessionFactory): Promise<ISession> {
    const session = this.#registerNew(factory);
    try {
      await session.open();
    } catch (err) {
      // open 失败：撤销注册，不广播任何 session:* 事件
      this.#unsubscribers.get(session.id)?.();
      this.#unsubscribers.delete(session.id);
      this.#sessions.delete(session.id);
      throw err;
    }
    this.emit('session:created', session.id);
    return session;
  }

  /** 内部：分配 id、订阅事件、入表，但**不**广播 'session:created'。供 create / createAndOpen 共用。 */
  #registerNew(factory: SessionFactory): ISession {
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

    const onEvent = (event: TranscriptEvent): void => {
      this.emit('session:event', id, event);
    };
    const onState = (state: ISession['state']): void => {
      this.emit('session:state', id, state);
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
   * @returns ReadResult（events / cursor / truncated）
   * @throws 会话不存在时抛 `Session not found`
   */
  read(id: SessionId, cursor: SequenceCursor): ReturnType<ISession['read']> {
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

  /** 销毁所有 session（应用退出 / 测试 teardown）。并行执行，不区分单个 destroy 的成败。 */
  async destroyAll(): Promise<void> {
    const ids = this.list();
    await Promise.all(ids.map((id) => this.destroy(id)));
  }

  /** 内部：按 id 取 session，找不到立即抛错。供需要"必须存在"语义的方法（write/read/clear）共用。 */
  #requireSession(id: SessionId): ISession {
    const session = this.#sessions.get(id);
    if (!session) throw new Error(`Session not found: ${id}`);
    return session;
  }
}
