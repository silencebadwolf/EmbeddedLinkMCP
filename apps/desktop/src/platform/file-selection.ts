import { execFile } from 'node:child_process';
import type { Dirent } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { electron } from './electron-runtime.js';
import type { PreloadResult } from '@linkterm/contracts/preload-api';
import {
  decodeFirmwareImageByPath,
  isSelfDescribingFirmwareImagePath,
} from '@linkterm/runtime/core/workspace/firmware-image';
import { formatHexAddress } from '@linkterm/runtime/core/workspace/intel-hex';
const { dialog } = electron;
const execFileAsync = promisify(execFile);

/**
 * 打开目录选择器并返回用户选择的工作区目录。
 *
 * @returns 成功结果；用户取消时 root 为 null
 */
export async function chooseWorkspaceRoot(): Promise<PreloadResult<{ root: string | null }>> {
  const defaultPath = await resolveWorkspaceDialogDefaultPath();
  const result = await dialog.showOpenDialog({
    title: 'Select workspace folder',
    properties: ['openDirectory'],
    ...(defaultPath ? { defaultPath } : {}),
  });
  return { success: true, data: { root: result.canceled ? null : (result.filePaths[0] ?? null) } };
}

async function resolveWorkspaceDialogDefaultPath(): Promise<string | undefined> {
  if (process.platform !== 'win32') return undefined;
  const home = await discoverDefaultWslHomePath();
  if (home) return home;
  return discoverFirstWslShareRoot();
}

async function discoverDefaultWslHomePath(): Promise<string | undefined> {
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
    return undefined;
  }

  for (const distroName of distros) {
    try {
      const { stdout } = await execFileAsync(
        'wsl.exe',
        ['-d', distroName, '--', 'sh', '-lc', 'printf "%s\\n%s\\n" "$(id -un)" "$HOME"'],
        { windowsHide: true, timeout: 5000 },
      );
      const [, linuxHomePath] = stdout.split(/\r?\n/u).map(normalizeWslText).filter(Boolean);
      if (linuxHomePath) return linuxPathToWslUnc(distroName, linuxHomePath);
    } catch {
      // Ignore unavailable distros and try the next registered one.
    }
  }
  return undefined;
}

async function discoverFirstWslShareRoot(): Promise<string | undefined> {
  for (const host of ['wsl.localhost', 'wsl$']) {
    const base = `\\\\${host}\\`;
    let entries: Dirent[];
    try {
      entries = await readdir(base, { withFileTypes: true });
    } catch {
      continue;
    }
    const firstDistro = entries.find((entry) => entry.isDirectory());
    if (firstDistro) return path.win32.join(base, firstDistro.name);
  }
  return undefined;
}

function linuxPathToWslUnc(distroName: string, linuxPath: string): string {
  const normalized = path.posix.normalize(linuxPath).replace(/^\/+/u, '').replace(/\//gu, '\\');
  return `\\\\wsl.localhost\\${distroName}\\${normalized}`;
}

function normalizeWslText(value: string): string {
  return value
    .replace(/\u0000/gu, '')
    .replace(/^\uFEFF/u, '')
    .trim();
}

/**
 * 打开文件选择器并返回用户选择的固件文件路径。
 *
 * @returns 成功结果；用户取消时 path 为 null
 */
export async function chooseFirmwareFile(): Promise<
  PreloadResult<{ path: string | null; baseAddress?: string }>
> {
  try {
    const result = await dialog.showOpenDialog({
      title: 'Select firmware file',
      properties: ['openFile'],
      filters: [
        { name: 'Firmware images', extensions: ['bin', 'hex', 'elf'] },
        { name: 'All files', extensions: ['*'] },
      ],
    });
    const selectedPath = result.canceled ? null : (result.filePaths[0] ?? null);
    if (selectedPath === null || !isSelfDescribingFirmwareImagePath(selectedPath)) {
      return { success: true, data: { path: selectedPath } };
    }
    const image = decodeFirmwareImageByPath(selectedPath, await readFile(selectedPath));
    return {
      success: true,
      data: {
        path: selectedPath,
        ...(image.baseAddress !== undefined
          ? { baseAddress: formatHexAddress(image.baseAddress) }
          : {}),
      },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: { code: 'INVALID_FIRMWARE_IMAGE', message } };
  }
}
