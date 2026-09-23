#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { access, cp, mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));

/** Relocate before launch to catch absolute pnpm junctions and source-tree imports. */
export async function smokeServerRelease(sourceDirectory) {
  const temp = await mkdtemp(join(root, '.linkterm', 'server-release-smoke-'));
  const input = resolve(sourceDirectory);
  const fromRoot = relative(root, temp);
  if (fromRoot.startsWith(`..${sep}`) || fromRoot === '..') throw new Error('Smoke directory escaped the workspace');
  const release = join(temp, 'relocated');
  let child;
  try {
    await cp(input, release, { recursive: true });
    const dataDir = join(temp, 'data');
    const token = 'smoke-only-' + 'a'.repeat(48);
    child = spawn(process.execPath, [join(release, 'dist/index.js')], {
      cwd: temp, windowsHide: true,
      env: { ...process.env, LINKTERM_SERVER_DATA_DIR: dataDir, LINKTERM_SERVER_TOKEN: token, LINKTERM_SERVER_PORT: '0' },
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    });
    let output = '', errors = '';
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => { output += chunk; });
    child.stderr.on('data', chunk => { errors += chunk; });
    const deadline = Date.now() + 15_000;
    let address;
    while (Date.now() < deadline) {
      address = output.match(/LinkTerm Web: (http:\/\/[^\s]+)/u)?.[1];
      if (address || child.exitCode !== null) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    if (!address) throw new Error(`Relocated server did not start: ${errors || output}`);
    const page = await fetch(address);
    if (!page.ok || !(await page.text()).includes('LinkTerm Web')) throw new Error('Web asset was not served');
    const unauthenticated = await fetch(address + '/api/session');
    if (unauthenticated.status !== 401) throw new Error('Unauthenticated API was accepted');
    const login = await fetch(address + '/api/login', {
      method: 'POST', headers: { Origin: address, 'Content-Type': 'application/json' }, body: JSON.stringify({ token }),
    });
    if (!login.ok) throw new Error(`Relocated server login failed: ${login.status}`);
    const cookie = login.headers.get('set-cookie')?.split(';')[0];
    const session = await fetch(address + '/api/session', { headers: { Cookie: cookie ?? '' } });
    if (!session.ok) throw new Error('Authenticated API was unavailable');
    const native = createRequire(join(release, 'package.json'))('node-pty');
    if (typeof native.spawn !== 'function') throw new Error('Node PTY native binding could not load');
    const stopped = once(child, 'exit');
    child.send('linkterm:dev:quit');
    let shutdownTimeout;
    const [code] = await Promise.race([stopped, new Promise(resolve => { shutdownTimeout = setTimeout(() => resolve([null]), 10_000); })]);
    clearTimeout(shutdownTimeout);
    if (code !== 0) throw new Error(`Relocated server did not shut down cleanly (${code}): ${errors}`);
    if (await access(join(dataDir, '.runtime-owner.json')).then(() => true, () => false)) {
      throw new Error('Runtime owner lock remained after a clean server shutdown');
    }
    console.log(`Portable server smoke passed: ${address}`);
  } finally {
    if (child && child.exitCode === null) {
      child.kill('SIGTERM');
      await Promise.race([once(child, 'exit'), new Promise(resolve => setTimeout(resolve, 5_000))]);
      if (child.exitCode === null) child.kill();
    }
    await rm(temp, { recursive: true, force: true });
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  if (process.argv.length !== 3) throw new Error('Usage: node smoke-server-release.mjs <portable-server-dir>');
  await smokeServerRelease(process.argv[2]);
}
