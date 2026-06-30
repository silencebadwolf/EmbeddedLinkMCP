import { EventEmitter } from 'node:events';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testDir, '../../..');
const startScriptPath = path.join(repoRoot, 'scripts', 'start-electron.mjs');

async function importStartScript(): Promise<typeof import('../../../scripts/start-electron.mjs')> {
  return import(pathToFileURL(startScriptPath).href);
}

describe('start-electron launcher', () => {
  it('is used by the package start script', async () => {
    const pkg = JSON.parse(await readFile(path.join(repoRoot, 'package.json'), 'utf-8')) as {
      scripts?: Record<string, string>;
    };

    expect(pkg.scripts?.start).toBe('node scripts/start-electron.mjs .');
  });

  it('removes inherited Electron Node mode before spawning Electron', async () => {
    const { buildElectronStartEnv } = await importStartScript();

    const env = buildElectronStartEnv({
      ELECTRON_RUN_AS_NODE: '1',
      KEEP_ME: 'yes',
    });

    expect(env.ELECTRON_RUN_AS_NODE).toBeUndefined();
    expect(env.KEEP_ME).toBe('yes');
  });

  it('forces the packaged renderer for pnpm start launches', async () => {
    const { buildElectronStartEnv } = await importStartScript();

    const env = buildElectronStartEnv({
      LINKTERM_FORCE_DIST: '0',
      KEEP_ME: 'yes',
    });

    expect(env.LINKTERM_FORCE_DIST).toBe('1');
    expect(env.KEEP_ME).toBe('yes');
  });

  it('spawns Electron visibly with sanitized env and a default app argument', async () => {
    const { spawnElectron } = await importStartScript();
    const child = new EventEmitter();
    const spawnImpl = vi.fn(() => child);

    const spawned = spawnElectron({
      electronExecutable: 'C:\\Tools\\electron.exe',
      args: [],
      env: { ELECTRON_RUN_AS_NODE: '1', KEEP_ME: 'yes' },
      cwd: repoRoot,
      spawnImpl,
    });

    expect(spawned).toBe(child);
    expect(spawnImpl).toHaveBeenCalledWith(
      'C:\\Tools\\electron.exe',
      ['.'],
      expect.objectContaining({
        cwd: repoRoot,
        windowsHide: false,
        stdio: 'inherit',
        env: expect.objectContaining({ KEEP_ME: 'yes', LINKTERM_FORCE_DIST: '1' }),
      }),
    );
    expect(spawnImpl.mock.calls[0]?.[2]?.env?.ELECTRON_RUN_AS_NODE).toBeUndefined();
  });

  it('falls back to Electron cli.js with Node instead of spawning a Windows cmd shim', async () => {
    const { electronLaunchCommand } = await importStartScript();
    const root = path.join(repoRoot, '.tmp-start-electron-test');
    const cliPath = path.join(root, 'node_modules', 'electron', 'cli.js');
    await rm(root, { recursive: true, force: true });
    await mkdir(path.dirname(cliPath), { recursive: true });
    await writeFile(cliPath, '');

    try {
      const command = electronLaunchCommand(root, 'win32');

      expect(command.executable).toBe(process.execPath);
      expect(command.argsPrefix).toEqual([cliPath]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('prefers a real Electron dist executable even when package metadata is damaged', async () => {
    const { electronLaunchCommand } = await importStartScript();
    const root = path.join(repoRoot, '.tmp-start-electron-test');
    const electronExe = path.join(
      root,
      'node_modules',
      '.pnpm',
      'electron@42.4.0',
      'node_modules',
      'electron',
      'dist',
      'electron.exe',
    );
    const damagedPathTxt = path.join(
      root,
      'node_modules',
      '.pnpm',
      'electron@42.4.0',
      'node_modules',
      'electron',
      'path.txt',
    );
    await rm(root, { recursive: true, force: true });
    await mkdir(path.dirname(electronExe), { recursive: true });
    await writeFile(electronExe, '');
    await writeFile(damagedPathTxt, Buffer.from([0x00, 0xff, 0x00]));

    try {
      const command = electronLaunchCommand(root, 'win32');

      expect(command).toEqual({ executable: electronExe, argsPrefix: [] });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('uses the platform argument when choosing the direct Electron executable name', async () => {
    const { electronLaunchCommand } = await importStartScript();
    const root = path.join(repoRoot, '.tmp-start-electron-test');
    const electronExe = path.join(
      root,
      'node_modules',
      '.pnpm',
      'electron@42.4.0',
      'node_modules',
      'electron',
      'dist',
      'electron.exe',
    );
    await rm(root, { recursive: true, force: true });
    await mkdir(path.dirname(electronExe), { recursive: true });
    await writeFile(electronExe, '');

    try {
      const command = electronLaunchCommand(root, 'win32');

      expect(command.executable).toBe(electronExe);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('detects direct CLI execution on Windows paths', async () => {
    const { isDirectCliRun } = await importStartScript();

    expect(isDirectCliRun(
      'file:///C:/Users/Admin/Desktop/Code/link-terminal/scripts/start-electron.mjs',
      'C:\\Users\\Admin\\Desktop\\Code\\link-terminal\\scripts\\start-electron.mjs',
    )).toBe(true);
  });
});
