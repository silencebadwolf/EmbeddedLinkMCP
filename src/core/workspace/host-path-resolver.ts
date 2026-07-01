import path from 'node:path';
import { readdir } from 'node:fs/promises';
import type { Dirent } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface WslHostPathRoot {
  distroName: string;
  linuxRoot: string;
}

export interface HostPathResolver {
  toHostPath(inputPath: string): Promise<string>;
}

export interface HostPathResolverOptions {
  platform?: NodeJS.Platform;
  wslRoots?: () => Promise<ReadonlyArray<WslHostPathRoot>>;
}

export function createHostPathResolver(options: HostPathResolverOptions = {}): HostPathResolver {
  const platform = options.platform ?? process.platform;
  const wslRoots = options.wslRoots ?? defaultWslRoots;
  return {
    async toHostPath(inputPath: string): Promise<string> {
      return toHostPath(inputPath, platform, wslRoots);
    },
  };
}

export const defaultHostPathResolver = createHostPathResolver();

async function toHostPath(
  inputPath: string,
  platform: NodeJS.Platform,
  wslRoots: () => Promise<ReadonlyArray<WslHostPathRoot>>,
): Promise<string> {
  if (platform !== 'win32') return inputPath;
  if (isWindowsDrivePath(inputPath) || isUncPath(inputPath)) return path.win32.normalize(inputPath);
  const drivePath = wslMountPathToWindows(inputPath);
  if (drivePath !== undefined) return drivePath;
  if (!inputPath.startsWith('/')) return inputPath;
  const root = await findWslRoot(inputPath, wslRoots);
  if (root === undefined) return inputPath;
  return linuxPathToWslUnc(root.distroName, inputPath);
}

function wslMountPathToWindows(inputPath: string): string | undefined {
  const match = inputPath.match(/^\/mnt\/([A-Za-z])(?:\/(.*))?$/u);
  if (!match) return undefined;
  const drive = match[1]!.toUpperCase();
  const rest = match[2]?.replace(/\//gu, '\\') ?? '';
  return rest.length > 0 ? `${drive}:\\${rest}` : `${drive}:\\`;
}

async function findWslRoot(
  linuxPath: string,
  wslRoots: () => Promise<ReadonlyArray<WslHostPathRoot>>,
): Promise<WslHostPathRoot | undefined> {
  const roots = await wslRoots();
  return roots
    .filter((root) => isLinuxPathInsideRoot(root.linuxRoot, linuxPath))
    .sort((a, b) => b.linuxRoot.length - a.linuxRoot.length)[0];
}

function isLinuxPathInsideRoot(root: string, candidate: string): boolean {
  const normalizedRoot = normalizeLinuxPath(root);
  const normalizedCandidate = normalizeLinuxPath(candidate);
  return normalizedCandidate === normalizedRoot || normalizedCandidate.startsWith(`${normalizedRoot}/`);
}

function linuxPathToWslUnc(distroName: string, linuxPath: string): string {
  const normalized = normalizeLinuxPath(linuxPath).replace(/^\/+/u, '').replace(/\//gu, '\\');
  return `\\\\wsl.localhost\\${distroName}\\${normalized}`;
}

function normalizeLinuxPath(value: string): string {
  const normalized = path.posix.normalize(value.replace(/\\/gu, '/'));
  return normalized.endsWith('/') && normalized !== '/' ? normalized.slice(0, -1) : normalized;
}

function isWindowsDrivePath(value: string): boolean {
  return /^[A-Za-z]:[\\/]/u.test(value);
}

function isUncPath(value: string): boolean {
  return value.startsWith('\\\\');
}

async function defaultWslRoots(): Promise<WslHostPathRoot[]> {
  if (process.platform !== 'win32') return [];
  const rootsFromCommand = await collectWslRootsFromCommand();
  if (rootsFromCommand.length > 0) return rootsFromCommand;
  return collectWslRootsFromShares();
}

async function collectWslRootsFromCommand(): Promise<WslHostPathRoot[]> {
  let distros: string[];
  try {
    const { stdout } = await execFileAsync('wsl.exe', ['--list', '--quiet'], {
      windowsHide: true,
      timeout: 5000,
    });
    distros = stdout
      .replace(/^\uFEFF/u, '')
      .split(/\r?\n/u)
      .map(normalizeWslText)
      .filter(Boolean);
  } catch {
    return [];
  }
  const roots: WslHostPathRoot[] = [];
  for (const distroName of distros) {
    try {
      const { stdout } = await execFileAsync(
        'wsl.exe',
        ['-d', distroName, '--', 'sh', '-lc', 'printf "%s\\n" "$HOME"'],
        { windowsHide: true, timeout: 5000 },
      );
      const home = stdout
        .split(/\r?\n/u)
        .map(normalizeWslText)
        .find(Boolean);
      if (home !== undefined) roots.push({ distroName, linuxRoot: home });
    } catch {
      // Ignore a distro that is registered but currently unavailable.
    }
  }
  return roots;
}

async function collectWslRootsFromShares(): Promise<WslHostPathRoot[]> {
  const roots: WslHostPathRoot[] = [];
  for (const host of ['wsl.localhost', 'wsl$']) {
    const base = `\\\\${host}\\`;
    let entries: Dirent[];
    try {
      entries = await readdir(base, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) roots.push({ distroName: entry.name, linuxRoot: '/' });
    }
    if (roots.length > 0) break;
  }
  return roots;
}

function normalizeWslText(value: string): string {
  return value.replace(/\u0000/gu, '').replace(/^\uFEFF/u, '').trim();
}
