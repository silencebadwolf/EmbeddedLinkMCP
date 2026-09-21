import {
  mkdirSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { RUNTIME_TOOL_POLICIES } from '@linkterm/runtime/core/activity/risk-policy';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const SOURCE_ROOTS = [
  join(ROOT, 'src'),
  ...['apps', 'packages'].flatMap((area) => {
    const directory = join(ROOT, area);
    return existsSync(directory)
      ? readdirSync(directory, { withFileTypes: true })
          .filter((entry) => entry.isDirectory() && existsSync(join(directory, entry.name, 'src')))
          .map((entry) => join(directory, entry.name, 'src'))
      : [];
  }),
];
const MCP_ROOT = join(ROOT, 'packages', 'mcp', 'src');
const SURFACES = join(MCP_ROOT, 'surfaces');
const CENTRAL_REGISTRY = join(MCP_ROOT, 'registry.ts');
const INVENTORY = join(ROOT, 'docs', 'security', 'mcp-tool-risk-inventory.json');

const REQUIRED_ACKNOWLEDGEMENT = [] as const;
const CONDITIONAL_ACKNOWLEDGEMENT = [] as const;

const entrySchema = z
  .object({
    name: z.string().regex(/^[a-z][a-z0-9_]*$/u),
    surface: z.string().min(1),
    sensitivity: z.enum(['read-only', 'state-affecting']),
    risk: z.enum(['read-only', 'state-affecting', 'disruptive', 'destructive-or-unknown']),
    acknowledgementPolicy: z.enum([
      'none',
      'client-acknowledgement-required',
      'conditional-client-acknowledgement',
    ]),
    acknowledgementCondition: z.string().min(1).optional(),
    futureApprovalPolicy: z.literal('unassigned'),
    rationale: z.string().trim().min(12),
  })
  .strict()
  .superRefine((entry, context) => {
    const conditional = entry.acknowledgementPolicy === 'conditional-client-acknowledgement';
    if (conditional !== (entry.acknowledgementCondition !== undefined)) {
      context.addIssue({
        code: 'custom',
        path: ['acknowledgementCondition'],
        message: 'condition is present exactly for conditional acknowledgement',
      });
    }
  });

const inventorySchema = z
  .object({
    schemaVersion: z.literal('1.0.0'),
    authority: z.literal('review-data-only'),
    sourcePattern: z.literal('{src,apps/*/src,packages/*/src}/**/*.{ts,tsx}'),
    tools: z.array(entrySchema).length(63),
  })
  .strict();

interface Registration {
  name: string;
  surface: string;
  sensitivity: 'read-only' | 'state-affecting';
  source: string;
  line: number;
}

function collectTypeScriptFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name))
    .flatMap((entry) => {
      const path = join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        throw new Error(`${path}: symbolic links are unsupported in production source`);
      }
      if (entry.isDirectory()) return collectTypeScriptFiles(path);
      return entry.isFile() &&
        (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) &&
        !entry.name.endsWith('.d.ts')
        ? [path]
        : [];
    });
}

function normalizedRelative(path: string): string {
  return relative(ROOT, path).split(sep).join('/');
}

function resolvesToCentralRegistry(file: string, specifier: string): boolean {
  if (!specifier.startsWith('.')) return false;
  const candidate = resolve(dirname(file), specifier);
  const sourceCandidate = specifier.endsWith('.js')
    ? candidate.replace(/\.js$/u, '.ts')
    : specifier.endsWith('.ts')
      ? candidate
      : `${candidate}.ts`;
  return sourceCandidate === resolve(CENTRAL_REGISTRY);
}

function isCentralRegistrySpecifier(file: string, specifier: string): boolean {
  return specifier.endsWith('.js') && resolvesToCentralRegistry(file, specifier);
}

function property(
  object: ts.ObjectLiteralExpression,
  key: string,
): ts.PropertyAssignment | undefined {
  return object.properties.find((candidate): candidate is ts.PropertyAssignment => {
    if (!ts.isPropertyAssignment(candidate)) return false;
    return (
      (ts.isIdentifier(candidate.name) || ts.isStringLiteralLike(candidate.name)) &&
      candidate.name.text === key
    );
  });
}

