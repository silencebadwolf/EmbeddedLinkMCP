/**
 * MCP schema 版本检查。
 *
 * Server 启动时声明一个固定版本（{@link LINKTERM_MCP_SCHEMA_VERSION}），客户端在每次工具调用的
 * 输入中可选携带 `clientSchemaVersion` 字段。当字段缺省时视为 "未声明"，read-only 工具放行、
 * state-affecting 工具继续放行（向后兼容老客户端）；当字段提供且不匹配时，state-affecting
 * 工具走"安全拒绝"路径（req §4.9 / DEVELOPMENT_PLAN Phase 4 决策 §2），read-only 工具放行
 * 但在结果中附 `warning`，让 AI 自行决定是否继续。
 *
 * 这种"读放行 + 写拒绝"策略既保留了 AI 排查问题的能力（list_sessions / read_from_session
 * 仍可用来诊断版本错配），又防止误版本写入污染会话或触发危险操作。
 */

/**
 * 当前 server 暴露的 schema 版本。语义化版本：major 提升表示破坏性变更（工具签名、返回结构改动），
 * minor 表示新增工具或新增字段（向后兼容），patch 表示修订。
 *
 * 客户端比较语义：
 * - 完全相等 → ok
 * - 不等但非空 → mismatch
 * - 空（缺省）→ legacy（视为兼容）
 */
export const LINKTERM_MCP_SCHEMA_VERSION = 'linkterm-mcp/1.0.0';

/** 单个工具的版本敏感度。 */
export type ToolSensitivity = 'read-only' | 'state-affecting';

/** {@link checkSchemaVersion} 返回值。 */
export interface SchemaVersionResult {
  /** 是否允许工具继续执行。state-affecting + mismatch 为 false；其它为 true。 */
  ok: boolean;
  /**
   * 当版本不匹配时填充的人类可读警告消息。
   * - state-affecting + mismatch: ok=false，作为 error.message 返回；
   * - read-only + mismatch: ok=true，作为 evidence.meta.warning 返回。
   */
  warning?: string;
  /** server 端声明的版本，便于客户端结构化比较。 */
  serverVersion: string;
  /** 客户端实际声明的版本（缺省为 undefined）。 */
  clientVersion?: string;
}

/**
 * 检查客户端声明的 schema 版本是否与 server 一致。
 *
 * @param clientVersion 客户端在工具入参中提供的 `clientSchemaVersion`；可选
 * @param sensitivity 工具的敏感度：read-only 工具 mismatch 时仍允许执行
 * @returns {@link SchemaVersionResult}
 */
export function checkSchemaVersion(
  clientVersion: string | undefined,
  sensitivity: ToolSensitivity,
): SchemaVersionResult {
  const serverVersion = LINKTERM_MCP_SCHEMA_VERSION;
  if (clientVersion === undefined || clientVersion === serverVersion) {
    return { ok: true, serverVersion, clientVersion };
  }
  const warning =
    `MCP schema version mismatch: client="${clientVersion}", server="${serverVersion}". ` +
    (sensitivity === 'state-affecting'
      ? 'Refusing state-affecting operation; please upgrade the client or align schema version.'
      : 'Read-only operation allowed but client should align schema version.');
  return {
    ok: sensitivity === 'read-only',
    warning,
    serverVersion,
    clientVersion,
  };
}
