import { ZodError } from 'zod';
import { ERROR_CODES } from '@linkterm/contracts/error-codes';
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
} from './errors.js';
import { ToolError } from '../core/errors.js';


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
