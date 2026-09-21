/** Runtime-generated LinkTerm MCP runbook content. */

import type { EvidenceKind } from '@linkterm/contracts/types';
import { FIRMWARE_IMAGE_USAGE_GUIDANCE } from '../../firmware-image-guidance.js';

export type RunbookRiskLevel = 'low' | 'medium' | 'high';

export type RunbookProfileStatus =
  | 'root-not-provided'
  | 'manager-unavailable'
  | 'loaded'
  | 'profile-not-found'
  | 'invalid-root'
  | 'schema-version-mismatch'
  | 'profile-too-large'
  | 'invalid-profile'
  | 'unavailable';

export interface RunbookWorkflow {
  id: string;
  title: string;
  description: string;
  recommendedTools: string[];
  riskLevel: RunbookRiskLevel;
  requiresConfirmation: boolean;
  expectedEvidenceKind: EvidenceKind;
}

export interface RunbookHighImpactTool {
  name: string;
  requiresConfirmation: false;
  backendInvokedWithoutConfirmation: true;
}

export interface RunbookControlWorkflowMode {
  mode: 'flash-observe' | 'debug-diagnose' | 'flash-observe-diagnose';
  requiresConfirmation: false;
}

export interface RunbookProfileSummary {
  status: RunbookProfileStatus;
  rootProvided: boolean;
  sections: {
    serial: boolean;
    jlink: boolean;
    flash: boolean;
    rtt: boolean;
  };
  serial?: {
    enabled: boolean;
    port?: string;
    baudRate?: number;
    mode?: 'normal' | 'terminal';
  };
  jlink?: {
    enabled: boolean;
    target?: string;
    interface?: 'swd' | 'jtag';
    speedKHz?: number | 'auto';
  };
  flash?: {
    binaryConfigured: boolean;
    baseAddress?: string;
    verify?: boolean;
  };
  rtt?: {
    enabled: boolean;
    channels?: number[];
    controlBlockAddress?: string;
  };
  issue?: {
    code: RunbookProfileStatus;
    message: string;
  };
}

export interface AgentRunbook {
  title: 'LinkTerm MCP Agent Runbook';
  schemaVersion: string;
  markdown: string;
  profileSummary: RunbookProfileSummary;
  workflows: RunbookWorkflow[];
  highImpactTools: RunbookHighImpactTool[];
  highImpactControlWorkflowModes: RunbookControlWorkflowMode[];
  safetyRules: string[];
}

export interface CreateAgentRunbookOptions {
  schemaVersion: string;
  profileSummary?: RunbookProfileSummary;
}

const DEFAULT_PROFILE_SUMMARY: RunbookProfileSummary = {
  status: 'root-not-provided',
  rootProvided: false,
  sections: { serial: false, jlink: false, flash: false, rtt: false },
};

const SAVED_CONFIGURATION_GUIDANCE =
  'Saved configuration maintenance: use update_workspace_config for <root>/.linkterm/config.json. To replace <root>/.linkterm/control-profile.json, read the current profile first and call init_control_profile with force=true and the reviewed complete profile. App-saved connection entries must be edited in place from the desktop Connections UI; ui_configure can open or prefill the dialog but does not update an existing saved record. A successful edit preserves the record identity and does not migrate or close an already active Session. If an optimistic-update conflict is reported, refresh the record and review the newer values before retrying; do not create a duplicate merely because the serial port changed.';

const JLINK_VCOM_RECOVERY_GUIDANCE =
  'J-Link VCOM recovery is an explicit desktop control-profile repair action and is not currently exposed as an MCP tool. Do not try to enable VCOM through jlink_commander_script or an external Commander process. Use the UI action Recover J-Link serial only for an SWD profile when the saved port is missing and one probe/candidate can be identified unambiguously. LinkTerm queries VCOM first and enables it only when Commander explicitly reports disabled; if VCOM is already enabled but no SEGGER CDC port appears, power-cycle or replug the probe, then call get_app_status again. Active GDB/RTT use, multiple probes, unknown VCOM state, or multiple CDC candidates requires stopping for user resolution; never guess a port.';

