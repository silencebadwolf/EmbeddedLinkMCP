/** Persistent workspace config: atomic load/save plus conflict reporting. */

import path from 'node:path';
import {
  detectConflicts,
  type ConflictReport,
  type EvidenceSnapshot,
} from './conflict-detect.js';
import {
  workspaceConfigSchema,
  workspaceConfigPatchSchema,
  type WorkspaceConfigPatch,
} from './config-schema.js';
import {
  defaultFsPrimitives,
  type FsPrimitives,
} from './fs-primitives.js';
import {
  WORKSPACE_SCHEMA_VERSION,
  type WorkspaceConfig,
} from './types.js';

/** 工作区已经存在 config.json 但 caller 没显式 force=true。 */
export class WorkspaceAlreadyInitializedError extends Error {
  readonly code = 'WORKSPACE_ALREADY_INITIALIZED' as const;
  constructor(public readonly root: string) {
    super(`Workspace already initialized at ${root}`);
    this.name = 'WorkspaceAlreadyInitializedError';
  }
}

/** 工作区还没初始化（找不到 .linkterm/config.json）。 */
export class WorkspaceNotFoundError extends Error {
  readonly code = 'WORKSPACE_NOT_FOUND' as const;
  constructor(public readonly root: string) {
    super(`Workspace config not found at ${root}`);
    this.name = 'WorkspaceNotFoundError';
  }
}

/** 持久化前发现严重冲突（severity='error'）。 */
export class WorkspaceConflictError extends Error {
  readonly code = 'WORKSPACE_CONFLICT' as const;
  constructor(
    public readonly report: ConflictReport,
    message: string = 'Workspace config conflicts hardware evidence',
  ) {
    super(message);
    this.name = 'WorkspaceConflictError';
  }
}

/** root 路径非法（非绝对路径或包含 ".." 段）。 */
export class WorkspaceInvalidRootError extends Error {
  readonly code = 'WORKSPACE_INVALID_ROOT' as const;
  constructor(public readonly root: string) {
    super(`Invalid workspace root: ${root}`);
    this.name = 'WorkspaceInvalidRootError';
  }
}

/** 持久化文件超过 1 MiB 上限。 */
export class WorkspaceConfigTooLargeError extends Error {
  readonly code = 'WORKSPACE_CONFIG_TOO_LARGE' as const;
  constructor(
    public readonly root: string,
    public readonly size: number,
  ) {
    super(`Workspace config file too large (>1MiB): ${size} bytes at ${root}`);
    this.name = 'WorkspaceConfigTooLargeError';
  }
}

/** 持久化文件 schemaVersion 与运行时常量不匹配。 */
export class WorkspaceSchemaVersionMismatchError extends Error {
  readonly code = 'WORKSPACE_SCHEMA_VERSION_MISMATCH' as const;
  constructor(
    public readonly expected: string,
    public readonly actual: unknown,
    public readonly root: string,
  ) {
    super(
      `Workspace schemaVersion mismatch at ${root}: expected ${expected}, got ${String(actual)}`,
    );
    this.name = 'WorkspaceSchemaVersionMismatchError';
  }
}

/**
 * 校验 root 必须是绝对路径且不含 ".." 段。
 *
 * @param root 待校验的工作区根目录路径
 * @throws {WorkspaceInvalidRootError} 路径非绝对或含 ".."
 */
export function assertValidRoot(root: string): void {
  if (!path.isAbsolute(root) || root.split(path.sep).includes('..')) {
    throw new WorkspaceInvalidRootError(root);
  }
}

/** WorkspaceConfigManager 构造选项。 */
export interface WorkspaceConfigManagerOptions {
  /** 注入 fs 原语；省略时用 `node:fs/promises` 默认实现。 */
  fs?: FsPrimitives;
  /**
   * 提供当前硬件证据快照的回调。每次 `update` 调用前会执行一次。
   * 测试可注入静态返回；main 进程组装为 `() => ({ serialPorts: serialDiscovery.listPorts() })`。
   */
  evidenceFn?: () => Promise<EvidenceSnapshot>;
}

/** init / load / update 共用的当前激活工作区状态。 */
interface CurrentWorkspace {
  root: string;
  config: WorkspaceConfig;
}

