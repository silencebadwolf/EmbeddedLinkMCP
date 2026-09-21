import type { UiStoreBridge } from '@linkterm/mcp/surfaces/ui/types';
import { IPC_CHANNELS } from '../../shared/ipc-protocol.js';
import type { UiStatePatch } from '../../shared/preload-api.js';

/**
 * 抽象 webContents.send 接口；测试通过自定义实现注入 fake，避免依赖 Electron。
 */
export interface UiPatchTarget {
  isDestroyed(): boolean;
  send(channel: string, ...args: unknown[]): void;
}

/**
 * Phase 10：构造 UI patch 主→渲染广播桥。
 *
 * 通过 thunk 暴露当前 webContents 集合，便于在测试中注入 fake；
 * `send` 抛错（如 isDestroyed 检查与 send 之间窗口被销毁）时静默吞咽，
 * 不影响其余 wc 的派发。
 *
 * @param getTargets 返回当前所有候选 webContents 的 thunk
 * @returns 实现 {@link UiStoreBridge} 的桥对象
 */
export function createUiBridge(
  getTargets: () => readonly UiPatchTarget[],
): UiStoreBridge {
  return {
    applyPatch: (patch: UiStatePatch): void => {
      for (const wc of getTargets()) {
        if (wc.isDestroyed()) continue;
        try {
          wc.send(IPC_CHANNELS.UI_STATE_PATCH, patch);
        } catch {
          // wc 在 isDestroyed 检查与 send 之间被销毁；忽略本次，不影响后续
        }
      }
    },
  };
}