export const RUNBOOK_WORKFLOWS: readonly RunbookWorkflow[] = [
  {
    id: 'observe_serial',
    title: 'Observe an existing or configured serial terminal',
    description:
      'Inspect Main-owned sessions first and reuse a compatible active terminal. Use get_app_status with a known workspace root to reuse profile facts; call discover_serial_ports only when no active session or known configuration exists. Serial open_session is create or reuse and Main coordination remains authoritative under races.',
    recommendedTools: [
      'list_sessions',
      'get_app_status',
      'open_session',
      'read_from_session',
      'send_and_wait',
    ],
    riskLevel: 'low',
    requiresConfirmation: false,
    expectedEvidenceKind: 'terminal_output',
  },
  {
    id: 'activate_profile',
    title: 'Bring configured control online without destructive actions',
    description:
      'Use the workspace control profile to open serial and connect J-Link without flashing, erasing, resetting, halting, or starting GDB server.',
    recommendedTools: [
      'inspect_control_profile',
      'prepare_control_profile_questions',
      'activate_control_profile',
      'connect_control_profile_chip',
      'disconnect_control_profile_chip',
    ],
    riskLevel: 'medium',
    requiresConfirmation: false,
    expectedEvidenceKind: 'workspace_config',
  },
  {
    id: 'flash_then_observe',
    title: 'Flash configured firmware, reset, then observe serial output',
    description:
      'Prefer run_control_workflow; for long flash workflows use background job mode, then poll status and read job evidence instead of retrying hardware operations.',
    recommendedTools: [
      'run_control_workflow',
      'get_control_workflow_job_status',
      'read_control_workflow_job',
      'cancel_control_workflow_job',
      'cleanup_control_workflow_jobs',
    ],
    riskLevel: 'high',
    requiresConfirmation: false,
    expectedEvidenceKind: 'debug_output',
  },
  {
    id: 'debug_diagnose',
    title: 'Start managed debug diagnosis',
    description:
      'Use LinkTerm-managed J-Link/GDB/debug evidence instead of direct GDB or SEGGER CLI calls; use background job mode when diagnosis may exceed the host request deadline.',
    recommendedTools: [
      'run_control_workflow',
      'get_control_workflow_job_status',
      'read_control_workflow_job',
      'register_list',
      'snapshot_capture',
      'crash_diagnose',
    ],
    riskLevel: 'high',
    requiresConfirmation: false,
    expectedEvidenceKind: 'debug_output',
  },
  {
    id: 'recover_attach',
    title: 'Recover or diagnose target attach problems',
    description:
      'When probe discovery works but CPU/register access fails, stay inside LinkTerm debug tools and collect structured evidence.',
    recommendedTools: ['probe_detect', 'probe_status', 'register_list', 'snapshot_capture'],
    riskLevel: 'medium',
    requiresConfirmation: false,
    expectedEvidenceKind: 'debug_output',
  },
  {
    id: 'rtt_or_gdb_observe',
    title: 'Use RTT log sessions or managed GDB evidence',
    description:
      'For continuous RTT log observation, prefer open_rtt_log_session with root so LinkTerm prepares the managed GDB/RTT backend and the App-visible session in one operation; if the session is silent or only shows a SEGGER banner, use diagnose_rtt_log_session before any flash/reset path; use rtt_read/rtt_search/rtt_clear for bounded one-shot debug evidence; do not launch external GDB server processes.',
    recommendedTools: [
      'open_rtt_log_session',
      'read_from_session',
      'diagnose_rtt_log_session',
      'rtt_read',
      'rtt_search',
    ],
    riskLevel: 'medium',
    requiresConfirmation: false,
    expectedEvidenceKind: 'debug_output',
  },
  {
    id: 'ui_assist',
    title: 'Assist the visible LinkTerm UI',
    description:
      'Use whitelisted UI patching and screenshots for non-sensitive setup help without touching terminal/debug state.',
    recommendedTools: ['ui_configure', 'ui_screenshot'],
    riskLevel: 'low',
    requiresConfirmation: false,
    expectedEvidenceKind: 'ui_screenshot',
  },
] as const;

export const HIGH_IMPACT_TOOLS: readonly RunbookHighImpactTool[] = [
  'flash_download',
  'flash_write',
  'flash_erase',
  'cpu_reset',
  'gdb_server_start',
  'jlink_reboot',
  'jlink_commander_script',
].map((name) => ({
  name,
  requiresConfirmation: false,
  backendInvokedWithoutConfirmation: true,
})) as readonly RunbookHighImpactTool[];

export const HIGH_IMPACT_CONTROL_WORKFLOW_MODES: readonly RunbookControlWorkflowMode[] = [
  { mode: 'flash-observe', requiresConfirmation: false },
  { mode: 'debug-diagnose', requiresConfirmation: false },
  { mode: 'flash-observe-diagnose', requiresConfirmation: false },
] as const;

