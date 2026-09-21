import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

export interface WorkspacePackage {
  readonly path: string;
  readonly name: string;
  readonly dependencies?: Record<string, string>;
  readonly devDependencies?: Record<string, string>;
  readonly optionalDependencies?: Record<string, string>;
  readonly peerDependencies?: Record<string, string>;
}

/** Discover the apps/* and packages/* members declared by this repository's workspace. */
export function readWorkspacePackages(rootDir: string): WorkspacePackage[] {
  if (!existsSync(join(rootDir, 'pnpm-workspace.yaml'))) return [];
  const packages: WorkspacePackage[] = [];
  for (const group of ['apps', 'packages']) {
    const directory = join(rootDir, group);
    if (!existsSync(directory)) continue;
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const packagePath = join(directory, entry.name, 'package.json');
      if (!existsSync(packagePath)) continue;
      const value: unknown = JSON.parse(readFileSync(packagePath, 'utf8'));
      if (typeof value !== 'object' || value === null || !('name' in value) || typeof value.name !== 'string') {
        throw new Error(`Workspace package has no valid name: ${packagePath}`);
      }
      packages.push({ ...(value as Omit<WorkspacePackage, 'path'>), path: packagePath });
    }
  }
  const names = packages.map((pkg) => pkg.name);
  if (new Set(names).size !== names.length) throw new Error('Workspace package names must be unique');
  return packages;
}

/** Preserve the license gate across workspace boundaries, including optional runtime dependencies. */
export function collectWorkspaceDependencies(
  rootDir: string,
  rootPackage: Pick<WorkspacePackage, 'dependencies' | 'devDependencies' | 'optionalDependencies'>,
): { runtime: Record<string, string>; all: Record<string, string>; errors: string[] } {
  const runtime: Record<string, string> = {};
  const all: Record<string, string> = {};
  const errors: string[] = [];
  let members: WorkspacePackage[];
  try {
    members = readWorkspacePackages(rootDir);
  } catch (error) {
    return { runtime, all, errors: [error instanceof Error ? error.message : String(error)] };
  }
  const internalNames = new Set(members.map((pkg) => pkg.name));
  const packages = [{ name: 'root', ...rootPackage }, ...members];
  for (const pkg of packages) {
    for (const field of ['dependencies', 'optionalDependencies', 'devDependencies'] as const) {
      for (const [name, specifier] of Object.entries(pkg[field] ?? {})) {
        if (specifier.startsWith('workspace:')) {
          if (!internalNames.has(name)) errors.push(`Unknown workspace dependency "${name}" in ${pkg.name}`);
          continue;
        }
        if (internalNames.has(name)) {
          errors.push(`Internal dependency "${name}" in ${pkg.name} must use workspace:*`);
          continue;
        }
        // Keep version disagreement visible rather than silently choosing one package's declaration.
        if (all[name] !== undefined && all[name] !== specifier) {
          errors.push(`Workspace dependency version conflict for "${name}": ${all[name]} vs ${specifier} in ${pkg.name}`);
        }
        all[name] = specifier;
        if (field !== 'devDependencies') runtime[name] = specifier;
      }
    }
  }
  return { runtime, all, errors };
}
