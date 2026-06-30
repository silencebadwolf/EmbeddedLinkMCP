import path from 'node:path';
import { readdir } from 'node:fs/promises';
import type { Dirent } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type {
  AgentIntegrationTarget,
  LinkTermMcpLaunchConfig,
} from '../../core/agent-integrations/index.js';
import { buildWslInteropLaunchConfig } from '../../core/agent-integrations/index.js';

const execFileAsync = promisify(execFile);

export interface WslHomeDir {
  distroName: string;
  userName: string;
  homePath: string;
  linuxHomePath?: string;
}

export interface WslCommandRunner {
  listDistros(): Promise<ReadonlyArray<string>>;
  getDefaultUserHome(distroName: string): Promise<{
    distroName: string;
    userName: string;
    linuxHomePath: string;
  } | undefined>;
}

export interface BuildDefaultAgentIntegrationTargetsOptions {
  appData: string;
  appRoot?: string;
  home: string;
  launchConfig?: LinkTermMcpLaunchConfig;
  httpTransport?: {
    url: string;
    bearerTokenEnvVar?: string;
  };
  wslHomeDirs?: () => Promise<ReadonlyArray<WslHomeDir>>;
  wslCommandRunner?: WslCommandRunner;
}

/** Build local and WSL Agent configuration targets that LinkTerm can install into. */
export async function buildDefaultAgentIntegrationTargets(
  options: BuildDefaultAgentIntegrationTargetsOptions,
): Promise<AgentIntegrationTarget[]> {
  const targets: AgentIntegrationTarget[] = [
    {
      id: 'vscode',
      label: 'VS Code Copilot',
      configPath: path.win32.join(options.appData, 'Code', 'User', 'mcp.json'),
      configKind: 'vscode-mcp-json',
      platform: 'windows',
      locationLabel: 'Windows',
    },
    {
      id: 'claude-desktop',
      label: 'Claude Desktop',
      configPath: path.win32.join(options.appData, 'Claude', 'claude_desktop_config.json'),
      configKind: 'mcp-servers',
      platform: 'windows',
      locationLabel: 'Windows',
    },
    {
      id: 'cursor',
      label: 'Cursor',
      configPath: path.win32.join(options.home, '.cursor', 'mcp.json'),
      configKind: 'mcp-servers',
      platform: 'windows',
      locationLabel: 'Windows',
    },
    {
      id: 'codex',
      label: 'Codex',
      configPath: path.win32.join(options.home, '.codex', 'config.toml'),
      configKind: 'codex-config-toml',
      ...(options.httpTransport
        ? { transport: { type: 'http' as const, ...options.httpTransport } }
        : {}),
      platform: 'windows',
      locationLabel: 'Windows',
    },
  ];

  const wslHomes = await (options.wslHomeDirs ?? (() => defaultWslHomeDirs(options.wslCommandRunner)))();
  for (const homeDir of wslHomes) {
    targets.push({
      id: `codex:wsl:${homeDir.distroName}:${homeDir.userName}`,
      label: `Codex (${homeDir.distroName})`,
      configPath: path.win32.join(homeDir.homePath, '.codex', 'config.toml'),
      wslConfigPath: path.posix.join(homeDir.linuxHomePath ?? `/home/${homeDir.userName}`, '.codex', 'config.toml'),
      configKind: 'codex-config-toml',
      launchConfig: options.launchConfig
        ? buildWslInteropLaunchConfig({
            ...options.launchConfig,
            ...(options.appRoot ? { cwd: windowsPathToWslMountPath(options.appRoot) } : {}),
          })
        : undefined,
      ...(options.httpTransport
        ? { transport: { type: 'http' as const, ...options.httpTransport } }
        : {}),
      platform: 'wsl',
      locationLabel: `WSL: ${homeDir.distroName} / ${homeDir.userName}`,
    });
  }

  return targets;
}

