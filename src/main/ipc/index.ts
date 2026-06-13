/**
 * 注册所有主进程 ↔ 渲染进程的 IPC handler。
 *
 * 占位实现：实际 handler 在 Phase 5 接入（session-ipc.ts / serial-ipc.ts / ui-ipc.ts）。
 * 调用约定：在 `app.whenReady()` 后调用，确保 ipcMain.handle 注册早于第一次 invoke。
 */
export function registerIpcHandlers(): void {
  // Phase 5 起：
  //   import { registerSessionIpc } from './session-ipc.js';
  //   registerSessionIpc(sessionManager);
}
