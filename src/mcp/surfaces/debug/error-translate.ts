/**
 * J-Link 域错误 → MCP ToolError 翻译层 + debug surface 共享 helper。
 *
 * 所有 debug 工具 handler 包一层 {@link runJLink}，统一捕获 `JLinkError` 子类并按
 * `instanceof` 翻译为稳定 ToolError；其余异常原样抛出，由 registry 兜底归一为
 * INTERNAL。这避免 28 个 handler 各自重复 try/catch。
 *
 * 此外提供两个 surface 共享 helper：
 * - {@link ok}：构造 ToolHandlerSuccess（统一注入 `success: true`）；
 * - {@link withAbortableTimeout}：把 `timeoutMs` 翻译为 AbortSignal，超时后由 backend
 *   抛 JLinkAbortedError，再由 runJLink 翻译为 ABORTED。
 *
 * **凭据红线**：ZodError 仅暴露 `path + message + code`，不回显 caller 提供的 value。
 * 这与 workspace surface 的 translateWorkspaceError 风格一致。
 */

import { ZodError } from 'zod';
import { ERROR_CODES } from '../../../shared/error-codes.js';
import {
  JLinkAbortedError,
  JLinkBufferTooLargeError,
  JLinkError,
  JLinkInvalidStateError,
  JLinkNotImplementedError,
  JLinkOperationError,
  NoBackendError,
  ProbeBusyError,
  ProbeNotFoundError,
} from '../../../jlink/errors.js';
import { ToolError, type ToolHandlerSuccess } from '../../registry.js';

/**
 * Phase 12：高影响 J-Link 工具的 confirm 闸门错误。
 *
 * 当 caller 未在入参中显式 `confirm: true` 时由 tool entry 抛出，被
 * {@link runJLink} 捕获并经 {@link translateJLinkError} 翻译为
 * `CONFIRMATION_REQUIRED` ToolError，details 含 `tool` 字段。
 *
 * **不继承 JLinkError**：confirm 闸门是 MCP 表层策略（与 backend 实现无关），
 * 与 backend 自身能抛的 8 个 JLinkError 子类语义独立；放在 error-translate
 * 模块里仅是为了让 runJLink 的翻译层一次覆盖。
 */
export class ConfirmationRequiredError extends Error {
  /**
   * @param toolName 被守卫的工具名（如 `flash_download`）
   */
  constructor(public readonly toolName: string) {
    super(
      `Confirmation required for high-impact operation \"${toolName}\"; pass confirm: true to proceed.`,
    );
    this.name = 'ConfirmationRequiredError';
  }
}

/**
 * 把 J-Link 域错误翻译为 ToolError 抛出。永远不返回（`: never`）。
 *
 * @param err 任意 throw 出的错误（来源：backend 调用 / Zod 解析 / 其它）
 */
export function translateJLinkError(err: unknown): never {
  if (err instanceof ToolError) {
    // 已是 ToolError（例如 binary-codec 抛的 INVALID_ARGUMENT），直接透传。
    throw err;
  }
  if (err instanceof ConfirmationRequiredError) {
    throw new ToolError(
      ERROR_CODES.CONFIRMATION_REQUIRED,
      'Confirmation required for high-impact operation',
      { tool: err.toolName },
    );
  }
  if (err instanceof NoBackendError) {
    throw new ToolError(ERROR_CODES.NO_BACKEND, err.message);
  }
  if (err instanceof ProbeNotFoundError) {
    throw new ToolError(ERROR_CODES.PROBE_NOT_FOUND, err.message, {
      probeId: err.probeId,
    });
  }
  if (err instanceof ProbeBusyError) {
    throw new ToolError(ERROR_CODES.PROBE_BUSY, err.message, {
      probeId: err.probeId,
    });
  }
  if (err instanceof JLinkBufferTooLargeError) {
    throw new ToolError(ERROR_CODES.BUFFER_TOO_LARGE, err.message, {
      actualBytes: err.actualBytes,
      maxBytes: err.maxBytes,
    });
  }
  if (err instanceof JLinkAbortedError) {
    throw new ToolError(ERROR_CODES.ABORTED, err.message);
  }
  if (err instanceof JLinkInvalidStateError) {
    const details: Record<string, unknown> = {};
    if (err.expected !== undefined) details.expected = err.expected;
    if (err.actual !== undefined) details.actual = err.actual;
    throw new ToolError(
      ERROR_CODES.INVALID_STATE,
      err.message,
      Object.keys(details).length > 0 ? details : undefined,
    );
  }
  if (err instanceof JLinkNotImplementedError) {
    throw new ToolError(ERROR_CODES.NOT_IMPLEMENTED, err.message, {
      method: err.method,
    });
  }
  if (err instanceof JLinkOperationError) {
    const details: Record<string, unknown> = {};
    if (err.operation !== undefined) details.operation = err.operation;
    // **不**把 underlying 放进 details——可能含敏感栈信息或第三方对象，让客户端只看
    // 翻译后的消息；调试需要时去主进程日志查。
    throw new ToolError(
      ERROR_CODES.JLINK_OPERATION_FAILED,
      err.message,
      Object.keys(details).length > 0 ? details : undefined,
    );
  }
  if (err instanceof JLinkError) {
    // 尚未匹配的 JLinkError 子类（理论上不会出现 —— 上面 8 个分支已覆盖全部）。
    // 落到 INTERNAL 而不是丢失 message，便于 Phase 13+ 增量扩展时早期发现遗漏。
    throw new ToolError(ERROR_CODES.INTERNAL, err.message, { code: err.code });
  }
  if (err instanceof ZodError) {
    const safeIssues = err.issues.map((i) => ({
      path: i.path,
      message: i.message,
      code: i.code,
    }));
    throw new ToolError(ERROR_CODES.INVALID_ARGUMENT, 'Invalid debug tool payload', {
      issues: safeIssues,
    });
  }
  throw err;
}

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
 * Debug surface 28 个 handler 共用。
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
