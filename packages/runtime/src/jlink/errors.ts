/**
 * J-Link backend 域错误层级。
 *
 * 与 SerialTransport / WorkspaceConfigManager 的错误风格一致：所有 backend 实现 throw
 * 这些类，MCP 边界（`src/mcp/surfaces/debug/error-translate.ts`）按 `instanceof` 翻译为
 * 稳定的 `ToolError`。新增子类时**必须**：
 *
 * 1. 同时在 `src/shared/error-codes.ts` 的 `ERROR_CODES` 加常量；
 * 2. 同时在 `src/mcp/registry.ts` 的 `ToolErrorCode` union 加字面量；
 * 3. 在 `error-translate.ts` 加一条 `instanceof` 分支。
 *
 * 三处缺一不可（M5 双向同步契约）。
 */

import { ERROR_CODES, type ErrorCode } from '@linkterm/contracts/error-codes';

/**
 * J-Link 域错误基类。所有子类都暴露稳定的 `code` 字段，避免上层用 message 字符串嗅探。
 *
 * 用 `new.target.name` 让 8 个子类不必各自重复 `this.name = ...` 赋值——子类构造时
 * `new.target` 指向最派生构造器，name 字段自动等于子类类名（例如 ProbeNotFoundError）。
 */
export class JLinkError extends Error {
  /** 与 ERROR_CODES 同源的稳定错误码字面量。 */
  readonly code: ErrorCode;

  constructor(message: string, code: ErrorCode) {
    super(message);
    this.name = new.target.name;
    this.code = code;
  }
}

/** backend 未注入；NullJLinkBackend 的所有方法抛此错。 */
export class NoBackendError extends JLinkError {
  constructor(message = 'No J-Link backend injected') {
    super(message, ERROR_CODES.NO_BACKEND);
  }
}

/** 给定 probeId 在 adapter 内部 Map 中找不到。 */
export class ProbeNotFoundError extends JLinkError {
  readonly probeId: string;
  constructor(probeId: string) {
    super(`Probe not found: ${probeId}`, ERROR_CODES.PROBE_NOT_FOUND);
    this.probeId = probeId;
  }
}

/** probe 上有并发操作未完成。Phase 9 stub 不会主动抛，预留给真实 backend。 */
export class ProbeBusyError extends JLinkError {
  readonly probeId: string;
  constructor(probeId: string, message = `Probe is busy with another operation: ${probeId}`) {
    super(message, ERROR_CODES.PROBE_BUSY);
    this.probeId = probeId;
  }
}

/** backend 实操失败；可携带原始 underlying error 用于诊断。 */
export class JLinkOperationError extends JLinkError {
  readonly operation?: string;
  readonly underlying?: unknown;
  constructor(message: string, opts?: { operation?: string; underlying?: unknown }) {
    super(message, ERROR_CODES.JLINK_OPERATION_FAILED);
    if (opts?.operation !== undefined) this.operation = opts.operation;
    if (opts?.underlying !== undefined) this.underlying = opts.underlying;
  }
}

/** 二进制载荷超过 16 MiB。 */
export class JLinkBufferTooLargeError extends JLinkError {
  readonly actualBytes: number;
  readonly maxBytes: number;
  constructor(actualBytes: number, maxBytes: number) {
    super(
      `Binary payload too large: ${actualBytes} bytes (max ${maxBytes})`,
      ERROR_CODES.BUFFER_TOO_LARGE,
    );
    this.actualBytes = actualBytes;
    this.maxBytes = maxBytes;
  }
}

/** 调用方通过 AbortSignal 主动取消（也覆盖 timeoutMs 触发的 AbortController）。 */
export class JLinkAbortedError extends JLinkError {
  constructor(message = 'Operation aborted by caller') {
    super(message, ERROR_CODES.ABORTED);
  }
}

/**
 * 操作语义与当前 probe 状态不符（如已 halt 再请求 halt、target 缺失等）。
 * 携带可选的 expected/actual 描述用于诊断。
 */
export class JLinkInvalidStateError extends JLinkError {
  readonly expected?: string;
  readonly actual?: string;
  constructor(message: string, opts?: { expected?: string; actual?: string }) {
    super(message, ERROR_CODES.INVALID_STATE);
    if (opts?.expected !== undefined) this.expected = opts.expected;
    if (opts?.actual !== undefined) this.actual = opts.actual;
  }
}

/** Phase 9 stub adapter 未实现的方法。 */
export class JLinkNotImplementedError extends JLinkError {
  readonly method: string;
  constructor(method: string) {
    super(`J-Link operation not implemented: ${method}`, ERROR_CODES.NOT_IMPLEMENTED);
    this.method = method;
  }
}
