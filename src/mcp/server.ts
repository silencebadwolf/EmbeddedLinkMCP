/**
 * MCP server 工厂与生命周期管理。
 *
 * 单例 server：由 main 进程在 app.whenReady 后调用 {@link createMcpServer} + {@link startMcpServer}
 * 拉起；进程退出（before-quit）时调用 {@link stopMcpServer} 释放 transport 与 SDK 资源。
 *
 * 关键不变量：
 * - SessionManager 必须与 IPC 层共享同一个实例（§4.5 \"AI 与人操作同一会话\"）。
 * - SerialDiscovery 同理 —— `discover_serial_ports` 工具应直接代理 main 进程已存在的实例，
 *   而不是 new 一个新轮询器。
 *
 * 不在此处暴露任何 Electron 类型 —— 调用方（main 进程）注入 SessionManager / SerialDiscovery，
 * server 模块只依赖 core / transports，便于在测试中独立验证。
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { SessionManager } from '../core/session/session-manager.js';
import type { SerialDiscovery } from '../transports/serial/serial-discovery.js';
import type {
  EvidenceSnapshot,
  WorkspaceConfigManager,
} from '../core/workspace/index.js';
import type { IJLinkBackend } from '../jlink/types.js';
import { NullJLinkBackend } from '../jlink/null-backend.js';
import { APP_NAME } from '../shared/constants.js';
import {
  defaultStdioTransportFactory,
  type McpTransportFactory,
} from './transport.js';
import { LINKTERM_MCP_SCHEMA_VERSION } from './versioning/version-check.js';
import { registerTerminalTools } from './surfaces/terminal/tools.js';
import { registerWorkspaceTools } from './surfaces/workspace/tools.js';
import { registerDebugTools } from './surfaces/debug/tools.js';
import { registerDebugBinaryTools } from './surfaces/debug/tools-binary.js';

/** {@link createMcpServer} 的依赖容器。 */
export interface CreateMcpServerOptions {
  sessionManager: SessionManager;
  serialDiscovery: SerialDiscovery;
  /**
   * 工作区配置管理器（Phase 8）。注入时 server 会注册 3 个 workspace 工具；
   * 缺省时跳过注册（向后兼容旧测试）。
   */
  workspaceConfigManager?: WorkspaceConfigManager;
  /**
   * 工作区工具计算 conflicts 时的硬件证据回调；省略时退化为只看 SerialDiscovery。
   * 仅在提供 workspaceConfigManager 时有意义。
   */
  workspaceEvidenceFn?: () => Promise<EvidenceSnapshot>;
  /**
   * J-Link backend（Phase 9）。注入时 server 会注册 28 个 debug 工具；
   * 缺省时使用 NullJLinkBackend，工具仍然注册并对所有调用返回 NO_BACKEND
   * 结构化拒绝（让 AI 客户端始终能看到工具清单与契约性失败）。
   */
  jlinkBackend?: IJLinkBackend;
  /** 注入用 transport 工厂；省略时使用 stdio。测试通常注入 InMemoryTransport。 */
  transportFactory?: McpTransportFactory;
  /** 覆盖 server 自报版本号；默认从 APP_NAME / package.json 推导。 */
  serverInfo?: { name: string; version: string };
}

/** {@link createMcpServer} 返回的句柄；start/stop 操控生命周期。 */
export interface LinkTermMcpServer {
  /** 底层 SDK McpServer 实例（暴露用于测试 / 调试）。 */
  readonly server: McpServer;
  /** 当前 schema 版本（与 {@link LINKTERM_MCP_SCHEMA_VERSION} 一致）。 */
  readonly schemaVersion: string;
  /** 启动 server：创建 transport 并 connect。重复调用为幂等（已启动时直接返回）。 */
  start(): Promise<void>;
  /** 停止 server：close 当前 transport 并释放 SDK 资源。重复调用为幂等。 */
  stop(): Promise<void>;
  /** 是否处于 connected 状态。 */
  isRunning(): boolean;
}

/**
 * 构造一个 LinkTerm MCP server（尚未连接 transport）。
 *
 * @param options 依赖容器
 * @returns 已注册全部工具但未启动的 server 句柄
 */
export function createMcpServer(options: CreateMcpServerOptions): LinkTermMcpServer {
  const transportFactory = options.transportFactory ?? defaultStdioTransportFactory;
  const serverInfo = options.serverInfo ?? {
    name: 'linkterm-mcp',
    version: LINKTERM_MCP_SCHEMA_VERSION,
  };

  const server = new McpServer(
    {
      ...serverInfo,
      title: APP_NAME,
    },
    {
      capabilities: {
        tools: {},
      },
      // SDK 没有专门的 schemaVersion 字段；我们把它放进 instructions，并让每个工具结果回填。
      instructions:
        `LinkTerm MCP terminal surface (schema=${LINKTERM_MCP_SCHEMA_VERSION}). ` +
        'All writes are tagged origin="ai" and serialized with human input via the same WriteQueue. ' +
        'Use sequence cursors with read_from_session to avoid missing concurrent human input.',
    },
  );

  registerTerminalTools(server, {
    sessionManager: options.sessionManager,
    serialDiscovery: options.serialDiscovery,
  });

  if (options.workspaceConfigManager) {
    const evidenceFn =
      options.workspaceEvidenceFn ??
      (async () => ({
        serialPorts: await options.serialDiscovery.listPorts(),
      }));
    registerWorkspaceTools(server, {
      workspaceConfigManager: options.workspaceConfigManager,
      evidenceFn,
    });
  }

  // Phase 9: 始终注册 28 个 debug 工具；未注入 backend 时挂 NullJLinkBackend，
  // 让所有调用都返回结构化的 NO_BACKEND 拒绝（req §4.6）。
  const jlinkBackend = options.jlinkBackend ?? new NullJLinkBackend();
  registerDebugTools(server, { jlinkBackend });
  registerDebugBinaryTools(server, { jlinkBackend });

  let activeTransport: Transport | null = null;
  let starting: Promise<void> | null = null;
  let stopping: Promise<void> | null = null;

  const start = async (): Promise<void> => {
    if (stopping) await stopping;
    if (activeTransport) return;
    if (starting) return starting;
    const pending = (async () => {
      const transport = transportFactory();
      try {
        await server.connect(transport);
        activeTransport = transport;
      } catch (err) {
        activeTransport = null;
        throw err;
      }
    })();
    starting = pending;
    try {
      await pending;
    } finally {
      starting = null;
    }
  };

  const stop = async (): Promise<void> => {
    if (stopping) return stopping;
    if (!activeTransport) return;
    const transport = activeTransport;
    activeTransport = null;
    stopping = (async () => {
      try {
        await server.close();
      } finally {
        try {
          await transport.close();
        } catch {
          // 已关闭则忽略
        }
      }
    })();
    try {
      await stopping;
    } finally {
      stopping = null;
    }
  };

  return {
    server,
    schemaVersion: LINKTERM_MCP_SCHEMA_VERSION,
    start,
    stop,
    isRunning: () => activeTransport !== null,
  };
}
