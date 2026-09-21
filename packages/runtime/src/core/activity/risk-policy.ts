import type {
  ActivitySurface,
  ApprovalPolicy,
  OperationRisk,
} from '@linkterm/contracts/activity-contract';
import type { ToolSensitivity } from './operation-sensitivity.js';

export type SourceToolSurface =
  | 'agent-runbook'
  | 'control-profile'
  | 'control-workflow'
  | 'debug'
  | 'jlink-device-catalog'
  | 'rtt-log-session'
  | 'runtime-control'
  | 'terminal'
  | 'ui'
  | 'workspace'
  | 'unknown';

export type RedactionProfile =
  | 'metadata-only'
  | 'runtime'
  | 'session'
  | 'workspace'
  | 'probe'
  | 'file'
  | 'job'
  | 'ui'
  | 'debug-payload';

export interface ToolObservationPolicy {
  readonly action: string;
  readonly sourceSurface: SourceToolSurface;
  readonly surface: ActivitySurface;
  readonly sensitivity: ToolSensitivity;
  readonly risk: OperationRisk;
  readonly approvalPolicy: ApprovalPolicy;
  readonly acknowledgement:
    | { readonly kind: 'none' }
    | { readonly kind: 'none' }
    | { readonly kind: 'none' };
  readonly redactionProfile: RedactionProfile;
}

export interface ResolvedToolObservationPolicy extends ToolObservationPolicy {
  readonly missingCurrentAcknowledgement: boolean;
  readonly hasDiagnostic: boolean;
}

export interface ResolveToolObservationPolicyInput {
  readonly action: string;
  readonly declaredSensitivity: ToolSensitivity;
  readonly rawArgs: unknown;
}

type AcknowledgementKind = ToolObservationPolicy['acknowledgement']['kind'];
type PolicyRow = readonly [
  action: string,
  sourceSurface: SourceToolSurface,
  sensitivity: ToolSensitivity,
  risk: OperationRisk,
  acknowledgement: AcknowledgementKind,
  redactionProfile: RedactionProfile,
];

