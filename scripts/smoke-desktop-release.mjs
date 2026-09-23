#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { cp, mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(join(root, 'package.json'));

/** Exercise the physically packaged asar after relocating it away from the build tree. */
export async function smokeDesktopRelease(unpackedDirectory) {
  const temporary = await mkdtemp(join(root, '.artifacts', 'desktop-smoke-'));
  const delta = relative(join(root, '.artifacts'), temporary);
  if (delta === '..' || delta.startsWith(`..${sep}`)) throw new Error('Smoke directory escaped staging');
  const release = join(temporary, 'relocated');
  let child;
  try {
    const resources = process.platform === 'darwin' ? 'Resources' : 'resources';
    await cp(join(resolve(unpackedDirectory), resources), join(release, 'resources'), { recursive: true });
    const binary = require('electron');
    const env = { ...process.env, LINKTERM_PACKAGED_ROOT: release, LINKTERM_SMOKE_PROFILE: join(temporary, 'profile') };
    delete env.ELECTRON_RUN_AS_NODE;
    child = spawn(binary, [join(root, 'scripts', 'desktop-release-smoke.cjs')], {
      cwd: root, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    let errors = '';
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => { output += chunk; });
    child.stderr.on('data', chunk => { errors += chunk; });
    let timeout;
    const finished = await Promise.race([
      once(child, 'exit').then(([code]) => ({ code })),
      new Promise(resolve => { timeout = setTimeout(() => resolve({ code: null }), 35_000); }),
    ]);
    clearTimeout(timeout);
    if (finished.code !== 0 || !output.includes('"packagedDesktopSmoke":"passed"')) {
      throw new Error(`Relocated desktop smoke failed (${finished.code}): ${errors || output}`);
    }
    console.log('Portable desktop smoke passed: packaged UI, preload and native PTY');
  } finally {
    if (child && child.exitCode === null) {
      child.kill();
      await Promise.race([once(child, 'exit'), new Promise(resolve => setTimeout(resolve, 5_000))]);
    }
    await rm(temporary, { recursive: true, force: true });
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  if (process.argv.length !== 3) throw new Error('Usage: node smoke-desktop-release.mjs <unpacked-dir>');
  await smokeDesktopRelease(process.argv[2]);
}
