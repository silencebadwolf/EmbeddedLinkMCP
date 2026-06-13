/**
 * 渲染端全局状态 store。
 *
 * 设计取舍：单 store + selector 工具，避免多 slice 在小团队场景下相互引用导致的环。
 *
 * **不可序列化 / 副作用值不进入 store**：xterm.js Terminal 实例、subscription 清理函数
 * 等用 `useRef` 在组件局部持有；store 仅承载视图态。
 */

import { create } from 'zustand';
import type { SessionId, SessionState } from '../../shared/types.js';
import type { Origin, SerialPortInfo } from '../../shared/types.js';
import type { Locale } from '../i18n/index.js';

/** 单条 session 在 UI 层的元信息镜像；权威状态仍在主进程。 */
export interface SessionMeta {
  /** SessionManager 分配的 `sess_<uuid>`。 */
  id: SessionId;
  /** UI 显示名；若未设则按 id 末尾 4 字符自动派生。 */
  label: string;
  /** 连接类型，方便侧边栏图标/语义。 */
  connectionType: 'serial' | 'ssh' | 'local-shell';
  /** 主进程权威 state 镜像（来自 status / state 事件 / create 返回值）。 */
  state: SessionState;
  /** 此会话最近一次写入/读取来源（用于 OriginIndicator 呼吸灯）。 */
  lastOrigin?: Origin;
  /** 最近一次活动的时间戳，用于呼吸灯透明度计算。 */
  lastOriginAt?: number;
}

/** OriginIndicator 用：每会话每来源的最近活动时间戳。 */
export type OriginActivityMap = Record<SessionId, Partial<Record<Origin, number>>>;

/** 全局状态形状。 */
export interface AppState {
  /** 已知的所有 session（包括 errored / closed）—— 直到用户 destroy 才移除。 */
  sessions: Map<SessionId, SessionMeta>;
  /** 当前 tab 选中的 session id；null 表示空状态。 */
  activeSessionId: SessionId | null;
  /** UI 语言，默认 en。MCP `ui_configure` 也会调用 setLocale。 */
  locale: Locale;
  /** ConnectionDialog 是否打开。 */
  dialogOpen: boolean;
  /** 串口扫描结果缓存（subscribe 推送时同步刷新）。 */
  serialPorts: ReadonlyArray<SerialPortInfo>;
  /** 每会话每来源最近一次写入时间戳，用于 OriginIndicator 呼吸灯透明度。 */
  originActivity: OriginActivityMap;

  // === actions ===
  /** 添加或覆盖 session 元信息。 */
  addSession(meta: SessionMeta): void;
  /** 移除 session（destroy 后 + 用户手动关闭 tab）。 */
  removeSession(id: SessionId): void;
  /** 设置当前活跃 tab。null 表示无 tab 选中。 */
  setActive(id: SessionId | null): void;
  /** 更新某个 session 的 state（来自 status/state 事件）。 */
  updateSessionState(id: SessionId, state: SessionState): void;
  /** 切换 UI 语言。 */
  setLocale(locale: Locale): void;
  /** 控制连接对话框开关。 */
  openDialog(): void;
  closeDialog(): void;
  /** 串口扫描结果缓存。 */
  setSerialPorts(ports: ReadonlyArray<SerialPortInfo>): void;
  /**
   * 标记某 session 收到了来自指定 origin 的事件，用于呼吸灯透明度计算。
   *
   * 写入侧也调用此方法（人类输入 origin='human' 视作活动开始）。
   */
  markOriginActivity(sessionId: SessionId, origin: Origin, at?: number): void;
}

/** Zustand 全局 store。组件通过 `useAppStore(selector)` 订阅子集，避免无关重渲。 */
export const useAppStore = create<AppState>((set) => ({
  sessions: new Map(),
  activeSessionId: null,
  locale: 'en',
  dialogOpen: false,
  serialPorts: [],
  originActivity: {},

  addSession: (meta) =>
    set((state) => {
      const next = new Map(state.sessions);
      next.set(meta.id, meta);
      return {
        sessions: next,
        // 新建会话默认成为活跃 tab；若已有活跃则保持
        activeSessionId: state.activeSessionId ?? meta.id,
      };
    }),

  removeSession: (id) =>
    set((state) => {
      const next = new Map(state.sessions);
      next.delete(id);
      let nextActive = state.activeSessionId;
      if (state.activeSessionId === id) {
        const remaining = Array.from(next.keys());
        nextActive = remaining.length > 0 ? (remaining[0] ?? null) : null;
      }
      const remainingActivity = { ...state.originActivity };
      delete remainingActivity[id];
      return { sessions: next, activeSessionId: nextActive, originActivity: remainingActivity };
    }),

  setActive: (id) => set(() => ({ activeSessionId: id })),

  updateSessionState: (id, sessionState) =>
    set((state) => {
      const existing = state.sessions.get(id);
      if (!existing) return state;
      const next = new Map(state.sessions);
      next.set(id, { ...existing, state: sessionState });
      return { sessions: next };
    }),

  setLocale: (locale) => set(() => ({ locale })),
  openDialog: () => set(() => ({ dialogOpen: true })),
  closeDialog: () => set(() => ({ dialogOpen: false })),
  setSerialPorts: (ports) => set(() => ({ serialPorts: ports })),

  markOriginActivity: (sessionId, origin, at) =>
    set((state) => {
      const stamp = at ?? Date.now();
      const sessionAct = state.originActivity[sessionId] ?? {};
      const nextActivity: OriginActivityMap = {
        ...state.originActivity,
        [sessionId]: { ...sessionAct, [origin]: stamp },
      };
      // 同步更新 SessionMeta.lastOrigin/lastOriginAt
      const meta = state.sessions.get(sessionId);
      if (!meta) return { originActivity: nextActivity };
      const sessions = new Map(state.sessions);
      sessions.set(sessionId, { ...meta, lastOrigin: origin, lastOriginAt: stamp });
      return { originActivity: nextActivity, sessions };
    }),
}));

/** Selector 工具：取已知 session id 列表（按插入顺序）。 */
export const selectSessionIds = (state: AppState): ReadonlyArray<SessionId> =>
  Array.from(state.sessions.keys());

/** Selector 工具：当前 active session 的完整元信息。 */
export const selectActiveSession = (state: AppState): SessionMeta | null => {
  if (!state.activeSessionId) return null;
  return state.sessions.get(state.activeSessionId) ?? null;
};
