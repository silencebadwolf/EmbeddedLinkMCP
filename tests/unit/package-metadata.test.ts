import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('package metadata', () => {
  it('installs native optional dependencies for both Windows and WSL x64', async () => {
    const pkg = JSON.parse(await readFile('package.json', 'utf-8')) as {
      scripts?: Record<string, string>;
      pnpm?: {
        supportedArchitectures?: {
          os?: string[];
          cpu?: string[];
          libc?: string[];
        };
      };
    };

    expect(pkg.scripts?.pretest).toBe('node scripts/doctor-wsl.mjs');

    expect(pkg.pnpm?.supportedArchitectures).toMatchObject({
      os: expect.arrayContaining(['current', 'win32', 'linux']),
      cpu: expect.arrayContaining(['current', 'x64']),
      libc: expect.arrayContaining(['current', 'glibc']),
    });

    const workspace = await readFile('pnpm-workspace.yaml', 'utf-8');
    expect(workspace).toContain('supportedArchitectures:');
    expect(workspace).toContain('- win32');
    expect(workspace).toContain('- linux');
    expect(workspace).toContain('- x64');
    expect(workspace).toContain('- glibc');
  });
});
