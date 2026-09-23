#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { cp, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { materializePnpmDeploy } from './materialize-pnpm-deploy.mjs';
import { generateReleaseSbom } from './generate-release-sbom.mjs';
import { smokeServerRelease } from './smoke-server-release.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const pnpm = process.env.npm_execpath;
if (!pnpm) throw new Error('Run this script through the pinned pnpm 9 workspace command');
const checkWithin = (directory, candidate) => {
  const rel = relative(directory, candidate);
  if (rel === '..' || rel.startsWith(`..${sep}`)) throw new Error(`Path escaped ${directory}: ${candidate}`);
};

async function runPnpm(args) {
  const child = spawn(process.execPath, [pnpm, ...args], { cwd: root, stdio: 'inherit', windowsHide: true });
  const [code] = await once(child, 'exit');
  if (code !== 0) throw new Error(`pnpm ${args.join(' ')} failed (${code})`);
}

export async function packServer() {
  await runPnpm(['--version']);
  const stagingRoot = join(root, '.artifacts');
  await mkdir(stagingRoot, { recursive: true });
  const temporary = await mkdtemp(join(stagingRoot, 'server-deploy-'));
  const deployed = join(temporary, 'app');
  const output = join(root, 'release', `linkterm-server-${process.platform}-${process.arch}-${Date.now()}`);
  checkWithin(stagingRoot, temporary); checkWithin(join(root, 'release'), output);
  try {
    await runPnpm(['--filter', '@linkterm/server', 'deploy', '--prod', '--frozen-lockfile', '--package-import-method=copy', deployed]);
    await cp(join(root, 'apps/web/dist'), join(deployed, 'public'), { recursive: true });
    for (const filename of ['LICENSE', 'NOTICE', 'third-party-manifest.json']) await cp(join(root, filename), join(deployed, filename));
    await cp(join(root, 'licenses'), join(deployed, 'licenses'), { recursive: true });
    const materialized = await materializePnpmDeploy(deployed, output);
    const sbom = await generateReleaseSbom(output);
    await smokeServerRelease(output);
    await runPnpm(['exec', 'node', 'scripts/generate-checksums.mjs', relative(root, output)]);
    console.log(`Portable Web server: ${output} (${materialized.packageCopies} physical package copies, ${sbom.components} SBOM components)`);
    return output;
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) await packServer();
