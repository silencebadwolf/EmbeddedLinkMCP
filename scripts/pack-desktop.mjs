#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { materializePnpmDeploy } from './materialize-pnpm-deploy.mjs';
import { generateReleaseSbom } from './generate-release-sbom.mjs';
import { smokeDesktopRelease } from './smoke-desktop-release.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const pnpm = process.env.npm_execpath;
if (!pnpm) throw new Error('Run this script through the pinned pnpm 9 workspace command');

const checkWithin = (directory, candidate) => {
  const delta = relative(directory, candidate);
  if (delta === '..' || delta.startsWith(`..${sep}`)) throw new Error(`Path escaped ${directory}: ${candidate}`);
};

async function run(command, args) {
  const child = spawn(process.execPath, [command, ...args], { cwd: root, stdio: 'inherit', windowsHide: true });
  const [code] = await once(child, 'exit');
  if (code !== 0) throw new Error(`${command} failed (${code})`);
}

/** Build a self-contained Electron candidate from a separate physical dependency tree. */
export async function packDesktop({ unpackedOnly = false } = {}) {
  const stagingRoot = join(root, '.artifacts');
  await mkdir(stagingRoot, { recursive: true });
  const temporary = await mkdtemp(join(stagingRoot, 'desktop-deploy-'));
  const deployed = join(temporary, 'deployed');
  const portable = join(temporary, 'portable');
  const output = join(root, 'release', `linkterm-desktop-${process.platform}-${process.arch}-${Date.now()}`);
  checkWithin(stagingRoot, temporary); checkWithin(join(root, 'release'), output);
  try {
    await run(pnpm, ['--filter', '@linkterm/desktop', 'deploy', '--prod', '--frozen-lockfile', '--package-import-method=copy', deployed]);
    for (const name of ['LICENSE', 'NOTICE', 'third-party-manifest.json']) await cp(join(root, name), join(deployed, name));
    await cp(join(root, 'licenses'), join(deployed, 'licenses'), { recursive: true });
    const materialized = await materializePnpmDeploy(deployed, portable);
    const sbom = await generateReleaseSbom(portable);
    const electronManifest = JSON.parse(await readFile(join(root, 'node_modules/electron/package.json'), 'utf8'));
    const config = {
      appId: 'com.linkterm.v2', productName: 'LinkTerm v2',
      directories: { output },
      files: ['dist/**/*', 'node_modules/**/*', 'package.json', '!**/*.ldtmp', '!**/*.ldenc'],
      extraResources: ['LICENSE', 'NOTICE', 'third-party-manifest.json', 'licenses', 'sbom.cdx.json'].map(name => ({ from: join(portable, name), to: name })),
      extraMetadata: { main: 'dist/main/index.js' },
      electronVersion: electronManifest.version,
      electronDist: join(root, 'node_modules/electron/dist'),
      npmRebuild: false,
      asarUnpack: ['**/*.node'],
      mac: { category: 'public.app-category.developer-tools', target: ['dmg', 'zip'] },
      win: { target: ['nsis', 'portable'] },
      nsis: { license: join(root, 'LICENSE') },
      linux: { target: ['AppImage', 'deb'], category: 'Development' },
    };
    const configPath = join(temporary, 'electron-builder.json');
    await writeFile(configPath, JSON.stringify(config, null, 2) + '\n');
    const builder = join(root, 'node_modules/electron-builder/out/cli/cli.js');
    await run(builder, ['--projectDir', portable, '--config', configPath, ...(unpackedOnly ? ['--dir'] : []), '--publish', 'never']);
    const macDirectory = process.platform === 'darwin'
      ? (await readdir(output, { withFileTypes: true })).find(entry => entry.isDirectory() && entry.name.startsWith('mac'))?.name
      : undefined;
    if (process.platform === 'darwin' && !macDirectory) throw new Error('Packaged macOS app directory was not found');
    const unpacked = macDirectory
      ? join(output, macDirectory, 'LinkTerm v2.app', 'Contents')
      : join(output, `${process.platform === 'win32' ? 'win' : 'linux'}-unpacked`);
    await smokeDesktopRelease(unpacked);
    await run(pnpm, ['exec', 'node', 'scripts/generate-checksums.mjs', relative(root, output)]);
    console.log(`Portable desktop release: ${output} (${materialized.packageCopies} physical package copies, ${sbom.components} SBOM components)`);
    return output;
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  await packDesktop({ unpackedOnly: process.argv.includes('--dir') });
}
