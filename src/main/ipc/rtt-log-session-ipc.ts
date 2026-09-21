import { electron } from '../electron-runtime.js';
import type { SessionManager } from '@linkterm/runtime/core/session/session-manager';
import type { ControlProfileManager, HostPathResolver } from '@linkterm/runtime/core/workspace/index';
import type { IJLinkBackend } from '@linkterm/runtime/jlink/types';
import type { JLinkDeviceCatalog } from '@linkterm/runtime/jlink/device-catalog';
import { IPC_CHANNELS } from '../../shared/ipc-protocol.js';
import type {
  PreloadFail,
  PreloadResult,
  RttLogOpenRequestPayload,
  RttLogOpenSuccess,
} from '../../shared/preload-api.js';
import {
  openRttLogFromRequest,
  rttLogOpenErrorCodeOf,
} from './rtt-log-open-helper.js';

const { ipcMain } = electron;

/** 注册 renderer 可调用的 RTT 日志会话 IPC handler。 */
export function registerRttLogSessionIpc(
  sessionManager: SessionManager,
  jlinkBackend: IJLinkBackend,
  controlProfileManager?: ControlProfileManager,
  jlinkDeviceCatalog?: JLinkDeviceCatalog,
  hostPathResolver?: HostPathResolver,
): () => void {
  ipcMain.handle(
    IPC_CHANNELS.RTT_LOG_OPEN,
    async (_event, raw: RttLogOpenRequestPayload): Promise<PreloadResult<RttLogOpenSuccess>> => {
      try {
        const result = await openRttLogFromRequest(raw, {
          sessionManager,
          jlinkBackend,
          controlProfileManager,
          jlinkDeviceCatalog,
          hostPathResolver,
        });
        return { success: true, data: result };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return failOf(rttLogOpenErrorCodeOf(err), message);
      }
    },
  );

  return () => {
    ipcMain.removeHandler(IPC_CHANNELS.RTT_LOG_OPEN);
  };
}

function failOf(code: string, message: string): PreloadFail {
  return { success: false, error: { code, message } };
}
