/** 类型定义：高层控制工作流的结构化输出。 */

import type { SerialSessionConfig, SessionState } from '@linkterm/contracts/types';
import type { ToolErrorCode } from '../errors.js';
import type { ControlWorkflowMode } from './input.js';
export type { ControlWorkflowMode } from './input.js';

/** run_control_workflow 支持的模式。 */


/** 单个工作流步骤的状态。 */
export type ControlWorkflowStepStatus = 'running' | 'passed' | 'failed' | 'skipped';

/** 工作流内部用于减少 AI 文本推理的稳定失败分类。 */
export type ControlWorkflowFailureCode =
  | 'flash_ram_preserve_failed'
  | 'flash_sector_erase_timeout'
  | 'flash_verify_failed'
  | 'probe_not_found'
  | 'rtt_connect_failed'
  | 'target_rejected'
  | 'command_timeout'
  | 'capability_not_implemented'
  | 'jlink_operation_failed';

/** 工作流步骤结构化记录。 */
export interface ControlWorkflowStep {
  id: string;
  status: ControlWorkflowStepStatus;
  durationMs: number;
  evidence?: unknown;
  error?: {
    code: ToolErrorCode;
    message: string;
    failureCode?: ControlWorkflowFailureCode;
    details?: Readonly<Record<string, unknown>>;
  };
}

/** 工作流阻塞原因。 */
export interface ControlWorkflowBlockingReason {
  kind:
    | 'jlink_commander_unavailable'
    | 'jlink_gdb_server_unavailable'
    | 'jlink_gdb_server_start_failed'
    | 'jlink_target_unsupported'
    | 'jlink_target_not_in_catalog'
    | 'serial_open_failed';
  code: ToolErrorCode;
  message: string;
  details?: Readonly<Record<string, unknown>>;
}

/** 工作流下一步建议。 */
export interface ControlWorkflowNextAction {
  kind: 'retry' | 'user_action' | 'diagnose' | 'stop';
  message: string;
  tool?: string;
  argsPatch?: Readonly<Record<string, unknown>>;
  requiresConfirm?: boolean;
}

/** 工作流摘要。 */
export interface ControlWorkflowSummary {
  serialOpened: boolean;
  probeConnected: boolean;
  gdbServerStarted: boolean;
  flashed: boolean;
  verified: boolean;
  reset: boolean;
  serialObserved: boolean;
  rttObserved: boolean;
  debugCaptured: boolean;
}

/** run_control_workflow evidence.data 结构。 */
export interface ControlWorkflowData {
  mode: ControlWorkflowMode;
  root: string;
  failedStep?: string;
  failureCode?: ControlWorkflowFailureCode;
  steps: ControlWorkflowStep[];
  summary: ControlWorkflowSummary;
  blockingReasons?: ControlWorkflowBlockingReason[];
  nextActions: ControlWorkflowNextAction[];
}



/** activate_control_profile 打开串口后的最小结果。 */
export interface ControlProfileSerialActivation {
  sessionId: string;
  state: SessionState;
  reused?: boolean;
}


/** 串口激活函数；测试可注入 fake，生产默认走 SessionManager + buildSession。 */
export type ControlProfileOpenSerial = (
  config: SerialSessionConfig,
) => Promise<ControlProfileSerialActivation>;
