import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import type {
  AgentIntegrationTarget,
  WslAgentConfigFileBridge,
} from '@linkterm/runtime/core/agent-integrations/index';

const execFileAsync = promisify(execFile);

export function createWslAgentConfigFileBridge(): WslAgentConfigFileBridge {
  return {
    readFile: async (target) => runWslRead(target),
    writeFile: async (target, data) => runWslWrite(target, data),
    writeBackup: async (target, data, backupName) => {
      const backupPath = `${requireWslConfigPath(target)}.${backupName}`;
      await runWslWrite(target, data, backupPath);
      return backupPath;
    },
  };
}

async function runWslRead(target: AgentIntegrationTarget): Promise<string> {
  try {
    const { stdout } = await execFileAsync(
      'wsl.exe',
      [
        '-d',
        requireWslDistroName(target),
        '-e',
        '/bin/sh',
        '-lc',
        'cat "$1"',
        'sh',
        requireWslConfigPath(target),
      ],
      {
        windowsHide: true,
        timeout: 5000,
      },
    );
    return stdout;
  } catch (err) {
    if (isWslMissingFileError(err)) {
      const notFound = new Error(`Missing WSL config file: ${requireWslConfigPath(target)}`) as NodeJS.ErrnoException;
      notFound.code = 'ENOENT';
      throw notFound;
    }
    throw err;
  }
}

async function runWslWrite(
  target: AgentIntegrationTarget,
  data: string,
  overridePath?: string,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const targetPath = overridePath ?? requireWslConfigPath(target);
    const child = spawn(
      'wsl.exe',
      [
        '-d',
        requireWslDistroName(target),
        '-e',
        '/bin/sh',
        '-lc',
        'mkdir -p "$(dirname "$1")" && cat > "$1"',
        'sh',
        targetPath,
      ],
      {
        stdio: ['pipe', 'ignore', 'pipe'],
        windowsHide: true,
      },
    );
    let stderr = '';
    child.stderr.setEncoding('utf-8');
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`wsl.exe exited with code ${code}: ${stderr.trim()}`));
      }
    });
    child.stdin.end(data, 'utf-8');
  });
}

function requireWslDistroName(target: AgentIntegrationTarget): string {
  const parts = target.id.split(':');
  const distroName = parts[2];
  if (target.platform !== 'wsl' || !distroName) {
    throw new Error(`Agent integration target is not a WSL target: ${target.id}`);
  }
  return distroName;
}

function requireWslConfigPath(target: AgentIntegrationTarget): string {
  if (!target.wslConfigPath) {
    throw new Error(`Missing WSL config path for target: ${target.id}`);
  }
  return target.wslConfigPath;
}

function isWslMissingFileError(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const stderr = 'stderr' in err ? String((err as { stderr?: unknown }).stderr ?? '') : '';
  const message = err instanceof Error ? err.message : '';
  return `${stderr}\n${message}`.includes('No such file or directory');
}
