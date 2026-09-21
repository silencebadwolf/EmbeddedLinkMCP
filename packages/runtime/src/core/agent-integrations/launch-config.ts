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

/** Options for building the Electron-owned MCP runtime launch command. */
export interface ElectronMcpLaunchConfigOptions {
  /** Packaged LinkTerm executable or Electron executable in development. */
  runtimePath: string;
  /** Runtime metadata path used by the launcher to attach directly to an already-running App. */
  metadataPath: string;
  /** Compiled launcher that clears Electron Node-mode before starting the real runtime. */
  launcherPath: string;
  /** App path passed to Electron in development; packaged builds may pass an empty string. */
  appPath?: string;
}

/**
 * Build a LinkTerm MCP launch config that starts the Electron main runtime.
 *
 * The configured process intentionally starts Electron in Node mode first, runs a tiny launcher,
 * then the launcher either proxies directly to an already-running App HTTP runtime or deletes
 * ELECTRON_RUN_AS_NODE before spawning the real Electron runtime with forwarded stdio. This prevents
 * VS Code/Electron Agent hosts from leaking their own Node-mode environment into LinkTerm while
 * preserving the byte-oriented MCP stdio pipe.
 *
 * @param options Runtime executable, metadata path, launcher path, and optional Electron app path.
 * @returns MCP launch configuration that keeps SessionManager available for later UI windows.
 */
export function buildElectronMcpLaunchConfig(
  options: ElectronMcpLaunchConfigOptions,
): LinkTermMcpLaunchConfig {
  return {
    command: options.runtimePath,
    args: [
      options.launcherPath,
      options.metadataPath,
      options.runtimePath,
      ...(options.appPath ? [options.appPath] : []),
    ],
    env: { ...LINKTERM_MCP_STDIO_ENV },
  };
}
