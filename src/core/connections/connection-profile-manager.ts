import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  CONNECTIONS_SCHEMA_VERSION,
  toSavedConfig,
  type ConnectionsFile,
  type EncryptedCredentialBlob,
  type SaveConnectionProfileInput,
  type SavedConnectionProfile,
  type SavedConnectionSummary,
  type SecretCodec,
} from './types.js';
import { connectionsFileSchema } from './schemas.js';
import { defaultFsPrimitives, type FsPrimitives } from '../workspace/fs-primitives.js';
import type {
  SaveConnectionProfileConfig,
  SshCredentialsPayload,
} from '../../shared/preload-api.js';

/** 保存 SSH 凭据时系统安全存储不可用。 */
export class CredentialStorageUnavailableError extends Error {
  readonly code = 'CREDENTIAL_STORAGE_UNAVAILABLE';

  constructor() {
    super('Secure credential storage is unavailable on this system');
    this.name = 'CredentialStorageUnavailableError';
  }
}

/** 快捷打开 SSH profile 时缺少已保存凭据。 */
export class CredentialRequiredError extends Error {
  readonly code = 'CREDENTIAL_REQUIRED';

  constructor() {
    super('Saved SSH profile does not contain credentials');
    this.name = 'CredentialRequiredError';
  }
}

/** 解密已保存 SSH 凭据失败。 */
export class CredentialDecryptFailedError extends Error {
  readonly code = 'CREDENTIAL_DECRYPT_FAILED';

  constructor() {
    super('Failed to decrypt saved SSH credentials');
    this.name = 'CredentialDecryptFailedError';
  }
}

/** 指定的保存连接不存在。 */
export class ConnectionProfileNotFoundError extends Error {
  readonly code = 'CONNECTION_PROFILE_NOT_FOUND';

  constructor(readonly profileId: string) {
    super(`Connection profile not found: ${profileId}`);
    this.name = 'ConnectionProfileNotFoundError';
  }
}

export interface ConnectionProfileManagerOptions {
  /** 全局 connections.json 的绝对路径。 */
  filePath: string;
  /** 文件系统抽象，测试可注入 fake fs。 */
  fs?: FsPrimitives;
  /** SSH 凭据加解密实现。 */
  secretCodec: SecretCodec;
}

/** 全局保存连接管理器；纯 core 逻辑，不依赖 Electron。 */
export class ConnectionProfileManager {
  readonly #filePath: string;
  readonly #fs: FsPrimitives;
  readonly #secretCodec: SecretCodec;
  #inflight: Promise<unknown> = Promise.resolve();

  constructor(options: ConnectionProfileManagerOptions) {
    this.#filePath = options.filePath;
    this.#fs = options.fs ?? defaultFsPrimitives;
    this.#secretCodec = options.secretCodec;
  }

  /** 返回 renderer 可见的脱敏 profile 列表。 */
  async list(): Promise<SavedConnectionSummary[]> {
    const file = await this.#readFileOrDefault();
    return file.profiles.map(toSummary);
  }

