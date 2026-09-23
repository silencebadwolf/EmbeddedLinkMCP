import type { Runtime } from '../../create-runtime.js';
import type { AgentIntegrationManager } from '../../core/agent-integrations/index.js';
import { findStableSerialIdentity } from '../../core/readiness/serial-identity.js';
import type { ClientServiceHost } from './ports.js';
import { registerActivityIpc } from './activity-ipc.js';
import { registerAgentIntegrationsIpc } from './agent-integrations-ipc.js';
import { registerAuditIpc } from './audit-ipc.js';
import { registerConnectionProfilesIpc } from './connection-profiles-ipc.js';
import { registerControlProfileIpc } from './control-profile-ipc.js';
import { registerFirstSignalIpc } from './first-signal-ipc.js';
import { registerJLinkDeviceCatalogIpc } from './jlink-device-catalog-ipc.js';
import { registerReadinessIpc } from './readiness-ipc.js';
import { registerRttLogSessionIpc } from './rtt-log-session-ipc.js';
import { registerSerialIpc } from './serial-ipc.js';
import { registerSessionCreate } from './session-create-handler.js';
import { registerSessionIpc } from './session-ipc.js';

/** Register the same business services for every authenticated host client. */
export function registerRuntimeClientServices(
  runtime: Runtime,
  host: ClientServiceHost,
  options: {
    readonly agentIntegrationManager: AgentIntegrationManager;
    readonly isTrustedPeer: (id: number) => boolean;
  },
): () => void {
  const dispose: Array<() => void> = [];
  const close = (): void => {
    for (const off of dispose.splice(0).reverse()) off();
  };
  try {
    dispose.push(registerSerialIpc(host, runtime.serialDiscovery));
    dispose.push(registerSessionIpc(host, runtime.sessionManager));
    dispose.push(
      registerSessionCreate(host, runtime.sessionManager, runtime.serialSessionCoordinator),
    );
    dispose.push(
      registerRttLogSessionIpc(
        host,
        runtime.sessionManager,
        runtime.jlinkBackend,
        runtime.controlProfileManager,
        runtime.jlinkDeviceCatalog,
      ),
    );
    dispose.push(
      registerConnectionProfilesIpc(
        host,
        runtime.sessionManager,
        runtime.connectionProfileManager,
        runtime.jlinkBackend,
        runtime.controlProfileManager,
        runtime.jlinkDeviceCatalog,
        undefined,
        runtime.serialSessionCoordinator,
        async (portPath) =>
          findStableSerialIdentity(portPath, await runtime.serialDiscovery.listPorts()),
      ),
    );
    dispose.push(registerAgentIntegrationsIpc(host, options.agentIntegrationManager));
    dispose.push(
      registerControlProfileIpc(
        host,
        runtime.controlProfileManager,
        runtime.controlProfileRecordManager,
        runtime,
      ),
    );
    dispose.push(registerJLinkDeviceCatalogIpc(host, runtime.jlinkDeviceCatalog));
    dispose.push(registerActivityIpc(host, runtime.operationLedger));
    dispose.push(
      registerAuditIpc(host, {
        auditStore: runtime.auditStore,
        isTrustedSender: options.isTrustedPeer,
      }),
    );
    dispose.push(registerReadinessIpc(host, runtime.runtimeReadinessService));
    dispose.push(registerFirstSignalIpc(host, runtime.firstSignalObservationService));
    return close;
  } catch (error) {
    close();
    throw error;
  }
}

export type {
  ClientServiceHost,
  ClientPeer,
  ClientRequestRegistry,
  ClientInvocation,
} from './ports.js';
