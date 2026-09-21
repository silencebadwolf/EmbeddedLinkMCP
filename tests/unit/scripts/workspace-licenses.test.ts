import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { collectWorkspaceDependencies } from '../../../scripts/workspace-packages.js';
import { validateLicenses } from '../../../scripts/validate-licenses.js';

describe('workspace license coverage', () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'linkterm-workspace-license-'));
    writeFileSync(join(root, 'pnpm-workspace.yaml'), "packages:\n  - 'apps/*'\n  - 'packages/*'\n");
    mkdirSync(join(root, 'packages/contracts'), { recursive: true });
    writeFileSync(join(root, 'packages/contracts/package.json'), JSON.stringify({
      name: '@linkterm/contracts', dependencies: { zod: '^4.4.3' }, optionalDependencies: { optional: '^1.0.0' },
    }));
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('requires attribution for external dependencies inside a workspace member', () => {
    const pkg = { dependencies: { '@linkterm/contracts': 'workspace:*' }, devDependencies: { electron: '^42.4.0' } };
    writeFileSync(join(root, 'package.json'), JSON.stringify(pkg));
    mkdirSync(join(root, 'licenses'));
    writeFileSync(join(root, 'licenses/electron.LICENSE'), 'MIT');
    writeFileSync(join(root, 'third-party-manifest.json'), JSON.stringify({
      schemaVersion: '1.0.0', dependencies: [{ name: 'electron', version: '^42.4.0', license: 'MIT', licenseFile: 'licenses/electron.LICENSE' }],
    }));
    const result = validateLicenses({ rootDir: root, packageJsonPath: join(root, 'package.json'), manifestPath: join(root, 'third-party-manifest.json') });
    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([
      expect.stringContaining('Runtime dependency "zod"'),
      expect.stringContaining('Runtime dependency "optional"'),
    ]));
    expect(result.errors.join('\n')).not.toContain('Runtime dependency "@linkterm/contracts"');
  });

  it('rejects missing internal packages and inconsistent external versions', () => {
    const result = collectWorkspaceDependencies(root, {
      dependencies: { '@linkterm/missing': 'workspace:*', zod: '^3.0.0' },
    });
    expect(result.errors).toEqual(expect.arrayContaining([
      expect.stringContaining('Unknown workspace dependency "@linkterm/missing"'),
      expect.stringContaining('Workspace dependency version conflict for "zod"'),
    ]));
  });
});