const SAFETY_RULES = [
  'LinkTerm MCP tools are the required path for J-Link, debug, flash, and serial operations exposed through the LinkTerm runtime.',
  'Call LinkTerm MCP tools sequentially; do not batch or parallelize first contact, health checks, or hardware-control steps.',
  'After a new MCP session or server reload, make one lightweight health-check call such as get_app_status or get_agent_runbook before dependent operations.',
  'Use ui_screenshot only when visual evidence is needed; prefer get_app_status for startup state checks.',
  'Human and AI use the same SessionManager, WriteQueue, transport, and transcript; do not close a shared session unless the user requested closure or the owning workflow explicitly disposes it, and never disable human input or claim exclusive terminal ownership.',
  'Serial open_session is create or reuse: inspect list_sessions/get_app_status first, use evidence.data.reused=true when returned, and on SERIAL_SESSION_CONFLICT compare the active/requested configuration instead of retrying blindly.',
  'For terminal commands, use write_to_session or send_and_wait to send data and read_from_session to read transcript evidence; do not infer that LinkTerm lacks a send interface from a partial host tool view.',
  'send_and_wait writes once, waits a bounded settle window, and returns observed device output; inspect hasDeviceOutput/receivedBase64 and read_from_session before deciding the next command. A marker is metadata rather than a success gate, an empty settle window does not prove a device crash or command completion, and it does not retry automatically.',
  'For continuous RTT log observation, prefer open_rtt_log_session with root/profile so LinkTerm starts the managed GDB server, connects RTT, and opens the App-visible session in one high-level operation; use probeId only to reuse an already prepared RTT backend.',
  'For RTT sessions, a successful write_to_session/send_and_wait bytesWritten result only proves LinkTerm accepted bytes into the shared write path; it does not prove target firmware consumed RTT down-channel input. Use device-origin transcript bytes or diagnose_rtt_log_session target_input_unanswered evidence before claiming interactive board success.',
  'If a continuous RTT log session is silent or only shows a SEGGER banner, call diagnose_rtt_log_session and treat it as a firmware-output/channel/control-block diagnosis; when the firmware exposes a known _SEGGER_RTT address, save it as profile.rtt.controlBlockAddress and reopen the root/profile RTT log path instead of repeating flash.',
  'Prefer the current workspace control profile: inspect or read <root>/.linkterm/control-profile.json first, and omit firmware.filePath when profile.flash.binary already names the firmware.',
  SAVED_CONFIGURATION_GUIDANCE,
  JLINK_VCOM_RECOVERY_GUIDANCE,
  'When only the chip/J-Link target should be connected, use connect_control_profile_chip and disconnect_control_profile_chip; keep serial/RTT session lifecycle separate.',
  FIRMWARE_IMAGE_USAGE_GUIDANCE,
  'High-impact J-Link and workflow operations execute immediately after validation; observe progress and results in Activity Center, transcript, and audit records.',
  'Validated AI operations execute automatically; legacy confirm values are ignored metadata, and LinkTerm has no approval, pause, resume-AI, or take-over action.',
  'When runtime diagnostics report stale code, call restart_mcp_runtime, then call get_app_status after restart before hardware operations.',
  'For long flash/observe/debug workflows, use run_control_workflow background job mode and recover with get_control_workflow_job_status plus read_control_workflow_job instead of retrying flash or using external tools; a host timeout is not evidence of hardware failure and must not trigger repeated flash, erase, reset, attach, or GDB startup.',
  'Conclusions must cite fresh LinkTerm MCP evidence; old serial output or external tool logs are not proof.',
] as const;

/**
 * Build concise MCP initialize instructions so clients receive safe operating guidance immediately on connect.
 *
 * @param schemaVersion LinkTerm MCP schema version advertised by the server.
 * @returns Compact runbook text suitable for MCP server instructions.
 */
