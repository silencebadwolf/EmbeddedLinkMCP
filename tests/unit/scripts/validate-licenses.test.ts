import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { validateLicenses } from '../../../scripts/validate-licenses.js';

interface FixtureSpec {
  pkg: {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    optionalDependencies?: Record<string, string>;
  };
  manifest: {
    schemaVersion?: string;
    dependencies?: unknown;
  };
  /** 写入到 licenses/ 的 license 文件名（不含扩展名前缀路径） */
  licenseFiles: string[];
}

function makeFixture(root: string, spec: FixtureSpec): void {
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'fixture', ...spec.pkg }));
  writeFileSync(
    join(root, 'third-party-manifest.json'),
    JSON.stringify({ schemaVersion: '1.0.0', ...spec.manifest }),
  );
  mkdirSync(join(root, 'licenses'), { recursive: true });
  for (const fname of spec.licenseFiles) {
    writeFileSync(join(root, 'licenses', fname), 'fake license content');
  }
}

describe('validateLicenses (Phase 11)', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'linkterm-license-test-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  function run() {
    return validateLicenses({
      manifestPath: join(root, 'third-party-manifest.json'),
      packageJsonPath: join(root, 'package.json'),
      rootDir: root,
    });
  }

  it('happy path: package.json + manifest + license files all aligned', () => {
    makeFixture(root, {
      pkg: { dependencies: { foo: '^1.0.0' }, devDependencies: { electron: '^42.0.0' } },
      manifest: {
        dependencies: [
          { name: 'foo', version: '^1.0.0', license: 'MIT', licenseFile: 'licenses/foo.LICENSE' },
          {
            name: 'electron',
            version: '^42.0.0',
            license: 'MIT',
            licenseFile: 'licenses/electron.LICENSE',
          },
        ],
      },
      licenseFiles: ['foo.LICENSE', 'electron.LICENSE'],
    });

    const result = run();
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.count).toBe(2);
  });

  it('missing-in-manifest: new runtime dep without manifest entry fails', () => {
    makeFixture(root, {
      pkg: { dependencies: { foo: '^1.0.0', bar: '^2.0.0' } },
      manifest: {
        dependencies: [
          { name: 'foo', version: '^1.0.0', license: 'MIT', licenseFile: 'licenses/foo.LICENSE' },
        ],
      },
      licenseFiles: ['foo.LICENSE'],
    });

    const result = run();
    expect(result.ok).toBe(false);
    expect(result.errors).toContainEqual(
      expect.stringContaining(
        'Runtime dependency "bar" (from package.json) is missing from third-party-manifest.json',
      ),
    );
  });

  it('extra-in-manifest: stale manifest entry without package.json dep fails', () => {
    makeFixture(root, {
      pkg: { dependencies: { foo: '^1.0.0' } },
      manifest: {
        dependencies: [
          { name: 'foo', version: '^1.0.0', license: 'MIT', licenseFile: 'licenses/foo.LICENSE' },
          {
            name: 'stale',
            version: '^9.0.0',
            license: 'MIT',
            licenseFile: 'licenses/stale.LICENSE',
          },
        ],
      },
      licenseFiles: ['foo.LICENSE', 'stale.LICENSE'],
    });

    const result = run();
    expect(result.ok).toBe(false);
    expect(result.errors).toContainEqual(
      expect.stringContaining('Manifest entry "stale" is not in package.json dependencies'),
    );
  });

  it('version-mismatch: manifest version differs from package.json fails', () => {
    makeFixture(root, {
      pkg: { dependencies: { foo: '^1.0.0' } },
      manifest: {
        dependencies: [
          { name: 'foo', version: '^2.0.0', license: 'MIT', licenseFile: 'licenses/foo.LICENSE' },
        ],
      },
      licenseFiles: ['foo.LICENSE'],
    });

    const result = run();
    expect(result.ok).toBe(false);
    expect(result.errors).toContainEqual(
      expect.stringContaining('Version mismatch for "foo": manifest=^2.0.0 vs package.json=^1.0.0'),
    );
  });

  it('missing-license-file: manifest references non-existent file fails', () => {
    makeFixture(root, {
      pkg: { dependencies: { foo: '^1.0.0' } },
      manifest: {
        dependencies: [
          { name: 'foo', version: '^1.0.0', license: 'MIT', licenseFile: 'licenses/foo.LICENSE' },
        ],
      },
      licenseFiles: [], // intentionally missing
    });

    const result = run();
    expect(result.ok).toBe(false);
    expect(result.errors).toContainEqual(
      expect.stringContaining('License file missing for foo'),
    );
  });

  it('electron-allowlist: electron in devDependencies (not dependencies) but in manifest passes', () => {
    makeFixture(root, {
      pkg: { dependencies: {}, devDependencies: { electron: '^42.0.0' } },
      manifest: {
        dependencies: [
          {
            name: 'electron',
            version: '^42.0.0',
            license: 'MIT',
            licenseFile: 'licenses/electron.LICENSE',
          },
        ],
      },
      licenseFiles: ['electron.LICENSE'],
    });

    const result = run();
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('stale-allowlist: EXTRA_RUNTIME_DEPS contains item not in package.json fails', () => {
    // EXTRA_RUNTIME_DEPS hardcodes 'electron'; remove it from package.json entirely
    makeFixture(root, {
      pkg: { dependencies: { foo: '^1.0.0' } },
      manifest: {
        dependencies: [
          { name: 'foo', version: '^1.0.0', license: 'MIT', licenseFile: 'licenses/foo.LICENSE' },
        ],
      },
      licenseFiles: ['foo.LICENSE'],
    });

    const result = run();
    expect(result.ok).toBe(false);
    expect(result.errors).toContainEqual(
      expect.stringContaining('EXTRA_RUNTIME_DEPS allowlist contains "electron"'),
    );
  });

  it('missing-manifest-file: clear error when manifest absent', () => {
    // 不调 makeFixture
    writeFileSync(join(root, 'package.json'), JSON.stringify({ dependencies: {} }));
    const result = run();
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toContain('third-party-manifest.json not found');
  });

  it('missing-package-json: clear error when package.json absent', () => {
    writeFileSync(
      join(root, 'third-party-manifest.json'),
      JSON.stringify({ schemaVersion: '1.0.0', dependencies: [] }),
    );
    const result = run();
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toContain('package.json not found');
  });

  it('manifest-corrupt-json: clear error when manifest is malformed JSON', () => {
    writeFileSync(join(root, 'package.json'), JSON.stringify({ dependencies: {} }));
    writeFileSync(join(root, 'third-party-manifest.json'), '{ this is not valid json');
    const result = run();
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toContain('manifest is not valid JSON');
  });

  it('accumulates multiple errors in single run', () => {
    // 同时构造：manifest 多余 entry + 版本不一致 + license 文件缺失
    makeFixture(root, {
      pkg: { dependencies: { foo: '^1.0.0' }, devDependencies: { electron: '^42.0.0' } },
      manifest: {
        dependencies: [
          // foo 版本与 package.json 不一致
          { name: 'foo', version: '^9.9.9', license: 'MIT', licenseFile: 'licenses/foo.LICENSE' },
          // electron entry 引用不存在的 license file
          {
            name: 'electron',
            version: '^42.0.0',
            license: 'MIT',
            licenseFile: 'licenses/electron.LICENSE',
          },
          // stale: bar 不在 package.json
          { name: 'bar', version: '^1.0.0', license: 'MIT', licenseFile: 'licenses/bar.LICENSE' },
        ],
      },
      licenseFiles: ['foo.LICENSE', 'bar.LICENSE'], // 缺 electron.LICENSE
    });

    const result = run();
    expect(result.ok).toBe(false);
    expect(result.errors.length).toBeGreaterThanOrEqual(3);
    expect(result.errors).toContainEqual(expect.stringContaining('Version mismatch for "foo"'));
    expect(result.errors).toContainEqual(expect.stringContaining('License file missing for electron'));
    expect(result.errors).toContainEqual(
      expect.stringContaining('Manifest entry "bar" is not in package.json'),
    );
  });
});
