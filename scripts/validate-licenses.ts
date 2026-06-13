import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

interface ManifestEntry {
  name: string;
  version: string;
  license: string;
  licenseFile: string;
}

interface Manifest {
  schemaVersion: string;
  dependencies: ManifestEntry[];
}

const ROOT = join(import.meta.dirname, '..');
const MANIFEST_PATH = join(ROOT, 'third-party-manifest.json');
const LICENSES_DIR = join(ROOT, 'licenses');

function validate(): void {
  const errors: string[] = [];

  if (!existsSync(MANIFEST_PATH)) {
    console.error('FAIL: third-party-manifest.json not found');
    process.exit(1);
  }

  const manifest: Manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf-8'));

  if (!manifest.dependencies || !Array.isArray(manifest.dependencies)) {
    console.error('FAIL: manifest missing dependencies array');
    process.exit(1);
  }

  for (const dep of manifest.dependencies) {
    if (!dep.name) errors.push(`Missing name in manifest entry: ${JSON.stringify(dep)}`);
    if (!dep.version) errors.push(`Missing version for ${dep.name}`);
    if (!dep.license) errors.push(`Missing license type for ${dep.name}`);
    if (!dep.licenseFile) errors.push(`Missing licenseFile for ${dep.name}`);

    const licensePath = join(ROOT, dep.licenseFile);
    if (!existsSync(licensePath)) {
      errors.push(`License file missing for ${dep.name}: ${dep.licenseFile}`);
    }
  }

  if (errors.length > 0) {
    console.error('FAIL: License validation errors:\n' + errors.map((e) => `  - ${e}`).join('\n'));
    process.exit(1);
  }

  console.log(`PASS: All ${manifest.dependencies.length} dependencies have valid license entries`);
}

validate();
