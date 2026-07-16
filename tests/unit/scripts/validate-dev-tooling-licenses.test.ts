import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';

import { validateLicenses } from '../../../scripts/validate-licenses.js';

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(value, null, 2));
}

function writeLicense(root: string, name: string): void {
  const path = join(root, 'licenses', name);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, 'fixture license');
}

interface ClosureEntry {
  name: string;
  version: string;
  license: string;
  licenseFile: string;
}

const rootEntry: ClosureEntry = {
  name: '@vitest/coverage-v8',
  version: '4.1.8',
  license: 'MIT',
  licenseFile: 'licenses/dev-tooling/coverage-v8.LICENSE',
};

const childEntry: ClosureEntry = {
  name: 'coverage-child',
  version: '1.2.3',
  license: 'MIT',
  licenseFile: 'licenses/dev-tooling/coverage-child.LICENSE',
};

const runtimeEntry = {
  name: 'electron',
  version: '^42.4.0',
  license: 'MIT',
  licenseFile: 'licenses/electron.LICENSE',
};

describe('validateLicenses audited development tooling', () => {
  const roots: string[] = [];
  const externalFiles: string[] = [];

  afterEach(() => {
    for (const root of roots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
    for (const file of externalFiles.splice(0)) {
      rmSync(file, { force: true });
    }
  });

  function makeFixture(productionClosure: ClosureEntry[]): string {
    const root = mkdtempSync(join(tmpdir(), 'linkterm-dev-license-test-'));
    roots.push(root);

    writeJson(join(root, 'package.json'), {
      dependencies: {},
      devDependencies: {
        electron: '^42.4.0',
        '@vitest/coverage-v8': '4.1.8',
      },
    });
    writeJson(join(root, 'third-party-manifest.json'), {
      schemaVersion: '1.1.0',
      dependencies: [
        {
          name: 'electron',
          version: '^42.4.0',
          license: 'MIT',
          licenseFile: 'licenses/electron.LICENSE',
        },
      ],
      auditedDevTooling: {
        roots: [{ name: '@vitest/coverage-v8', specifier: '4.1.8' }],
        productionClosure,
      },
    });
    writeJson(join(root, 'node_modules/@vitest/coverage-v8/package.json'), {
      name: '@vitest/coverage-v8',
      version: '4.1.8',
      license: 'MIT',
      dependencies: { 'coverage-child': '^1.0.0' },
      peerDependencies: { vitest: '4.1.8' },
      devDependencies: { '@vitest/browser': '4.1.8' },
    });
    writeJson(join(root, 'node_modules/coverage-child/package.json'), {
      name: 'coverage-child',
      version: '1.2.3',
      license: 'MIT',
    });
    writeLicense(root, 'electron.LICENSE');
    writeLicense(root, 'dev-tooling/coverage-v8.LICENSE');
    writeLicense(root, 'dev-tooling/coverage-child.LICENSE');

    return root;
  }

  function run(root: string) {
    return validateLicenses({
      manifestPath: join(root, 'third-party-manifest.json'),
      packageJsonPath: join(root, 'package.json'),
      rootDir: root,
    });
  }

  it('fails when an audited development-tooling production dependency is omitted', () => {
    const result = run(makeFixture([rootEntry]));

    expect(result.ok).toBe(false);
    expect(result.errors).toContainEqual(
      expect.stringContaining('Audited dev-tooling dependency "coverage-child@1.2.3" is missing'),
    );
  });

  it('accepts the complete dependencies-only closure while excluding peer and dev edges', () => {
    const result = run(makeFixture([rootEntry, childEntry]));

    expect(result).toMatchObject({
      ok: true,
      errors: [],
      count: 1,
      auditedDevToolRootCount: 1,
      auditedDevToolPackageCount: 2,
    });
  });

  it('reports an exact resolved-version mismatch in the audited closure', () => {
    const result = run(
      makeFixture([
        rootEntry,
        {
          ...childEntry,
          version: '9.9.9',
        },
      ]),
    );

    expect(result.ok).toBe(false);
    expect(result.errors).toContainEqual(
      expect.stringContaining(
        'Version mismatch for audited dev-tooling "coverage-child": manifest=9.9.9 vs installed=1.2.3',
      ),
    );
  });

  it('rejects an installed audited root that drifts from its exact package.json specifier', () => {
    const root = makeFixture([{ ...rootEntry, version: '4.1.9' }, childEntry]);
    writeJson(join(root, 'node_modules/@vitest/coverage-v8/package.json'), {
      name: '@vitest/coverage-v8',
      version: '4.1.9',
      license: 'MIT',
      dependencies: { 'coverage-child': '^1.0.0' },
    });

    const result = run(root);

    expect(result.ok).toBe(false);
    expect(result.errors).toContainEqual(
      expect.stringContaining(
        'Installed audited dev-tooling root "@vitest/coverage-v8" version mismatch: package.json=4.1.8 vs installed=4.1.9',
      ),
    );
  });

  it('rejects a stale audited closure entry that is not installed', () => {
    const result = run(
      makeFixture([
        rootEntry,
        childEntry,
        {
          name: 'stale-tool',
          version: '0.0.1',
          license: 'MIT',
          licenseFile: 'licenses/dev-tooling/coverage-child.LICENSE',
        },
      ]),
    );

    expect(result.ok).toBe(false);
    expect(result.errors).toContainEqual(
      expect.stringContaining(
        'Audited dev-tooling manifest entry "stale-tool@0.0.1" is not in the installed production closure',
      ),
    );
  });

  it('rejects an extra version record even when the installed version is also present', () => {
    const result = run(
      makeFixture([
        rootEntry,
        childEntry,
        {
          ...childEntry,
          version: '9.9.9',
        },
      ]),
    );

    expect(result.ok).toBe(false);
    expect(result.errors).toContainEqual(
      expect.stringContaining(
        'Audited dev-tooling manifest entry "coverage-child@9.9.9" is not in the installed production closure',
      ),
    );
  });

  it('reports a license identifier mismatch against installed metadata', () => {
    const result = run(
      makeFixture([
        rootEntry,
        {
          ...childEntry,
          license: 'BSD-3-Clause',
        },
      ]),
    );

    expect(result.ok).toBe(false);
    expect(result.errors).toContainEqual(
      expect.stringContaining(
        'License mismatch for audited dev-tooling "coverage-child@1.2.3": manifest=BSD-3-Clause vs installed=MIT',
      ),
    );
  });

  it('rejects a stale audited root after its package.json devDependency is removed', () => {
    const root = makeFixture([rootEntry, childEntry]);
    writeJson(join(root, 'package.json'), {
      dependencies: {},
      devDependencies: { electron: '^42.4.0' },
    });

    const result = run(root);

    expect(result.ok).toBe(false);
    expect(result.errors).toContainEqual(
      expect.stringContaining(
        'Audited dev-tooling root "@vitest/coverage-v8" is not an allowlisted declared devDependency',
      ),
    );
  });

  it('rejects orphaned closure records when no audited root remains declared', () => {
    const root = makeFixture([rootEntry, childEntry]);
    writeJson(join(root, 'package.json'), {
      dependencies: {},
      devDependencies: { electron: '^42.4.0' },
    });
    writeJson(join(root, 'third-party-manifest.json'), {
      schemaVersion: '1.1.0',
      dependencies: [
        {
          name: 'electron',
          version: '^42.4.0',
          license: 'MIT',
          licenseFile: 'licenses/electron.LICENSE',
        },
      ],
      auditedDevTooling: {
        roots: [],
        productionClosure: [rootEntry, childEntry],
      },
    });

    const result = run(root);

    expect(result.ok).toBe(false);
    expect(result.errors).toContainEqual(
      expect.stringContaining(
        'Audited dev-tooling manifest entry "@vitest/coverage-v8@4.1.8" has no declared audited root',
      ),
    );
  });

  it('rejects duplicate exact records in the audited production closure', () => {
    const result = run(makeFixture([rootEntry, childEntry, childEntry]));

    expect(result.ok).toBe(false);
    expect(result.errors).toContainEqual(
      expect.stringContaining(
        'Duplicate audited dev-tooling manifest entry "coverage-child@1.2.3"',
      ),
    );
  });

  it('rejects a missing repository license file for an audited package', () => {
    const root = makeFixture([rootEntry, childEntry]);
    rmSync(join(root, 'licenses/dev-tooling/coverage-child.LICENSE'));

    const result = run(root);

    expect(result.ok).toBe(false);
    expect(result.errors).toContainEqual(
      expect.stringContaining(
        'License file missing for audited dev-tooling coverage-child: licenses/dev-tooling/coverage-child.LICENSE',
      ),
    );
  });

  it.each(['outside path', 'directory path'] as const)(
    'rejects an audited licenseFile that resolves to an $caseName',
    (caseName) => {
      const root = makeFixture([rootEntry, childEntry]);
      let licenseFile = 'licenses/dev-tooling';
      if (caseName === 'outside path') {
        const outsideName = `${basename(root)}.outside.LICENSE`;
        const outsidePath = join(dirname(root), outsideName);
        writeFileSync(outsidePath, 'outside fixture license');
        externalFiles.push(outsidePath);
        licenseFile = `../${outsideName}`;
      }
      writeJson(join(root, 'third-party-manifest.json'), {
        schemaVersion: '1.1.0',
        dependencies: [
          {
            name: 'electron',
            version: '^42.4.0',
            license: 'MIT',
            licenseFile: 'licenses/electron.LICENSE',
          },
        ],
        auditedDevTooling: {
          roots: [{ name: '@vitest/coverage-v8', specifier: '4.1.8' }],
          productionClosure: [rootEntry, { ...childEntry, licenseFile }],
        },
      });

      const result = run(root);

      expect(result.ok).toBe(false);
      expect(result.errors).toContainEqual(
        expect.stringContaining(
          'License file for audited dev-tooling "coverage-child" must resolve to a regular repository file under licenses/dev-tooling',
        ),
      );
    },
  );

  it.each([
    {
      label: 'runtime dependency',
      expectedPath: 'dependencies',
      manifest: {
        dependencies: [null],
        auditedDevTooling: {
          roots: [{ name: '@vitest/coverage-v8', specifier: '4.1.8' }],
          productionClosure: [rootEntry, childEntry],
        },
      },
    },
    {
      label: 'audited root',
      expectedPath: 'auditedDevTooling.roots',
      manifest: {
        dependencies: [runtimeEntry],
        auditedDevTooling: {
          roots: [null],
          productionClosure: [rootEntry, childEntry],
        },
      },
    },
    {
      label: 'audited closure',
      expectedPath: 'auditedDevTooling.productionClosure',
      manifest: {
        dependencies: [runtimeEntry],
        auditedDevTooling: {
          roots: [{ name: '@vitest/coverage-v8', specifier: '4.1.8' }],
          productionClosure: [null],
        },
      },
    },
  ])('returns diagnostics for a null $label record', ({ expectedPath, manifest }) => {
    const root = makeFixture([rootEntry, childEntry]);
    writeJson(join(root, 'third-party-manifest.json'), {
      schemaVersion: '1.1.0',
      ...manifest,
    });

    let result: ReturnType<typeof validateLicenses> | undefined;
    expect(() => {
      result = run(root);
    }).not.toThrow();
    expect(result?.ok).toBe(false);
    expect(result?.errors).toContainEqual(
      expect.stringContaining(`${expectedPath}[0] must be an object`),
    );
  });
});
