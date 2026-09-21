import type { ToolHandlerSuccess } from '../../registry.js';
import { translateJLinkError } from '@linkterm/runtime/jlink/operation-error';
export { translateJLinkError } from '@linkterm/runtime/jlink/operation-error';

/**
 * J-Link 域错误 → MCP ToolError 翻译层 + debug surface 共享 helper。
 *
 * 所有 debug 工具 handler 包一层 {@link runJLink}，统一捕获 `JLinkError` 子类并按
 * `instanceof` 翻译为稳定 ToolError；其余异常原样抛出，由 registry 兜底归一为
 * INTERNAL。这避免 debug handler 各自重复 try/catch。
 *
 * 此外提供两个 surface 共享 helper：
 * - {@link ok}：构造 ToolHandlerSuccess（统一注入 `success: true`）；
 * - {@link withAbortableTimeout}：把 `timeoutMs` 翻译为 AbortSignal，超时后由 backend
 *   抛 JLinkAbortedError，再由 runJLink 翻译为 ABORTED。
 *
 * **凭据红线**：ZodError 仅暴露 `path + message + code`，不回显 caller 提供的 value。
 * 这与 workspace surface 的 translateWorkspaceError 风格一致。
 */






/**
 * 高阶 wrapper：执行 backend 调用，捕获并翻译 J-Link 错误。
 *
 * @param fn 业务闭包；通常调用 `deps.jlinkBackend.xxx(...)`
 */
export async function runJLink<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    translateJLinkError(err);
  }
}

/**
 * 简化 ToolHandlerSuccess 构造，避免每个 handler 重复 `success: true`。
 * Debug surface handler 共用。
 */
export function ok(value: Omit<ToolHandlerSuccess, 'success'>): ToolHandlerSuccess {
  return { success: true, ...value };
}

/**
 * 在可选超时内执行长操作；超时触发 AbortController.abort()，backend 收到信号后抛
 * JLinkAbortedError。
 *
 * 行为：
 * - `timeoutMs === undefined`：不创建 AbortController，传 `undefined` 给 backend；
 * - `timeoutMs > 0`：创建 AbortController + setTimeout 触发 abort；操作结束后清理定时器；
 * - backend 抛 `JLinkAbortedError` 时由调用方 `runJLink` 翻译为 ABORTED。
 *
 * @param timeoutMs 可选超时（毫秒）；undefined 表示不限时
 * @param fn 接收 signal 的业务闭包；当 timeoutMs 缺省时 signal 也是 undefined
 */
export async function withAbortableTimeout<T>(
  timeoutMs: number | undefined,
  fn: (signal: AbortSignal | undefined) => Promise<T>,
): Promise<T> {
  if (timeoutMs === undefined) {
    return fn(undefined);
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fn(controller.signal);
  } finally {
    clearTimeout(timer);
  }
}
