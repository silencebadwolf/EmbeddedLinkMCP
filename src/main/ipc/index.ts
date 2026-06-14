import { BrowserWindow } from 'electron';
import { SessionManager } from '../../core/session/session-manager.js';
import { WorkspaceConfigManager } from '../../core/workspace/index.js';
import { JLinkAdapter } from '../../jlink/index.js';
import type { IJLinkBackend } from '../../jlink/index.js';
import { createMcpServer, type LinkTermMcpServer } from '../../mcp/index.js';
import type { CapturableWindow } from '../../mcp/surfaces/ui/types.js';
import { SerialDiscovery } from '../../transports/serial/serial-discovery.js';
import { registerSerialIpc } from './serial-ipc.js';
import { registerSessionIpc } from './session-ipc.js';
import { registerSessionCreate } from './session-create-handler.js';
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
  /**
   * Phase 9：J-Link backend。当前仅 lifecycle 可用（probeConnect/disconnect/status
   * /detect），其余方法抛 NOT_IMPLEMENTED；Phase 13+ 替换为真实 SEGGER 适配器。
   */
  jlinkBackend: IJLinkBackend;
  mcpServer: LinkTermMcpServer;
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
   * 必须是 thunk —— 详见 `src/main/index.ts` `getMainWindow` JSDoc。
   */
  getMainWindow?: () => BrowserWindow | null;
}

/**
 * 注册所有主进程 ↔ 渲染进程的 IPC handler，并返回拥有所有 main-side 状态的 context。
 *
 * 启动失败保证：MCP server 启动抛错时，已注册的 IPC handler 会被回滚 ——
 * 否则下次 register 会撞 `ipcMain.handle` 的 \"already registered\"。
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
  const jlinkBackend: IJLinkBackend = new JLinkAdapter();

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

  const mcpServer = createMcpServer({
    sessionManager,
    serialDiscovery,
    workspaceConfigManager,
    workspaceEvidenceFn: async () => ({
      serialPorts: await serialDiscovery.listPorts(),
    }),
    jlinkBackend,
    uiBridge,
    getActiveWindow,
  });

  const unregisterSerial = registerSerialIpc(serialDiscovery);
  const unregisterSession = registerSessionIpc(sessionManager);
  const unregisterSessionCreate = registerSessionCreate(sessionManager);

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
      serialDiscovery.dispose();
      throw err;
    }
  }

  const dispose = async (): Promise<void> => {
    unregisterSerial();
    unregisterSession();
    unregisterSessionCreate();
    // 先停 MCP，避免 destroyAll 期间还有新工具调用进来
    await mcpServer.stop().catch(() => undefined);
    await sessionManager.destroyAll().catch(() => undefined);
    serialDiscovery.dispose();
  };

  return { serialDiscovery, sessionManager, workspaceConfigManager, jlinkBackend, mcpServer, dispose };
}

