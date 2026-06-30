import { electron } from '../electron-runtime.js';
import { IPC_CHANNELS } from '../../shared/ipc-protocol.js';
import type { SerialPortInfo } from '../../shared/types.js';
import type { SerialDiscovery } from '../../transports/serial/serial-discovery.js';
import type { PreloadResult } from '../../shared/preload-api.js';
import { ERROR_CODES } from '../../shared/error-codes.js';

const { BrowserWindow, ipcMain } = electron;

/**
 * 注册串口相关 IPC handler 与广播。
 *
 * - `serial:listPorts` （invoke）：渲染端按需拉取一次端口列表。
 * - `serial:portChanged` （send）：主进程把 SerialDiscovery 的 'change' 事件
 *   广播给所有 BrowserWindow，无订阅者时 SerialDiscovery 自动停轮询。
 *
 * Phase 2 内 IPC 仅服务于 Phase 6 的 UI；本函数只做"薄壳"，不在此引入业务逻辑。
 *
 * Phase 6 评审 M2：原 `serial:listPorts` 是裸返 Promise，主进程侧抛错会变成
 * `ipcRenderer.invoke` 的 reject，渲染端拿到的是 stack dump。统一壳让所有 IPC
 * 入口错误处理路径一致。
 *
 * @returns 反注册函数：移除 ipcMain handler 与 discovery 监听器（用于退出/测试 teardown）
 */
export function registerSerialIpc(discovery: SerialDiscovery): () => void {
  ipcMain.handle(
    IPC_CHANNELS.SERIAL_LIST_PORTS,
    async (): Promise<PreloadResult<ReadonlyArray<SerialPortInfo>>> => {
      try {
        const ports = await discovery.listPorts();
        return { success: true, data: ports };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { success: false, error: { code: ERROR_CODES.INTERNAL, message } };
      }
    },
  );

  const onChange = (ports: readonly SerialPortInfo[]): void => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send(IPC_CHANNELS.SERIAL_PORT_CHANGED, ports);
      }
    }
  };
  discovery.on('change', onChange);

  return () => {
    ipcMain.removeHandler(IPC_CHANNELS.SERIAL_LIST_PORTS);
    discovery.off('change', onChange);
  };
}
