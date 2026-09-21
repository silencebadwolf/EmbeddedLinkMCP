/**
 * 渲染端全局状态 store。
 *
 * 设计取舍：单 store + selector 工具，避免多 slice 在小团队场景下相互引用导致的环。
 *
 * **不可序列化 / 副作用值不进入 store**：xterm.js Terminal 实例、subscription 清理函数
 * 等用 `useRef` 在组件局部持有；store 仅承载视图态。
 */

import { create } from 'zustand';
import type { ConnectionType, SessionId, SessionState } from '@linkterm/contracts/types';
import type { Origin, SerialPortInfo } from '@linkterm/contracts/types';
import type { Locale } from '../i18n/index.js';
import type { NonSensitivePrefill } from '@linkterm/contracts/preload-api';

const USER_PREFERENCES_STORAGE_KEY = 'linkterm:user-preferences';
const USER_PREFERENCES_SCHEMA_VERSION = 1;

interface UserPreferences {
  schemaVersion: typeof USER_PREFERENCES_SCHEMA_VERSION;
  locale: Locale;
}

/**
 * 判断未知值是否为 LinkTerm 当前支持的 UI 语言。
 *
 * @param value - 待校验的未知输入。
 * @returns 若 value 是合法 Locale 则返回 true。
 */
function isLocale(value: unknown): value is Locale {
  return value === 'en' || value === 'zh';
}

/**
 * 从浏览器本地存储读取 UI 偏好；缺失、损坏或不可用时返回 null。
 *
 * @returns 已校验的用户偏好，或 null。
 */
function readUserPreferences(): UserPreferences | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(USER_PREFERENCES_STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    const candidate = parsed as Partial<UserPreferences>;
    if (candidate.schemaVersion !== USER_PREFERENCES_SCHEMA_VERSION || !isLocale(candidate.locale)) {
      return null;
    }
    return { schemaVersion: USER_PREFERENCES_SCHEMA_VERSION, locale: candidate.locale };
  } catch {
    return null;
  }
}

/**
 * 将 UI 偏好写入浏览器本地存储；存储不可用时静默降级为内存态。
 *
 * @param preferences - 需要持久化的用户偏好。
 */
function writeUserPreferences(preferences: UserPreferences): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(USER_PREFERENCES_STORAGE_KEY, JSON.stringify(preferences));
  } catch {
    // 存储配额或隐私模式失败时静默降级；内存态仍会更新。
  }
}

const initialUserPreferences = readUserPreferences();

/** 单条 session 在 UI 层的元信息镜像；权威状态仍在主进程。 */
export interface SessionMeta {
  /** SessionManager 分配的 `sess_<uuid>`。 */
  id: SessionId;
  /** UI 显示名；若未设则按 id 末尾 4 字符自动派生。 */
  label: string;
  /** 连接类型，方便侧边栏图标/语义。 */
  connectionType: ConnectionType;
  /** RTT 日志会话的非敏感匹配键。 */
  rttLog?: {
    probeId: string;
    channelIndex: number;
  };
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
  /**
   * Phase 10：MCP `ui_configure` 推送的 ConnectionDialog 预填值。
   *
   * 仅在 dialog 由关到开的边沿被读取一次（useEffect `[open]`），随后立即调用
   * `setConnectionDialogPrefill(null)` —— 防止反复关→开时陈旧 prefill 阴魂不散。
   * 不允许敏感凭据字段（类型 `NonSensitivePrefill` 已在 schema/类型双层禁止）。
   */
  connectionDialogPrefill: NonSensitivePrefill | null;

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
  /**
   * 设置 ConnectionDialog 的 prefill。MCP `ui_configure` open_connection_dialog 推送时调用；
   * dialog 当前打开则不会立即生效（保护用户输入），下一次关→开边沿才被消费。
   * 调用方在边沿消费 prefill 后应当传入 `null` 清空，避免反复关→开时陈旧 prefill 阴魂不散。
   */
  setConnectionDialogPrefill(prefill: NonSensitivePrefill | null): void;
}

/** Zustand 全局 store。组件通过 `useAppStore(selector)` 订阅子集，避免无关重渲。 */
export const useAppStore = create<AppState>((set) => ({
  sessions: new Map(),
  activeSessionId: null,
  locale: initialUserPreferences?.locale ?? 'en',
  dialogOpen: false,
  serialPorts: [],
  originActivity: {},
  connectionDialogPrefill: null,

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

  setLocale: (locale) => {
    writeUserPreferences({ schemaVersion: USER_PREFERENCES_SCHEMA_VERSION, locale });
    set(() => ({ locale }));
  },
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

  setConnectionDialogPrefill: (prefill) =>
    set(() => ({ connectionDialogPrefill: prefill })),
}));

/** Selector 工具：取已知 session id 列表（按插入顺序）。 */
export const selectSessionIds = (state: AppState): ReadonlyArray<SessionId> =>
  Array.from(state.sessions.keys());

/** Selector 工具：当前 active session 的完整元信息。 */
export const selectActiveSession = (state: AppState): SessionMeta | null => {
  if (!state.activeSessionId) return null;
  return state.sessions.get(state.activeSessionId) ?? null;
};
