import { SerialDiscovery } from '../../transports/serial/serial-discovery.js';
import { registerSerialIpc } from './serial-ipc.js';

/**
 * 主进程持有的全局依赖容器：随 IPC handler 一起初始化、随退出统一清理。
 * Phase 5+ 会在此挂载 SessionManager / MCP server 等。
 */
export interface MainProcessContext {
  serialDiscovery: SerialDiscovery;
  /** 反注册所有 IPC handler；应用退出/测试 teardown 调用。 */
  dispose: () => void;
}

/**
 * 注册所有主进程 ↔ 渲染进程的 IPC handler，并返回拥有所有 main-side 状态的 context。
 *
 * 调用约定：在 `app.whenReady()` 后调用，确保 ipcMain.handle 注册早于第一次 invoke。
 */
export function registerIpcHandlers(): MainProcessContext {
  const serialDiscovery = new SerialDiscovery();
  const unregisterSerial = registerSerialIpc(serialDiscovery);

  const dispose = (): void => {
    unregisterSerial();
    serialDiscovery.dispose();
  };

  return { serialDiscovery, dispose };
}