function requiredLiteral(
  object: ts.ObjectLiteralExpression,
  key: string,
  file: string,
  sourceFile: ts.SourceFile,
): string {
  const assignment = property(object, key);
  if (!assignment || !ts.isStringLiteralLike(assignment.initializer)) {
    const position = sourceFile.getLineAndCharacterOfPosition(object.getStart(sourceFile));
    throw new Error(
      `${normalizedRelative(file)}:${position.line + 1}: registerTool ${key} must be a string literal`,
    );
  }
  return assignment.initializer.text;
}

function scanSourceRegistrations(file: string, sourceText: string): Registration[] {
  const registrations: Registration[] = [];
  let centralSdkBridgeCalls = 0;
  let centralEntryDeclarations = 0;
  const sourceFile = ts.createSourceFile(
    file,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const directCallees = new Set<string>();
  const namespaceCallees = new Set<string>();
  for (const statement of sourceFile.statements) {
    if (
      normalizedRelative(file) === 'packages/mcp/src/registry.ts' &&
      ts.isFunctionDeclaration(statement) &&
      statement.name?.text === 'registerTool' &&
      statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)
    ) {
      centralEntryDeclarations += 1;
    }
    const moduleSpecifier =
      (ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement)) &&
      statement.moduleSpecifier !== undefined &&
      ts.isStringLiteralLike(statement.moduleSpecifier)
        ? statement.moduleSpecifier.text
        : undefined;
    if (
      moduleSpecifier !== undefined &&
      /(^|\/)registry\.js$/u.test(moduleSpecifier) &&
      !isCentralRegistrySpecifier(file, moduleSpecifier)
    ) {
      throw new Error(`${normalizedRelative(file)}: alternate registry.js module is unsupported`);
    }
    const importClause = ts.isImportDeclaration(statement) ? statement.importClause : undefined;
    const namedImports =
      importClause?.namedBindings && ts.isNamedImports(importClause.namedBindings)
        ? importClause.namedBindings
        : undefined;
    const defaultNamedRegisterTool = importClause?.name?.text === 'registerTool';
    const importsRegisterTool =
      defaultNamedRegisterTool ||
      namedImports?.elements.some(
        (element) =>
          (element.propertyName?.text ?? element.name.text) === 'registerTool' ||
          element.name.text === 'registerTool',
      ) === true;
    if (
      importsRegisterTool &&
      (defaultNamedRegisterTool ||
        moduleSpecifier === undefined ||
        !isCentralRegistrySpecifier(file, moduleSpecifier))
    ) {
      throw new Error(
        `${normalizedRelative(file)}: registerTool import must resolve through the central registry.js module`,
      );
    }
    const namedExports =
      ts.isExportDeclaration(statement) &&
      statement.exportClause !== undefined &&
      ts.isNamedExports(statement.exportClause)
        ? statement.exportClause
        : undefined;
    if (
      namedExports?.elements.some(
        (element) =>
          (element.propertyName?.text ?? element.name.text) === 'registerTool' ||
          element.name.text === 'registerTool',
      ) === true
    ) {
      throw new Error(`${normalizedRelative(file)}: registerTool must not be re-exported`);
    }
    if (
      ts.isExportDeclaration(statement) &&
      moduleSpecifier !== undefined &&
      resolvesToCentralRegistry(file, moduleSpecifier) &&
      (!statement.exportClause || ts.isNamespaceExport(statement.exportClause))
    ) {
      throw new Error(`${normalizedRelative(file)}: registerTool must not be re-exported`);
    }
    if (
      ts.isExportDeclaration(statement) &&
      moduleSpecifier !== undefined &&
      /(^|\/)registry\.js$/u.test(moduleSpecifier)
    ) {
      const exports = statement.exportClause;
      const reexportsRegisterTool =
        !exports ||
        ts.isNamespaceExport(exports) ||
        exports.elements.some(
          (element) => (element.propertyName?.text ?? element.name.text) === 'registerTool',
        );
      if (reexportsRegisterTool) {
        throw new Error(`${normalizedRelative(file)}: registerTool must not be re-exported`);
      }
    }
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteralLike(statement.moduleSpecifier) ||
      !/(^|\/)registry\.js$/u.test(statement.moduleSpecifier.text)
    ) {
      continue;
    }
    const bindings = statement.importClause?.namedBindings;
    if (bindings && ts.isNamedImports(bindings)) {
      for (const element of bindings.elements) {
        const importedName = element.propertyName?.text ?? element.name.text;
        if (importedName === 'registerTool') directCallees.add(element.name.text);
      }
    } else if (bindings && ts.isNamespaceImport(bindings)) {
      namespaceCallees.add(bindings.name.text);
    }
  }

  const isRegisterToolCallee = (expression: ts.LeftHandSideExpression): boolean =>
    (ts.isIdentifier(expression) && directCallees.has(expression.text)) ||
    (ts.isPropertyAccessExpression(expression) &&
      ts.isIdentifier(expression.expression) &&
      namespaceCallees.has(expression.expression.text) &&
      expression.name.text === 'registerTool');

  const surfaceForRegistration = (): string => {
    const path = relative(SURFACES, file);
    const segments = path.split(sep);
    const surface = segments[0];
    if (isAbsolute(path) || !surface || surface === '..' || segments.length < 2) {
      throw new Error(
        `${normalizedRelative(file)}: registerTool registration must be under a directory in packages/mcp/src/surfaces`,
      );
    }
    return surface;
  };

  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      ts.isStringLiteralLike(node.arguments[0]) &&
      /(^|\/)registry\.js$/u.test(node.arguments[0].text)
    ) {
      if (!isCentralRegistrySpecifier(file, node.arguments[0].text)) {
        throw new Error(`${normalizedRelative(file)}: alternate registry.js module is unsupported`);
      }
      throw new Error(`${normalizedRelative(file)}: dynamic registry access is unsupported`);
    } else if (ts.isCallExpression(node) && isRegisterToolCallee(node.expression)) {
      const definition = node.arguments[1];
      if (!definition || !ts.isObjectLiteralExpression(definition)) {
        throw new Error(
          `${normalizedRelative(file)}: registerTool definition must be an object literal`,
        );
      }
      const name = requiredLiteral(definition, 'name', file, sourceFile);
      const sensitivity = requiredLiteral(definition, 'sensitivity', file, sourceFile);
      if (sensitivity !== 'read-only' && sensitivity !== 'state-affecting') {
        throw new Error(`${name}: unsupported sensitivity ${sensitivity}`);
      }
      const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
      registrations.push({
        name,
        surface: surfaceForRegistration(),
        sensitivity,
        source: normalizedRelative(file),
        line: position.line + 1,
      });
    } else if (
      ts.isIdentifier(node) &&
      directCallees.has(node.text) &&
      !ts.isImportSpecifier(node.parent) &&
      !(ts.isCallExpression(node.parent) && node.parent.expression === node)
    ) {
      throw new Error(
        `${normalizedRelative(file)}: registerTool binding "${node.text}" must be invoked directly`,
      );
    } else if (
      ts.isPropertyAccessExpression(node) &&
      ts.isIdentifier(node.expression) &&
      namespaceCallees.has(node.expression.text) &&
      node.name.text === 'registerTool' &&
      !(ts.isCallExpression(node.parent) && node.parent.expression === node)
    ) {
      throw new Error(
        `${normalizedRelative(file)}: registerTool namespace member must be invoked directly`,
      );
    } else if (
      ts.isElementAccessExpression(node) &&
      ts.isStringLiteralLike(node.argumentExpression) &&
      (node.argumentExpression.text === 'registerTool' || node.argumentExpression.text === 'tool')
    ) {
      if (ts.isIdentifier(node.expression) && namespaceCallees.has(node.expression.text)) {
        throw new Error(
          `${normalizedRelative(file)}: registerTool namespace binding "${node.expression.text}" must not escape`,
        );
      }
      throw new Error(
        `${normalizedRelative(file)}: computed ${node.argumentExpression.text} member access must use the registry wrapper`,
      );
    } else if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken
    ) {
      const inspectAssignmentTarget = (candidate: ts.Expression): void => {
        let target = candidate;
        while (ts.isParenthesizedExpression(target)) target = target.expression;
        if (ts.isArrayLiteralExpression(target)) {
          for (const element of target.elements) {
            if (!ts.isOmittedExpression(element)) inspectAssignmentTarget(element);
          }
          return;
        }
        if (!ts.isObjectLiteralExpression(target)) return;
        for (const assignment of target.properties) {
          if (
            !ts.isPropertyAssignment(assignment) &&
            !ts.isShorthandPropertyAssignment(assignment)
          ) {
            continue;
          }
          const name = assignment.name;
          const key =
            ts.isIdentifier(name) || ts.isStringLiteralLike(name)
              ? name.text
              : ts.isComputedPropertyName(name) && ts.isStringLiteralLike(name.expression)
                ? name.expression.text
                : undefined;
          if (key === 'registerTool' || key === 'tool') {
            throw new Error(
              `${normalizedRelative(file)}: assignment-destructured ${key} member access must use the registry wrapper`,
            );
          }
          if (ts.isPropertyAssignment(assignment)) {
            inspectAssignmentTarget(assignment.initializer);
          }
        }
      };
      inspectAssignmentTarget(node.left);
    } else if (ts.isBindingElement(node) && ts.isObjectBindingPattern(node.parent)) {
      const key =
        node.propertyName &&
        (ts.isIdentifier(node.propertyName) || ts.isStringLiteralLike(node.propertyName))
          ? node.propertyName.text
          : node.propertyName &&
              ts.isComputedPropertyName(node.propertyName) &&
              ts.isStringLiteralLike(node.propertyName.expression)
            ? node.propertyName.expression.text
            : ts.isIdentifier(node.name)
              ? node.name.text
              : undefined;
      const declaration = node.parent.parent;
      const initializer = ts.isVariableDeclaration(declaration)
        ? declaration.initializer
        : undefined;
      const trackedNamespace =
        initializer !== undefined &&
        ts.isIdentifier(initializer) &&
        namespaceCallees.has(initializer.text);
      if (!trackedNamespace && (key === 'registerTool' || key === 'tool')) {
        throw new Error(
          `${normalizedRelative(file)}: destructured ${key} member access must use the registry wrapper`,
        );
      }
    } else if (
      ts.isIdentifier(node) &&
      namespaceCallees.has(node.text) &&
      !ts.isNamespaceImport(node.parent) &&
      !(
        ts.isPropertyAccessExpression(node.parent) &&
        node.parent.expression === node &&
        (node.parent.name.text !== 'registerTool' ||
          (ts.isCallExpression(node.parent.parent) &&
            node.parent.parent.expression === node.parent))
      )
    ) {
      throw new Error(
        `${normalizedRelative(file)}: registerTool namespace binding "${node.text}" must not escape`,
      );
    } else if (
      ts.isPropertyAccessExpression(node) &&
      (node.name.text === 'registerTool' || node.name.text === 'tool') &&
      !isRegisterToolCallee(node)
    ) {
      const call =
        ts.isCallExpression(node.parent) && node.parent.expression === node
          ? node.parent
          : undefined;
      const firstArgument = call?.arguments[0];
      const isCentralSdkBridge =
        normalizedRelative(file) === 'packages/mcp/src/registry.ts' &&
        node.name.text === 'registerTool' &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === 'server' &&
        firstArgument !== undefined &&
        ts.isPropertyAccessExpression(firstArgument) &&
        ts.isIdentifier(firstArgument.expression) &&
        firstArgument.expression.text === 'def' &&
        firstArgument.name.text === 'name';
      if (!isCentralSdkBridge) {
        throw new Error(
          `${normalizedRelative(file)}: direct ${node.name.text} member access must use the registry wrapper`,
        );
      }
      centralSdkBridgeCalls += 1;
      if (centralSdkBridgeCalls > 1) {
        throw new Error(
          `${normalizedRelative(file)}: central registry must contain exactly one fixed-shape SDK bridge`,
        );
      }
    } else if (
      normalizedRelative(file) === 'packages/mcp/src/registry.ts' &&
      ts.isIdentifier(node) &&
      node.text === 'registerTool' &&
      !(ts.isFunctionDeclaration(node.parent) && node.parent.name === node) &&
      !(ts.isPropertyAccessExpression(node.parent) && node.parent.name === node)
    ) {
      throw new Error(
        `${normalizedRelative(file)}: central registerTool entry must not be aliased or forwarded`,
      );
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  if (normalizedRelative(file) === 'packages/mcp/src/registry.ts') {
    if (centralEntryDeclarations !== 1) {
      throw new Error(
        `${normalizedRelative(file)}: central registry must expose exactly one registerTool function`,
      );
    }
    if (centralSdkBridgeCalls !== 1) {
      throw new Error(
        `${normalizedRelative(file)}: central registry must contain exactly one fixed-shape SDK bridge`,
      );
    }
  }
  return registrations;
}

