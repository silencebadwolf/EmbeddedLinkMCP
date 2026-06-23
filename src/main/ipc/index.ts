import path from 'node:path';
import { app, BrowserWindow } from 'electron';
import { SessionManager } from '../../core/session/session-manager.js';
import { ControlProfileManager, WorkspaceConfigManager } from '../../core/workspace/index.js';
import { ConnectionProfileManager } from '../../core/connections/index.js';
import {
  AgentIntegrationManager,
  buildElectronMcpLaunchConfig,
  type AgentIntegrationTarget,
  type LinkTermMcpLaunchConfig,
} from '../../core/agent-integrations/index.js';
import { JLinkAdapter } from '../../jlink/index.js';
import type { IJLinkBackend } from '../../jlink/index.js';
import { createMcpServer, type LinkTermMcpServer } from '../../mcp/index.js';
import { startMcpHttpRuntimeServer, type McpHttpRuntimeServer } from '../../mcp/http-runtime-server.js';
import { createRuntimeDiagnosticsProvider } from '../../mcp/runtime-diagnostics.js';
import { runtimeMetadataPath } from '../../mcp/runtime-metadata.js';
import { ControlWorkflowJobManager } from '../../mcp/surfaces/control-workflow/job-manager.js';
import type { CapturableWindow } from '../../mcp/surfaces/ui/types.js';
import { SerialDiscovery } from '../../transports/serial/serial-discovery.js';
import { registerSerialIpc } from './serial-ipc.js';
import { registerSessionIpc } from './session-ipc.js';
import { registerSessionCreate } from './session-create-handler.js';
import { registerRttLogSessionIpc } from './rtt-log-session-ipc.js';
import { registerConnectionProfilesIpc } from './connection-profiles-ipc.js';
import { registerAgentIntegrationsIpc } from './agent-integrations-ipc.js';
import { registerControlProfileIpc } from './control-profile-ipc.js';
import { SafeStorageSecretCodec } from '../connections/safe-storage-secret-codec.js';
import { createUiBridge } from './ui-bridge.js';
export { createUiBridge, type UiPatchTarget } from './ui-bridge.js';

/**
 * 主进程持有的全局依赖容器：随 IPC handler 一起初始化、随退出统一清理。
 *
 * **关键不变量（§4.5）**：`sessionManager` 必须由 IPC 层与 MCP server 共享同一实例 ——
 * 这是 \"AI 与人操作同一会话\" 的物理基础。`mcpServer` 在创建时被注入这个 manager，
 * 因此本 context 同时持有二者并在 dispose 时按 \"先 stop MCP → 再 destroyAll session\" 顺序释放。
 *
 * Phase 8 新增 `workspaceConfigManager`：MCP `init/get/update_workspace_config` 三工具与之共享。
 */
export interface MainProcessContext {
  serialDiscovery: SerialDiscovery;
  sessionManager: SessionManager;
  workspaceConfigManager: WorkspaceConfigManager;
  controlProfileManager: ControlProfileManager;
  connectionProfileManager: ConnectionProfileManager;
  /** 本机 Agent MCP 配置检测与安装管理器。 */
  agentIntegrationManager: AgentIntegrationManager;
  /**
   * Phase 9：J-Link backend。当前仅 lifecycle 可用（probeConnect/disconnect/status
   * /detect），其余方法抛 NOT_IMPLEMENTED；Phase 13+ 替换为真实 SEGGER 适配器。
   */
  jlinkBackend: IJLinkBackend;
  /** 控制工作流后台 job 管理器，必须在 HTTP 短生命周期 MCP server 间共享。 */
  controlWorkflowJobManager: ControlWorkflowJobManager;
  mcpServer: LinkTermMcpServer;
  /** 本地 HTTP MCP endpoint，供后启动的 stdio proxy 连接到同一 runtime。 */
  mcpHttpServer: McpHttpRuntimeServer;
  /** 反注册所有 IPC handler 并停止 MCP server / 销毁所有 session；应用退出/测试 teardown 调用。 */
  dispose: () => Promise<void>;
}

