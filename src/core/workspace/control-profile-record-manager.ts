import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { normalizeJLinkTargetName } from '../../shared/jlink-target-name.js';
import { controlProfileSchema } from './control-profile-schema.js';
import { controlProfileRecordsFileSchema } from './control-profile-record-schema.js';
import {
  CONTROL_PROFILE_RECORDS_SCHEMA_VERSION,
  type ControlProfileRecord,
  type ControlProfileRecordsFile,
  type SaveControlProfileRecordInput,
} from './control-profile-record-types.js';
import { defaultFsPrimitives, type FsPrimitives } from './fs-primitives.js';

const MAX_CONTROL_PROFILE_RECORDS = 200;

export interface ControlProfileRecordManagerOptions {
  filePath: string;
  fs?: FsPrimitives;
}

export class ControlProfileRecordNotFoundError extends Error {
  readonly code = 'CONTROL_PROFILE_RECORD_NOT_FOUND' as const;

  constructor(readonly recordId: string) {
    super(`Control profile record not found: ${recordId}`);
    this.name = 'ControlProfileRecordNotFoundError';
  }
}

export class ControlProfileRecordManager {
  readonly #filePath: string;
  readonly #fs: FsPrimitives;
  #inflight: Promise<unknown> = Promise.resolve();

  constructor(options: ControlProfileRecordManagerOptions) {
    this.#filePath = options.filePath;
    this.#fs = options.fs ?? defaultFsPrimitives;
  }

  async list(): Promise<ControlProfileRecord[]> {
    const file = await this.#readFileOrDefault();
    return newestFirst(file.records);
  }

  async save(input: SaveControlProfileRecordInput): Promise<ControlProfileRecord> {
    return this.#serialize(async () => {
      const file = await this.#readFileOrDefault();
      const now = new Date().toISOString();
      const profile = controlProfileSchema.parse(input.profile);
      const fingerprint = buildRecordFingerprint(input.root, profile);
      const existing = file.records.find(
        (record) => buildRecordFingerprint(record.root, record.profile) === fingerprint,
      );
      const record: ControlProfileRecord = existing
        ? {
            ...existing,
            label: normalizeLabel(input.label) ?? existing.label,
            source: input.source,
            profile,
            updatedAt: now,
          }
        : {
            id: `ctrl_${randomUUID()}`,
            label: normalizeLabel(input.label) ?? defaultLabel(input.root, profile),
            root: input.root,
            source: input.source,
            profile,
            createdAt: now,
            updatedAt: now,
          };
      const nextRecords = existing
        ? file.records.map((item) => (item.id === existing.id ? record : item))
        : [record, ...file.records];
      await this.#writeFile({
        schemaVersion: CONTROL_PROFILE_RECORDS_SCHEMA_VERSION,
        records: newestFirst(nextRecords).slice(0, MAX_CONTROL_PROFILE_RECORDS),
      });
      return record;
    });
  }

  async get(recordId: string): Promise<ControlProfileRecord> {
    const file = await this.#readFileOrDefault();
    const record = file.records.find((item) => item.id === recordId);
    if (!record) throw new ControlProfileRecordNotFoundError(recordId);
    return record;
  }

  async delete(recordId: string): Promise<void> {
    await this.#serialize(async () => {
      const file = await this.#readFileOrDefault();
      const records = file.records.filter((item) => item.id !== recordId);
      if (records.length === file.records.length)
        throw new ControlProfileRecordNotFoundError(recordId);
      await this.#writeFile({ schemaVersion: CONTROL_PROFILE_RECORDS_SCHEMA_VERSION, records });
    });
  }

  async #readFileOrDefault(): Promise<ControlProfileRecordsFile> {
    try {
      const raw = await this.#fs.readFile(this.#filePath);
      return controlProfileRecordsFileSchema.parse(JSON.parse(raw));
    } catch (err) {
      if (isNotFound(err)) {
        return { schemaVersion: CONTROL_PROFILE_RECORDS_SCHEMA_VERSION, records: [] };
      }
      throw err;
    }
  }

  async #writeFile(file: ControlProfileRecordsFile): Promise<void> {
    const parsed = controlProfileRecordsFileSchema.parse(file);
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

function newestFirst(records: ControlProfileRecord[]): ControlProfileRecord[] {
  return [...records].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

function normalizeLabel(label: string | undefined): string | undefined {
  const trimmed = label?.trim();
  if (!trimmed) return undefined;
  return trimmed.slice(0, 128);
}

function defaultLabel(root: string, profile: ControlProfileRecord['profile']): string {
  const workspace = path.basename(path.normalize(root)) || root;
  const target = profile.jlink?.target;
  return target ? `${workspace} - ${target}` : workspace;
}

function buildRecordFingerprint(root: string, profile: ControlProfileRecord['profile']): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        root: path.normalize(root),
        profile: normalizeProfileForFingerprint(profile),
      }),
    )
    .digest('hex');
}

function normalizeProfileForFingerprint(
  profile: ControlProfileRecord['profile'],
): ControlProfileRecord['profile'] {
  const jlink = profile.jlink;
  if (jlink?.target === undefined) return profile;
  return {
    ...profile,
    jlink: {
      ...jlink,
      target: normalizeJLinkTargetName(jlink.target),
    },
  };
}

function isNotFound(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: unknown }).code === 'ENOENT'
  );
}