export function createAgentRunbookInstructions(schemaVersion: string): string {
  const highImpactTools = HIGH_IMPACT_TOOLS.map((tool) => tool.name).join(', ');
  const workflowIds = RUNBOOK_WORKFLOWS.map((workflow) => workflow.id).join(', ');
  return [
    `LinkTerm MCP Agent Runbook (schema=${schemaVersion}).`,
    'Use this guidance immediately after initialize; do not require the user to remind you to read a manual first.',
    'For detailed or workspace/profile-aware guidance, call get_agent_runbook when useful, but basic safe operation is already described here.',
    'Call LinkTerm MCP tools sequentially; do not batch or parallelize first contact, health checks, or hardware-control steps.',
    'After a new MCP session or server reload, make one lightweight health-check call such as get_app_status or get_agent_runbook before dependent operations.',
    'Startup: call get_app_status first for current sessions, readiness, read-only serial-port and J-Link probe discovery, runtime identity, and core tool-set diagnostics; it does not connect to or mutate hardware, capture screenshots, or write sessions.',
    'Startup model: use initialize instructions or get_agent_runbook for MCP usage, then call get_app_status for current state; if recommendedWorkflows contains profile_flash_observe, use those run_control_workflow arguments and observe Activity Center, transcript, and audit evidence.',
    'If core tools are missing, repair or restart the LinkTerm MCP runtime instead of falling back to external tools.',
    'If runtime code is stale, call restart_mcp_runtime, then call get_app_status after the runtime restarts before hardware operations.',
    'Use ui_screenshot only when visual evidence is needed; prefer get_app_status for startup state checks.',
    'LinkTerm MCP tools are the required path for J-Link, debug, flash, and serial operations exposed through the LinkTerm runtime.',
    'Serial: inspect existing sessions and known workspace/control-profile facts before opening; open_session may create or reuse a compatible session and reports evidence.data.reused=true when reused; discover ports only when configuration is unknown, and inspect SERIAL_SESSION_CONFLICT instead of retrying blindly.',
    'Human and AI use the same SessionManager, transport, same WriteQueue and transcript; do not close a shared session unless the user requested it, and do not disable human input or claim terminal ownership.',
    'For terminal commands, send bytes with write_to_session or send_and_wait, then read transcript evidence with read_from_session; never claim LinkTerm lacks a send interface before checking get_app_status terminalCommandTools.',
    'send_and_wait writes once, waits a bounded settle window, and returns observed device output; inspect hasDeviceOutput/receivedBase64 and read_from_session before deciding the next command. Markers are metadata, silence proves neither crash nor completion, and it does not retry automatically.',
    'For RTT terminal sessions, bytesWritten from write_to_session/send_and_wait is host-side acceptance only; require later device-origin output or diagnose_rtt_log_session evidence that is not target_input_unanswered before claiming the board consumed the input.',
    'For continuous RTT log observation, call open_rtt_log_session with root/profile and then read_from_session; this high-level path owns managed GDB server startup and RTT connect internally. If the session is silent or only shows a SEGGER banner, call diagnose_rtt_log_session before considering flash/reset/debug recovery; when _SEGGER_RTT is known, persist it as profile.rtt.controlBlockAddress so LinkTerm configures SEGGER RTT Telnet with that control block. Use probeId only to reuse an already prepared RTT backend; use rtt_read/rtt_search/rtt_clear only for bounded one-shot debug evidence.',
    'Prefer the current workspace control profile: inspect or read <root>/.linkterm/control-profile.json first, and omit firmware.filePath when profile.flash.binary already names the firmware.',
    SAVED_CONFIGURATION_GUIDANCE,
    JLINK_VCOM_RECOVERY_GUIDANCE,
    'Use connect_control_profile_chip/disconnect_control_profile_chip when you need only the chip connection; use activate_control_profile only when opening the configured observation session too is intended.',
    FIRMWARE_IMAGE_USAGE_GUIDANCE,
    'Prefer run_control_workflow for supported hardware workflows before manually chaining low-level serial and J-Link tools.',
    'Validated operations execute automatically; legacy confirm values are ignored and there is no approval, pause, resume-AI, or take-over workflow.',
    'For long-running flash/observe/debug workflows, use run_control_workflow background job mode, then poll get_control_workflow_job_status and read_control_workflow_job; cancel with cancel_control_workflow_job when needed. A host timeout is not evidence of hardware failure and must not trigger repeated flash, erase, reset, attach, or GDB startup.',
    `Available workflow hints: ${workflowIds}.`,
    `High-impact tools execute immediately after validation; observe their Activity/Audit lifecycle and backend evidence: ${highImpactTools}.`,
    'Collect fresh MCP evidence before claiming success or failure.',
  ].join(' ');
}

/**
 * Build the complete runtime runbook payload.
 *
 * @param options Runtime schema version and optional sanitized profile summary.
 * @returns Markdown plus structured guidance for AI MCP clients.
 */
