import { randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';

const purl = (name, version) => `pkg:npm/${name.split('/').map(encodeURIComponent).join('/')}@${encodeURIComponent(version)}`;

/** Inventory exactly the dependency files installed inside one portable release. */
export async function generateReleaseSbom(directory) {
  const root = resolve(directory);
  const components = new Map();
  const dependencies = new Map();
  const packages = new Map();
  const load = async packageDirectory => {
    if (packages.has(packageDirectory)) return packages.get(packageDirectory);
    const manifest = JSON.parse(await readFile(join(packageDirectory, 'package.json'), 'utf8'));
    packages.set(packageDirectory, manifest);
    return manifest;
  };
  const find = async (packageDirectory, name) => {
    let current = packageDirectory;
    while (current === root || (!relative(root, current).startsWith('..' + sep) && relative(root, current) !== '..')) {
      const candidate = join(current, 'node_modules', ...name.split('/'));
      try { await load(candidate); return candidate; }
      catch (error) { if (error?.code !== 'ENOENT') throw error; }
      if (current === root) break;
      current = dirname(current);
    }
    return undefined;
  };
  const visited = new Set();
  const visit = async packageDirectory => {
    const manifest = await load(packageDirectory);
    const ref = purl(manifest.name, manifest.version);
    if (visited.has(packageDirectory)) return ref;
    visited.add(packageDirectory);
    const component = { type: packageDirectory === root ? 'application' : 'library', 'bom-ref': ref,
      name: manifest.name, version: manifest.version, purl: ref,
      ...(typeof manifest.license === 'string' ? { licenses: [{ license: { id: manifest.license } }] } : {}),
    };
    components.set(ref, component);
    const children = new Set();
    for (const name of Object.keys({ ...manifest.dependencies, ...manifest.optionalDependencies, ...manifest.peerDependencies })) {
      const child = await find(packageDirectory, name);
      if (!child) {
        if (manifest.optionalDependencies?.[name] || manifest.peerDependenciesMeta?.[name]?.optional) continue;
        throw new Error(`Release is missing ${name} required by ${manifest.name}`);
      }
      children.add(await visit(child));
    }
    const previous = dependencies.get(ref) ?? new Set();
    for (const child of children) previous.add(child);
    dependencies.set(ref, previous);
    return ref;
  };
  const rootRef = await visit(root);
  const bom = {
    bomFormat: 'CycloneDX', specVersion: '1.6', serialNumber: `urn:uuid:${randomUUID()}`, version: 1,
    metadata: { timestamp: new Date().toISOString(), component: components.get(rootRef) },
    components: [...components.values()].filter(value => value['bom-ref'] !== rootRef).sort((a, b) => a['bom-ref'].localeCompare(b['bom-ref'])),
    dependencies: [...dependencies].map(([ref, children]) => ({ ref, dependsOn: [...children].sort() })).sort((a, b) => a.ref.localeCompare(b.ref)),
  };
  const output = join(root, 'sbom.cdx.json');
  await writeFile(output, JSON.stringify(bom, null, 2) + '\n');
  return { output, components: bom.components.length };
}