  /** 保存一个全局连接 profile。 */
  async save(input: SaveConnectionProfileInput): Promise<SavedConnectionSummary> {
    return this.#serialize(async () => {
      const file = await this.#readFileOrDefault();
      const now = new Date().toISOString();
      const encryptedCredential = this.#encryptCredentialIfRequested(input);
      const profile: SavedConnectionProfile = {
        id: `conn_${randomUUID()}`,
        label: normalizeLabel(input.label),
        type: input.config.type,
        config: toSavedConfig(input.config),
        ...(encryptedCredential !== undefined ? { encryptedCredential } : {}),
        createdAt: now,
        updatedAt: now,
      };
      const next: ConnectionsFile = {
        schemaVersion: CONNECTIONS_SCHEMA_VERSION,
        profiles: [...file.profiles, profile],
      };
      await this.#writeFile(next);
      return toSummary(profile);
    });
  }

  /** 删除指定 profile；不存在时抛 ConnectionProfileNotFoundError。 */
  async delete(profileId: string): Promise<void> {
    await this.#serialize(async () => {
      const file = await this.#readFileOrDefault();
      const nextProfiles = file.profiles.filter((p) => p.id !== profileId);
      if (nextProfiles.length === file.profiles.length) {
        throw new ConnectionProfileNotFoundError(profileId);
      }
      await this.#writeFile({ schemaVersion: CONNECTIONS_SCHEMA_VERSION, profiles: nextProfiles });
    });
  }

  /** 读取 profile 并还原成可打开配置；RTT 分支由专用 RTT open 路径消费。 */
  async openConfig(profileId: string): Promise<SaveConnectionProfileConfig> {
    const file = await this.#readFileOrDefault();
    const profile = file.profiles.find((p) => p.id === profileId);
    if (!profile) throw new ConnectionProfileNotFoundError(profileId);

    switch (profile.config.type) {
      case 'serial':
        return { ...profile.config };
      case 'local-shell':
        return { ...profile.config };
      case 'ssh':
        if (!profile.encryptedCredential) throw new CredentialRequiredError();
        return {
          ...profile.config,
          credentials: this.#decryptCredential(profile.encryptedCredential),
        };
      case 'rtt-log':
        return { ...profile.config };
    }
  }

  #encryptCredentialIfRequested(
    input: SaveConnectionProfileInput,
  ): EncryptedCredentialBlob | undefined {
    if (input.config.type !== 'ssh' || input.saveCredentials !== true) return undefined;
    if (!this.#secretCodec.isAvailable()) throw new CredentialStorageUnavailableError();
    return {
      provider: 'electron-safeStorage',
      version: 1,
      ciphertextBase64: this.#secretCodec.encryptUtf8(JSON.stringify(input.config.credentials)),
    };
  }

  #decryptCredential(blob: EncryptedCredentialBlob): SshCredentialsPayload {
    try {
      const raw = this.#secretCodec.decryptUtf8(blob.ciphertextBase64);
      return parseSshCredentials(JSON.parse(raw));
    } catch {
      throw new CredentialDecryptFailedError();
    }
  }

  async #readFileOrDefault(): Promise<ConnectionsFile> {
    try {
      const raw = await this.#fs.readFile(this.#filePath);
      return connectionsFileSchema.parse(JSON.parse(raw));
    } catch (err) {
      if (isNotFound(err)) {
        return { schemaVersion: CONNECTIONS_SCHEMA_VERSION, profiles: [] };
      }
      throw err;
    }
  }

  async #writeFile(file: ConnectionsFile): Promise<void> {
    const parsed = connectionsFileSchema.parse(file);
    const dir = path.dirname(this.#filePath);
    const tmp = `${this.#filePath}.tmp`;
    await this.#fs.mkdir(dir, { recursive: true });
    try {
      await this.#fs.writeFile(tmp, `${JSON.stringify(parsed, null, 2)}\n`);
      await this.#fs.rename(tmp, this.#filePath);
    } catch (err) {
      await this.#fs.unlink(tmp).catch(() => undefined);
      throw err;
    }
  }

  #serialize<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.#inflight.then(fn, fn);
    this.#inflight = next.catch(() => undefined);
    return next;
  }
}

function toSummary(profile: SavedConnectionProfile): SavedConnectionSummary {
  return {
    id: profile.id,
    label: profile.label,
    type: profile.type,
    config: profile.config,
    hasCredential: profile.encryptedCredential !== undefined,
    createdAt: profile.createdAt,
    updatedAt: profile.updatedAt,
  };
}

function normalizeLabel(label: string): string {
  const trimmed = label.trim();
  return trimmed.length > 0 ? trimmed.slice(0, 128) : 'Saved connection';
}

function parseSshCredentials(value: unknown): SshCredentialsPayload {
  return z
    .union([
      z.object({ kind: z.literal('password'), password: z.string().min(1) }).strict(),
      z
        .object({
          kind: z.literal('privateKey'),
          privateKey: z.string().min(1),
          passphrase: z.string().optional(),
        })
        .strict(),
    ])
    .parse(value);
}

function isNotFound(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: unknown }).code === 'ENOENT'
  );
}
