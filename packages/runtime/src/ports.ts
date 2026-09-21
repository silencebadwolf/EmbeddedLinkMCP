import type { AgentIntegrationManager } from './core/agent-integrations/index.js';
import type { SecretCodec } from './core/connections/types.js';
import type { SessionBuilder } from './core/session/factory.js';
import type { SerialPortInfo } from '@linkterm/contracts/types';
import type { IJLinkBackend } from './jlink/types.js';
import type { IJLinkVcomControl } from './jlink/vcom-types.js';
import type { JLinkDeviceCatalog } from './jlink/device-catalog.js';
import type { PtyFactory } from './transports/local-shell/pty-like.js';
import type { SerialPortFactory } from './transports/serial/serial-port-like.js';

/** The owning process supplies bindings compiled for its own Node/Electron ABI. */
export interface RuntimeNativeBindings {
  readonly createSerialPort: SerialPortFactory;
  readonly listSerialPorts: () => Promise<readonly SerialPortInfo[]>;
  readonly createPty: PtyFactory;
}

export interface RuntimeStatus {
  readonly codeFresh: boolean;
  readonly runtimeFresh: boolean;
}

export interface RuntimeOptions {
  readonly dataDir: string;
  readonly nativeBindings: RuntimeNativeBindings;
  readonly secretCodec: SecretCodec;
  readonly sessionFactory?: SessionBuilder;
  readonly agentIntegrations?: Pick<AgentIntegrationManager, 'listStatuses'>;
  readonly getRuntimeStatus?: () => Promise<RuntimeStatus>;
  readonly jlinkBackend?: IJLinkBackend;
  readonly vcomControl?: IJLinkVcomControl;
  readonly jlinkDeviceCatalog?: JLinkDeviceCatalog;
  /** Injected backends retain ownership unless an explicit disposer is supplied. */
  readonly disposeJLinkBackend?: () => Promise<void>;
}
