/**
 * 第三方许可证清单的双向校验脚本。
 *
 * 校验范围：
 * 1. **manifest 内部一致性**：每个 entry 必须有 name/version/license/licenseFile，且 licenseFile 实际存在
 * 2. **package.json → manifest（缺失检测）**：package.json `dependencies` 中的每个包必须在 manifest 出现（或在 EXTRA_RUNTIME_DEPS allowlist 中）
 * 3. **manifest → package.json（多余检测）**：manifest 中的每个包必须在 package.json `dependencies` 或 allowlist 中（防止删依赖后忘删 manifest）
 * 4. **版本严格相等**：manifest.version === package.json.dependencies[name]，防止 bump 依赖后忘了重新审核许可证
 * 5. **定向开发工具闭包**：单独解析 allowlisted dev-tooling root 的已安装 `dependencies` 闭包，并校验 exact version、license 和归因文件
 *
 * `EXTRA_RUNTIME_DEPS` 是显式 allowlist：用于 `electron` 这类
 * "在 devDependencies 但运行时分发"的特殊依赖。
 */

import { readFileSync, existsSync, realpathSync, statSync } from 'fs';
import { createRequire } from 'module';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { collectWorkspaceDependencies } from './workspace-packages.js';

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
  auditedDevTooling?: AuditedDevTooling;
}

interface AuditedDevToolRoot {
  name: string;
  specifier: string;
}

interface AuditedDevTooling {
  roots: AuditedDevToolRoot[];
  productionClosure: ManifestEntry[];
}

interface PackageJsonLike {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
}

interface InstalledPackageJson {
  name?: string;
  version?: string;
  license?: string;
  dependencies?: Record<string, string>;
}

interface InstalledPackage {
  name: string;
  version: string;
  license: string;
  packageJsonPath: string;
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

/** 需要独立审计 production dependency closure 的开发工具根。 */
export const AUDITED_DEV_TOOL_ROOTS = ['@vitest/coverage-v8'] as const;

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
  /** 校验过的独立开发工具根数量。 */
  auditedDevToolRootCount: number;
  /** 校验过的开发工具 production dependency closure 包数量（含根）。 */
  auditedDevToolPackageCount: number;
}

/** 将包名转换为 node_modules 下的跨平台路径片段。 */
function packageNameParts(name: string): string[] {
  return name.split('/');
}

/** JSON 值是否为可安全读取字段的普通记录。 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 从 JSON 数组中过滤结构损坏的记录，同时保留可累积诊断。 */
function objectRecords<T>(value: unknown[], path: string, errors: string[]): T[] {
  const records: T[] = [];
  for (const [index, entry] of value.entries()) {
    if (!isRecord(entry)) {
      errors.push(`${path}[${index}] must be an object`);
      continue;
    }
    records.push(entry as T);
  }
  return records;
}

/** 判断 candidate 是否位于 directory 内（允许 candidate 等于 directory，随后由 regular-file 检查拒绝）。 */
function isPathInside(directory: string, candidate: string): boolean {
  const relativePath = relative(directory, candidate);
  return (
    relativePath === '' ||
    (relativePath !== '..' && !relativePath.startsWith(`..${sep}`) && !isAbsolute(relativePath))
  );
}

/** 校验 manifest 归因路径留在指定仓库目录内且最终指向普通文件。 */
function validateRepositoryLicenseFile(
  rootDir: string,
  licenseFile: string,
  allowedDirectory: string,
  dependencyLabel: string,
  missingMessage: string,
  errors: string[],
): void {
  const allowedPath = resolve(rootDir, allowedDirectory);
  const licensePath = resolve(rootDir, licenseFile);
  const invalidMessage = `License file for ${dependencyLabel} must resolve to a regular repository file under ${allowedDirectory}`;

  if (!isPathInside(allowedPath, licensePath)) {
    errors.push(invalidMessage);
    return;
  }
  if (!existsSync(licensePath)) {
    errors.push(missingMessage);
    return;
  }

  const realRootPath = realpathSync(rootDir);
  const realAllowedPath = realpathSync(allowedPath);
  const realLicensePath = realpathSync(licensePath);
  if (
    !isPathInside(realRootPath, realAllowedPath) ||
    !isPathInside(realAllowedPath, realLicensePath) ||
    !statSync(licensePath).isFile()
  ) {
    errors.push(invalidMessage);
  }
}

