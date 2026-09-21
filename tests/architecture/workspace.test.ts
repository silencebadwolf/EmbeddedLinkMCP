import { builtinModules } from 'node:module';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { readWorkspacePackages } from '../../scripts/workspace-packages.js';

const root = process.cwd();
const allowedDependencies: Record<string, readonly string[]> = {
  '@linkterm/contracts': [],
  '@linkterm/ui': ['@linkterm/contracts'],
  '@linkterm/runtime': ['@linkterm/contracts'],
  '@linkterm/mcp': ['@linkterm/contracts', '@linkterm/runtime'],
  '@linkterm/desktop': ['@linkterm/contracts', '@linkterm/ui', '@linkterm/runtime', '@linkterm/mcp'],
  '@linkterm/web': ['@linkterm/contracts', '@linkterm/ui'],
  '@linkterm/server': ['@linkterm/contracts', '@linkterm/runtime', '@linkterm/mcp'],
};

describe('workspace package boundaries', () => {
  it('declares internal edges explicitly and keeps the architecture acyclic', () => {
    const packages = readWorkspacePackages(root);
    const names = new Set(packages.map((pkg) => pkg.name));
    expect(names.has('@linkterm/contracts')).toBe(true);
    for (const pkg of packages) {
      expect(allowedDependencies, pkg.name).toHaveProperty(pkg.name);
      for (const [name, specifier] of Object.entries(pkg.dependencies ?? {})) {
        if (!name.startsWith('@linkterm/')) continue;
        expect(names.has(name), `${pkg.name} -> ${name}`).toBe(true);
        expect(specifier).toBe('workspace:*');
        expect(allowedDependencies[pkg.name], `${pkg.name} -> ${name}`).toContain(name);
      }
    }
  });

  it('exposes only materialized, browser-safe contract entry points', () => {
    const packageDir = resolve(root, 'packages/contracts');
    const pkg = JSON.parse(readFileSync(resolve(packageDir, 'package.json'), 'utf8')) as {
      exports: Record<string, { types: string; import: string }>;
      dependencies: Record<string, string>;
    };
    const builtins = new Set(builtinModules.flatMap((name) => [name, `node:${name}`]));
    for (const entry of Object.values(pkg.exports)) {
      expect(existsSync(resolve(packageDir, entry.types)), entry.types).toBe(true);
      expect(existsSync(resolve(packageDir, entry.import)), entry.import).toBe(true);
    }
    for (const name of readdirSync(resolve(packageDir, 'src'))) {
      if (!name.endsWith('.ts')) continue;
      const path = resolve(packageDir, 'src', name);
      const source = readFileSync(path, 'utf8');
      const ast = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
      for (const statement of ast.statements) {
        if (!ts.isImportDeclaration(statement) && !ts.isExportDeclaration(statement)) continue;
        if (!statement.moduleSpecifier || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
        const specifier = statement.moduleSpecifier.text;
        expect(builtins.has(specifier), `${name}: ${specifier}`).toBe(false);
        expect(specifier).not.toMatch(/electron|node-pty|serialport|@linkterm\/(runtime|mcp)/);
        if (specifier.startsWith('.')) {
          expect(resolve(dirname(path), specifier).startsWith(resolve(packageDir, 'src'))).toBe(true);
        } else {
          expect(pkg.dependencies, `${name}: undeclared ${specifier}`).toHaveProperty(specifier);
        }
      }
      expect(source).not.toContain('declare global');
      expect(source).not.toContain('IPC_CHANNELS');
    }
  });
});
