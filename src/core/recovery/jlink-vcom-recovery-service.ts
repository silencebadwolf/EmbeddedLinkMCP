import type { SerialPortInfo, SessionState } from '../../shared/types.js';
import type { SerialDiscovery } from '../../transports/serial/serial-discovery.js';
import type { IJLinkBackend, ProbeInfo } from '../../jlink/types.js';
import type { IJLinkVcomControl, VcomInspection } from '../../jlink/vcom-types.js';
import type { ControlProfileManager } from '../workspace/control-profile-manager.js';
import type { ControlProfileRecordManager } from '../workspace/control-profile-record-manager.js';
import type { ControlProfileRecord } from '../workspace/control-profile-record-types.js';
import {
  deriveStableSerialIdentity,
  findStableSerialIdentity,
} from '../readiness/serial-identity.js';

export type JLinkVcomRecoveryStatus =
  | 'already-available'
  | 'replacement-opened'
  | 'recovered'
  | 'power-cycle-required';

export interface JLinkVcomRecoveryResult {
  status: JLinkVcomRecoveryStatus;
  inspection?: VcomInspection;
  record: ControlProfileRecord;
  port?: string;
  sessionId?: string;
  sessionState?: SessionState;
  firmwareUpdateObserved: boolean;
}

export class JLinkVcomRecoveryError extends Error {
  constructor(
    readonly code:
      | 'JLINK_VCOM_REQUIRES_SWD'
      | 'JLINK_PROBE_NOT_FOUND'
      | 'JLINK_PROBE_SELECTION_REQUIRED'
      | 'JLINK_VCOM_UNSUPPORTED'
      | 'JLINK_VCOM_STATE_UNKNOWN'
      | 'JLINK_VCOM_PORT_AMBIGUOUS'
      | 'JLINK_SERIAL_PROFILE_REQUIRED',
    message: string,
  ) {
    super(message);
    this.name = 'JLinkVcomRecoveryError';
  }
}

export interface JLinkVcomRecoveryServiceOptions {
  controlProfileManager: ControlProfileManager;
  recordManager: ControlProfileRecordManager;
  serialDiscovery: Pick<SerialDiscovery, 'listPorts'>;
  jlinkBackend: Pick<IJLinkBackend, 'probeDetect'>;
  vcomControl: IJLinkVcomControl;
  openSerial: (input: {
    port: string;
    baudRate: number;
    mode: 'normal' | 'terminal';
    label: string;
  }) => Promise<{ sessionId: string; state: SessionState }>;
  timeoutMs?: number;
  pollIntervalMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

/** 显式 J-Link VCOM 恢复服务；构造函数不扫描、不连接也不修改硬件。 */
export class JLinkVcomRecoveryService {
  readonly #options: JLinkVcomRecoveryServiceOptions;

  constructor(options: JLinkVcomRecoveryServiceOptions) {
    this.#options = options;
  }

  /** 恢复指定工作区记录的串口，并在唯一识别成功后原位更新记录、打开新会话。 */
  async recover(input: {
    recordId: string;
    expectedUpdatedAt: string;
  }): Promise<JLinkVcomRecoveryResult> {
    const record = await this.#options.recordManager.get(input.recordId);
    const serial = record.profile.serial;
    if (serial?.enabled !== true || serial.port === undefined) {
      throw new JLinkVcomRecoveryError(
        'JLINK_SERIAL_PROFILE_REQUIRED',
        'The saved workspace does not contain an enabled serial profile',
      );
    }
    if (record.profile.jlink?.interface !== 'swd') {
      throw new JLinkVcomRecoveryError(
        'JLINK_VCOM_REQUIRES_SWD',
        'SEGGER J-Link VCOM requires the workspace debug interface to be SWD',
      );
    }

    const before = await this.#options.serialDiscovery.listPorts();
    const existing = before.find((port) => port.path === serial.port);
    if (existing !== undefined) {
      const opened = await this.#openAndPersist(record, existing.path, input.expectedUpdatedAt);
      return { status: 'already-available', ...opened };
    }

    const trustedReplacement = this.#findTrustedReplacement(record, before);
    if (trustedReplacement !== undefined) {
      const opened = await this.#openAndPersist(
        record,
        trustedReplacement.path,
        input.expectedUpdatedAt,
      );
      return { status: 'replacement-opened', ...opened };
    }
    if (before.some(isSeggerCdcPort)) {
      throw new JLinkVcomRecoveryError(
        'JLINK_VCOM_PORT_AMBIGUOUS',
        'A SEGGER CDC port is already present but does not match the saved identity; select it manually',
      );
    }

    const probe = await this.#selectSingleProbe();
    const selector = probe.serialNumber ? { serialNumber: probe.serialNumber } : undefined;
    const inspection = await this.#options.vcomControl.inspectVcom(selector);
    if (!inspection.supported) {
      throw new JLinkVcomRecoveryError(
        'JLINK_VCOM_UNSUPPORTED',
        'The selected J-Link probe does not report VCOM support',
      );
    }
    if (inspection.state === 'enabled') {
      return {
        status: 'power-cycle-required',
        inspection,
        record,
        firmwareUpdateObserved: inspection.firmwareUpdateObserved,
      };
    }
    if (inspection.state !== 'disabled') {
      throw new JLinkVcomRecoveryError(
        'JLINK_VCOM_STATE_UNKNOWN',
        'J-Link Commander did not report whether VCOM is enabled or disabled',
      );
    }

