import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';

import {
  buildCurrentVerifiedDeploymentEvidence,
  type VerifiedDeploymentEvidence,
} from '../core/compensation/index.js';
import type { ControlProfileManager } from '../core/workspace/index.js';
import { decodeFirmwareImageByPath } from '../core/workspace/firmware-image.js';

const CONTROL_PROFILE_REFLASH_WORKFLOW_MODE = 'flash-observe';
const CONTROL_PROFILE_REFLASH_OBSERVE = { enabled: false, serial: false } as const;

export async function readCurrentControlProfileDeploymentEvidence(
  manager: ControlProfileManager,
  root: string,
): Promise<VerifiedDeploymentEvidence | undefined> {
  try {
    const profile = await manager.load(root);
    const flash = profile.flash;
    if (flash?.binary === undefined || flash.baseAddress === undefined) return undefined;
    if (profile.jlink?.enabled !== true) return undefined;

    const absolutePath = resolveWorkspaceChildPath(root, flash.binary);
    const profileBaseAddress = parseHexAddress(flash.baseAddress);
    if (absolutePath === undefined || profileBaseAddress === undefined) return undefined;
    const realFirmwarePath = await resolveWorkspaceRealChildPath(root, absolutePath);
    if (realFirmwarePath === undefined) return undefined;

    const image = decodeFirmwareImageByPath(realFirmwarePath, await readFile(realFirmwarePath));
    const baseAddress = image.baseAddress ?? profileBaseAddress;

    return buildCurrentVerifiedDeploymentEvidence({
      root,
      profile,
      workflowMode: CONTROL_PROFILE_REFLASH_WORKFLOW_MODE,
      observe: CONTROL_PROFILE_REFLASH_OBSERVE,
      firmware: {
        absolutePath: realFirmwarePath,
        sourcePath: flash.binary,
        binary: image.binary,
        format: image.format,
        baseAddress,
        verify: flash.verify ?? true,
      },
    });
  } catch {
    return undefined;
  }
}

async function resolveWorkspaceRealChildPath(
  root: string,
  resolvedChildPath: string,
): Promise<string | undefined> {
  const [realRoot, realChild] = await Promise.all([realpath(root), realpath(resolvedChildPath)]);
  if (!isPathInside(realRoot, realChild)) return undefined;
  return realChild;
}

function isPathInside(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function resolveWorkspaceChildPath(root: string, childPath: string): string | undefined {
  const trimmed = childPath.trim();
  if (trimmed === '') return undefined;
  const normalizedRoot = path.resolve(root);
  const resolved = path.resolve(normalizedRoot, trimmed);
  const relative = path.relative(normalizedRoot, resolved);
  if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) return undefined;
  return resolved;
}

function parseHexAddress(value: string): number | undefined {
  if (!/^0x[0-9a-fA-F]+$/u.test(value)) return undefined;
  const parsed = Number.parseInt(value.slice(2), 16);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : undefined;
}
