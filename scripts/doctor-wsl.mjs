import { createRequire } from 'node:module';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);

export function checkWslNativeDependencies(options = {}) {
  const platform = options.platform ?? process.platform;
  const arch = options.arch ?? process.arch;
  const cwd = options.cwd ?? process.cwd();
  const requireResolve = options.requireResolve ?? ((id) => require.resolve(id));
  const readTextFile = options.readTextFile ?? ((filePath) => readFileSync(filePath, 'utf-8'));
  const listDirectory = options.listDirectory ?? ((dirPath) => readdirSync(dirPath));
  const messages = [];

  if (platform !== 'linux') {
    messages.push('WSL native dependency check skipped: current host is not Linux.');
    return { ok: true, messages };
  }
  if (arch !== 'x64') {
    messages.push(`WSL native dependency check skipped: unsupported arch ${arch}.`);
    return { ok: true, messages };
  }

  const requiredPackages = [
    '@rolldown/binding-linux-x64-gnu',
    '@tailwindcss/oxide-linux-x64-gnu',
  ];
  const missing = [];
  for (const packageName of requiredPackages) {
    try {
      requireResolve(packageName);
    } catch {
      if (!pnpmVirtualStoreHasPackage(cwd, packageName, listDirectory)) {
        missing.push(packageName);
      }
    }
  }

  if (missing.length === 0) {
    messages.push('WSL native dependencies are installed.');
    return { ok: true, messages };
  }

  messages.push(`Missing WSL/Linux native dependencies: ${missing.join(', ')}`);
  messages.push(...nativeDependencyMetadataMessages(cwd, readTextFile));
  if (/^\/mnt\/[a-z]\//i.test(cwd)) {
    messages.push(`Workspace is on a Windows mount (${cwd}); WSL pnpm repair may fail on Windows file locks or NTFS rename permissions.`);
    messages.push('Stop LinkTerm/Electron and other Windows processes using this checkout, then run pnpm install --force from Windows PowerShell.');
    messages.push('For the most reliable WSL test loop, clone the repository under the Linux filesystem and run pnpm install there.');
  } else {
    messages.push('Run from the repository root inside WSL: pnpm install --force');
    messages.push('If node_modules was installed only from Windows, reinstall inside WSL before running Vitest or Vite.');
  }
  return { ok: false, messages };
}

function pnpmVirtualStoreHasPackage(cwd, packageName, listDirectory) {
  let entries = [];
  try {
    entries = listDirectory(path.join(cwd, 'node_modules', '.pnpm'));
  } catch {
    return false;
  }
  const prefix = `${packageName.replace('/', '+')}@`;
  return entries.some((entry) => entry.startsWith(prefix));
}

function nativeDependencyMetadataMessages(cwd, readTextFile) {
  const messages = [];
  const packageStatus = packageSupportedArchitecturesStatus(path.join(cwd, 'package.json'), readTextFile);
  if (!packageStatus.ok) {
    messages.push(`package.json pnpm.supportedArchitectures is incomplete for WSL/Linux x64: ${packageStatus.missing.join(', ')}`);
  }

  const workspaceStatus = workspaceSupportedArchitecturesStatus(path.join(cwd, 'pnpm-workspace.yaml'), readTextFile);
  if (!workspaceStatus.ok) {
    messages.push(`pnpm-workspace.yaml supportedArchitectures is incomplete for WSL/Linux x64: ${workspaceStatus.missing.join(', ')}`);
  }

  const lockStatus = lockfileNativeBindingStatus(path.join(cwd, 'pnpm-lock.yaml'), readTextFile);
  if (!lockStatus.ok) {
    messages.push(`pnpm-lock.yaml is missing Linux native binding entries: ${lockStatus.missing.join(', ')}`);
  }

  if (!packageStatus.ok || !workspaceStatus.ok || !lockStatus.ok) {
    messages.push('Refresh repository metadata before sharing or testing from WSL: pnpm install --lockfile-only');
  }
  return messages;
}

function packageSupportedArchitecturesStatus(filePath, readTextFile) {
  try {
    const pkg = JSON.parse(readTextFile(filePath));
    const supported = pkg?.pnpm?.supportedArchitectures;
    return supportedArchitecturesStatus(supported);
  } catch {
    return { ok: false, missing: ['package.json'] };
  }
}

function workspaceSupportedArchitecturesStatus(filePath, readTextFile) {
  try {
    return supportedArchitectureTextStatus(readTextFile(filePath));
  } catch {
    return { ok: false, missing: ['pnpm-workspace.yaml'] };
  }
}

function lockfileNativeBindingStatus(filePath, readTextFile) {
  let text = '';
  try {
    text = readTextFile(filePath);
  } catch {
    return { ok: false, missing: ['pnpm-lock.yaml'] };
  }
  const required = ['@rolldown/binding-linux-x64-gnu', '@tailwindcss/oxide-linux-x64-gnu'];
  const missing = required.filter((entry) => !text.includes(entry));
  return { ok: missing.length === 0, missing };
}

function supportedArchitecturesStatus(supported) {
  const checks = [
    ['os', 'linux'],
    ['cpu', 'x64'],
    ['libc', 'glibc'],
  ];
  const missing = checks
    .filter(([key, value]) => !Array.isArray(supported?.[key]) || !supported[key].includes(value))
    .map(([key, value]) => `${key}:${value}`);
  return { ok: missing.length === 0, missing };
}

function supportedArchitectureTextStatus(text) {
  const required = ['supportedArchitectures:', '- linux', '- x64', '- glibc'];
  const missing = required.filter((entry) => !text.includes(entry));
  return { ok: missing.length === 0, missing };
}

export function main() {
  const result = checkWslNativeDependencies();
  for (const message of result.messages) {
    console.log(message);
  }
  return result.ok ? 0 : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  process.exitCode = main();
}
