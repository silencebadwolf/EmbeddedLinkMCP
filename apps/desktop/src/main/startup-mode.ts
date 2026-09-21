/** Runtime startup mode helpers for desktop and MCP stdio launches. */

export interface StartupLockState {
  hasSingleInstanceLock: boolean;
  isMcpStdioMode: boolean;
}

/**
 * Detect whether the current process was launched as a stdio MCP server.
 *
 * @param env Environment variables to inspect.
 * @returns True when MCP stdio mode is explicitly enabled.
 */
export function isMcpStdioMode(env: NodeJS.ProcessEnv): boolean {
  return env.LINKTERM_MCP_STDIO === '1';
}

/**
 * Decide whether a process without the single-instance lock must quit.
 *
 * @param state Current single-instance and MCP startup mode state.
 * @returns True for ordinary duplicate desktop launches; false for MCP stdio subprocesses.
 */
export function shouldQuitForMissingSingleInstanceLock(state: StartupLockState): boolean {
  return !state.hasSingleInstanceLock && !state.isMcpStdioMode;
}

/**
 * Decide whether this process should create the desktop BrowserWindow.
 *
 * @param state Current single-instance and MCP startup mode state.
 * @returns True when this process owns the desktop single-instance role.
 */
export function shouldCreateMainWindow(state: StartupLockState): boolean {
  return state.hasSingleInstanceLock && !state.isMcpStdioMode;
}
