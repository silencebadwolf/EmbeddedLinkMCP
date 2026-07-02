/** Types for workspace-local LinkTerm control profile. */

/** 当前 control-profile.json schema 版本。 */
export const CONTROL_PROFILE_SCHEMA_VERSION = 'linkterm-control/1.0.0' as const;

/** 串口快速拉起配置。 */
export interface ControlSerialProfile {
  enabled: boolean;
  port?: string;
  baudRate?: number;
  mode?: 'normal' | 'terminal';
}

/** J-Link probe 连接配置；不保存序列号或凭据类字段。 */
export interface ControlJLinkProfile {
  enabled: boolean;
  target?: string;
  interface?: 'swd' | 'jtag';
  speedKHz?: number | 'auto';
}

/** Flash 事实配置。激活工具只读取并返回，不执行烧录。 */
export interface ControlFlashProfile {
  binary?: string;
  baseAddress?: string;
  verify?: boolean;
}

/** RTT 快速拉起配置。 */
export interface ControlRttProfile {
  enabled: boolean;
  channels?: number[];
  controlBlockAddress?: string;
}

/** 工作区本地控制配置。 */
export interface ControlProfile {
  schemaVersion: typeof CONTROL_PROFILE_SCHEMA_VERSION;
  serial?: ControlSerialProfile;
  jlink?: ControlJLinkProfile;
  flash?: ControlFlashProfile;
  rtt?: ControlRttProfile;
}
