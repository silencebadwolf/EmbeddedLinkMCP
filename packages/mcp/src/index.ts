/**
 * src/mcp/ 桶导出。
 *
 * 仅导出公开 API：server 工厂、registry 类型、版本常量。具体工具实现是内部细节。
 */

export {
  createMcpServer,
  type CreateMcpServerOptions,
  type LinkTermMcpServer,
} from './server.js';
export {
  defaultStdioTransportFactory,
  type McpTransportFactory,
} from './transport.js';
export {
  LINKTERM_MCP_SCHEMA_VERSION,
  checkSchemaVersion,
  type SchemaVersionResult,
  type ToolSensitivity,
} from './versioning/version-check.js';
export {
  ToolError,
  type ToolErrorCode,
  type LinkTermToolResult,
} from './registry.js';
