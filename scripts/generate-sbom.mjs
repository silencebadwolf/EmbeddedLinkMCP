import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, '..');

function packagePurl(name, version) {
  const encodedName = name.split('/').map(encodeURIComponent).join('/');
  return `pkg:npm/${encodedName}@${encodeURIComponent(version)}`;
}

function resolveRepositoryPath(relativePath) {
  const resolvedPath = path.resolve(repositoryRoot, relativePath);
  const relativeToRepository = path.relative(repositoryRoot, resolvedPath);
  if (relativeToRepository.startsWith('..') || path.isAbsolute(relativeToRepository)) {
    throw new Error(`Path must stay inside the repository: ${relativePath}`);
  }
  return resolvedPath;
}

function packageIdentity(name, node) {
  const version = typeof node.version === 'string' ? node.version : 'unknown';
  const ref = packagePurl(name, version);
  return { version, ref };
}

function collectDependencyGraph(rootDependencies) {
  const components = new Map();
  const edges = new Map();

  function visit(name, node) {
    if (!node || typeof node !== 'object') return null;

    const { version, ref } = packageIdentity(name, node);
    if (!components.has(ref)) {
      const segments = name.startsWith('@') ? name.slice(1).split('/') : [name];
      const component = {
        type: 'library',
        'bom-ref': ref,
        name: segments.at(-1),
        version,
        purl: ref,
      };
      if (segments.length > 1) component.group = segments.slice(0, -1).join('/');
      components.set(ref, component);
    }

    const childRefs = new Set();
    for (const [childName, childNode] of Object.entries(node.dependencies ?? {})) {
      const childRef = visit(childName, childNode);
      if (childRef) childRefs.add(childRef);
    }
    const existing = edges.get(ref) ?? new Set();
    for (const childRef of childRefs) existing.add(childRef);
    edges.set(ref, existing);
    return ref;
  }

  const directRefs = [];
  for (const [name, node] of Object.entries(rootDependencies ?? {})) {
    const ref = visit(name, node);
    if (ref) directRefs.push(ref);
  }

  return { components, edges, directRefs };
}

async function main() {
  const packageJson = JSON.parse(await readFile(path.join(repositoryRoot, 'package.json'), 'utf8'));
  const pnpmArguments = ['list', '--prod', '--json', '--depth', 'Infinity', '--silent'];
  const pnpmExecutable = process.platform === 'win32' ? process.env.ComSpec ?? 'cmd.exe' : 'pnpm';
  const pnpmInvocation = process.platform === 'win32'
    ? ['/d', '/s', '/c', 'pnpm', ...pnpmArguments]
    : pnpmArguments;
  const listOutput = execFileSync(
    pnpmExecutable,
    pnpmInvocation,
    { cwd: repositoryRoot, encoding: 'utf8', windowsHide: true },
  );
  const roots = JSON.parse(listOutput);
  const root = Array.isArray(roots) ? roots[0] : roots;
  if (!root || typeof root !== 'object') throw new Error('pnpm did not return a project dependency graph');

  const graph = collectDependencyGraph(root.dependencies);
  const rootRef = packagePurl(packageJson.name, packageJson.version);
  const dependencies = [
    { ref: rootRef, dependsOn: [...graph.directRefs].sort() },
    ...[...graph.edges.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([ref, dependsOn]) => ({ ref, dependsOn: [...dependsOn].sort() })),
  ];

  const bom = {
    bomFormat: 'CycloneDX',
    specVersion: '1.6',
    serialNumber: `urn:uuid:${randomUUID()}`,
    version: 1,
    metadata: {
      timestamp: new Date().toISOString(),
      component: {
        type: 'application',
        'bom-ref': rootRef,
        name: packageJson.name,
        version: packageJson.version,
        purl: rootRef,
        licenses: [{ license: { id: packageJson.license } }],
      },
    },
    components: [...graph.components.values()].sort((left, right) =>
      left['bom-ref'].localeCompare(right['bom-ref']),
    ),
    dependencies,
  };

  const outputArgument = process.argv[2] ?? 'release/sbom.cdx.json';
  const outputPath = resolveRepositoryPath(outputArgument);
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(bom, null, 2)}\n`, 'utf8');
  console.log(`Wrote CycloneDX SBOM with ${bom.components.length} components to ${outputPath}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
