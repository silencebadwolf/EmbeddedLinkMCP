import { describe, expect, it } from 'vitest';
import { buildNodeMcpLaunchConfig } from '@/core/agent-integrations/index.js';

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