/**
 * {@link registerIpcHandlers} 的可选项。
 *
 * `autoStartMcp` 控制是否在 register 阶段就启动 MCP server：
 * - `true`: 立即启动（CI / 测试可显式开启）
 * - `false`: 不启动；调用方稍后自行 `mcpServer.start()`
 * - `undefined`（默认）: 依据环境变量 `LINKTERM_MCP_STDIO==='1'` 决定。
 *   桌面默认不自动占用 stdio —— 否则任何 console.log / Node warning 都会
 *   破坏 MCP 协议帧，并污染 Electron 主进程的标准输出。
 */
export interface RegisterIpcHandlersOptions {
  /** 是否在创建 context 后立即启动 MCP server。 */
  autoStartMcp?: boolean;
  /**
   * Phase 10：当前主窗口 thunk。注入后 MCP `ui_screenshot` 可以拿到 BrowserWindow
   * 调用 `webContents.capturePage()`；缺省时 ui_screenshot 一律 UI_NOT_AVAILABLE。
   *
   * 必须是 thunk —— 详见 `src/main/index.ts` `getMainWindow` JSDoc.
   */
  getMainWindow?: () => BrowserWindow | null;
}

/**
 * 注册所有主进程 ↔ 渲染进程的 IPC handler，并返回拥有所有 main-side 状态的 context.
 *
 * 启动失败保证：MCP server 启动抛错时，已注册的 IPC handler 会被回滚 ——
 * 否则下次 register 会撞 `ipcMain.handle` 的 \"already registered\".
 *
 * @param options 可选行为开关
 * @returns 包含 sessionManager / mcpServer 的 context；调用方应在退出时 await dispose()
 */
export async function registerIpcHandlers(
  options: RegisterIpcHandlersOptions = {},
): Promise<MainProcessContext> {
  const serialDiscovery = new SerialDiscovery();
  const sessionManager = new SessionManager();
  const workspaceConfigManager = new WorkspaceConfigManager({
    evidenceFn: async () => ({
      serialPorts: await serialDiscovery.listPorts(),
    }),
  });
  const controlProfileManager = new ControlProfileManager();
  const connectionProfileManager = new ConnectionProfileManager({
    filePath: path.join(app.getPath('userData'), 'connections.json'),
    secretCodec: new SafeStorageSecretCodec(),
  });
  const agentIntegrationManager = new AgentIntegrationManager({
    targets: buildDefaultAgentIntegrationTargets(),
    launchConfig: buildLinkTermMcpLaunchConfig(),
  });
  const jlinkBackend: IJLinkBackend = new JLinkAdapter();
  const controlWorkflowJobManager = new ControlWorkflowJobManager();

  const uiBridge = createUiBridge(() =>
    BrowserWindow.getAllWindows().map((w) => w.webContents),
  );

  const getMainWindow = options.getMainWindow;
  const getActiveWindow: () => CapturableWindow | null = getMainWindow
    ? () => {
        const win = getMainWindow();
        return win && !win.isDestroyed() ? win : null;
      }
    : () => null;

  const metadataPath = runtimeMetadataPath(app.getPath('userData'));
  const ownerRuntimeDiagnostics = createRuntimeDiagnosticsProvider({
    transportMode: 'http-owner',
    metadataPath,
  });
  const directStdioRuntimeDiagnostics = createRuntimeDiagnosticsProvider({
    transportMode: 'direct-stdio',
    metadataPath,
  });

  const mcpServer = createMcpServer({
    sessionManager,
    serialDiscovery,
    workspaceConfigManager,
    workspaceEvidenceFn: async () => ({
      serialPorts: await serialDiscovery.listPorts(),
    }),
    controlProfileManager,
    controlWorkflowJobManager,
    jlinkBackend,
    uiBridge,
    getActiveWindow,
    runtimeDiagnostics: directStdioRuntimeDiagnostics,
  });

  const mcpHttpServer = await startMcpHttpRuntimeServer({
    sessionManager,
    serialDiscovery,
    workspaceConfigManager,
    workspaceEvidenceFn: async () => ({
      serialPorts: await serialDiscovery.listPorts(),
    }),
    controlProfileManager,
    controlWorkflowJobManager,
    jlinkBackend,
    uiBridge,
    getActiveWindow,
    runtimeDiagnostics: ownerRuntimeDiagnostics,
    metadataPath,
  });

  const unregisterSerial = registerSerialIpc(serialDiscovery);
  const unregisterSession = registerSessionIpc(sessionManager);
  const unregisterSessionCreate = registerSessionCreate(sessionManager);
  const unregisterRttLogSession = registerRttLogSessionIpc(sessionManager, jlinkBackend);
  const unregisterConnectionProfiles = registerConnectionProfilesIpc(
    sessionManager,
    connectionProfileManager,
  );
  const unregisterAgentIntegrations = registerAgentIntegrationsIpc(
    agentIntegrationManager,
  );
  const unregisterControlProfile = registerControlProfileIpc(controlProfileManager);

  const shouldAutoStart =
    options.autoStartMcp ?? process.env.LINKTERM_MCP_STDIO === '1';
  if (shouldAutoStart) {
    try {
      await mcpServer.start();
    } catch (err) {
      // 回滚已注册的 IPC handler 与 SerialDiscovery，避免重复 register / handler 泄漏
      unregisterSerial();
      unregisterSession();
      unregisterSessionCreate();
      unregisterRttLogSession();
      unregisterConnectionProfiles();
      unregisterAgentIntegrations();
      unregisterControlProfile();
      await mcpHttpServer.close().catch(() => undefined);
      serialDiscovery.dispose();
      throw err;
    }
  }

  const dispose = async (): Promise<void> => {
    unregisterSerial();
    unregisterSession();
    unregisterSessionCreate();
    unregisterRttLogSession();
    unregisterConnectionProfiles();
    unregisterAgentIntegrations();
    unregisterControlProfile();
    // 先停 MCP，避免 destroyAll 期间还有新工具调用进来
    await mcpServer.stop().catch(() => undefined);
    await mcpHttpServer.close().catch(() => undefined);
    await sessionManager.destroyAll().catch(() => undefined);
    serialDiscovery.dispose();
  };

  return {
    serialDiscovery,
    sessionManager,
    workspaceConfigManager,
    controlProfileManager,
    connectionProfileManager,
    agentIntegrationManager,
    jlinkBackend,
    controlWorkflowJobManager,
    mcpServer,
    mcpHttpServer,
    dispose,
  };
}