export function createAgentRunbook(options: CreateAgentRunbookOptions): AgentRunbook {
  const profileSummary = options.profileSummary ?? DEFAULT_PROFILE_SUMMARY;
  const payload: Omit<AgentRunbook, 'markdown'> = {
    title: 'LinkTerm MCP Agent Runbook',
    schemaVersion: options.schemaVersion,
    profileSummary,
    workflows: [...RUNBOOK_WORKFLOWS],
    highImpactTools: [...HIGH_IMPACT_TOOLS],
    highImpactControlWorkflowModes: [...HIGH_IMPACT_CONTROL_WORKFLOW_MODES],
    safetyRules: [...SAFETY_RULES],
  };
  return {
    ...payload,
    markdown: renderRunbookMarkdown(payload),
  };
}

/**
 * Convert a control profile into the non-sensitive runbook summary.
 *
 * @param input Unknown profile-like value loaded from runtime state.
 * @param status Summary status; callers use `loaded` for valid profiles and failure states for diagnostics.
 * @returns Whitelist-only profile summary with no firmware paths, credentials, tokens, or probe serials.
 */
export function sanitizeControlProfileForRunbook(
  input: unknown,
  status: RunbookProfileStatus = 'loaded',
): RunbookProfileSummary {
  const profile = asRecord(input);
  const serial = asRecord(profile?.serial);
  const jlink = asRecord(profile?.jlink);
  const flash = asRecord(profile?.flash);
  const rtt = asRecord(profile?.rtt);

  const summary: RunbookProfileSummary = {
    status,
    rootProvided: true,
    sections: {
      serial: serial !== undefined,
      jlink: jlink !== undefined,
      flash: flash !== undefined,
      rtt: rtt !== undefined,
    },
  };

  if (serial) {
    summary.serial = {
      enabled: serial.enabled === true,
      ...(typeof serial.port === 'string' ? { port: serial.port } : {}),
      ...(typeof serial.baudRate === 'number' ? { baudRate: serial.baudRate } : {}),
      ...(serial.mode === 'normal' || serial.mode === 'terminal' ? { mode: serial.mode } : {}),
    };
  }

  if (jlink) {
    summary.jlink = {
      enabled: jlink.enabled === true,
      ...(typeof jlink.target === 'string' ? { target: jlink.target } : {}),
      ...(jlink.interface === 'swd' || jlink.interface === 'jtag'
        ? { interface: jlink.interface }
        : {}),
      ...(typeof jlink.speedKHz === 'number' || jlink.speedKHz === 'auto'
        ? { speedKHz: jlink.speedKHz }
        : {}),
    };
  }

  if (flash) {
    summary.flash = {
      binaryConfigured: typeof flash.binary === 'string' && flash.binary.length > 0,
      ...(typeof flash.baseAddress === 'string' ? { baseAddress: flash.baseAddress } : {}),
      ...(typeof flash.verify === 'boolean' ? { verify: flash.verify } : {}),
    };
  }

  if (rtt) {
    summary.rtt = {
      enabled: rtt.enabled === true,
      ...(Array.isArray(rtt.channels) &&
      rtt.channels.every((channel) => typeof channel === 'number')
        ? { channels: [...rtt.channels] }
        : {}),
      ...(typeof rtt.controlBlockAddress === 'string'
        ? { controlBlockAddress: rtt.controlBlockAddress }
        : {}),
    };
  }

  return summary;
}

/**
 * Build a profile summary for cases where a profile is absent or unavailable.
 *
 * @param status Failure or missing-context status.
 * @param rootProvided Whether caller supplied a workspace root.
 * @param message Optional sanitized status message.
 * @returns Empty-section profile summary.
 */
export function createProfileStatusSummary(
  status: RunbookProfileStatus,
  rootProvided: boolean,
  message?: string,
): RunbookProfileSummary {
  return {
    status,
    rootProvided,
    sections: { serial: false, jlink: false, flash: false, rtt: false },
    ...(message ? { issue: { code: status, message } } : {}),
  };
}

