import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const packageDirs = readdirSync(join(root, 'packages'), { withFileTypes: true })
  .filter(entry => entry.isDirectory() && existsSync(join(root, 'packages', entry.name, 'package.json')))
  .map(entry => join(root, 'packages', entry.name));
const packages = new Map(packageDirs.map(directory => {
  const manifest = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8')) as {
    name: string;
    dependencies?: Record<string, string>;
    exports: Record<string, { import: string; types: string }>;
  };
  return [manifest.name, { directory, manifest }];
}));

function files(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry =>
    entry.isDirectory() ? files(join(directory, entry.name)) : /\.tsx?$/u.test(entry.name) ? [join(directory, entry.name)] : []);
}

describe('compiled workspace package interfaces', () => {
  it('materializes every public export and resolves internal imports through declared package exports', () => {
    for (const { directory, manifest } of packages.values()) {
      for (const [name, entry] of Object.entries(manifest.exports)) {
        for (const file of [entry.import, entry.types]) {
          expect(file, `${manifest.name}/${name}`).toMatch(/^\.\/dist\//u);
          expect(existsSync(resolve(directory, file)), `${manifest.name}/${name}: ${file}`).toBe(true);
        }
      }
      for (const file of files(join(directory, 'src'))) {
        const ast = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
        const visit = (node: ts.Node): void => {
          if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
            const specifier = node.moduleSpecifier.text;
            if (specifier.startsWith('.')) {
              const local = relative(join(directory, 'src'), resolve(dirname(file), specifier));
              expect(local.startsWith('..') || isAbsolute(local), `${file}: cross-package source import ${specifier}`).toBe(false);
            } else if (specifier.startsWith('@linkterm/')) {
              const segments = specifier.split('/');
              const name = segments.slice(0, 2).join('/');
              const entry = segments.length === 2 ? '.' : `./${segments.slice(2).join('/')}`;
              expect(manifest.dependencies?.[name], `${manifest.name} -> ${name}`).toBe('workspace:*');
              expect(packages.get(name)?.manifest.exports, `${file}: ${specifier}`).toHaveProperty(entry);
            }
          }
          ts.forEachChild(node, visit);
        };
        visit(ast);
      }
    }
  });
});
