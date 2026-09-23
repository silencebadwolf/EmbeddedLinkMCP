import type { ClientServiceHost } from './ports.js';

import type { SessionManager } from '../../core/session/session-manager.js';
import type { ControlProfileManager, HostPathResolver } from '../../core/workspace/index.js';
import type { IJLinkBackend } from '../../jlink/types.js';
import type { JLinkDeviceCatalog } from '../../jlink/device-catalog.js';
import { CLIENT_CHANNELS as IPC_CHANNELS } from '@linkterm/contracts/client-protocol';
import type {
  PreloadFail,
  PreloadResult,
  RttLogOpenRequestPayload,
  RttLogOpenSuccess,
} from '@linkterm/contracts/preload-api';
import { openRttLogFromRequest, rttLogOpenErrorCodeOf } from './rtt-log-open-helper.js';

/** 注册 renderer 可调用的 RTT 日志会话 IPC handler。 */
export function registerRttLogSessionIpc(
  host: ClientServiceHost,
  sessionManager: SessionManager,
  jlinkBackend: IJLinkBackend,
  controlProfileManager?: ControlProfileManager,
  jlinkDeviceCatalog?: JLinkDeviceCatalog,
  hostPathResolver?: HostPathResolver,
): () => void {
  const ipcMain = host.requests;

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