const POLICY_ROWS = [
  [
    'activate_control_profile',
    'control-profile',
    'state-affecting',
    'state-affecting',
    'none',
    'workspace',
  ],
  [
    'apply_control_profile_answer',
    'control-profile',
    'state-affecting',
    'state-affecting',
    'none',
    'workspace',
  ],
  ['breakpoint_clear', 'debug', 'state-affecting', 'disruptive', 'none', 'debug-payload'],
  ['breakpoint_list', 'debug', 'read-only', 'read-only', 'none', 'debug-payload'],
  ['breakpoint_set', 'debug', 'state-affecting', 'disruptive', 'none', 'debug-payload'],
  [
    'cancel_control_workflow_job',
    'control-workflow',
    'state-affecting',
    'disruptive',
    'none',
    'job',
  ],
  [
    'cleanup_control_workflow_jobs',
    'control-workflow',
    'state-affecting',
    'state-affecting',
    'none',
    'job',
  ],
  ['close_session', 'terminal', 'state-affecting', 'state-affecting', 'none', 'session'],
  [
    'connect_control_profile_chip',
    'control-profile',
    'state-affecting',
    'state-affecting',
    'none',
    'workspace',
  ],
  ['cpu_halt', 'debug', 'state-affecting', 'disruptive', 'none', 'debug-payload'],
  [
    'cpu_reset',
    'debug',
    'state-affecting',
    'disruptive',
    'none',
    'debug-payload',
  ],
  ['cpu_run', 'debug', 'state-affecting', 'disruptive', 'none', 'debug-payload'],
  ['cpu_step', 'debug', 'state-affecting', 'disruptive', 'none', 'debug-payload'],
  ['crash_diagnose', 'debug', 'read-only', 'read-only', 'none', 'debug-payload'],
  ['diagnose_rtt_log_session', 'rtt-log-session', 'read-only', 'read-only', 'none', 'session'],
  [
    'disconnect_control_profile_chip',
    'control-profile',
    'state-affecting',
    'state-affecting',
    'none',
    'workspace',
  ],
  ['discover_serial_ports', 'terminal', 'read-only', 'read-only', 'none', 'session'],
  [
    'flash_download',
    'debug',
    'state-affecting',
    'destructive-or-unknown',
    'none',
    'debug-payload',
  ],
  [
    'flash_erase',
    'debug',
    'state-affecting',
    'destructive-or-unknown',
    'none',
    'debug-payload',
  ],
  ['flash_verify', 'debug', 'state-affecting', 'state-affecting', 'none', 'debug-payload'],
  [
    'flash_write',
    'debug',
    'state-affecting',
    'destructive-or-unknown',
    'none',
    'debug-payload',
  ],
  [
    'gdb_server_start',
    'debug',
    'state-affecting',
    'disruptive',
    'none',
    'debug-payload',
  ],
  ['gdb_server_stop', 'debug', 'state-affecting', 'disruptive', 'none', 'debug-payload'],
  ['get_agent_runbook', 'agent-runbook', 'read-only', 'read-only', 'none', 'runtime'],
  ['get_app_status', 'agent-runbook', 'read-only', 'read-only', 'none', 'runtime'],
  ['get_control_profile', 'control-profile', 'read-only', 'read-only', 'none', 'workspace'],
  ['get_control_workflow_job_status', 'control-workflow', 'read-only', 'read-only', 'none', 'job'],
  ['get_session_status', 'terminal', 'read-only', 'read-only', 'none', 'session'],
  ['get_workspace_config', 'workspace', 'read-only', 'read-only', 'none', 'workspace'],
  [
    'init_control_profile',
    'control-profile',
    'state-affecting',
    'state-affecting',
    'none',
    'workspace',
  ],
  ['init_workspace', 'workspace', 'state-affecting', 'state-affecting', 'none', 'workspace'],
  ['inspect_control_profile', 'control-profile', 'read-only', 'read-only', 'none', 'workspace'],
  [
    'jlink_commander_script',
    'debug',
    'state-affecting',
    'destructive-or-unknown',
    'none',
    'debug-payload',
  ],
  ['jlink_device_catalog_get', 'jlink-device-catalog', 'read-only', 'read-only', 'none', 'probe'],
  [
    'jlink_device_catalog_search',
    'jlink-device-catalog',
    'read-only',
    'read-only',
    'none',
    'probe',
  ],
  [
    'jlink_reboot',
    'debug',
    'state-affecting',
    'disruptive',
    'none',
    'debug-payload',
  ],
  ['list_sessions', 'terminal', 'read-only', 'read-only', 'none', 'session'],
  ['memory_read', 'debug', 'read-only', 'read-only', 'none', 'debug-payload'],
  ['memory_write', 'debug', 'state-affecting', 'destructive-or-unknown', 'none', 'debug-payload'],
  [
    'open_rtt_log_session',
    'rtt-log-session',
    'state-affecting',
    'state-affecting',
    'none',
    'session',
  ],
  ['open_session', 'terminal', 'state-affecting', 'state-affecting', 'none', 'session'],
  [
    'prepare_control_profile_questions',
    'control-profile',
    'read-only',
    'read-only',
    'none',
    'workspace',
  ],
  ['probe_connect', 'debug', 'state-affecting', 'state-affecting', 'none', 'debug-payload'],
  ['probe_detect', 'debug', 'read-only', 'read-only', 'none', 'debug-payload'],
  ['probe_disconnect', 'debug', 'state-affecting', 'state-affecting', 'none', 'debug-payload'],
  ['probe_status', 'debug', 'read-only', 'read-only', 'none', 'debug-payload'],
  ['read_control_workflow_job', 'control-workflow', 'read-only', 'read-only', 'none', 'job'],
  ['read_from_session', 'terminal', 'read-only', 'read-only', 'none', 'session'],
  ['register_list', 'debug', 'read-only', 'read-only', 'none', 'debug-payload'],
  ['register_read', 'debug', 'read-only', 'read-only', 'none', 'debug-payload'],
  ['register_write', 'debug', 'state-affecting', 'disruptive', 'none', 'debug-payload'],
  [
    'restart_mcp_runtime',
    'runtime-control',
    'state-affecting',
    'disruptive',
    'none',
    'runtime',
  ],
  ['rtt_clear', 'debug', 'state-affecting', 'state-affecting', 'none', 'debug-payload'],
  ['rtt_connect', 'debug', 'state-affecting', 'state-affecting', 'none', 'debug-payload'],
  ['rtt_read', 'debug', 'state-affecting', 'state-affecting', 'none', 'debug-payload'],
  ['rtt_search', 'debug', 'read-only', 'read-only', 'none', 'debug-payload'],
  [
    'run_control_workflow',
    'control-workflow',
    'state-affecting',
    'destructive-or-unknown',
    'none',
    'workspace',
  ],
  ['send_and_wait', 'terminal', 'state-affecting', 'state-affecting', 'none', 'session'],
  ['snapshot_capture', 'debug', 'read-only', 'read-only', 'none', 'debug-payload'],
  ['ui_configure', 'ui', 'state-affecting', 'state-affecting', 'none', 'ui'],
  ['ui_screenshot', 'ui', 'read-only', 'read-only', 'none', 'ui'],
  [
    'update_workspace_config',
    'workspace',
    'state-affecting',
    'state-affecting',
    'none',
    'workspace',
  ],
  ['write_to_session', 'terminal', 'state-affecting', 'state-affecting', 'none', 'session'],
] as const satisfies readonly PolicyRow[];

