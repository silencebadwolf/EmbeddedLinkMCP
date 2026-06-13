/**
 * MCP server transport 工厂。
 *
 * Phase 4 仅交付 Stdio：MCP host（Copilot / Claude Desktop 等）以子进程形式拉起 Electron main，
 * 通过 stdin/stdout 交换 JSON-RPC 消息。本地 TCP transport 留待 Phase 5/12。
 *
 * 工厂模式与 transport 适配器一致 —— 测试可注入假 transport 而无需启动真 stdio 流。
 */

import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

/** Server transport 工厂签名。 */
export type McpTransportFactory = () => Transport;

/**
 * 默认 stdio transport 工厂：使用进程的 stdin/stdout。
 *
 * 注意：被这个 transport 接管后，main 进程**禁止**再向 stdout 写非 JSON-RPC 内容
 * （console.log 之类的诊断输出会破坏协议）。日志请走 stderr 或文件。
 */
export const defaultStdioTransportFactory: McpTransportFactory = () => new StdioServerTransport();
