/**
 * IPC / MCP 边界错误码集中常量。
 *
 * Phase 6 评审 M5：原本错误码字符串散落在 main IPC handler、MCP tools.ts 与渲染端
 * 错误判别处。统一到此文件后：
 * - main / mcp 的 throw 时使用 `ERROR_CODES.XXX`；
 * - renderer 端按 `result.error.code === ERROR_CODES.XXX` 判别（不再硬编码字面量）；
 * - 改名时 IDE 一次性重命名，避免漏改。
 *
 * 注意：本文件**不得引入运行时依赖** —— 它会被 main / preload / renderer / mcp 共同消费。
 */

/** 已对外稳定的错误码集合。删除条目前需要确认所有客户端都已迁移。 */
export const ERROR_CODES = {
  /** 入参 schema/类型校验失败。 */
  INVALID_PAYLOAD: 'INVALID_PAYLOAD',
  /** MCP / IPC 入参语义错误（如非法 base64）。 */
  INVALID_ARGUMENT: 'INVALID_ARGUMENT',
  /** 目标 session 不存在（已 destroy 或从未创建）。 */
  SESSION_NOT_FOUND: 'SESSION_NOT_FOUND',
  /** 目标 session 不在 open 状态，无法写入。 */
  NOT_OPEN: 'NOT_OPEN',
  /** WriteQueue normal 通道已满，调用方应退避后重试。 */
  QUEUE_FULL: 'QUEUE_FULL',
  /** 等待响应超时（sendAndWait）。 */
  TIMEOUT: 'TIMEOUT',
  /** sendAndWait 等待期间 session 进入 closed/errored 终态。 */
  SESSION_CLOSED: 'SESSION_CLOSED',
  /** 兜底错误码，未归类的内部异常一律落到这里。 */
  INTERNAL: 'INTERNAL',
  /** 工作区配置文件不存在（caller 未先 init_workspace）。 */
  WORKSPACE_NOT_FOUND: 'WORKSPACE_NOT_FOUND',
  /** 工作区已存在 config.json，但 caller 未传 force=true。 */
  WORKSPACE_ALREADY_INITIALIZED: 'WORKSPACE_ALREADY_INITIALIZED',
  /** 工作区配置与硬件证据冲突，且包含 severity='error' 级别的差异。 */
  WORKSPACE_CONFLICT: 'WORKSPACE_CONFLICT',
  /** 工作区 config.json 的 schemaVersion 与运行时常量不匹配（需迁移）。 */
  WORKSPACE_SCHEMA_VERSION_MISMATCH: 'WORKSPACE_SCHEMA_VERSION_MISMATCH',
} as const;

/** ERROR_CODES 的字符串字面量联合类型。 */
export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];