const SOURCE_TO_ACTIVITY = {
  'agent-runbook': 'runtime',
  'control-profile': 'control-profile',
  'control-workflow': 'workflow',
  debug: 'debug',
  'jlink-device-catalog': 'debug',
  'rtt-log-session': 'debug',
  'runtime-control': 'runtime',
  terminal: 'terminal',
  ui: 'ui',
  workspace: 'workspace',
  unknown: 'runtime',
} as const satisfies Readonly<Record<SourceToolSurface, ActivitySurface>>;

const RISK_TO_APPROVAL = {
  'read-only': 'none',
  'state-affecting': 'none',
  disruptive: 'none',
  'destructive-or-unknown': 'none',
} as const satisfies Readonly<Record<OperationRisk, ApprovalPolicy>>;

const SAFE_ACTION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
function freezeAcknowledgement(
  kind: AcknowledgementKind,
): ToolObservationPolicy['acknowledgement'] {
  void kind;
  return Object.freeze({ kind: 'none' });
}

export const RUNTIME_TOOL_POLICIES: readonly ToolObservationPolicy[] = Object.freeze(
  POLICY_ROWS.map(
    ([action, sourceSurface, sensitivity, risk, acknowledgementKind, redactionProfile]) => {
      const policy: ToolObservationPolicy = {
        action,
        sourceSurface,
        surface: SOURCE_TO_ACTIVITY[sourceSurface],
        sensitivity,
        risk,
        approvalPolicy: RISK_TO_APPROVAL[risk],
        acknowledgement: freezeAcknowledgement(acknowledgementKind),
        redactionProfile,
      };
      return Object.freeze(policy);
    },
  ),
);

const POLICY_BY_ACTION: ReadonlyMap<string, ToolObservationPolicy> = new Map(
  RUNTIME_TOOL_POLICIES.map((policy) => [policy.action, policy]),
);

function conservativeFallback(
  input: ResolveToolObservationPolicyInput,
  reviewed: ToolObservationPolicy | undefined,
): ResolvedToolObservationPolicy {
  return Object.freeze({
    action: SAFE_ACTION_PATTERN.test(input.action) ? input.action : 'unknown-tool',
    sourceSurface: reviewed?.sourceSurface ?? 'unknown',
    surface: reviewed?.surface ?? 'runtime',
    sensitivity: input.declaredSensitivity,
    risk: 'destructive-or-unknown',
    approvalPolicy: 'none',
    acknowledgement: freezeAcknowledgement('none'),
    redactionProfile: 'metadata-only',
    missingCurrentAcknowledgement: false,
    hasDiagnostic: true,
  });
}

export function resolveToolObservationPolicy(
  input: ResolveToolObservationPolicyInput,
): ResolvedToolObservationPolicy {
  const reviewed = POLICY_BY_ACTION.get(input.action);
  if (reviewed === undefined || reviewed.sensitivity !== input.declaredSensitivity) {
    return conservativeFallback(input, reviewed);
  }

  return Object.freeze({
    ...reviewed,
    missingCurrentAcknowledgement: false,
    hasDiagnostic: false,
  });
}