/**
 * Build the default local Agent configuration targets that LinkTerm can install into.
 *
 * @returns Supported Agent config file targets for the current OS user.
 */
function buildDefaultAgentIntegrationTargets(): AgentIntegrationTarget[] {
  const appData = app.getPath('appData');
  const home = app.getPath('home');
  return [
    {
      id: 'vscode',
      label: 'VS Code Copilot',
      configPath: path.join(appData, 'Code', 'User', 'mcp.json'),
      configKind: 'vscode-mcp-json',
    },
    {
      id: 'claude-desktop',
      label: 'Claude Desktop',
      configPath: path.join(appData, 'Claude', 'claude_desktop_config.json'),
      configKind: 'mcp-servers',
    },
    {
      id: 'cursor',
      label: 'Cursor',
      configPath: path.join(home, '.cursor', 'mcp.json'),
      configKind: 'mcp-servers',
    },
  ];
}

/**
 * Build the stdio launch command external Agents should use to start LinkTerm MCP.
 *
 * @returns Launch configuration with MCP stdio enabled.
 */
function buildLinkTermMcpLaunchConfig(): LinkTermMcpLaunchConfig {
  return buildElectronMcpLaunchConfig({
    runtimePath: process.execPath,
    metadataPath: runtimeMetadataPath(app.getPath('userData')),
    launcherPath: electronRuntimeLauncherPath(),
    appPath: app.isPackaged ? undefined : app.getAppPath(),
  });
}

/**
 * Resolve the compiled launcher script used to clear Electron Node-mode before MCP runtime startup.
 *
 * @returns Absolute path to the launcher script in development or packaged builds.
 */
function electronRuntimeLauncherPath(): string {
  const relativeLauncherPath = path.join('dist', 'main', 'mcp', 'electron-runtime-launcher.js');
  return app.isPackaged
    ? path.join(process.resourcesPath, 'app.asar', relativeLauncherPath)
    : path.join(app.getAppPath(), relativeLauncherPath);
}

