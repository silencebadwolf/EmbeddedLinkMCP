/** Persistent workspace-local LinkTerm control profile manager. */

import path from 'node:path';
import {
  controlProfileBodySchema,
  controlProfileSchema,
  type ControlProfileBody,
} from './control-profile-schema.js';
import { CONTROL_PROFILE_SCHEMA_VERSION, type ControlProfile } from './control-profile-types.js';
import { normalizeJLinkTargetName } from '@linkterm/contracts/jlink-target-name';
import { defaultFsPrimitives, type FsPrimitives } from './fs-primitives.js';
import { assertValidRoot } from './workspace-config-manager.js';

/** control-profile.json 已存在但 caller 未显式 force=true。 */
export class ControlProfileAlreadyInitializedError extends Error {
  readonly code = 'CONTROL_PROFILE_ALREADY_INITIALIZED' as const;

  constructor(public readonly root: string) {
    super(`Control profile already initialized at ${root}`);
    this.name = 'ControlProfileAlreadyInitializedError';
  }
}

/** 找不到 `<root>/.linkterm/control-profile.json`。 */
export class ControlProfileNotFoundError extends Error {
  readonly code = 'CONTROL_PROFILE_NOT_FOUND' as const;

  constructor(public readonly root: string) {
    super(`Control profile not found at ${root}`);
    this.name = 'ControlProfileNotFoundError';
  }
}

/** 持久化文件超过 1 MiB 上限。 */
export class ControlProfileTooLargeError extends Error {
  readonly code = 'CONTROL_PROFILE_TOO_LARGE' as const;

  constructor(
    public readonly root: string,
    public readonly size: number,
  ) {
    super(`Control profile file too large (>1MiB): ${size} bytes at ${root}`);
    this.name = 'ControlProfileTooLargeError';
  }
}

/** 持久化文件 schemaVersion 与运行时常量不匹配。 */
export class ControlProfileSchemaVersionMismatchError extends Error {
  readonly code = 'CONTROL_PROFILE_SCHEMA_VERSION_MISMATCH' as const;

  constructor(
    public readonly expected: string,
    public readonly actual: unknown,
    public readonly root: string,
  ) {
    super(
      `Control profile schemaVersion mismatch at ${root}: expected ${expected}, got ${String(actual)}`,
    );
    this.name = 'ControlProfileSchemaVersionMismatchError';
  }
}

/** ControlProfileManager 构造选项。 */
export interface ControlProfileManagerOptions {
  /** 注入 fs 原语；省略时用 `node:fs/promises` 默认实现。 */
  fs?: FsPrimitives;
}

/** 当前已激活控制配置状态。 */
interface CurrentControlProfile {
  root: string;
  profile: ControlProfile;
}

/** 持久化文件大小上限（1 MiB），防止误读巨型/非配置文件。 */
const MAX_CONTROL_PROFILE_FILE_BYTES = 1024 * 1024;

/**
 * 返回工作区控制配置文件路径。
 *
 * @param root 工作区根目录绝对路径
 * @returns `<root>/.linkterm/control-profile.json` 的绝对路径
 */
export function controlProfilePath(root: string): string {
  return path.join(root, '.linkterm', 'control-profile.json');
}

/**
 * 管理 `<root>/.linkterm/control-profile.json` 的创建、读取与覆盖。
 *
 * 文件只保存可复用的串口/J-Link/Flash/RTT 非敏感事实；凭据类字段由 Zod strict schema
 * 拒绝，避免被 Agent 或 UI 持久化到工作区。
 */
export class ControlProfileManager {
  readonly #fs: FsPrimitives;
  #current: CurrentControlProfile | null = null;
  #inflight: Promise<unknown> = Promise.resolve();

  constructor(options: ControlProfileManagerOptions = {}) {
    this.#fs = options.fs ?? defaultFsPrimitives;
  }

