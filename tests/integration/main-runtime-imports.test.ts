import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repositoryRoot = path.resolve(import.meta.dirname, '../..');
const mainOutputRoot = path.join(repositoryRoot, 'apps', 'desktop', 'dist');

function javascriptFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return javascriptFiles(entryPath);
    return entry.name.endsWith('.js') ? [entryPath] : [];
  });
}

describe('Electron Main build runtime imports', () => {
  it('emits Node-resolvable relative imports instead of the renderer @ alias', () => {
    execFileSync(
      process.execPath,
      [path.join(repositoryRoot, 'node_modules', 'typescript', 'bin', 'tsc'), '-b', 'apps/desktop/tsconfig.main.json'],
      {
      cwd: repositoryRoot,
      stdio: 'ignore',
      },
    );

    const unresolvedAliases = javascriptFiles(mainOutputRoot)
      .flatMap((filePath) => {
        const source = readFileSync(filePath, 'utf8');
        return source.includes("from '@/") || source.includes("from \"@/")
          ? [path.relative(repositoryRoot, filePath)]
          : [];
      });

    expect(unresolvedAliases).toEqual([]);
  });

  it('does not ship the removed AI pause/take-over runtime surface', () => {
    const legacyMarkers = javascriptFiles(mainOutputRoot).flatMap((filePath) => {
      const source = readFileSync(filePath, 'utf8');
      return /AiControl|AI_CONTROL|ai-control-state|registerAiControl|aiControl:/.test(source)
        ? [path.relative(repositoryRoot, filePath)]
        : [];
    });

    expect(legacyMarkers).toEqual([]);
  });
});
