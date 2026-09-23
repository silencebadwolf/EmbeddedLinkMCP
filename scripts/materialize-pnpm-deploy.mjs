#!/usr/bin/env node
import { cp, lstat, mkdir, readFile, realpath, readdir } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const within = (root, candidate) => {
  const child = relative(root, candidate);
  return child === '' || (!child.startsWith(`..${sep}`) && child !== '..' && !isAbsolute(child));
};
const parts = name => name.split('/');

/** Turn pnpm's absolute Windows junction graph into a relocatable physical package tree. */
export async function materializePnpmDeploy(sourceDirectory, targetDirectory) {
  const source = await realpath(sourceDirectory);
  const target = resolve(targetDirectory);
  if (within(source, target) || within(target, source)) throw new Error('Source and target directories must be separate');
  await mkdir(dirname(target), { recursive: true });
  await mkdir(target);
  const origins = new Map([[target, source]]);
  const queue = [[source, target]];
  const readManifest = async directory => JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'));
  const findSource = async (directory, name) => {
    let current = directory;
    while (within(source, current)) {
      const candidate = join(current, 'node_modules', ...parts(name));
      try {
        const resolved = await realpath(candidate);
        if (!within(source, resolved)) throw new Error(`Deployment link escapes staging: ${candidate}`);
        return resolved;
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error;
      }
      if (current === source) break;
      current = dirname(current);
    }
    return undefined;
  };
  const visible = (directory, name) => {
    let current = directory;
    while (within(target, current)) {
      const candidate = join(current, 'node_modules', ...parts(name));
      const found = origins.get(candidate);
      if (found) return found;
      if (current === target) break;
      current = dirname(current);
    }
    return undefined;
  };
  const copyPackage = async (from, to) => {
    await mkdir(dirname(to), { recursive: true });
    await cp(from, to, {
      recursive: true,
      filter: async entry => {
        if (entry !== from && relative(from, entry).split(/[\\/]/u).includes('node_modules')) return false;
        if (entry !== from && (await lstat(entry)).isSymbolicLink()) throw new Error(`Unexpected package symlink: ${entry}`);
        return true;
      },
    });
    origins.set(to, from);
    queue.push([from, to]);
  };
  // Root application files are copied without the pnpm virtual store.
  for (const entry of await readdir(source, { withFileTypes: true })) {
    if (entry.name === 'node_modules') continue;
    const from = join(source, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Unexpected root symlink: ${from}`);
    await cp(from, join(target, entry.name), { recursive: true });
  }
  while (queue.length) {
    const [from, to] = queue.shift();
    const manifest = await readManifest(from);
    const dependencies = { ...manifest.dependencies, ...manifest.optionalDependencies, ...manifest.peerDependencies };
    for (const name of Object.keys(dependencies)) {
      const origin = await findSource(from, name);
      if (!origin) {
        if (manifest.optionalDependencies?.[name] || manifest.peerDependenciesMeta?.[name]?.optional) continue;
        throw new Error(`Missing production dependency ${name} of ${manifest.name}`);
      }
      if (visible(to, name) === origin) continue;
      const destination = join(to, 'node_modules', ...parts(name));
      if (origins.has(destination)) throw new Error(`Conflicting dependency ${name} of ${manifest.name}`);
      await copyPackage(origin, destination);
    }
  }
  // A moved release must never retain pnpm junctions pointing to its build machine.
  const scan = async directory => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const filename = join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`Link remained in release: ${filename}`);
      if (entry.isDirectory()) await scan(filename);
    }
  };
  await scan(target);
  return { packageCopies: origins.size - 1, output: target };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  if (process.argv.length !== 4) throw new Error('Usage: node materialize-pnpm-deploy.mjs <deploy-dir> <portable-dir>');
  console.log(await materializePnpmDeploy(process.argv[2], process.argv[3]));
}