  /**
   * 初始化控制配置文件。
   *
   * @param root 工作区根目录绝对路径
   * @param body 不含 schemaVersion 的控制配置主体
   * @param opts.force 已存在时强制覆盖；默认 false 报错
   * @returns 已写入并校验的完整控制配置
   * @throws ControlProfileAlreadyInitializedError 已存在且未 force
   */
  async init(
    root: string,
    body: ControlProfileBody = {},
    opts?: { force?: boolean },
  ): Promise<ControlProfile> {
    assertValidRoot(root);
    const next = this.#inflight.then(() => this.#initImpl(root, body, opts));
    this.#inflight = next.catch(() => {});
    return next;
  }

  async #initImpl(
    root: string,
    body: ControlProfileBody,
    opts?: { force?: boolean },
  ): Promise<ControlProfile> {
    const file = controlProfilePath(root);
    if (!opts?.force) {
      const exists = await this.#fileExists(file);
      if (exists) {
        throw new ControlProfileAlreadyInitializedError(root);
      }
    }

    const validatedBody = normalizeControlProfileBody(controlProfileBodySchema.parse(body));
    const profile = controlProfileSchema.parse({
      schemaVersion: CONTROL_PROFILE_SCHEMA_VERSION,
      ...validatedBody,
    });
    await this.#writeAtomic(root, profile);
    this.#current = { root, profile };
    return profile;
  }

  /**
   * 读取并校验工作区控制配置。
   *
   * @param root 工作区根目录绝对路径
   * @returns 已校验的控制配置
   * @throws ControlProfileNotFoundError 文件不存在
   * @throws ControlProfileTooLargeError 文件超过 1 MiB
   */
  async load(root: string): Promise<ControlProfile> {
    assertValidRoot(root);
    const file = controlProfilePath(root);
    let raw: string;
    try {
      const s = await this.#fs.stat(file);
      if (s.size > MAX_CONTROL_PROFILE_FILE_BYTES) {
        throw new ControlProfileTooLargeError(root, s.size);
      }
      raw = await this.#fs.readFile(file);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new ControlProfileNotFoundError(root);
      }
      throw err;
    }

    const parsedRaw = JSON.parse(raw) as unknown;
    if (
      typeof parsedRaw === 'object' &&
      parsedRaw !== null &&
      'schemaVersion' in parsedRaw &&
      (parsedRaw as { schemaVersion: unknown }).schemaVersion !== CONTROL_PROFILE_SCHEMA_VERSION
    ) {
      throw new ControlProfileSchemaVersionMismatchError(
        CONTROL_PROFILE_SCHEMA_VERSION,
        (parsedRaw as { schemaVersion: unknown }).schemaVersion,
        root,
      );
    }
    const profile = controlProfileSchema.parse(parsedRaw);
    this.#current = { root, profile };
    return profile;
  }

  /**
   * 返回最近一次成功 init/load 的控制配置副本。
   *
   * @returns 当前控制配置状态；尚未激活时返回 null
   */
  getCurrent(): CurrentControlProfile | null {
    if (this.#current === null) return null;
    return structuredClone(this.#current);
  }

  async #fileExists(file: string): Promise<boolean> {
    try {
      const s = await this.#fs.stat(file);
      return s.isFile();
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return false;
      throw err;
    }
  }

  async #writeAtomic(root: string, profile: ControlProfile): Promise<void> {
    const dir = path.join(root, '.linkterm');
    await this.#fs.mkdir(dir, { recursive: true });
    const file = controlProfilePath(root);
    const tmp = `${file}.tmp`;
    const json = JSON.stringify(profile, null, 2);
    try {
      await this.#fs.writeFile(tmp, json);
      await this.#fs.rename(tmp, file);
    } catch (err) {
      await this.#fs.unlink(tmp).catch(() => {});
      throw err;
    }
  }
}

function normalizeControlProfileBody(body: ControlProfileBody): ControlProfileBody {
  const jlink = body.jlink;
  const target = jlink?.target;
  if (jlink === undefined || target === undefined) return body;
  return {
    ...body,
    jlink: {
      ...jlink,
      target: normalizeJLinkTargetName(target),
    },
  };
}