/** 从 resolved entry 向上寻找名字匹配的 package.json，绕过 exports 对 package.json 的限制。 */
function findOwningPackageJson(entryPath: string, expectedName: string): string | undefined {
  let current = dirname(entryPath);

  while (true) {
    const candidate = join(current, 'package.json');
    if (existsSync(candidate)) {
      try {
        const pkg = JSON.parse(readFileSync(candidate, 'utf-8')) as InstalledPackageJson;
        if (pkg.name === expectedName) return realpathSync(candidate);
      } catch {
        // 继续向上寻找；最终由调用方给出稳定的无法解析诊断。
      }
    }

    const parent = dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

/** 按真实 Node 解析规则定位 issuer 的普通 dependency，不读取 peer/dev snapshot 边。 */
function resolveInstalledPackageJson(
  name: string,
  issuerPackageJsonPath: string,
  rootDir: string,
): string | undefined {
  const issuerPath = realpathSync(issuerPackageJsonPath);
  const requireFromIssuer = createRequire(issuerPath);

  try {
    return realpathSync(requireFromIssuer.resolve(`${name}/package.json`));
  } catch {
    // 某些包通过 exports 禁止 package.json 子路径，改为解析 entry 后向上寻找。
  }

  try {
    const entryPath = requireFromIssuer.resolve(name);
    const owningPackageJson = findOwningPackageJson(entryPath, name);
    if (owningPackageJson) return owningPackageJson;
  } catch {
    // fixture 或扁平安装可由根 node_modules fallback 解析。
  }

  const rootCandidate = join(rootDir, 'node_modules', ...packageNameParts(name), 'package.json');
  return existsSync(rootCandidate) ? realpathSync(rootCandidate) : undefined;
}

/** 收集开发工具根沿 package.json `dependencies` 可达的已安装精确闭包。 */
function collectInstalledProductionClosure(
  rootDir: string,
  rootName: string,
): { packages: Map<string, InstalledPackage>; errors: string[] } {
  const errors: string[] = [];
  const packages = new Map<string, InstalledPackage>();
  const rootPackageJson = join(
    rootDir,
    'node_modules',
    ...packageNameParts(rootName),
    'package.json',
  );

  if (!existsSync(rootPackageJson)) {
    return {
      packages,
      errors: [`Audited dev-tooling root "${rootName}" is not installed`],
    };
  }

  const queue = [realpathSync(rootPackageJson)];
  const visitedPaths = new Set<string>();

  while (queue.length > 0) {
    const packageJsonPath = queue.shift()!;
    if (visitedPaths.has(packageJsonPath)) continue;
    visitedPaths.add(packageJsonPath);

    let pkg: InstalledPackageJson;
    try {
      pkg = JSON.parse(readFileSync(packageJsonPath, 'utf-8')) as InstalledPackageJson;
    } catch (err) {
      errors.push(
        `Cannot read installed package metadata at ${packageJsonPath}: ${(err as Error).message}`,
      );
      continue;
    }

    if (!pkg.name || !pkg.version || !pkg.license) {
      errors.push(`Installed package metadata is incomplete at ${packageJsonPath}`);
      continue;
    }

    const key = `${pkg.name}@${pkg.version}`;
    packages.set(key, {
      name: pkg.name,
      version: pkg.version,
      license: pkg.license,
      packageJsonPath,
    });

    for (const dependencyName of Object.keys(pkg.dependencies ?? {}).sort()) {
      const dependencyPath = resolveInstalledPackageJson(dependencyName, packageJsonPath, rootDir);
      if (!dependencyPath) {
        errors.push(`Cannot resolve production dependency "${dependencyName}" from "${key}"`);
        continue;
      }
      queue.push(dependencyPath);
    }
  }

  return { packages, errors };
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
    return {
      ok: false,
      errors: ['third-party-manifest.json not found'],
      count: 0,
      auditedDevToolRootCount: 0,
      auditedDevToolPackageCount: 0,
    };
  }
  if (!existsSync(opts.packageJsonPath)) {
    return {
      ok: false,
      errors: ['package.json not found'],
      count: 0,
      auditedDevToolRootCount: 0,
      auditedDevToolPackageCount: 0,
    };
  }

  let manifestValue: unknown;
  try {
    manifestValue = JSON.parse(readFileSync(opts.manifestPath, 'utf-8'));
  } catch (err) {
    return {
      ok: false,
      errors: [`manifest is not valid JSON: ${(err as Error).message}`],
      count: 0,
      auditedDevToolRootCount: 0,
      auditedDevToolPackageCount: 0,
    };
  }

  if (!isRecord(manifestValue)) {
    return {
      ok: false,
      errors: ['manifest root must be an object'],
      count: 0,
      auditedDevToolRootCount: 0,
      auditedDevToolPackageCount: 0,
    };
  }
  const manifest = manifestValue as unknown as Manifest;

  if (!manifest.dependencies || !Array.isArray(manifest.dependencies)) {
    return {
      ok: false,
      errors: ['manifest missing dependencies array'],
      count: 0,
      auditedDevToolRootCount: 0,
      auditedDevToolPackageCount: 0,
    };
  }
  const manifestDependencies = objectRecords<ManifestEntry>(
    manifest.dependencies,
    'dependencies',
    errors,
  );

  let packageJsonValue: unknown;
  try {
    packageJsonValue = JSON.parse(readFileSync(opts.packageJsonPath, 'utf-8'));
  } catch (err) {
    return {
      ok: false,
      errors: [`package.json is not valid JSON: ${(err as Error).message}`],
      count: 0,
      auditedDevToolRootCount: 0,
      auditedDevToolPackageCount: 0,
    };
  }
  if (!isRecord(packageJsonValue)) {
    return {
      ok: false,
      errors: ['package.json root must be an object'],
      count: manifestDependencies.length,
      auditedDevToolRootCount: 0,
      auditedDevToolPackageCount: 0,
    };
  }
  const pkg = packageJsonValue as PackageJsonLike;

  const declaredDependencies = collectWorkspaceDependencies(opts.rootDir, pkg);
  errors.push(...declaredDependencies.errors);
  const pkgDeps = declaredDependencies.runtime;
  const allDeps = declaredDependencies.all;

  // EXTRA_RUNTIME_DEPS 必须实际出现在 package.json 任一 dep 字段（防 stale allowlist）
  for (const name of EXTRA_RUNTIME_DEPS) {
    if (!(name in allDeps)) {
      errors.push(
        `EXTRA_RUNTIME_DEPS allowlist contains \"${name}\" but it is not in package.json dependencies/devDependencies/optionalDependencies`,
      );
    }
  }

  const expectedRuntimeNames = new Set<string>([...Object.keys(pkgDeps), ...EXTRA_RUNTIME_DEPS]);
  const manifestNames = new Set(
    manifestDependencies
      .filter((dependency) => typeof dependency.name === 'string')
      .map((dependency) => dependency.name),
  );

  // 1. manifest 内部一致性 + license 文件存在
  for (const dep of manifestDependencies) {
    if (typeof dep.name !== 'string' || dep.name.length === 0) {
      errors.push(`Missing name in manifest entry: ${JSON.stringify(dep)}`);
      continue;
    }
    if (typeof dep.version !== 'string' || dep.version.length === 0)
      errors.push(`Missing version for ${dep.name}`);
    if (typeof dep.license !== 'string' || dep.license.length === 0)
      errors.push(`Missing license type for ${dep.name}`);
    if (typeof dep.licenseFile !== 'string' || dep.licenseFile.length === 0)
      errors.push(`Missing licenseFile for ${dep.name}`);

    if (typeof dep.licenseFile === 'string' && dep.licenseFile.length > 0) {
      validateRepositoryLicenseFile(
        opts.rootDir,
        dep.licenseFile,
        'licenses',
        `runtime dependency "${dep.name}"`,
        `License file missing for ${dep.name}: ${dep.licenseFile}`,
        errors,
      );
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
  for (const dep of manifestDependencies) {
    if (typeof dep.name !== 'string' || dep.name.length === 0) continue;
    if (!expectedRuntimeNames.has(dep.name)) {
      errors.push(
        `Manifest entry \"${dep.name}\" is not in package.json dependencies (and not in EXTRA_RUNTIME_DEPS allowlist) — remove from manifest or add back to package.json`,
      );
    }
  }

  // 4. 版本严格相等（manifest.version 必须与 package.json.dependencies[name] 字符串一致；
  //    EXTRA_RUNTIME_DEPS allowlist 项与 package.json 任一 dep 字段比对）
  for (const dep of manifestDependencies) {
    if (
      typeof dep.name !== 'string' ||
      dep.name.length === 0 ||
      typeof dep.version !== 'string' ||
      dep.version.length === 0
    )
      continue;
    const pkgVersion = allDeps[dep.name];
    if (pkgVersion === undefined) continue; // 已在 #3 报错
    if (pkgVersion !== dep.version) {
      errors.push(
        `Version mismatch for \"${dep.name}\": manifest=${dep.version} vs package.json=${pkgVersion}`,
      );
    }
  }

  const expectedAuditedRoots = AUDITED_DEV_TOOL_ROOTS.filter(
    (name) => name in (pkg.devDependencies ?? {}),
  );
  const auditedDevToolingValue = manifestValue.auditedDevTooling;
  const auditedDevTooling = isRecord(auditedDevToolingValue) ? auditedDevToolingValue : undefined;
  if (auditedDevToolingValue !== undefined && !auditedDevTooling) {
    errors.push('auditedDevTooling must be an object');
  }

  const rootsValue = auditedDevTooling?.roots;
  if (auditedDevTooling && !Array.isArray(rootsValue)) {
    errors.push('auditedDevTooling.roots must be an array');
  }
  const auditedRoots = Array.isArray(rootsValue)
    ? objectRecords<AuditedDevToolRoot>(rootsValue, 'auditedDevTooling.roots', errors)
    : [];

  const closureValue = auditedDevTooling?.productionClosure;
  if (auditedDevTooling && !Array.isArray(closureValue)) {
    errors.push('auditedDevTooling.productionClosure must be an array');
  }
  const auditedClosure = Array.isArray(closureValue)
    ? objectRecords<ManifestEntry>(closureValue, 'auditedDevTooling.productionClosure', errors)
    : [];
  const seenAuditedClosureKeys = new Set<string>();
  for (const entry of auditedClosure) {
    if (
      typeof entry.name !== 'string' ||
      entry.name.length === 0 ||
      typeof entry.version !== 'string' ||
      entry.version.length === 0
    )
      continue;
    const entryKey = `${entry.name}@${entry.version}`;
    if (seenAuditedClosureKeys.has(entryKey)) {
      errors.push(`Duplicate audited dev-tooling manifest entry "${entryKey}"`);
    }
    seenAuditedClosureKeys.add(entryKey);
  }

  if (expectedAuditedRoots.length > 0 && !auditedDevTooling) {
    errors.push('Manifest is missing auditedDevTooling for declared audited development tools');
  }

  if (expectedAuditedRoots.length === 0 && auditedClosure.length > 0) {
    for (const entry of auditedClosure) {
      if (
        typeof entry.name !== 'string' ||
        entry.name.length === 0 ||
        typeof entry.version !== 'string' ||
        entry.version.length === 0
      )
        continue;
      errors.push(
        `Audited dev-tooling manifest entry "${entry.name}@${entry.version}" has no declared audited root`,
      );
    }
  }

  for (const root of auditedRoots) {
    if (
      typeof root.name !== 'string' ||
      root.name.length === 0 ||
      typeof root.specifier !== 'string' ||
      root.specifier.length === 0
    ) {
      errors.push('Audited dev-tooling root requires non-empty name and specifier strings');
      continue;
    }
    const isAllowlisted = AUDITED_DEV_TOOL_ROOTS.some((name) => name === root.name);
    const isDeclaredDevDependency = root.name in (pkg.devDependencies ?? {});
    if (!isAllowlisted || !isDeclaredDevDependency) {
      errors.push(
        `Audited dev-tooling root "${root.name}" is not an allowlisted declared devDependency`,
      );
    }
  }

  const installedPackages = new Map<string, InstalledPackage>();
  for (const rootName of expectedAuditedRoots) {
    const rootRecords = auditedRoots.filter((root) => root.name === rootName);
    if (rootRecords.length !== 1) {
      errors.push(
        `Audited dev-tooling root "${rootName}" must appear exactly once (found ${rootRecords.length})`,
      );
    }

    const packageSpecifier = pkg.devDependencies?.[rootName];
    if (rootRecords.length === 1 && rootRecords[0]!.specifier !== packageSpecifier) {
      errors.push(
        `Specifier mismatch for audited dev-tooling root "${rootName}": manifest=${rootRecords[0]!.specifier} vs package.json=${packageSpecifier}`,
      );
    }

    const installed = collectInstalledProductionClosure(opts.rootDir, rootName);
    errors.push(...installed.errors);
    const installedRoot = [...installed.packages.values()].find(
      (installedPackage) => installedPackage.name === rootName,
    );
    if (installedRoot && packageSpecifier !== installedRoot.version) {
      errors.push(
        `Installed audited dev-tooling root "${rootName}" version mismatch: package.json=${packageSpecifier} vs installed=${installedRoot.version}`,
      );
    }
    for (const [installedKey, installedPackage] of installed.packages) {
      installedPackages.set(installedKey, installedPackage);
    }
  }

  const validAuditedClosure = auditedClosure.filter(
    (entry) =>
      typeof entry.name === 'string' &&
      entry.name.length > 0 &&
      typeof entry.version === 'string' &&
      entry.version.length > 0,
  );
  const manifestKeys = new Set(
    validAuditedClosure.map((entry) => `${entry.name}@${entry.version}`),
  );
  const manifestEntriesByName = new Map<string, ManifestEntry[]>();
  for (const entry of validAuditedClosure) {
    const entries = manifestEntriesByName.get(entry.name) ?? [];
    entries.push(entry);
    manifestEntriesByName.set(entry.name, entries);
  }

  if (expectedAuditedRoots.length > 0) {
    for (const [installedKey, installedPackage] of installedPackages) {
      if (!manifestKeys.has(installedKey)) {
        const sameNameEntries = manifestEntriesByName.get(installedPackage.name) ?? [];
        if (
          sameNameEntries.length === 1 &&
          typeof sameNameEntries[0]!.version === 'string' &&
          sameNameEntries[0]!.version.length > 0
        ) {
          errors.push(
            `Version mismatch for audited dev-tooling "${installedPackage.name}": manifest=${sameNameEntries[0]!.version} vs installed=${installedPackage.version}`,
          );
        } else {
          errors.push(
            `Audited dev-tooling dependency "${installedKey}" is missing from third-party-manifest.json`,
          );
        }
      }
    }

    const installedNames = new Set(
      [...installedPackages.values()].map((installedPackage) => installedPackage.name),
    );
    for (const entry of validAuditedClosure) {
      const entryKey = `${entry.name}@${entry.version}`;
      const installedPackage = installedPackages.get(entryKey);
      if (!installedPackage) {
        const hasInstalledName = installedNames.has(entry.name);
        const hasExactInstalledVersionInManifest = [...installedPackages.keys()].some(
          (installedKey) =>
            installedKey.startsWith(`${entry.name}@`) && manifestKeys.has(installedKey),
        );
        if (!hasInstalledName || hasExactInstalledVersionInManifest) {
          errors.push(
            `Audited dev-tooling manifest entry "${entryKey}" is not in the installed production closure`,
          );
        }
      } else if (
        typeof entry.license === 'string' &&
        entry.license.length > 0 &&
        entry.license !== installedPackage.license
      ) {
        errors.push(
          `License mismatch for audited dev-tooling "${entryKey}": manifest=${entry.license} vs installed=${installedPackage.license}`,
        );
      }
    }
  }

  for (const dep of auditedClosure) {
    if (typeof dep.name !== 'string' || dep.name.length === 0) {
      errors.push(`Missing name in audited dev-tooling entry: ${JSON.stringify(dep)}`);
      continue;
    }
    if (typeof dep.version !== 'string' || dep.version.length === 0)
      errors.push(`Missing version for audited dev-tooling ${dep.name}`);
    if (typeof dep.license !== 'string' || dep.license.length === 0)
      errors.push(`Missing license type for audited dev-tooling ${dep.name}`);
    if (typeof dep.licenseFile !== 'string' || dep.licenseFile.length === 0)
      errors.push(`Missing licenseFile for audited dev-tooling ${dep.name}`);
    if (typeof dep.licenseFile === 'string' && dep.licenseFile.length > 0) {
      validateRepositoryLicenseFile(
        opts.rootDir,
        dep.licenseFile,
        'licenses/dev-tooling',
        `audited dev-tooling "${dep.name}"`,
        `License file missing for audited dev-tooling ${dep.name}: ${dep.licenseFile}`,
        errors,
      );
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    count: manifestDependencies.length,
    auditedDevToolRootCount: auditedRoots.length,
    auditedDevToolPackageCount: auditedClosure.length,
  };
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

  console.log(
    `PASS: ${result.count} runtime dependencies and ${result.auditedDevToolPackageCount} packages in ${result.auditedDevToolRootCount} audited dev-tooling production closure have valid license entries`,
  );
}

const isDirectExecution =
  process.argv[1] != null && pathToFileURL(process.argv[1]).href === import.meta.url;

if (isDirectExecution) {
  main();
}
