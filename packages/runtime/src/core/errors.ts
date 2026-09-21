/** Shared backend operation errors. Legacy names retain instanceof compatibility across hosts and MCP. */
/**
 * 已知错误码集合。Handler 可以通过 {@link ToolError} 抛出已归类的错误；
 * 未归类异常会被吞成 `INTERNAL`，避免泄漏栈/凭据。
 */
export type ToolErrorCode =
  | 'NOT_FOUND'
  | 'SESSION_NOT_FOUND'
  | 'SERIAL_SESSION_CONFLICT'
  | 'NOT_OPEN'
  | 'NOT_WRITABLE'
  | 'NOT_IMPLEMENTED'
  | 'INVALID_ARGUMENT'
  | 'TIMEOUT'
  | 'DEVICE_UNRESPONSIVE'
  | 'SESSION_CLOSED'
  | 'QUEUE_FULL'
  | 'NO_BACKEND'
  | 'VERSION_MISMATCH'
  | 'WORKSPACE_NOT_FOUND'
  | 'WORKSPACE_ALREADY_INITIALIZED'
  | 'WORKSPACE_CONFLICT'
  | 'WORKSPACE_SCHEMA_VERSION_MISMATCH'
  | 'CONTROL_PROFILE_NOT_FOUND'
  | 'CONTROL_PROFILE_ALREADY_INITIALIZED'
  | 'CONTROL_PROFILE_SCHEMA_VERSION_MISMATCH'
  | 'PROBE_NOT_FOUND'
  | 'PROBE_BUSY'
  | 'JLINK_OPERATION_FAILED'
  | 'BUFFER_TOO_LARGE'
  | 'ABORTED'
  | 'INVALID_STATE'
  | 'UI_NOT_AVAILABLE'
  | 'INTERNAL';


/**
 * Handler 内部用来抛出已归类的错误；registry 会把它转成 LinkTermToolResult.error.
 *
 * **不要把任何敏感字段塞进 message 或 details**（密码 / 私钥 / token）。
 */
export class ToolError extends Error {
  constructor(
    public readonly code: ToolErrorCode,
    message: string,
    public readonly details?: Readonly<Record<string, unknown>>,
  ) {
    super(message);
    this.name = 'ToolError';
  }
}
