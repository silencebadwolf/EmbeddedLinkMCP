/**
 * MCP UI surface — Electron-free 最小接口契约。
 *
 * 与 `src/core/` 同样的隔离策略：本目录禁止 `import 'electron'`，仅声明 capturePage /
 * isDestroyed 等结构性接口。`src/main/ipc/index.ts` 的 `createUiBridge` 把真 BrowserWindow
 * 适配到这里的 `CapturableWindow`，让 surface 在测试环境完全无 Electron 依赖即可跑通。
 *
 * 该模块也被 `src/mcp/server.ts` 通过 `CreateMcpServerOptions.uiBridge` / `getActiveWindow`
 * 注入消费 —— 因此 server.ts 同样不应出现 Electron 类型。
 */

import type { UiStatePatch } from '../../../shared/preload-api.js';

/**
 * Electron `NativeImage` 的最小子集 —— `BrowserWindow.webContents.capturePage()` 返回的对象。
 *
 * 仅声明 `toPNG()` 与 `getSize()`：UI 工具只需要 PNG 字节流与原始像素尺寸；裁剪 / 缩放
 * 等功能不在 Phase 10 范围。
 */
export interface CapturableImage {
  /** 序列化为 PNG，返回字节流。Buffer 在 Node 环境下天然存在。 */
  toPNG(): Buffer;
  /** 像素尺寸；用于 evidence.data.width / height 报告。 */
  getSize(): { width: number; height: number };
}

/**
 * Electron `WebContents` 的最小子集。
 *
 * 仅 `capturePage()` —— 主进程 thunk 已经拿到具体窗口，UI 工具不需要其它入口。
 */
export interface CapturableWebContents {
  capturePage(): Promise<CapturableImage>;
}

/**
 * Electron `BrowserWindow` 的最小子集，UI 工具可调用对象。
 *
 * `isDestroyed()` 是必备守卫 —— 主进程 thunk 拿到的引用可能已被 macOS `'closed'`
 * 监听器置 null 后又重建为新窗口，调用方按 thunk 模式每次重新读取，再用 isDestroyed
 * 双保险。
 */
export interface CapturableWindow {
  isDestroyed(): boolean;
  webContents: CapturableWebContents;
}

/**
 * UI patch 广播桥 —— `ui_configure` handler 调用 `applyPatch` 让主进程把 patch 经
 * `UI_STATE_PATCH` channel 推送给所有渲染进程。
 *
 * 设计为 fire-and-forget：返回 void 表示已尝试 send（不代表 store 已应用）。Phase 10
 * Q5：AI 客户端可在 ~50ms 后调用 `ui_screenshot` 验证视觉效果。
 */
export interface UiStoreBridge {
  /** 把 patch 广播给所有订阅了 `UI_STATE_PATCH` 的渲染进程。 */
  applyPatch(patch: UiStatePatch): void;
}

/**
 * `registerUiTools` 的依赖容器。
 *
 * 两端都用 thunk —— `getActiveWindow` 必须每次调用都从 module-scope 读最新引用，
 * 而不是构造时快照（macOS `'activate'` 重建会替换 module 单例，构造时快照会指向已
 * destroy 的旧窗口；详见 Phase 10 决策 Q7）。
 */
export interface UiToolsDeps {
  /** UI patch 广播桥；缺省时所有 ui_configure 调用一律返回 UI_NOT_AVAILABLE。 */
  uiBridge: UiStoreBridge | null;
  /** 当前主窗口 thunk；返回 null 或已 destroyed 的窗口时 ui_screenshot 拒绝。 */
  getActiveWindow: () => CapturableWindow | null;
}
