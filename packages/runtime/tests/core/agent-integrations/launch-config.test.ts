import { describe, expect, it } from 'vitest';
import { buildElectronMcpLaunchConfig, buildNodeMcpLaunchConfig } from '@linkterm/runtime/core/agent-integrations/index';

describe('buildNodeMcpLaunchConfig', () => {
  it('uses an Electron/Node runtime to launch the standalone MCP stdio entry', () => {
    const config = buildNodeMcpLaunchConfig({
      runtimePath: 'C:\\Program Files\\LinkTerm\\LinkTerm.exe',
      entryPath: 'C:\\Users\\A\\link-terminal\\dist\\main\\mcp\\stdio-entry.js',
    });

    expect(config).toEqual({
      command: 'C:\\Program Files\\LinkTerm\\LinkTerm.exe',
      args: ['C:\\Users\\A\\link-terminal\\dist\\main\\mcp\\stdio-entry.js'],
      env: {
        ELECTRON_RUN_AS_NODE: '1',
        LINKTERM_MCP_STDIO: '1',
        LINKTERM_FORCE_DIST: '1',
      },
    });
  });
});

describe('buildElectronMcpLaunchConfig', () => {
  it('launches through a Node-mode shim that clears Electron Node-mode for the real runtime', () => {
    const config = buildElectronMcpLaunchConfig({
      runtimePath: 'C:\\Program Files\\LinkTerm\\LinkTerm.exe',
      metadataPath: 'C:\\Users\\A\\AppData\\Roaming\\linkterm-v2\\mcp-runtime.json',
      launcherPath: 'C:\\Program Files\\LinkTerm\\resources\\app.asar\\dist\\main\\mcp\\electron-runtime-launcher.js',
      appPath: 'C:\\Users\\A\\link-terminal',
    });

    expect(config).toEqual({
      command: 'C:\\Program Files\\LinkTerm\\LinkTerm.exe',
      args: [
        'C:\\Program Files\\LinkTerm\\resources\\app.asar\\dist\\main\\mcp\\electron-runtime-launcher.js',
        'C:\\Users\\A\\AppData\\Roaming\\linkterm-v2\\mcp-runtime.json',
        'C:\\Program Files\\LinkTerm\\LinkTerm.exe',
        'C:\\Users\\A\\link-terminal',
      ],
      env: {
        ELECTRON_RUN_AS_NODE: '1',
        LINKTERM_MCP_STDIO: '1',
        LINKTERM_FORCE_DIST: '1',
      },
    });
  });
});
