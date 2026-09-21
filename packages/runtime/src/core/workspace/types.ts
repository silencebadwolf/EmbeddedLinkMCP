/** Workspace config types. Schema-driven; credential keys are schema-rejected, not blocklisted here. */

import type { SerialMode } from '@linkterm/contracts/types';

/** 当前工作区配置文件 schema 版本。namespace 风格仿 LINKTERM_MCP_SCHEMA_VERSION。 */
export const WORKSPACE_SCHEMA_VERSION = 'linkterm-workspace/1.0.0';

/** 芯片型号配置。例如 STM32F4 系列、Nordic nRF52 系列等。 */
export interface ChipConfig {
  /** 厂商/系列名，如 'STM32F4' / 'nRF52'。 */
  family: string;
  /** 具体型号，如 'STM32F407VG' / 'nRF52840'。 */
  part: string;
}

/** 烧录工具配置。 */
export interface FlashConfig {
  /** 烧录工具名，如 'jlink' / 'openocd' / 'pyocd'。 */
  tool: string;
  /** 默认烧录二进制相对路径（可选）。 */
  binary?: string;
  /** 烧录基地址（可选；通常用于 .bin 而非 .hex/.elf）。 */
  baseAddress?: number;
}

/** 调试器配置。 */
export interface DebugConfig {
  /** 调试器后端，如 'jlink' / 'openocd' / 'pyocd'。 */
  tool: string;
  /** 连接方式描述，如 'swd' / 'jtag' / serial 编号字符串。 */
  connection?: string;
}

/** RTT（Real Time Transfer）配置。 */
export interface RttConfig {
  /** 是否启用 RTT。 */
  enabled: boolean;
  /** 通道索引（缺省所有通道）。 */
  channels?: number[];
}

/**
 * 工作区持久化的串口配置。
 *
 * 与 `SerialSessionConfig` 字段相似，但仅保留 5 个最常用字段；其余（dataBits/parity 等）
 * 走会话级临时覆盖，不持久化，避免配置文件膨胀。
 */
export interface SerialPersistedConfig {
  port: string;
  baudRate: number;
  mode: SerialMode;
}

/** 工作区根配置形态。 */
export interface WorkspaceConfig {
  schemaVersion: typeof WORKSPACE_SCHEMA_VERSION;
  chip?: ChipConfig;
  flash?: FlashConfig;
  debug?: DebugConfig;
  rtt?: RttConfig;
  serial?: SerialPersistedConfig;
}

/** 5 类必填字段名集合（用于 missingFields 计算）。 */
export const REQUIRED_FIELDS = ['chip', 'flash', 'debug', 'rtt', 'serial'] as const;

/** REQUIRED_FIELDS 元素的字符串字面量类型联合。 */
export type RequiredField = (typeof REQUIRED_FIELDS)[number];
