/** Electron transport adapter for shared runtime client services. */
import { registerAuditIpc as registerService } from '@linkterm/runtime/services/client/audit-ipc';
import { desktopClientHost } from '../../platform/client-host.js';
export * from '@linkterm/runtime/services/client/audit-ipc';
type ServiceArgs = Parameters<typeof registerService> extends [unknown, ...infer Rest] ? Rest : never;
export function registerAuditIpc(...args: ServiceArgs): () => void {
  return registerService(desktopClientHost, ...args);
}
