/** Pure conflict detection between persisted config and live hardware evidence. */

import type { SerialPortInfo } from '../../shared/types.js';
import { REQUIRED_FIELDS, type RequiredField } from './types.js';
import type { WorkspaceConfig } from './types.js';

/**
 * 当前可观测到的硬件证据快照。
 *
 * 后续 Phase 9 加入 J-Link 后会扩展此结构（probes / rttChannels 等），
 * 因此 caller 总是把整个 snapshot 完整传入而非按字段。
 */
export interface EvidenceSnapshot {
  /** 当前枚举到的串口列表（来自 SerialDiscovery.listPorts）。 */
  serialPorts: readonly SerialPortInfo[];
}

/** 单条冲突描述。 */
export interface Conflict {
  /** 冲突字段路径（点分），如 'serial.port'。 */
  field: string;
  /** 配置值（持久化里写的）。 */
  configured: unknown;
  /** 实际观测值（硬件证据），找不到时为 null。 */
  actual: unknown;
  /** 严重度：warn 仅提示，error 由 caller 视情况升级为 WorkspaceConflictError。 */
  severity: 'warn' | 'error';
  /** 人类可读说明，便于 MCP 客户端直接展示。 */
  message: string;
}

/** detectConflicts 的输出结构。 */
export interface ConflictReport {
  conflicts: Conflict[];
  /** 5 类必填字段中尚未填写的字段名列表。 */
  missingFields: RequiredField[];
}

/**
 * 计算工作区配置与硬件证据的冲突报告。
 *
 * @param config 已通过 schema 校验的工作区配置
 * @param evidence 当前硬件证据快照
 * @returns 结构化冲突报告
 */
export function detectConflicts(
  config: WorkspaceConfig,
  evidence: EvidenceSnapshot,
): ConflictReport {
  const conflicts: Conflict[] = [];

  // 串口冲突：配置中 serial.port 必须能在当前枚举到的端口列表中找到对应路径。
  if (config.serial !== undefined) {
    const configuredPort = config.serial.port;
    const found = evidence.serialPorts.some((p) => p.path === configuredPort);
    if (!found) {
      conflicts.push({
        field: 'serial.port',
        configured: configuredPort,
        actual: null,
        // Phase 8 暂统一 warn —— 不强制阻塞写入，让 caller 自行决定。
        severity: 'warn',
        message:
          `Configured serial port "${configuredPort}" is not present in the current ` +
          `enumeration of ${evidence.serialPorts.length} port(s).`,
      });
    }
  }

  // 缺失字段：5 类必填字段未配置时列出。
  const missingFields = REQUIRED_FIELDS.filter((k) => config[k] === undefined);

  return { conflicts, missingFields };
}
