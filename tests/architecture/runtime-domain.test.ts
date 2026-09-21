import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const root = process.cwd();

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(path) : entry.name.endsWith('.ts') ? [path] : [];
  });
}

describe('backend domain dependency direction', () => {
  it('keeps core, transports and J-Link independent of the MCP and Electron adapters', () => {
    const files = sourceFiles(resolve(root, 'packages/runtime/src'));
    for (const file of files) {
      const ast = ts.createSourceFile(
        file,
        readFileSync(file, 'utf8'),
        ts.ScriptTarget.Latest,
        true,
      );
      const specifiers: string[] = [];
      const visit = (node: ts.Node): void => {
        if (
          (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
          node.moduleSpecifier &&
          ts.isStringLiteral(node.moduleSpecifier)
        ) {
          specifiers.push(node.moduleSpecifier.text);
        }
        if (
          ts.isCallExpression(node) &&
          node.arguments[0] &&
          ts.isStringLiteral(node.arguments[0]) &&
          (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
            (ts.isIdentifier(node.expression) &&
              ['require', 'requireFn'].includes(node.expression.text)))
        ) {
          specifiers.push(node.arguments[0].text);
        }
        ts.forEachChild(node, visit);
      };
      visit(ast);
      for (const specifier of specifiers) {
        const target = specifier.startsWith('.')
          ? resolve(dirname(file), specifier).replaceAll('\\', '/')
          : specifier;
        expect(target, `${file}: ${specifier}`).not.toMatch(
          /\/src\/(mcp|main)\/|^electron(?:\/|$)|^@modelcontextprotocol\/|^@linkterm\/mcp|^(node-pty|serialport)$/,
        );
      }
    }
  });
});
