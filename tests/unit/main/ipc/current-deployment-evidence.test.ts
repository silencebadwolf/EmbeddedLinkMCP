import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { readCurrentControlProfileDeploymentEvidence } from '../../../../src/main/ipc/current-deployment-evidence.js';
import type { ControlProfileManager } from '../../../../src/core/workspace/index.js';

describe('readCurrentControlProfileDeploymentEvidence', () => {
  it('does not read firmware through a workspace symlink that resolves outside the workspace', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'linkterm-current-evidence-root-'));
    const outside = await mkdtemp(path.join(os.tmpdir(), 'linkterm-current-evidence-outside-'));

    try {
      await mkdir(path.join(root, 'build'), { recursive: true });
      await writeFile(path.join(outside, 'app.bin'), Buffer.from([0x00, 0x20, 0x00, 0x20]));
      await symlink(
        outside,
        path.join(root, 'build', 'linked'),
        process.platform === 'win32' ? 'junction' : 'dir',
      );

      const manager = {
        load: vi.fn(async () => ({
          schemaVersion: 'linkterm-control/1.0.0' as const,
          jlink: {
            enabled: true,
            target: 'STM32H743II',
            interface: 'swd' as const,
            speedKHz: 4000,
          },
          flash: {
            binary: 'build/linked/app.bin',
            baseAddress: '0x08000000',
            verify: true,
          },
          rtt: { enabled: true, channels: [0], controlBlockAddress: '0x24000000' },
        })),
      } as unknown as ControlProfileManager;

      await expect(
        readCurrentControlProfileDeploymentEvidence(manager, root),
      ).resolves.toBeUndefined();
    } finally {
      await rm(root, { recursive: true, force: true });
      await rm(outside, { recursive: true, force: true });
    }
  });
});