/** 持久化文件大小上限（1 MiB），防止误读巨型/非配置文件。 */
const MAX_CONFIG_FILE_BYTES = 1024 * 1024;

/**
 * 工作区配置管理器。
 *
 * 单例式持有：每个 LinkTerm 主进程只一个。但允许同一 manager 切换不同 root
 * （由 caller 显式调 `init`/`load` 决定）。
 */
export class WorkspaceConfigManager {
  readonly #fs: FsPrimitives;
  readonly #evidenceFn: () => Promise<EvidenceSnapshot>;
  #current: CurrentWorkspace | null = null;
  /**
   * 串行化锁：所有写路径（init / update）依次链接到此 promise，避免并发 update 之间的
   * read-modify-write 丢更新。load 是只读 + 单语句赋值 #current，故不参与排队。
   */
  #inflight: Promise<unknown> = Promise.resolve();

  constructor(options: WorkspaceConfigManagerOptions = {}) {
    this.#fs = options.fs ?? defaultFsPrimitives;
    this.#evidenceFn = options.evidenceFn ?? (async () => ({ serialPorts: [] }));
  }

  /**
   * 初始化工作区：创建 `.linkterm/` 目录与空白的 config.json（仅含 schemaVersion）。
   *
   * @param root 工作区根目录绝对路径
   * @param opts.force 已存在时强制覆盖（默认 false 报错）
   * @returns 写入后的 config（仅含 schemaVersion，等待后续 update 填充 5 类）
   * @throws WorkspaceAlreadyInitializedError 已存在且未 force
   * @throws WorkspaceInvalidRootError root 非法
   */
  async init(root: string, opts?: { force?: boolean }): Promise<WorkspaceConfig> {
    assertValidRoot(root);
    const next = this.#inflight.then(() => this.#initImpl(root, opts));
    this.#inflight = next.catch(() => {});
    return next;
  }

