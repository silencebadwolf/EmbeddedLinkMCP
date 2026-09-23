#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { watch } from 'node:fs';
import { copyFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { buildElectronStartEnv, electronLaunchCommand, isDirectCliRun } from './start-electron.mjs';
import { prepareDevNative } from './prepare-dev-native.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));

/** Only backend artifacts restart Electron; compiled UI changes use Vite HMR. */
export async function desktopRuntimeFingerprint(directory = root) {
  const entries = [];
  const visit = async (path) => {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      const file = join(path, entry.name);
      if (entry.isDirectory()) await visit(file);
      else if (entry.name.endsWith('.js')) {
        const metadata = await stat(file);
        entries.push(`${file}:${metadata.mtimeMs}:${metadata.size}`);
      }
    }
  };
  for (const path of [
    'apps/desktop/dist/main',
    'apps/desktop/dist/preload',
    'apps/desktop/dist/platform',
    'apps/desktop/dist/ipc',
    'packages/contracts/dist',
    'packages/runtime/dist',
    'packages/mcp/dist',
  ]) {
    await visit(join(directory, path));
  }
  return entries.sort().join('\n');
}

/** Await graceful app shutdown before replacing the runtime that owns its devices. */
export async function stopDesktopChild(child, timeoutMs = 5_000) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, 'exit');
  if (child.connected) child.send({ type: 'linkterm:dev:quit' }, () => {});
  else child.kill();
  const timer = setTimeout(() => child.kill(), timeoutMs);
  try {
    await exited;
  } finally {
    clearTimeout(timer);
  }
}

export async function startDesktopDevelopment() {
  const compiler = join(root, 'node_modules/typescript/bin/tsc');
  for (const args of [[join(root, 'scripts/copy-ui-assets.mjs')], [compiler, '-b']]) {
    const child = spawn(process.execPath, args, { cwd: root, stdio: 'inherit', windowsHide: true });
    const [code] = await once(child, 'exit');
    if (code !== 0) throw new Error(`Initial desktop build failed (${code})`);
  }
  const native = await prepareDevNative('desktop');
  let server;
  try { server = await createServer({ configFile: join(root, 'apps/desktop/vite.config.ts') }); }
  catch (error) { await native.cleanup(); throw error; }
  let compilerWatcher, assetWatcher, desktop;
  let closing = false,
    restart = Promise.resolve(),
    fingerprint = '';
  const close = async () => {
    if (closing) return;
    closing = true;
    assetWatcher?.close();
    compilerWatcher?.kill();
    try {
      await restart.catch(() => {});
      await stopDesktopChild(desktop);
      await server.close();
    } finally { await native.cleanup(); }
  };
  const refresh = async () => {
    if (closing) return;
    const next = await desktopRuntimeFingerprint();
    if (next === fingerprint) return;
    await stopDesktopChild(desktop);
    if (closing) return;
    const launch = electronLaunchCommand(root);
    const env = { ...buildElectronStartEnv(process.env), LINKTERM_FORCE_DIST: '0', LINKTERM_DEV_NATIVE_MODULE_ROOT: native.root };
    desktop = spawn(launch.executable, [...launch.argsPrefix, 'apps/desktop'], {
      cwd: root,
      env,
      stdio: ['inherit', 'inherit', 'inherit', 'ipc'],
      windowsHide: false,
    });
    desktop.on('error', fail);
    fingerprint = next;
  };
  const fail = (error) => {
    console.error(error);
    process.exitCode = 1;
    void close();
  };
  process.once('SIGINT', close);
  process.once('SIGTERM', close);
  try {
    await server.listen();
    server.printUrls();
    await refresh();
    assetWatcher = watch(join(root, 'packages/ui/src/styles'), (_event, filename) => {
      if (filename === 'global.css')
        void copyFile(
          join(root, 'packages/ui/src/styles/global.css'),
          join(root, 'packages/ui/dist/styles/global.css'),
        ).catch(fail);
    });
    compilerWatcher = spawn(
      process.execPath,
      [compiler, '-b', '--watch', '--preserveWatchOutput', '--pretty', 'false', '--locale', 'en'],
      {
        cwd: root,
        stdio: ['ignore', 'pipe', 'inherit'],
        windowsHide: true,
      },
    );
    let output = '';
    compilerWatcher.stdout.setEncoding('utf8');
    compilerWatcher.stdout.on('data', (chunk) => {
      process.stdout.write(chunk);
      output += chunk;
      const lines = output.split('\n');
      output = lines.pop() ?? '';
      if (lines.some((line) => /Found 0 errors\. Watching for file changes\./u.test(line))) {
        restart = restart.then(refresh).catch(fail);
      }
    });
    compilerWatcher.on('error', fail);
    compilerWatcher.once('exit', (code) => {
      if (!closing) fail(new Error(`TypeScript watcher stopped (${code})`));
    });
    return close;
  } catch (error) {
    await close();
    throw error;
  }
}

if (isDirectCliRun())
  startDesktopDevelopment().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
