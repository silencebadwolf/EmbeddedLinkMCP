/** Electron transport adapter for shared runtime client services. */
import { registerRttLogSessionIpc as registerService } from '@linkterm/runtime/services/client/rtt-log-session-ipc';
import { desktopClientHost } from '../../platform/client-host.js';
export * from '@linkterm/runtime/services/client/rtt-log-session-ipc';
type ServiceArgs = Parameters<typeof registerService> extends [unknown, ...infer Rest] ? Rest : never;
export function registerRttLogSessionIpc(...args: ServiceArgs): () => void {
  return registerService(desktopClientHost, ...args);
}