  async #initImpl(
    root: string,
    opts?: { force?: boolean },
  ): Promise<WorkspaceConfig> {
    const file = this.#configPath(root);
    if (!opts?.force) {
      const exists = await this.#fileExists(file);
      if (exists) {
        throw new WorkspaceAlreadyInitializedError(root);
      }
    }
    const config: WorkspaceConfig = { schemaVersion: WORKSPACE_SCHEMA_VERSION };
    await this.#writeAtomic(root, config);
    this.#current = { root, config };
    return config;
  }

  /**
   * 读取工作区配置；不存在时抛 WorkspaceNotFoundError。
   *
   * 解析失败（JSON 损坏 / schema 不匹配）抛 ZodError，由 MCP 翻译为 INVALID_ARGUMENT。
   *
   * @param root 工作区根目录绝对路径
   * @returns 已校验的 WorkspaceConfig
   * @throws WorkspaceInvalidRootError root 非法
   * @throws WorkspaceConfigTooLargeError 文件超过 1MiB
   * @throws WorkspaceSchemaVersionMismatchError 文件 schemaVersion 不匹配
   */
  async load(root: string): Promise<WorkspaceConfig> {
    assertValidRoot(root);
    const file = this.#configPath(root);
    let raw: string;
    try {
      const s = await this.#fs.stat(file);
      if (s.size > MAX_CONFIG_FILE_BYTES) {
        throw new WorkspaceConfigTooLargeError(root, s.size);
      }
      raw = await this.#fs.readFile(file);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new WorkspaceNotFoundError(root);
      }
      throw err;
    }
    const parsedRaw = JSON.parse(raw) as unknown;
    if (
      typeof parsedRaw === 'object' &&
      parsedRaw !== null &&
      'schemaVersion' in parsedRaw &&
      (parsedRaw as { schemaVersion: unknown }).schemaVersion !== WORKSPACE_SCHEMA_VERSION
    ) {
      throw new WorkspaceSchemaVersionMismatchError(
        WORKSPACE_SCHEMA_VERSION,
        (parsedRaw as { schemaVersion: unknown }).schemaVersion,
        root,
      );
    }
    const config = workspaceConfigSchema.parse(parsedRaw);
    this.#current = { root, config };
    return config;
  }

  /**
   * 浅合并 5 类字段并落盘（除非 validateOnly=true）。
   *
   * 行为说明：
   * - 浅合并：patch 中提供的字段**整体替换**对应键（chip / flash / debug / rtt / serial），
   *   不递归 merge 子字段，避免 stale 子字段意外保留。
   * - validateOnly：仅算冲突 + 校验合法，不写盘；调用前后 `#current` 状态不变。
   * - 冲突含 severity='error' 时抛 WorkspaceConflictError；只有 warn 的不阻塞写入。
   *
   * @param root 工作区根（必须已 init）
   * @param patch 5 类字段任意子集
   * @param opts.validateOnly 仅校验，不写盘
   * @returns 合并后的最终 config + 冲突报告
   * @throws WorkspaceNotFoundError / ZodError / WorkspaceConflictError
   */
  async update(
    root: string,
    patch: WorkspaceConfigPatch,
    opts?: { validateOnly?: boolean },
  ): Promise<{ config: WorkspaceConfig; conflicts: ConflictReport }> {
    assertValidRoot(root);
    const next = this.#inflight.then(() => this.#updateImpl(root, patch, opts));
    this.#inflight = next.catch(() => {});
    return next;
  }

  async #updateImpl(
    root: string,
    patch: WorkspaceConfigPatch,
    opts?: { validateOnly?: boolean },
  ): Promise<{ config: WorkspaceConfig; conflicts: ConflictReport }> {
    const validatedPatch = workspaceConfigPatchSchema.parse(patch);

    // validateOnly 模式快照 #current，避免 load() 在 dry-run 期间副作用地切换激活工作区。
    const snapshot = this.#current;

    // 当前盘上配置：未来可加缓存，现在每次都读取以避免内存与盘漂移。
    const current = await this.load(root);

    const merged: WorkspaceConfig = {
      ...current,
      ...validatedPatch,
    };
    // current 已通过 workspaceConfigSchema、patch 已通过 workspaceConfigPatchSchema；
    // 浅合并不引入新的形态约束，故无需二次 parse。

    const evidence = await this.#evidenceFn();
    const conflicts = detectConflicts(merged, evidence);

    const hasError = conflicts.conflicts.some((c) => c.severity === 'error');
    if (hasError && !opts?.validateOnly) {
      throw new WorkspaceConflictError(conflicts);
    }

    if (opts?.validateOnly) {
      // 还原 dry-run 之前的激活快照，避免静默切换 currentWorkspace
      this.#current = snapshot;
    } else {
      await this.#writeAtomic(root, merged);
      this.#current = { root, config: merged };
    }

    return { config: merged, conflicts };
  }

  /**
   * 返回当前已激活（最近一次 init/load/update 成功）的工作区。
   *
   * MCP `get_workspace_config` 在 caller 不传 root 时使用此入口回退。
   *
   * @returns `{ root, config }` 的深拷贝；未激活时 null
   */
  getCurrent(): CurrentWorkspace | null {
    if (this.#current === null) return null;
    return structuredClone(this.#current);
  }

  /** `<root>/.linkterm/config.json` 绝对路径。 */
  #configPath(root: string): string {
    return path.join(root, '.linkterm', 'config.json');
  }

  /** 检查文件是否存在；用于 init 决定是否报 ALREADY_INITIALIZED。 */
  async #fileExists(file: string): Promise<boolean> {
    try {
      const s = await this.#fs.stat(file);
      return s.isFile();
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return false;
      throw err;
    }
  }

  /**
   * 原子写：先写 .tmp，再 rename 到目标。POSIX/Win32 同分区内 rename 均原子。
   *
   * 写中崩溃时旧文件保持完整可用；新写入要么完整成功要么不存在。
   * 失败时尝试清理残留 `.tmp`（best-effort），但不吞掉原始错误。
   */
  async #writeAtomic(root: string, config: WorkspaceConfig): Promise<void> {
    const dir = path.join(root, '.linkterm');
    await this.#fs.mkdir(dir, { recursive: true });
    const file = this.#configPath(root);
    const tmp = `${file}.tmp`;
    const json = JSON.stringify(config, null, 2);
    try {
      await this.#fs.writeFile(tmp, json);
      await this.#fs.rename(tmp, file);
    } catch (err) {
      await this.#fs.unlink(tmp).catch(() => {});
      throw err;
    }
  }
}
