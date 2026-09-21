/** Main-only physical probe selector; serialNumber must never cross the Renderer/MCP boundary. */
export interface ProbeSelector {
  serialNumber?: string;
}

export type VcomState = 'enabled' | 'disabled' | 'unknown';

export interface VcomInspection {
  supported: boolean;
  state: VcomState;
  requiresPowerCycle: true;
  firmwareUpdateObserved: boolean;
}

export interface VcomChangeResult {
  commandAccepted: true;
  enabled: boolean;
  requiresPowerCycle: true;
  firmwareUpdateObserved: boolean;
}

/** 独立于 IJLinkBackend 的探针维护接口；调用方必须显式发起。 */
export interface IJLinkVcomControl {
  inspectVcom(selector?: ProbeSelector, signal?: AbortSignal): Promise<VcomInspection>;
  setVcomEnabled(
    selector: ProbeSelector | undefined,
    enabled: boolean,
    signal?: AbortSignal,
  ): Promise<VcomChangeResult>;
}
