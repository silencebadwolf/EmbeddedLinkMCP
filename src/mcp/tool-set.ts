import { createHash } from 'node:crypto';

const CORE_TOOL_NAMES = [
  'list_sessions',
  'open_session',
  'close_session',
  'write_to_session',
  'read_from_session',
  'send_and_wait',
  'discover_serial_ports',
  'get_session_status',
  'get_agent_runbook',
  'get_app_status',
  'init_control_profile',
  'get_control_profile',
  'inspect_control_profile',
  'prepare_control_profile_questions',
  'apply_control_profile_answer',
  'activate_control_profile',
  'run_control_workflow',
  'probe_detect',
  'probe_connect',
  'probe_disconnect',
  'probe_status',
  'cpu_reset',
  'cpu_halt',
  'cpu_run',
  'cpu_step',
  'breakpoint_set',
  'breakpoint_clear',
  'breakpoint_list',
  'register_read',
  'register_write',
  'register_list',
  'flash_erase',
  'rtt_connect',
  'rtt_clear',
  'gdb_server_start',
  'gdb_server_stop',
  'crash_diagnose',
  'memory_read',
  'memory_write',
  'flash_download',
  'flash_write',
  'flash_verify',
  'rtt_read',
  'rtt_search',
  'snapshot_capture',
  'ui_configure',
  'ui_screenshot',
] as const;

export type CoreToolName = (typeof CORE_TOOL_NAMES)[number];

export interface ToolSetDiagnostics {
  count: number;
  hash: string;
  core: {
    expected: readonly CoreToolName[];
    complete: boolean;
    missing: CoreToolName[];
  };
}

/**
 * Return the tool names expected in every fully-capable LinkTerm runtime.
 *
 * @returns Stable core tool name list.
 */
export function expectedCoreToolNames(): readonly CoreToolName[] {
  return CORE_TOOL_NAMES;
}

/**
 * Build deterministic diagnostics for the tools registered in this runtime.
 *
 * @param registeredToolNames Tool names recorded during MCP registration.
 * @returns Count, sha256 hash, and missing core-tool report.
 */
export function buildToolSetDiagnostics(registeredToolNames: Iterable<string>): ToolSetDiagnostics {
  const uniqueToolNames = Array.from(new Set(registeredToolNames)).sort();
  const registered = new Set(uniqueToolNames);
  const missing = CORE_TOOL_NAMES.filter((toolName) => !registered.has(toolName));
  return {
    count: uniqueToolNames.length,
    hash: createHash('sha256').update(uniqueToolNames.join('\n')).digest('hex'),
    core: {
      expected: CORE_TOOL_NAMES,
      complete: missing.length === 0,
      missing,
    },
  };
}
