/**
 * `window.linkterm` 安全访问层。
 *
 * 当 renderer 在纯浏览器（Vite dev server 直接打开、Storybook、Playwright 之类）里运行时，
 * Electron 的 preload 不会注入 `window.linkterm`，对它的成员访问会抛 TypeError。
 *
 * 这个模块提供：
 * - `getLinkterm()`：拿到 PreloadAPI 或 null（未注入时）；
 * - `isLinktermAvailable()`：浅层布尔判断，组件用来切换降级 UI。
 *
 * 调用站点应当在 effect 顶部 `if (!api) return;` 早返回，而不是把所有逻辑塞进可选链 ——
 * 后者读起来像 IPC 在生产环境也可能为空，反而掩盖真正的 bug。
 */

import type { PreloadAPI } from '../../shared/preload-api.js';

/**
 * 拿到当前的 LinkTerm preload API；不在 Electron 环境时返回 null。
 *
 * 使用 globalThis 而非裸 window，是为了让 SSR / Node 环境下的导入也不抛 ReferenceError。
 */
export function getLinkterm(): PreloadAPI | null {
  if (typeof globalThis === 'undefined') return null;
  const w = (globalThis as unknown as { window?: { linkterm?: PreloadAPI } }).window;
  return w?.linkterm ?? null;
}

/** preload 是否已注入；组件用来决定渲染降级提示。 */
export function isLinktermAvailable(): boolean {
  return getLinkterm() !== null;
}