async function defaultWslHomeDirs(runner?: WslCommandRunner): Promise<WslHomeDir[]> {
  if (process.platform !== 'win32' && !runner) return [];
  const commandRunner = runner ?? defaultWslCommandRunner();
  const homes = await collectWslHomesFromCommand(commandRunner);
  if (homes.length > 0) return homes;
  const roots = await collectWslRoots();
  const uncHomes: WslHomeDir[] = [];
  for (const root of roots) {
    const homeRoot = path.win32.join(root.path, 'home');
    let users: string[];
    try {
      const entries = await readdir(homeRoot, { withFileTypes: true });
      users = entries
        .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
        .map((entry) => entry.name);
    } catch {
      users = [];
    }
    for (const userName of users) {
      uncHomes.push({
        distroName: root.distroName,
        userName,
        homePath: path.join(homeRoot, userName),
        linuxHomePath: `/home/${userName}`,
      });
    }
  }
  return uncHomes;
}

async function collectWslHomesFromCommand(runner: WslCommandRunner): Promise<WslHomeDir[]> {
  let distros: ReadonlyArray<string>;
  try {
    distros = await runner.listDistros();
  } catch {
    return [];
  }
  const homes: WslHomeDir[] = [];
  for (const distroName of distros) {
    const trimmedDistro = normalizeWslText(distroName);
    if (!trimmedDistro) continue;
    let home: Awaited<ReturnType<WslCommandRunner['getDefaultUserHome']>>;
    try {
      home = await runner.getDefaultUserHome(trimmedDistro);
    } catch {
      continue;
    }
    if (!home) continue;
    homes.push({
      distroName: trimmedDistro,
      userName: home.userName,
      linuxHomePath: home.linuxHomePath,
      homePath: linuxHomeToUncPath(trimmedDistro, home.linuxHomePath),
    });
  }
  return homes;
}

async function collectWslRoots(): Promise<Array<{ distroName: string; path: string }>> {
  const roots: Array<{ distroName: string; path: string }> = [];
  for (const host of ['wsl.localhost', 'wsl$']) {
    const base = `\\\\${host}\\`;
    let entries: Dirent[];
    try {
      entries = await readdir(base, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        roots.push({ distroName: entry.name, path: path.join(base, entry.name) });
      }
    }
    if (roots.length > 0) break;
  }
  return roots;
}

function defaultWslCommandRunner(): WslCommandRunner {
  return {
    listDistros: async () => {
      const { stdout } = await execFileAsync('wsl.exe', ['--list', '--quiet'], {
        windowsHide: true,
        timeout: 5000,
      });
      return stdout
        .replace(/^\uFEFF/u, '')
        .split(/\r?\n/u)
        .map(normalizeWslText)
        .filter(Boolean);
    },
    getDefaultUserHome: async (distroName) => {
      const { stdout } = await execFileAsync(
        'wsl.exe',
        ['-d', distroName, '--', 'sh', '-lc', 'printf "%s\\n%s\\n" "$(id -un)" "$HOME"'],
        { windowsHide: true, timeout: 5000 },
      );
      const [userName, linuxHomePath] = stdout
        .split(/\r?\n/u)
        .map(normalizeWslText)
        .filter(Boolean);
      if (!userName || !linuxHomePath) return undefined;
      return { distroName, userName, linuxHomePath };
    },
  };
}

function linuxHomeToUncPath(distroName: string, linuxHomePath: string): string {
  const normalized = linuxHomePath.replace(/^\/+/u, '').replace(/\//gu, '\\');
  return `\\\\wsl.localhost\\${distroName}\\${normalized}`;
}

function windowsPathToWslMountPath(windowsPath: string): string | undefined {
  const normalized = path.win32.resolve(windowsPath);
  const drive = normalized.match(/^([A-Za-z]):\\/u)?.[1]?.toLowerCase();
  if (!drive) return undefined;
  const withoutDrive = normalized.slice(3).replace(/\\/gu, '/');
  return `/mnt/${drive}/${withoutDrive}`;
}

function normalizeWslText(value: string): string {
  return value.replace(/\u0000/gu, '').replace(/^\uFEFF/u, '').trim();
}