function scanRegistrations(): Registration[] {
  const registrations = SOURCE_ROOTS.flatMap(collectTypeScriptFiles).flatMap((file) =>
    scanSourceRegistrations(file, readFileSync(file, 'utf8')),
  );
  return registrations.sort((left, right) => left.name.localeCompare(right.name));
}

function duplicates(values: readonly string[]): string[] {
  return [...new Set(values.filter((value, index) => values.indexOf(value) !== index))].sort();
}

describe('MCP tool risk inventory', () => {
  const registrations = scanRegistrations();

  it('fails closed instead of skipping a symlinked production source entry', () => {
    const root = mkdtempSync(join(tmpdir(), 'linkterm-inventory-'));
    const target = join(root, 'target');
    mkdirSync(target);
    writeFileSync(join(target, 'tools.ts'), 'export {};\n', 'utf8');
    symlinkSync(target, join(root, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');

    try {
      expect(() => collectTypeScriptFiles(root)).toThrow(
        /symbolic links are unsupported in production source/u,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it.each([
    {
      label: 'named import alias',
      source: `
        import { registerTool as addTool } from '../../registry.js';
        addTool(server, {
          name: 'synthetic_alias_tool',
          sensitivity: 'read-only',
        });
      `,
    },
    {
      label: 'namespace import member',
      source: `
        import * as registry from '../../registry.js';
        registry.registerTool(server, {
          name: 'synthetic_alias_tool',
          sensitivity: 'read-only',
        });
      `,
    },
  ])('discovers a registration through a $label', ({ source }) => {
    expect(scanSourceRegistrations(join(SURFACES, 'synthetic', 'tools.ts'), source)).toMatchObject([
      {
        name: 'synthetic_alias_tool',
        surface: 'synthetic',
        sensitivity: 'read-only',
      },
    ]);
  });

  it('fails closed when a local wrapper hides the registration object', () => {
    const source = `
      import { registerTool } from '../../registry.js';
      const addTool = (definition: unknown) => registerTool(server, definition);
      addTool({ name: 'hidden_tool', sensitivity: 'read-only' });
    `;

    expect(() => scanSourceRegistrations(join(SURFACES, 'synthetic', 'tools.ts'), source)).toThrow(
      /registerTool definition must be an object literal/u,
    );
  });

  it('fails closed when an imported registerTool binding escapes into a local alias', () => {
    const source = `
      import { registerTool } from '../../registry.js';
      const addTool = registerTool;
      addTool(server, { name: 'hidden_alias_tool', sensitivity: 'read-only' });
    `;

    expect(() => scanSourceRegistrations(join(SURFACES, 'synthetic', 'tools.ts'), source)).toThrow(
      /registerTool binding "registerTool" must be invoked directly/u,
    );
  });

  it.each([
    {
      label: 'namespace object alias',
      source: `
        import * as registry from '../../registry.js';
        const alias = registry;
        alias.registerTool(server, {
          name: 'hidden_namespace_alias',
          sensitivity: 'read-only',
        });
      `,
      error: /registerTool namespace binding "registry" must not escape/u,
    },
    {
      label: 'namespace destructuring',
      source: `
        import * as registry from '../../registry.js';
        const { registerTool: addTool } = registry;
        addTool(server, {
          name: 'hidden_namespace_destructure',
          sensitivity: 'read-only',
        });
      `,
      error: /registerTool namespace binding "registry" must not escape/u,
    },
    {
      label: 'computed namespace member',
      source: `
        import * as registry from '../../registry.js';
        registry['registerTool'](server, {
          name: 'hidden_computed_member',
          sensitivity: 'read-only',
        });
      `,
      error: /registerTool namespace binding "registry" must not escape/u,
    },
    {
      label: 'registry re-export',
      source: `export { registerTool as addTool } from '../../registry.js';`,
      error: /registerTool must not be re-exported/u,
    },
    {
      label: 'extensionless registry re-export',
      source: `export { registerTool as addTool } from '../../registry';`,
      error: /registerTool must not be re-exported/u,
    },
    {
      label: 'extensionless registry star re-export',
      source: `export * from '../../registry';`,
      error: /registerTool must not be re-exported/u,
    },
    {
      label: 'extensionless registry namespace re-export',
      source: `export * as registry from '../../registry';`,
      error: /registerTool must not be re-exported/u,
    },
    {
      label: 'alternate registry provenance',
      source: `
        import { registerTool } from 'evil/registry.js';
        registerTool(server, {
          name: 'wrong_registry_provenance',
          sensitivity: 'read-only',
        });
      `,
      error: /alternate registry\.js module is unsupported/u,
    },
    {
      label: 'extensionless registry import',
      source: `
        import { registerTool } from '../../registry';
        registerTool(server, {
          name: 'extensionless_registry_import',
          sensitivity: 'read-only',
        });
      `,
      error: /registerTool import must resolve through the central registry\.js module/u,
    },
    {
      label: 'alternate wrapper module filename',
      source: `
        import { registerTool } from 'evil/mcp.js';
        registerTool(server, {
          name: 'alternate_wrapper_module',
          sensitivity: 'read-only',
        });
      `,
      error: /registerTool import must resolve through the central registry\.js module/u,
    },
    {
      label: 'default import named registerTool',
      source: `
        import registerTool from 'evil/mcp.js';
        registerTool(server, {
          name: 'default_alternate_wrapper',
          sensitivity: 'read-only',
        });
      `,
      error: /registerTool import must resolve through the central registry\.js module/u,
    },
    {
      label: 'dynamic registry import',
      source: `
        const registry = await import('../../registry.js');
        registry.registerTool(server, {
          name: 'hidden_dynamic_import',
          sensitivity: 'read-only',
        });
      `,
      error: /dynamic registry access is unsupported/u,
    },
    {
      label: 'direct SDK member call',
      source: `
        server.registerTool('hidden_direct_sdk', {}, async () => ({ content: [] }));
      `,
      error: /direct registerTool member access must use the registry wrapper/u,
    },
    {
      label: 'legacy SDK tool call',
      source: `server.tool('hidden_legacy_sdk', {}, async () => ({ content: [] }));`,
      error: /direct tool member access must use the registry wrapper/u,
    },
    {
      label: 'computed direct SDK member call',
      source: `server['registerTool']('hidden_computed_sdk', {}, async () => ({ content: [] }));`,
      error: /computed registerTool member access must use the registry wrapper/u,
    },
    {
      label: 'destructured direct SDK member call',
      source: `
        const { registerTool: raw } = server;
        raw.call(server, 'hidden_destructured_sdk', {}, async () => ({ content: [] }));
      `,
      error: /destructured registerTool member access must use the registry wrapper/u,
    },
    {
      label: 'literal-computed destructured SDK member call',
      source: `
        const { ['registerTool']: raw } = mcpServer;
        raw.call(mcpServer, 'hidden_computed_destructure', {}, async () => ({ content: [] }));
      `,
      error: /destructured registerTool member access must use the registry wrapper/u,
    },
    {
      label: 'destructured legacy SDK tool call',
      source: `
        const { tool: legacy } = mcpServer;
        legacy.call(mcpServer, 'hidden_legacy_destructured', {}, async () => ({ content: [] }));
      `,
      error: /destructured tool member access must use the registry wrapper/u,
    },
    {
      label: 'assignment-destructured direct SDK member call',
      source: `
        let raw;
        ({ registerTool: raw } = mcpServer);
        raw.call(mcpServer, 'hidden_assignment_sdk', {}, async () => ({ content: [] }));
      `,
      error: /assignment-destructured registerTool member access must use the registry wrapper/u,
    },
    {
      label: 'assignment-destructured legacy SDK tool call',
      source: `
        let legacy;
        ({ ['tool']: legacy } = mcpServer);
        legacy.call(mcpServer, 'hidden_assignment_legacy', {}, async () => ({ content: [] }));
      `,
      error: /assignment-destructured tool member access must use the registry wrapper/u,
    },
    {
      label: 'nested assignment-destructured direct SDK member call',
      source: `
        let raw;
        ({ sdk: { registerTool: raw } } = { sdk: mcpServer });
        raw.call(mcpServer, 'hidden_nested_assignment', {}, async () => ({ content: [] }));
      `,
      error: /assignment-destructured registerTool member access must use the registry wrapper/u,
    },
  ])('fails closed for an unsupported $label', ({ source, error }) => {
    expect(() => scanSourceRegistrations(join(SURFACES, 'synthetic', 'tools.ts'), source)).toThrow(
      error,
    );
  });

  it('allows exactly one fixed-shape SDK bridge in the central registry implementation', () => {
    const entry = `export function registerTool(): void {}`;
    const bridge = `
      server.registerTool(def.name, {}, async () => ({ content: [] }));
    `;
    const registryFile = join(MCP_ROOT, 'registry.ts');

    expect(scanSourceRegistrations(registryFile, `${entry}\n${bridge}`)).toEqual([]);
    expect(() => scanSourceRegistrations(registryFile, `${entry}\n${bridge}\n${bridge}`)).toThrow(
      /central registry must contain exactly one fixed-shape SDK bridge/u,
    );
    expect(() =>
      scanSourceRegistrations(
        registryFile,
        `${entry}\nserver.tool('hidden_legacy_sdk', {}, async () => ({ content: [] }));`,
      ),
    ).toThrow(/direct tool member access must use the registry wrapper/u);
    expect(() =>
      scanSourceRegistrations(
        registryFile,
        `${entry}\n${bridge}\nexport const addTool = registerTool;`,
      ),
    ).toThrow(/central registerTool entry must not be aliased or forwarded/u);
  });

  it.each([
    { file: join(MCP_ROOT, 'outside-tools.ts'), specifier: './registry.js' },
    {
      file: join(ROOT, 'src', 'main', 'outside-tools.ts'),
      specifier: '../../packages/mcp/src/registry.js',
    },
    { file: join(SURFACES, 'surface-root-tool.ts'), specifier: '../registry.js' },
  ])(
    'fails closed when a registration is declared outside a valid surface: $file',
    ({ file, specifier }) => {
      const source = `
      import { registerTool } from '${specifier}';
      registerTool(server, {
        name: 'outside_surface_tool',
        sensitivity: 'read-only',
      });
    `;

      expect(() => scanSourceRegistrations(file, source)).toThrow(
        /registerTool registration must be under a directory in packages\/mcp\/src\/surfaces/u,
      );
    },
  );

  it('discovers exactly 63 unique literal production registrations', () => {
    expect(registrations).toHaveLength(63);
    expect(duplicates(registrations.map((entry) => entry.name))).toEqual([]);
    expect(registrations.filter((entry) => entry.sensitivity === 'read-only')).toHaveLength(25);
    expect(registrations.filter((entry) => entry.sensitivity === 'state-affecting')).toHaveLength(
      38,
    );
  });

  it('matches every registration to one strict sorted inventory entry', () => {
    const inventory = inventorySchema.parse(JSON.parse(readFileSync(INVENTORY, 'utf8')));
    const sourceNames = registrations.map((entry) => entry.name);
    const inventoryNames = inventory.tools.map((entry) => entry.name);
    expect({
      missing: sourceNames.filter((name) => !inventoryNames.includes(name)),
      extra: inventoryNames.filter((name) => !sourceNames.includes(name)),
      duplicates: duplicates(inventoryNames),
    }).toEqual({ missing: [], extra: [], duplicates: [] });
    expect(inventoryNames).toEqual([...inventoryNames].sort());

    const sourceByName = new Map(registrations.map((entry) => [entry.name, entry]));
    for (const entry of inventory.tools) {
      expect(entry.surface, entry.name).toBe(sourceByName.get(entry.name)?.surface);
      expect(entry.sensitivity, entry.name).toBe(sourceByName.get(entry.name)?.sensitivity);
      expect(entry.sensitivity, `${entry.name}: risk/sensitivity mismatch`).toBe(
        entry.risk === 'read-only' ? 'read-only' : 'state-affecting',
      );
      if (entry.sensitivity === 'read-only') {
        expect(entry.acknowledgementPolicy, entry.name).toBe('none');
      }
    }

    expect(inventory.tools.filter((entry) => entry.risk === 'read-only')).toHaveLength(25);
    expect(inventory.tools.filter((entry) => entry.risk === 'state-affecting')).toHaveLength(20);
    expect(inventory.tools.filter((entry) => entry.risk === 'disruptive')).toHaveLength(12);
    expect(inventory.tools.filter((entry) => entry.risk === 'destructive-or-unknown')).toHaveLength(
      6,
    );

    expect(
      inventory.tools
        .filter((entry) => entry.acknowledgementPolicy === 'client-acknowledgement-required')
        .map((entry) => entry.name),
    ).toEqual([...REQUIRED_ACKNOWLEDGEMENT]);
    expect(
      inventory.tools
        .filter((entry) => entry.acknowledgementPolicy === 'conditional-client-acknowledgement')
        .map((entry) => entry.name),
    ).toEqual([...CONDITIONAL_ACKNOWLEDGEMENT]);
    expect(
      inventory.tools.find((entry) => entry.name === 'run_control_workflow')
        ?.acknowledgementCondition,
    ).toBeUndefined();
  });

  it('keeps the exact runtime observation table in lockstep with registrations and review data', () => {
    const inventory = inventorySchema.parse(JSON.parse(readFileSync(INVENTORY, 'utf8')));
    const sourceNames = registrations.map((entry) => entry.name).sort();
    const inventoryNames = inventory.tools.map((entry) => entry.name);
    const runtimeNames = RUNTIME_TOOL_POLICIES.map((entry) => entry.action);

    expect(RUNTIME_TOOL_POLICIES).toHaveLength(63);
    expect(duplicates(runtimeNames)).toEqual([]);
    expect(runtimeNames).toEqual(inventoryNames);
    expect(sourceNames).toEqual(inventoryNames);

    const sourceByName = new Map(registrations.map((entry) => [entry.name, entry]));
    const runtimeByName = new Map(RUNTIME_TOOL_POLICIES.map((entry) => [entry.action, entry]));
    for (const reviewed of inventory.tools) {
      const runtime = runtimeByName.get(reviewed.name);
      expect(runtime?.sensitivity, reviewed.name).toBe(
        sourceByName.get(reviewed.name)?.sensitivity,
      );
      expect(
        {
          risk: runtime?.risk,
          sourceSurface: runtime?.sourceSurface,
          acknowledgementPolicy: runtime?.acknowledgement.kind,
        },
        reviewed.name,
      ).toEqual({
        risk: reviewed.risk,
        sourceSurface: reviewed.surface,
        acknowledgementPolicy: reviewed.acknowledgementPolicy,
      });
    }
  });
});
