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
  /** J-Link backend 未注入；当前 server 仅暴露空实现。 */
  NO_BACKEND: 'NO_BACKEND',
  /** 给定 probeId 不存在或已 disconnect。 */
  PROBE_NOT_FOUND: 'PROBE_NOT_FOUND',
  /** probe 上有并发操作未完成。 */
  PROBE_BUSY: 'PROBE_BUSY',
  /** backend 实操失败（保留 J-Link 前缀避免与未来通用 OPERATION_FAILED 撞名）。 */
  JLINK_OPERATION_FAILED: 'JLINK_OPERATION_FAILED',
  /** 二进制载荷超过 16 MiB 上限（MCP JSON 通道保护）。 */
  BUFFER_TOO_LARGE: 'BUFFER_TOO_LARGE',
  /** 调用方通过 AbortSignal 主动取消（含超时）。 */
  ABORTED: 'ABORTED',
  /** 操作语义与当前 probe 状态不符（如已 halt 再请求 halt、target 缺失等）。 */
  INVALID_STATE: 'INVALID_STATE',
  /** JLinkAdapter stub 未实现的方法（Phase 9 占位，等待真实 backend）。 */
  NOT_IMPLEMENTED: 'NOT_IMPLEMENTED',
} as const;

/** ERROR_CODES 的字符串字面量联合类型。 */
export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];