function renderRunbookMarkdown(payload: Omit<AgentRunbook, 'markdown'>): string {
  const workflowLines = payload.workflows
    .map(
      (workflow) =>
        `- ${workflow.id}: use ${workflow.recommendedTools.join(' -> ')}; risk=${workflow.riskLevel}; execution=automatic; observe=${workflow.expectedEvidenceKind}`,
    )
    .join('\n');
  const highImpactLines = payload.highImpactTools
    .map(
      (tool) =>
        `- ${tool.name}: executes immediately after validation; observe Activity/Audit lifecycle and backend evidence.`,
    )
    .join('\n');
  const workflowModeLines = payload.highImpactControlWorkflowModes
    .map((entry) => `- run_control_workflow mode ${entry.mode}: executes immediately; observe Activity/Audit lifecycle.`)
    .join('\n');
  const safetyLines = payload.safetyRules.map((rule) => `- ${rule}`).join('\n');

  return [
    '# LinkTerm MCP Agent Runbook',
    '',
    `Schema version: ${payload.schemaVersion}`,
    '',
    '## First action',
    '',
    'Read this runbook before operating LinkTerm. Prefer high-level workflows when they match the task, then collect fresh MCP evidence.',
    '',
    '## Startup health',
    '',
    'Use get_app_status as the preferred lightweight health-check call after initialize or server reload. It performs one-shot serial-port and J-Link probe discovery and reports runtime identity, metadata freshness, UI availability without screenshot capture, sanitized profile status, and core tool-set diagnostics; it does not connect to or mutate hardware, flash, reset, start GDB, open sessions, or write to terminals.',
    '',
    'Startup model: treat MCP usage and MCP current state as the only required pre-run inputs. Use initialize instructions or get_agent_runbook for usage, then call get_app_status for current state. If get_app_status returns recommendedWorkflows.profile_flash_observe, use its run_control_workflow arguments and recover evidence with the listed follow-up tools.',
    '',
    'If get_app_status reports missing core tools, repair or restart the LinkTerm MCP runtime. Do not treat missing tools as a hardware failure and do not recover by running external J-Link, GDB, flash, serial CLI, or VS Code task commands.',
    '',
    'If get_app_status reports stale runtime code, call restart_mcp_runtime, then call get_app_status after the runtime restarts before hardware operations.',
    '',
    '## Ownership boundary',
    '',
    'AI clients MUST NOT bypass LinkTerm with JLink.exe, JLinkGDBServerCL.exe, gdb, arm-none-eabi-gdb, ad-hoc serial CLI tools, or VS Code task wrappers.',
    '',
    '## Capabilities',
    '',
    '- terminal/serial: create or reuse sessions, send commands with write_to_session or send_and_wait, wait for output, and read transcript evidence with read_from_session. If a host view appears read-only, first check get_app_status.terminalCommandTools instead of inventing an external serial path.',
    '- control profile: inspect, ask for missing fields, initialize, read, and non-destructively activate workspace control facts; prefer the current workspace control profile before inventing firmware/J-Link/serial parameters.',
    '- control workflow: prefer run_control_workflow for flash/observe/debug modes instead of manually chaining low-level serial and J-Link tools. When profile.flash.binary already names the firmware, omit firmware.filePath unless intentionally overriding it. For long operations, request background job mode and recover evidence with get_control_workflow_job_status and read_control_workflow_job; use cancel_control_workflow_job only when cancellation is needed.',
    '- J-Link debug/flash/RTT/GDB: use LinkTerm MCP debug tools only; do not launch external SEGGER or GDB commands. For silent RTT logs, use diagnose_rtt_log_session to distinguish SEGGER banner transport evidence from firmware log output before considering flash or reset.',
    '- UI: use ui_configure and ui_screenshot for whitelisted non-sensitive UI assistance.',
    '',
    '## Saved configuration and J-Link VCOM recovery',
    '',
    `- ${SAVED_CONFIGURATION_GUIDANCE}`,
    `- ${JLINK_VCOM_RECOVERY_GUIDANCE}`,
    '',
    '## Reference design use',
    '',
    'Commander script orchestration and transport selection from open-source J-Link MCP projects are design reference only. LinkTerm hardware operations must remain inside LinkTerm MCP tools and backend abstractions; do not copy reference command scripts, hardcoded target defaults, fixed temp-file names, or raw-output parsing instructions into runtime guidance.',
    '',
    '## Recommended workflows',
    '',
    workflowLines,
    '',
    '## Automatically executed high-impact operations',
    '',
    highImpactLines,
    workflowModeLines,
    '',
    '## Safety rules',
    '',
    safetyLines,
    '',
    '## Current profile summary',
    '',
    `Profile status: ${payload.profileSummary.status}. Sections configured: serial=${String(payload.profileSummary.sections.serial)}, jlink=${String(payload.profileSummary.sections.jlink)}, flash=${String(payload.profileSummary.sections.flash)}, rtt=${String(payload.profileSummary.sections.rtt)}.`,
  ].join('\n');
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}
