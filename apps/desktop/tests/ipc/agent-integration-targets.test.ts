/** Agent integration target discovery tests. */

import { describe, expect, it } from 'vitest';
import { buildDefaultAgentIntegrationTargets } from '../../src/main/ipc/agent-integration-targets.js';

describe('buildDefaultAgentIntegrationTargets', () => {
  it('includes Windows Codex and injected WSL Codex targets', async () => {
    const targets = await buildDefaultAgentIntegrationTargets({
      appData: 'C:\\Users\\A\\AppData\\Roaming',
      appRoot: 'C:\\Users\\Admin\\Desktop\\Code\\link-terminal',
      home: 'C:\\Users\\A',
      launchConfig: {
        command: 'C:\\Program Files\\LinkTerm\\LinkTerm.exe',
        args: ['C:\\Users\\Admin\\Desktop\\Code\\link-terminal'],
        env: { LINKTERM_MCP_STDIO: '1' },
      },
      wslHomeDirs: async () => [
        {
          distroName: 'Ubuntu-24.04',
          userName: 'jianyin',
          homePath: '\\\\wsl.localhost\\Ubuntu-24.04\\home\\jianyin',
        },
      ],
    });

    expect(targets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'codex',
          label: 'Codex',
          platform: 'windows',
          locationLabel: 'Windows',
          configKind: 'codex-config-toml',
          configPath: 'C:\\Users\\A\\.codex\\config.toml',
        }),
        expect.objectContaining({
          id: 'codex:wsl:Ubuntu-24.04:jianyin',
          label: 'Codex (Ubuntu-24.04)',
          platform: 'wsl',
          locationLabel: 'WSL: Ubuntu-24.04 / jianyin',
          configKind: 'codex-config-toml',
          configPath: '\\\\wsl.localhost\\Ubuntu-24.04\\home\\jianyin\\.codex\\config.toml',
          launchConfig: expect.objectContaining({
            command: 'cmd.exe',
            cwd: '/mnt/c/Users/Admin/Desktop/Code/link-terminal',
          }),
        }),
      ]),
    );
  });

  it('builds Codex targets as HTTP-first when HTTP settings are provided', async () => {
    const targets = await buildDefaultAgentIntegrationTargets({
      appData: 'C:\\Users\\A\\AppData\\Roaming',
      appRoot: 'C:\\Users\\Admin\\Desktop\\Code\\link-terminal',
      home: 'C:\\Users\\A',
      httpTransport: {
        url: 'http://localhost:57371/mcp',
        bearerTokenEnvVar: 'LINKTERM_MCP_TOKEN',
      },
      launchConfig: {
        command: 'C:\\Program Files\\LinkTerm\\LinkTerm.exe',
        args: ['C:\\Users\\Admin\\Desktop\\Code\\link-terminal'],
        env: { LINKTERM_MCP_STDIO: '1' },
      },
      wslHomeDirs: async () => [
        {
          distroName: 'Ubuntu-24.04',
          userName: 'jianyin',
          homePath: '\\\\wsl.localhost\\Ubuntu-24.04\\home\\jianyin',
          linuxHomePath: '/home/jianyin',
        },
      ],
    });

    expect(targets).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'codex',
        transport: {
          type: 'http',
          url: 'http://localhost:57371/mcp',
          bearerTokenEnvVar: 'LINKTERM_MCP_TOKEN',
        },
      }),
      expect.objectContaining({
        id: 'codex:wsl:Ubuntu-24.04:jianyin',
        transport: {
          type: 'http',
          url: 'http://localhost:57371/mcp',
          bearerTokenEnvVar: 'LINKTERM_MCP_TOKEN',
        },
        launchConfig: expect.objectContaining({
          command: 'cmd.exe',
        }),
      }),
    ]));
  });

  it('discovers WSL Codex targets through the WSL command runner', async () => {
    const targets = await buildDefaultAgentIntegrationTargets({
      appData: 'C:\\Users\\A\\AppData\\Roaming',
      home: 'C:\\Users\\A',
      wslCommandRunner: {
        listDistros: async () => ['Ubuntu-24.04'],
        getDefaultUserHome: async (distroName) => ({
          distroName,
          userName: 'jianyin',
          linuxHomePath: '/home/jianyin',
        }),
      },
    });

    expect(targets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'codex:wsl:Ubuntu-24.04:jianyin',
          configPath: '\\\\wsl.localhost\\Ubuntu-24.04\\home\\jianyin\\.codex\\config.toml',
          locationLabel: 'WSL: Ubuntu-24.04 / jianyin',
        }),
      ]),
    );
  });

  it('normalizes WSL command output with NUL characters', async () => {
    const targets = await buildDefaultAgentIntegrationTargets({
      appData: 'C:\\Users\\A\\AppData\\Roaming',
      home: 'C:\\Users\\A',
      wslCommandRunner: {
        listDistros: async () => [`${'Ubuntu-24.04'.split('').join('\0')}\0`],
        getDefaultUserHome: async (distroName) => ({
          distroName,
          userName: 'jianyin',
          linuxHomePath: '/home/jianyin',
        }),
      },
    });

    expect(targets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'codex:wsl:Ubuntu-24.04:jianyin',
          configPath: '\\\\wsl.localhost\\Ubuntu-24.04\\home\\jianyin\\.codex\\config.toml',
        }),
      ]),
    );
  });
});
