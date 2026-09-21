import { builtinModules } from 'node:module';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
import { expect, it } from 'vitest';

it('keeps the entire shared UI independent of desktop and server APIs', () => {
  const builtins = new Set(builtinModules.flatMap((name) => [name, `node:${name}`]));
  const visitDirectory = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const file = join(directory, entry.name);
      if (entry.isDirectory()) {
        visitDirectory(file);
        continue;
      }
      if (!/\.tsx?$/u.test(file)) continue;
      const source = readFileSync(file, 'utf8');
      expect(source, file).not.toMatch(
        /window\.(linkterm|electron)|\b(?:require|process|Buffer)\s*[.(]/u,
      );
      const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
      const visit = (node: ts.Node): void => {
        if (
          ts.isStringLiteral(node) &&
          (ts.isImportDeclaration(node.parent) ||
            ts.isExportDeclaration(node.parent) ||
            (ts.isCallExpression(node.parent) &&
              node.parent.expression.kind === ts.SyntaxKind.ImportKeyword))
        ) {
          expect(builtins.has(node.text), `${file}: ${node.text}`).toBe(false);
          expect(node.text, file).not.toMatch(
            /^(electron|node-pty|serialport|@linkterm\/(runtime|mcp|desktop|server))(\/|$)/u,
          );
        }
        ts.forEachChild(node, visit);
      };
      visit(ast);
    }
  };
  visitDirectory(join(process.cwd(), 'packages/ui/src'));
});