    const change = await this.#options.vcomControl.setVcomEnabled(selector, true);
    const after = await this.#waitForReenumeration(before);
    const newPorts = after.filter(
      (port) => !before.some((previous) => previous.path === port.path) && isSeggerCdcPort(port),
    );
    if (newPorts.length === 0) {
      return {
        status: 'power-cycle-required',
        inspection,
        record,
        firmwareUpdateObserved: inspection.firmwareUpdateObserved || change.firmwareUpdateObserved,
      };
    }
    if (newPorts.length !== 1) {
      throw new JLinkVcomRecoveryError(
        'JLINK_VCOM_PORT_AMBIGUOUS',
        'More than one new SEGGER CDC port appeared; select the port manually',
      );
    }
    const opened = await this.#openAndPersist(record, newPorts[0]!.path, input.expectedUpdatedAt);
    return {
      status: 'recovered',
      inspection,
      ...opened,
      firmwareUpdateObserved: inspection.firmwareUpdateObserved || change.firmwareUpdateObserved,
    };
  }

  async #selectSingleProbe(): Promise<ProbeInfo> {
    const probes = await this.#options.jlinkBackend.probeDetect();
    if (probes.length === 0) {
      throw new JLinkVcomRecoveryError('JLINK_PROBE_NOT_FOUND', 'No J-Link probe was detected');
    }
    if (probes.length !== 1) {
      throw new JLinkVcomRecoveryError(
        'JLINK_PROBE_SELECTION_REQUIRED',
        'More than one J-Link probe is connected; select one before enabling VCOM',
      );
    }
    return probes[0]!;
  }

  #findTrustedReplacement(
    record: ControlProfileRecord,
    ports: readonly SerialPortInfo[],
  ): SerialPortInfo | undefined {
    const saved = record.profile.serial;
    if (saved === undefined) return undefined;
    const matches = ports.filter((port) => {
      const identity = deriveStableSerialIdentity(port);
      return (
        (saved.hardwareIdentity !== undefined &&
          identity.hardwareIdentity === saved.hardwareIdentity) ||
        (saved.parentIdentity !== undefined && identity.parentIdentity === saved.parentIdentity)
      );
    });
    return matches.length === 1 ? matches[0] : undefined;
  }

  async #waitForReenumeration(
    before: readonly SerialPortInfo[],
  ): Promise<readonly SerialPortInfo[]> {
    const timeoutMs = this.#options.timeoutMs ?? 10_000;
    const pollIntervalMs = this.#options.pollIntervalMs ?? 250;
    const sleep =
      this.#options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    const deadline = Date.now() + timeoutMs;
    let latest = before;
    while (Date.now() < deadline) {
      await sleep(pollIntervalMs);
      latest = await this.#options.serialDiscovery.listPorts();
      if (latest.some((port) => !before.some((previous) => previous.path === port.path))) break;
    }
    return latest;
  }

  async #openAndPersist(
    record: ControlProfileRecord,
    port: string,
    expectedUpdatedAt: string,
  ): Promise<{
    record: ControlProfileRecord;
    port: string;
    sessionId: string;
    sessionState: SessionState;
    firmwareUpdateObserved: false;
  }> {
    const serial = record.profile.serial!;
    const identity = findStableSerialIdentity(
      port,
      await this.#options.serialDiscovery.listPorts(),
    );
    // 先证明新端口可打开，再持久化替换；打开失败时原配置保持不变。
    const opened = await this.#options.openSerial({
      port,
      baudRate: serial.baudRate ?? 115_200,
      mode: serial.mode ?? 'terminal',
      label: record.label,
    });
    const profile = { ...record.profile, serial: { ...serial, port, ...(identity ?? {}) } };
    const savedProfile = await this.#options.controlProfileManager.init(
      record.root,
      {
        ...(profile.serial ? { serial: profile.serial } : {}),
        ...(profile.jlink ? { jlink: profile.jlink } : {}),
        ...(profile.flash ? { flash: profile.flash } : {}),
        ...(profile.rtt ? { rtt: profile.rtt } : {}),
      },
      { force: true },
    );
    const updated = await this.#options.recordManager.save({
      recordId: record.id,
      expectedUpdatedAt,
      root: record.root,
      source: 'manual',
      label: record.label,
      profile: savedProfile,
    });
    return {
      record: updated,
      port,
      sessionId: opened.sessionId,
      sessionState: opened.state,
      firmwareUpdateObserved: false,
    };
  }
}

function isSeggerCdcPort(port: SerialPortInfo): boolean {
  const text = `${port.manufacturer ?? ''} ${port.friendlyName ?? ''} ${port.pnpId ?? ''}`;
  return port.vendorId?.toLowerCase() === '1366' || /\b(?:segger|j-?link)\b/iu.test(text);
}
