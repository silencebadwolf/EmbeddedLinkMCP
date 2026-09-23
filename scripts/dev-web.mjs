#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { watch } from 'node:fs';
import { copyFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { isDirectCliRun } from './start-electron.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const compiler = join(root, 'node_modules/typescript/bin/tsc');
const backendDirs = ['apps/server/dist', 'packages/contracts/dist', 'packages/runtime/dist', 'packages/mcp/dist'];

async function fingerprint() {
  const entries = [];
  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const filename = join(directory, entry.name);
      if (entry.isDirectory()) await visit(filename);
      else if (entry.name.endsWith('.js')) {
        const metadata = await stat(filename);
        entries.push(`${filename}:${metadata.mtimeMs}:${metadata.size}`);
      }
    }
  }
  for (const directory of backendDirs) await visit(join(root, directory));
  return entries.sort().join('\n');
}

async function run(args) {
  const child = spawn(process.execPath, args, { cwd: root, stdio: 'inherit', windowsHide: true });
  const [code] = await once(child, 'exit');
  if (code !== 0) throw new Error(`Web development build failed (${code})`);
}

async function stopChild(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, 'exit');
  if (child.connected) child.send('linkterm:dev:quit', () => {});
  else child.kill();
  const fallback = setTimeout(() => child.kill(), 5_000);
  try { await exited; } finally { clearTimeout(fallback); }
}

function waitForServerReady(child) {
  return new Promise((resolve, reject) => {
    let settled = false, buffer = '';
    const timeout = setTimeout(() => finish(new Error('Web server did not report readiness within 15 seconds')), 15_000);
    const onExit = code => finish(new Error(`Web server stopped before readiness (${code})`));
    const onError = error => finish(error);
    const finish = error => {
      if (settled) return;
      settled = true; clearTimeout(timeout);
      child.off('exit', onExit); child.off('error', onError);
      if (error) reject(error); else resolve();
    };
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', chunk => {
      process.stdout.write(chunk);
      if (settled) return;
      buffer += chunk;
      if (/LinkTerm Web: http:\/\/[^\s]+/u.test(buffer)) finish();
    });
    child.once('exit', onExit);
    child.once('error', onError);
  });
}

export async function startWebDevelopment({ serverOnly = false } = {}) {
  await run([join(root, 'scripts/copy-ui-assets.mjs')]);
  await run([compiler, '-b', 'packages/contracts', 'packages/runtime', 'packages/mcp', 'packages/ui', 'apps/server', 'apps/web']);
  const vite = serverOnly ? undefined : await createServer({ configFile: join(root, 'apps/web/vite.config.ts') });
  let child, watcher, assetWatcher;
  let closing = false, lastFingerprint = '', restart = Promise.resolve();
  const close = async () => {
    if (closing) return;
    closing = true;
    watcher?.kill(); assetWatcher?.close();
    await restart.catch(() => undefined);
    await stopChild(child);
    await vite?.close();
    await vite?.watcher.close();
  };
  const fail = error => { console.error(error); process.exitCode = 1; void close(); };
  const refresh = async () => {
    if (closing) return;
    const next = await fingerprint();
    if (next === lastFingerprint) return;
    await stopChild(child);
    if (closing) return;
    child = spawn(process.execPath, [join(root, 'apps/server/dist/index.js')], {
      cwd: root,
      env: { ...process.env, ...(serverOnly ? {} : { LINKTERM_DEV_ORIGIN: 'http://localhost:5174' }) },
      stdio: ['inherit', 'pipe', 'inherit', 'ipc'], windowsHide: true,
    });
    child.on('error', fail);
    child.once('exit', code => { if (!closing && code !== 0) fail(new Error(`Web server stopped (${code})`)); });
    await waitForServerReady(child);
    lastFingerprint = next;
  };
  process.once('SIGINT', close); process.once('SIGTERM', close);
  try {
    await vite?.listen(); vite?.printUrls();
    await refresh();
    assetWatcher = watch(join(root, 'packages/ui/src/styles'), (_event, filename) => {
      if (filename === 'global.css') void copyFile(join(root, 'packages/ui/src/styles/global.css'), join(root, 'packages/ui/dist/styles/global.css')).catch(fail);
    });
    watcher = spawn(process.execPath, [compiler, '-b', '--watch', '--preserveWatchOutput', '--pretty', 'false', '--locale', 'en'], {
      cwd: root, stdio: ['ignore', 'pipe', 'inherit'], windowsHide: true,
    });
    let output = '';
    watcher.stdout.setEncoding('utf8');
    watcher.stdout.on('data', chunk => {
      process.stdout.write(chunk); output += chunk;
      const lines = output.split('\n'); output = lines.pop() ?? '';
      if (lines.some(line => /Found 0 errors\. Watching for file changes\./u.test(line))) restart = restart.then(refresh).catch(fail);
    });
    watcher.on('error', fail);
    watcher.once('exit', code => { if (!closing) fail(new Error(`TypeScript watcher stopped (${code})`)); });
    return close;
  } catch (error) { await close(); throw error; }
}

if (isDirectCliRun()) startWebDevelopment({ serverOnly: process.argv.includes('--server-only') }).catch(error => { console.error(error); process.exitCode = 1; });
