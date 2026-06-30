#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(scriptDir, '..');

export function buildElectronStartEnv(env = process.env) {
  const next = { ...env };
  delete next.ELECTRON_RUN_AS_NODE;
  next.LINKTERM_FORCE_DIST = '1';
  return next;
}

export function electronExecutablePath(root = repoRoot) {
  return electronLaunchCommand(root).executable;
}

export function electronLaunchCommand(root = repoRoot, platform = process.platform) {
  const executable = process.platform === 'win32' ? 'electron.exe' : 'electron';
  const candidate = join(
    root,
    'node_modules',
    '.pnpm',
    'electron@42.4.0',
    'node_modules',
    'electron',
    'dist',
    executable,
  );
  if (existsSync(candidate)) return { executable: candidate, argsPrefix: [] };

  const cliPath = join(root, 'node_modules', 'electron', 'cli.js');
  if (platform === 'win32' && existsSync(cliPath)) {
    return { executable: process.execPath, argsPrefix: [cliPath] };
  }

  return {
    executable: platform === 'win32'
      ? join(root, 'node_modules', '.bin', 'electron.cmd')
      : join(root, 'node_modules', '.bin', 'electron'),
    argsPrefix: [],
  };
}

export function spawnElectron({
  electronExecutable,
  args = process.argv.slice(2),
  env = process.env,
  cwd = repoRoot,
  spawnImpl = spawn,
} = {}) {
  const launch = electronExecutable === undefined
    ? electronLaunchCommand(cwd)
    : { executable: electronExecutable, argsPrefix: [] };
  return spawnImpl(launch.executable, [...launch.argsPrefix, ...(args.length > 0 ? args : ['.'])], {
    cwd,
    env: buildElectronStartEnv(env),
    stdio: 'inherit',
    windowsHide: false,
  });
}

export function isDirectCliRun(moduleUrl = import.meta.url, argvPath = process.argv[1]) {
  return Boolean(argvPath) && moduleUrl === fileUrlForCliPath(argvPath);
}

export function fileUrlForCliPath(argvPath) {
  const windowsPath = argvPath.match(/^([A-Za-z]):[\\/](.*)$/u);
  if (windowsPath) {
    const drive = windowsPath[1].toUpperCase();
    const rest = windowsPath[2].replace(/\\/gu, '/').split('/').map(encodeURIComponent).join('/');
    return `file:///${drive}:/${rest}`;
  }
  return pathToFileURL(argvPath).href;
}

if (isDirectCliRun()) {
  const child = spawnElectron();
  child.on('exit', (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exit(code ?? 0);
  });
  child.on('error', (err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
