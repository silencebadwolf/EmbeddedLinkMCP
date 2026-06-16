import type { LinkTermMcpLaunchConfig } from './types.js';

const LINKTERM_MCP_STDIO_ENV = {
  ELECTRON_RUN_AS_NODE: '1',
  LINKTERM_MCP_STDIO: '1',
  LINKTERM_FORCE_DIST: '1',
} as const;

/** Options for building the standalone MCP stdio launch command. */
export interface NodeMcpLaunchConfigOptions {
  /** Electron executable or packaged LinkTerm executable running in Node mode. */
  runtimePath: string;
  /** Compiled standalone MCP stdio entry path. */
  entryPath: string;
}

/**
 * Build a LinkTerm MCP stdio launch config that starts the standalone Node-mode MCP entry.
 *
 * @param options Runtime executable and compiled MCP entry path.
 * @returns MCP launch configuration safe to run from Electron-based Agent hosts.
 */
export function buildNodeMcpLaunchConfig(
  options: NodeMcpLaunchConfigOptions,
): LinkTermMcpLaunchConfig {
  return {
    command: options.runtimePath,
    args: [options.entryPath],
    env: { ...LINKTERM_MCP_STDIO_ENV },
  };
}
