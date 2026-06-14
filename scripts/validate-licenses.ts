/**
 * 第三方许可证清单的双向校验脚本。
 *
 * 校验范围：
 * 1. **manifest 内部一致性**：每个 entry 必须有 name/version/license/licenseFile，且 licenseFile 实际存在
 * 2. **package.json → manifest（缺失检测）**：package.json `dependencies` 中的每个包必须在 manifest 出现（或在 EXTRA_RUNTIME_DEPS allowlist 中）
 * 3. **manifest → package.json（多余检测）**：manifest 中的每个包必须在 package.json `dependencies` 或 allowlist 中（防止删依赖后忘删 manifest）
 * 4. **版本严格相等**：manifest.version === package.json.dependencies[name]，防止 bump 依赖后忘了重新审核许可证
 *
 * `EXTRA_RUNTIME_DEPS` 是显式 allowlist：用于 `electron` 这类
 * "在 devDependencies 但运行时分发"的特殊依赖。
 */

import { readFileSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

interface ManifestEntry {
  name: string;
  version: string;
  license: string;
  licenseFile: string;
}

interface Manifest {
  schemaVersion: string;
  generatedAt?: string;
  dependencies: ManifestEntry[];
}

interface PackageJsonLike {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
}

/**
 * 必须出现在 manifest 中、但 package.json `dependencies` 字段不一定有的运行时依赖。
 *
 * 当前仅 `electron` —— 它在 package.json 是 devDependency（通过 electron CLI 启动）
 * 但运行时分发包含完整 Electron runtime，必须有许可证归因。
 *
 * 加入此 allowlist 的依赖会从 \"missing in package.json.dependencies\" 错误中豁免，
 * 但仍要求实际存在于 package.json 任一 dep 字段（避免 stale allowlist）。
 */
export const EXTRA_RUNTIME_DEPS = ['electron'] as const;

/** {@link validateLicenses} 的依赖注入选项。 */
export interface ValidateOptions {
  /** 绝对路径：`third-party-manifest.json`。 */
  manifestPath: string;
  /** 绝对路径：项目 `package.json`。 */
  packageJsonPath: string;
  /** 项目根目录的绝对路径。manifest 中的 `licenseFile` 字段以此为基准解析。 */
  rootDir: string;
}

/** {@link validateLicenses} 的返回结果。 */
export interface ValidateResult {
  /** 全部校验通过为 true；任一错误为 false。 */
  ok: boolean;
  /** 累积的错误消息（脚本设计为"尽可能多报"，一次跑出所有问题）。 */
  errors: string[];
  /** 校验过的依赖数（manifest entry 数）。manifest 缺失/损坏时为 0。 */
  count: number;
}

/**
 * 双向校验 manifest ↔ package.json ↔ license 文件三方一致性。
 *
 * @param opts 注入路径，便于测试注入临时目录
 * @returns errors 列表与 ok 标志；调用方决定 exit code 或抛错
 */
export function validateLicenses(opts: ValidateOptions): ValidateResult {
  const errors: string[] = [];

  if (!existsSync(opts.manifestPath)) {
    return { ok: false, errors: ['third-party-manifest.json not found'], count: 0 };
  }
  if (!existsSync(opts.packageJsonPath)) {
    return { ok: false, errors: ['package.json not found'], count: 0 };
  }

  let manifest: Manifest;
  try {
    manifest = JSON.parse(readFileSync(opts.manifestPath, 'utf-8'));
  } catch (err) {
    return {
      ok: false,
      errors: [`manifest is not valid JSON: ${(err as Error).message}`],
      count: 0,
    };
  }

  if (!manifest.dependencies || !Array.isArray(manifest.dependencies)) {
    return { ok: false, errors: ['manifest missing dependencies array'], count: 0 };
  }

  let pkg: PackageJsonLike;
  try {
    pkg = JSON.parse(readFileSync(opts.packageJsonPath, 'utf-8'));
  } catch (err) {
    return {
      ok: false,
      errors: [`package.json is not valid JSON: ${(err as Error).message}`],
      count: 0,
    };
  }

  const pkgDeps = pkg.dependencies ?? {};
  const allDeps = {
    ...(pkg.dependencies ?? {}),
    ...(pkg.devDependencies ?? {}),
    ...(pkg.optionalDependencies ?? {}),
  };

  // EXTRA_RUNTIME_DEPS 必须实际出现在 package.json 任一 dep 字段（防 stale allowlist）
  for (const name of EXTRA_RUNTIME_DEPS) {
    if (!(name in allDeps)) {
      errors.push(
        `EXTRA_RUNTIME_DEPS allowlist contains \"${name}\" but it is not in package.json dependencies/devDependencies/optionalDependencies`,
      );
    }
  }

  const expectedRuntimeNames = new Set<string>([
    ...Object.keys(pkgDeps),
    ...EXTRA_RUNTIME_DEPS,
  ]);
  const manifestNames = new Set(manifest.dependencies.map((d) => d.name));

  // 1. manifest 内部一致性 + license 文件存在
  for (const dep of manifest.dependencies) {
    if (!dep.name) {
      errors.push(`Missing name in manifest entry: ${JSON.stringify(dep)}`);
      continue;
    }
    if (!dep.version) errors.push(`Missing version for ${dep.name}`);
    if (!dep.license) errors.push(`Missing license type for ${dep.name}`);
    if (!dep.licenseFile) errors.push(`Missing licenseFile for ${dep.name}`);

    if (dep.licenseFile) {
      const licensePath = join(opts.rootDir, dep.licenseFile);
      if (!existsSync(licensePath)) {
        errors.push(`License file missing for ${dep.name}: ${dep.licenseFile}`);
      }
    }
  }

  // 2. package.json → manifest（缺失检测；区分来源以避免与 allowlist 错误重复或矛盾）
  for (const name of expectedRuntimeNames) {
    if (!manifestNames.has(name)) {
      const source = name in pkgDeps ? 'package.json' : 'EXTRA_RUNTIME_DEPS allowlist';
      errors.push(
        `Runtime dependency "${name}" (from ${source}) is missing from third-party-manifest.json`,
      );
    }
  }

  // 3. manifest → package.json（多余 / stale 检测）
  for (const dep of manifest.dependencies) {
    if (!dep.name) continue;
    if (!expectedRuntimeNames.has(dep.name)) {
      errors.push(
        `Manifest entry \"${dep.name}\" is not in package.json dependencies (and not in EXTRA_RUNTIME_DEPS allowlist) — remove from manifest or add back to package.json`,
      );
    }
  }

  // 4. 版本严格相等（manifest.version 必须与 package.json.dependencies[name] 字符串一致；
  //    EXTRA_RUNTIME_DEPS allowlist 项与 package.json 任一 dep 字段比对）
  for (const dep of manifest.dependencies) {
    if (!dep.name || !dep.version) continue;
    const pkgVersion = allDeps[dep.name];
    if (pkgVersion === undefined) continue; // 已在 #3 报错
    if (pkgVersion !== dep.version) {
      errors.push(
        `Version mismatch for \"${dep.name}\": manifest=${dep.version} vs package.json=${pkgVersion}`,
      );
    }
  }

  return { ok: errors.length === 0, errors, count: manifest.dependencies.length };
}

/**
 * 脚本入口：拼装真实路径并按结果设置 exit code。
 * 仅在脚本被直接执行时调用（被测试 import 时不执行）。
 */
function main(): void {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const result = validateLicenses({
    manifestPath: join(root, 'third-party-manifest.json'),
    packageJsonPath: join(root, 'package.json'),
    rootDir: root,
  });

  if (!result.ok) {
    console.error(
      'FAIL: License validation errors:\n' + result.errors.map((e) => `  - ${e}`).join('\n'),
    );
    process.exit(1);
  }

  console.log(`PASS: All ${result.count} dependencies have valid license entries`);
}

const isDirectExecution =
  process.argv[1] != null && pathToFileURL(process.argv[1]).href === import.meta.url;

if (isDirectExecution) {
  main();
}
