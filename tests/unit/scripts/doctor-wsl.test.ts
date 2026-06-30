import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testDir, '../../..');
const doctorScriptPath = path.join(repoRoot, 'scripts', 'doctor-wsl.mjs');

async function importDoctorScript(): Promise<typeof import('../../../scripts/doctor-wsl.mjs')> {
  return import(pathToFileURL(doctorScriptPath).href);
}

describe('doctor-wsl script', () => {
  it('runs its CLI entrypoint when executed directly', () => {
    const output = execFileSync(process.execPath, [doctorScriptPath], {
      encoding: 'utf-8',
      windowsHide: true,
    });

    expect(output).toContain('WSL native dependenc');
  });

  it('is exposed through package.json', async () => {
    const pkg = JSON.parse(await readFile(path.join(repoRoot, 'package.json'), 'utf-8')) as {
      scripts?: Record<string, string>;
    };

    expect(pkg.scripts?.['doctor:wsl']).toBe('node scripts/doctor-wsl.mjs');
  });

  it('reports missing Linux native bindings with a concrete pnpm repair command', async () => {
    const { checkWslNativeDependencies } = await importDoctorScript();

    const result = checkWslNativeDependencies({
      platform: 'linux',
      arch: 'x64',
      cwd: '/home/me/link-terminal',
      requireResolve: () => {
        throw Object.assign(new Error('Cannot find module'), { code: 'MODULE_NOT_FOUND' });
      },
      listDirectory: () => {
        throw Object.assign(new Error('missing'), { code: 'ENOENT' });
      },
    });

    expect(result.ok).toBe(false);
    expect(result.messages.join('\n')).toContain('@rolldown/binding-linux-x64-gnu');
    expect(result.messages.join('\n')).toContain('pnpm install --force');
  });

  it('accepts Linux native bindings installed in the pnpm virtual store', async () => {
    const { checkWslNativeDependencies } = await importDoctorScript();

    const result = checkWslNativeDependencies({
      platform: 'linux',
      arch: 'x64',
      cwd: '/mnt/c/Users/Admin/Desktop/Code/link-terminal',
      requireResolve: () => {
        throw Object.assign(new Error('Cannot find module'), { code: 'MODULE_NOT_FOUND' });
      },
      listDirectory: (dirPath: string) => {
        if (dirPath.replaceAll('\\', '/').endsWith('/node_modules/.pnpm')) {
          return [
            '@rolldown+binding-linux-x64-gnu@1.0.0',
            '@tailwindcss+oxide-linux-x64-gnu@4.1.0',
          ];
        }
        throw Object.assign(new Error('missing'), { code: 'ENOENT' });
      },
    });

    expect(result.ok).toBe(true);
    expect(result.messages.join('\n')).toContain('WSL native dependencies are installed.');
  });

  it('reports when package metadata no longer asks pnpm to install WSL native bindings', async () => {
    const { checkWslNativeDependencies } = await importDoctorScript();

    const result = checkWslNativeDependencies({
      platform: 'linux',
      arch: 'x64',
      cwd: '/home/me/link-terminal',
      requireResolve: () => {
        throw Object.assign(new Error('Cannot find module'), { code: 'MODULE_NOT_FOUND' });
      },
      readTextFile: (filePath: string) => {
        if (filePath.endsWith('package.json')) return '{"pnpm":{"supportedArchitectures":{"os":["current"],"cpu":["current"],"libc":["current"]}}}';
        if (filePath.endsWith('pnpm-workspace.yaml')) return 'packages:\n  - .\n';
        if (filePath.endsWith('pnpm-lock.yaml')) return 'lockfileVersion: 9.0\n';
        throw Object.assign(new Error('missing'), { code: 'ENOENT' });
      },
    });

    const message = result.messages.join('\n');
    expect(result.ok).toBe(false);
    expect(message).toContain('package.json pnpm.supportedArchitectures');
    expect(message).toContain('pnpm-workspace.yaml supportedArchitectures');
    expect(message).toContain('pnpm install --lockfile-only');
  });

  it('warns WSL users about Windows-mounted workspaces because pnpm repair can hit file locks', async () => {
    const { checkWslNativeDependencies } = await importDoctorScript();

    const result = checkWslNativeDependencies({
      platform: 'linux',
      arch: 'x64',
      cwd: '/mnt/c/Users/Admin/Desktop/Code/link-terminal',
      requireResolve: () => {
        throw Object.assign(new Error('Cannot find module'), { code: 'MODULE_NOT_FOUND' });
      },
      listDirectory: () => {
        throw Object.assign(new Error('missing'), { code: 'ENOENT' });
      },
    });

    const message = result.messages.join('\n');
    expect(message).toContain('/mnt/c');
    expect(message).toContain('Stop LinkTerm/Electron');
    expect(message).toContain('Windows PowerShell');
  });

  it('passes on non-Linux hosts without requiring Linux native bindings', async () => {
    const { checkWslNativeDependencies } = await importDoctorScript();

    const result = checkWslNativeDependencies({
      platform: 'win32',
      arch: 'x64',
      requireResolve: () => {
        throw new Error('should not be called');
      },
    });

    expect(result.ok).toBe(true);
  });
});
