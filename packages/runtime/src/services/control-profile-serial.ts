import type {
  ControlProfileOpenSerial,
  ControlProfileSerialActivation,
} from '../core/control-workflow/types.js';
import type { SessionManager } from '../core/session/session-manager.js';
import { SerialSessionCoordinator } from '../core/session/serial-session-coordinator.js';
import { buildSession } from '../core/session/factory.js';
import type { SerialSessionConfig } from '@linkterm/contracts/types';
import type { SessionCreateRequestConfig } from '@linkterm/contracts/preload-api';

/**
 * 构造默认串口激活函数。
 *
 * @param sessionManager 主进程共享 SessionManager
 * @returns 可打开串口 session 的函数
 */
export function defaultOpenSerial(
  sessionManager: SessionManager,
  serialSessionCoordinator: SerialSessionCoordinator = new SerialSessionCoordinator(sessionManager),
): ControlProfileOpenSerial {
  return async (config: SerialSessionConfig): Promise<ControlProfileSerialActivation> => {
    const createConfig = config as SessionCreateRequestConfig;
    return serialSessionCoordinator.openOrReuse(config, async () => {
      const session = await sessionManager.createAndOpen(
        (id) => (sessionManager.sessionFactory ?? buildSession)(id, createConfig),
        {
          connectionType: 'serial',
          label: config.label,
          createdBy: 'ai',
          serial: { port: config.port, baudRate: config.baudRate, mode: config.mode },
        },
      );
      return { sessionId: session.id, state: session.state };
    });
  };
}
