import { appendFile, chmod, mkdir, open, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Buffer } from 'node:buffer';
import {
  AUDIT_DEFAULT_MAX_FILE_BYTES,
  AUDIT_DEFAULT_MAX_READ_BYTES,
  AUDIT_DEFAULT_MAX_READ_EVENTS,
  AUDIT_DEFAULT_RETENTION_DAYS,
  AUDIT_MAX_DIAGNOSTICS,
  AuditExportResultSchema,
  AuditRecordEnvelopeSchema,
  AuditStoreStatusSchema,
  AuditWarningCodeSchema,
  createAuditRecord,
  type AuditClearResult,
  type AuditExportRequest,
  type AuditExportResult,
  type AuditPathMode,
  type AuditRecordEnvelope,
  type AuditStoreStatus,
  type AuditWarningCode,
} from '../../shared/audit-contract.js';
import { ActivityEventViewSchema, type ActivityEventView } from '../../shared/activity-contract.js';

const ACTIVE_FILE_NAME = 'activity.jsonl';
const DATA_FILE_PATTERN = /^activity(?:\.[A-Za-z0-9T._-]+)?\.jsonl$/u;
const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1_000;

export interface AuditStoreOptions {
  /** Main-owned `<userData>/activity` directory; renderer never receives this path. */
  readonly directory: string;
  /** Default true; false is an explicit local privacy preference. */
  readonly enabled?: boolean;
  /** Retention in days. `retentionMs` is a test/configuration seam with precedence. */
  readonly retentionDays?: number;
  readonly retentionMs?: number;
  /** Maximum bytes per JSONL data file. */
  readonly maxFileBytes?: number;
  /** Maximum valid events materialized during startup recovery. */
  readonly maxReadEvents?: number;
  /** Total startup bytes to inspect across newest data files. */
  readonly maxReadBytes?: number;
  readonly now?: () => string;
  /** Best-effort health callback; it must not throw into ledger/MCP paths. */
  readonly onWarning?: (code: AuditWarningCode) => void;
}

interface DataFile {
  readonly name: string;
  readonly path: string;
  readonly size: number;
  readonly modifiedMs: number;
}

function safePositiveInteger(name: string, value: number, fallback: number): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved <= 0) {
    throw new RangeError(`${name} must be a positive safe integer`);
  }
  return resolved;
}

function safeNonNegativeInteger(name: string, value: number, fallback: number): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved < 0) {
    throw new RangeError(`${name} must be a non-negative safe integer`);
  }
  return resolved;
}

function timestampForFile(now: string): string {
  return now.replaceAll(/[:.]/gu, '-');
}

function isTrailingLine(lines: readonly string[], index: number): boolean {
  for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
    if (lines[cursor]?.trim() !== '') return false;
  }
  return true;
}

function dataFileName(name: string): boolean {
  return DATA_FILE_PATTERN.test(name);
}

const PROTECTED_ARGUMENT_KEY = /(?:password|privateKey|passphrase|token|secret|credential|auth)/iu;
const MAIN_ONLY_FIELD = /(?:principalId|leaseId|preparedOperation|authorizationRecord|mainOwnedSourceRef|nonce|effectFingerprint)/u;

function passesDurableBoundary(event: ActivityEventView): boolean {
  if (MAIN_ONLY_FIELD.test(JSON.stringify(event))) return false;
  const items = event.argumentSummary?.items ?? [];
  return items.every((item) => item.kind === 'omitted' || !PROTECTED_ARGUMENT_KEY.test(item.key));
}

/**
 * Main-owned, best-effort durable projection of the already redacted activity stream.
 *
 * The write queue is deliberately independent from OperationLedger and transport paths:
 * a slow or broken filesystem can lose a durable observation, but cannot reject a tool call
 * or alter the in-memory operation state. Internal authority objects never enter this class.
 */
export class AuditStore {
  private readonly directory: string;
  private readonly enabled: boolean;
  private readonly retentionMs: number;
  private readonly retentionDays: number;
  private readonly maxFileBytes: number;
  private readonly maxReadEvents: number;
  private readonly maxReadBytes: number;
  private readonly now: () => string;
  private readonly onWarning?: (code: AuditWarningCode) => void;
  private queue: Promise<void> = Promise.resolve();
  private pending: AuditRecordEnvelope[] = [];
  private drainScheduled = false;
  private records: AuditRecordEnvelope[] = [];
  private warningCounts = new Map<AuditWarningCode, number>();
  private lastWarningCode: AuditWarningCode | undefined;
  private fileCount = 0;
  private byteCount = 0;
  private activeFileBytes = 0;
  private initialized = false;
  private rotationCounter = 0;

  constructor(options: AuditStoreOptions) {
    if (options.directory.trim().length === 0) throw new RangeError('directory is required');
    this.directory = options.directory;
    this.enabled = options.enabled ?? true;
    const requestedDays = safeNonNegativeInteger(
      'retentionDays',
      options.retentionDays ?? AUDIT_DEFAULT_RETENTION_DAYS,
      AUDIT_DEFAULT_RETENTION_DAYS,
    );
    const requestedRetentionMs = options.retentionMs ?? requestedDays * MILLISECONDS_PER_DAY;
    if (!Number.isSafeInteger(requestedRetentionMs) || requestedRetentionMs < 0) {
      throw new RangeError('retentionMs must be a non-negative safe integer');
    }
    this.retentionMs = requestedRetentionMs;
    this.retentionDays = Math.floor(requestedRetentionMs / MILLISECONDS_PER_DAY);
    this.maxFileBytes = safePositiveInteger(
      'maxFileBytes',
      options.maxFileBytes ?? AUDIT_DEFAULT_MAX_FILE_BYTES,
      AUDIT_DEFAULT_MAX_FILE_BYTES,
    );
    this.maxReadEvents = safePositiveInteger(
      'maxReadEvents',
      options.maxReadEvents ?? AUDIT_DEFAULT_MAX_READ_EVENTS,
      AUDIT_DEFAULT_MAX_READ_EVENTS,
    );
    this.maxReadBytes = safePositiveInteger(
      'maxReadBytes',
      options.maxReadBytes ?? AUDIT_DEFAULT_MAX_READ_BYTES,
      AUDIT_DEFAULT_MAX_READ_BYTES,
    );
    this.now = options.now ?? (() => new Date().toISOString());
    this.onWarning = options.onWarning;
  }

  /** Create the directory and recover the newest bounded valid records. */
  async initialize(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;
    if (!this.enabled) return;
    try {
      await mkdir(this.directory, { recursive: true });
      await this.applyPosixMode(this.directory, 0o700);
      await this.applyRetention();
      const files = await this.listDataFiles();
      this.fileCount = files.length;
      this.byteCount = files.reduce((total, file) => total + file.size, 0);
      this.activeFileBytes = files.find((file) => file.name === ACTIVE_FILE_NAME)?.size ?? 0;
      await this.recover(files);
    } catch {
      this.recordWarning('directory-failed');
      this.fileCount = 0;
      this.byteCount = 0;
      this.activeFileBytes = 0;
    }
  }

  /** Enqueue a validated display-safe event and return without waiting for filesystem I/O. */
  enqueue(event: ActivityEventView): void {
    if (!this.enabled) return;
    this.pruneExpiredRecords();
    let envelope: AuditRecordEnvelope;
    try {
      envelope = createAuditRecord(ActivityEventViewSchema.parse(event));
      if (!passesDurableBoundary(envelope.event)) throw new Error('durable boundary rejected');
    } catch {
      this.recordWarning('append-failed');
      return;
    }
    this.pending.push(envelope);
    this.scheduleDrain();
  }

  /** Wait for all queued writes; intended for tests and orderly Main shutdown. */
  async flush(): Promise<void> {
    do {
      await this.queue;
    } while (this.drainScheduled || this.pending.length > 0);
  }

  /** Return an immutable copy of recovered and newly appended safe envelopes. */
  getRecords(): readonly AuditRecordEnvelope[] {
    return Object.freeze(this.records.map((record) => Object.freeze(record)));
  }

  getStatus(): AuditStoreStatus {
    this.pruneExpiredRecords();
    return AuditStoreStatusSchema.parse({
      schemaVersion: '1.0.0',
      enabled: this.enabled,
      retentionDays: this.retentionDays,
      maxFileBytes: this.maxFileBytes,
      eventCount: this.records.length,
      fileCount: this.fileCount,
      byteCount: this.byteCount,
      warningCount: [...this.warningCounts.values()].reduce((sum, count) => sum + count, 0),
      ...(this.lastWarningCode === undefined ? {} : { lastWarningCode: this.lastWarningCode }),
      warnings: [...this.warningCounts.entries()]
        .slice(-AUDIT_MAX_DIAGNOSTICS)
        .map(([code, count]) => ({ code, count })),
      windowsAclDefault: process.platform === 'win32',
    });
  }

  /** Export only validated retained envelopes; the absolute destination remains Main-only. */
  async export(request: AuditExportRequest): Promise<AuditExportResult> {
    await this.flush();
    await this.applyRetention();
    this.pruneExpiredRecords();
    const format = request.format;
    const pathMode: AuditPathMode = request.pathMode ?? 'basename';
    const stamp = timestampForFile(this.now());
    const extension = format === 'json' ? 'json' : 'jsonl';
    const fileName = `activity-export-${stamp}.${extension}`;
    const exportDirectory = path.join(this.directory, 'exports');
    try {
      await mkdir(exportDirectory, { recursive: true });
      const records = this.records.map((record) => AuditRecordEnvelopeSchema.parse(record));
      const content =
        format === 'json'
          ? `${JSON.stringify(records, null, 2)}\n`
          : records.map((record) => JSON.stringify(record)).join('\n') + (records.length > 0 ? '\n' : '');
      const destination = path.join(exportDirectory, fileName);
      await writeFile(destination, content, { encoding: 'utf8', flag: 'w' });
      await this.applyPosixMode(destination, 0o600);
      return AuditExportResultSchema.parse({
        schemaVersion: '1.0.0',
        fileName,
        format,
        pathMode,
        eventCount: records.length,
        redacted: true,
      });
    } catch {
      this.recordWarning('export-failed');
      throw new Error('AUDIT_EXPORT_FAILED');
    }
  }

  /** Delete only this store's activity directory; safe to call repeatedly. */
  async clear(): Promise<AuditClearResult> {
    await this.flush();
    try {
      const files = this.enabled ? await this.listDataFiles() : [];
      await rm(this.directory, { recursive: true, force: true });
      if (this.enabled) {
        await mkdir(this.directory, { recursive: true });
        await this.applyPosixMode(this.directory, 0o700);
      }
      this.records = [];
      this.fileCount = 0;
      this.byteCount = 0;
      this.activeFileBytes = 0;
      this.warningCounts.clear();
      this.lastWarningCode = undefined;
      return { schemaVersion: '1.0.0', cleared: true, deletedFileCount: files.length };
    } catch {
      this.recordWarning('clear-failed');
      throw new Error('AUDIT_CLEAR_FAILED');
    }
  }

  async dispose(): Promise<void> {
    await this.flush();
  }

  private scheduleDrain(): void {
    if (this.drainScheduled) return;
    this.drainScheduled = true;
    this.queue = this.queue
      .then(async () => {
        const batch = this.pending.splice(0);
        await this.writeBatch(batch);
      })
      .catch(() => {
        this.recordWarning('append-failed');
      })
      .finally(() => {
        this.drainScheduled = false;
        if (this.pending.length > 0) this.scheduleDrain();
      });
  }

  private async writeBatch(batch: readonly AuditRecordEnvelope[]): Promise<void> {
    if (batch.length === 0) return;
    if (!this.initialized) await this.initialize();
    if (!this.enabled) return;
    await mkdir(this.directory, { recursive: true });
    let chunk: AuditRecordEnvelope[] = [];
    let chunkBytes = 0;
    for (const envelope of batch) {
      const line = `${JSON.stringify(envelope)}\n`;
      const lineBytes = Buffer.byteLength(line, 'utf8');
      const wouldExceed = this.activeFileBytes + chunkBytes > 0
        && this.activeFileBytes + chunkBytes + lineBytes > this.maxFileBytes;
      if (wouldExceed && chunk.length > 0) {
        await this.appendChunk(chunk);
        chunk = [];
        chunkBytes = 0;
      }
      if (
        chunk.length === 0 &&
        this.activeFileBytes > 0 &&
        this.activeFileBytes + lineBytes > this.maxFileBytes
      ) {
        await this.rotateActiveFile();
      }
      chunk.push(envelope);
      chunkBytes += lineBytes;
    }
    if (chunk.length > 0) await this.appendChunk(chunk);
  }

  private async appendChunk(chunk: readonly AuditRecordEnvelope[]): Promise<void> {
    const lines = chunk.map((envelope) => `${JSON.stringify(envelope)}\n`);
    const content = lines.join('');
    const contentBytes = Buffer.byteLength(content, 'utf8');
    const activePath = path.join(this.directory, ACTIVE_FILE_NAME);
    await appendFile(activePath, content, { encoding: 'utf8' });
    await this.applyPosixMode(activePath, 0o600);
    this.activeFileBytes += contentBytes;
    this.byteCount += contentBytes;
    if (this.fileCount === 0) this.fileCount = 1;
    this.records.push(...chunk);
    if (this.records.length > this.maxReadEvents) this.records.splice(0, this.records.length - this.maxReadEvents);
    this.pruneExpiredRecords();
    await this.applyRetention();
    const files = await this.listDataFiles();
    this.fileCount = files.length;
    this.byteCount = files.reduce((total, file) => total + file.size, 0);
    this.activeFileBytes = files.find((file) => file.name === ACTIVE_FILE_NAME)?.size ?? 0;
  }

  private async rotateActiveFile(): Promise<void> {
    const activePath = path.join(this.directory, ACTIVE_FILE_NAME);
    try {
      await stat(activePath);
    } catch {
      this.activeFileBytes = 0;
      return;
    }
    const rotatedName = `activity.${timestampForFile(this.now())}.${this.rotationCounter++}.jsonl`;
    await rename(activePath, path.join(this.directory, rotatedName));
    this.activeFileBytes = 0;
    this.fileCount += 1;
    await this.applyRetention();
    const files = await this.listDataFiles();
    this.fileCount = files.length;
    this.byteCount = files.reduce((total, file) => total + file.size, 0);
  }

  private async recover(files: readonly DataFile[]): Promise<void> {
    const selected: Array<{
      readonly fileIndex: number;
      readonly lineIndex: number;
      readonly event: AuditRecordEnvelope;
    }> = [];
    let remainingBytes = this.maxReadBytes;
    for (let fileIndex = files.length - 1; fileIndex >= 0; fileIndex -= 1) {
      if (selected.length >= this.maxReadEvents || remainingBytes <= 0) break;
      const file = files[fileIndex];
      if (file === undefined) continue;
      let content: string;
      let startsAtFileOffset = false;
      try {
        const read = await this.readBoundedFile(file, remainingBytes);
        content = read.content;
        startsAtFileOffset = read.startsAtFileOffset;
        remainingBytes -= read.bytesRead;
      } catch {
        this.recordWarning('invalid-line-skipped');
        continue;
      }
      const lines = content.split('\n');
      const fileEvents: Array<{ readonly lineIndex: number; readonly event: AuditRecordEnvelope }> = [];
      for (let index = startsAtFileOffset ? 1 : 0; index < lines.length; index += 1) {
        const line = lines[index]?.trim();
        if (!line) continue;
        try {
          const parsed = AuditRecordEnvelopeSchema.safeParse(JSON.parse(line));
          if (!parsed.success) throw new Error('invalid envelope');
          fileEvents.push({ lineIndex: index, event: parsed.data });
        } catch {
          this.recordWarning(isTrailingLine(lines, index) ? 'trailing-line-recovered' : 'invalid-line-skipped');
        }
      }
      const needed = Math.max(0, this.maxReadEvents - selected.length);
      for (const entry of fileEvents.slice(-needed)) {
        selected.unshift({ fileIndex, lineIndex: entry.lineIndex, event: entry.event });
      }
    }
    selected.sort((left, right) => left.fileIndex - right.fileIndex || left.lineIndex - right.lineIndex);
    this.records = selected.map(({ event }) => event).slice(-this.maxReadEvents);
  }

  private async readBoundedFile(
    file: DataFile,
    budget: number,
  ): Promise<{
    readonly content: string;
    readonly bytesRead: number;
    readonly startsAtFileOffset: boolean;
  }> {
    const bytesToRead = Math.min(file.size, budget);
    if (bytesToRead >= file.size) {
      return {
        content: await readFile(file.path, 'utf8'),
        bytesRead: bytesToRead,
        startsAtFileOffset: false,
      };
    }
    const handle = await open(file.path, 'r');
    try {
      const buffer = Buffer.alloc(bytesToRead);
      const startOffset = file.size - bytesToRead;
      const result = await handle.read(buffer, 0, bytesToRead, startOffset);
      let startsAtFileOffset = startOffset > 0;
      if (startsAtFileOffset) {
        const preceding = Buffer.alloc(1);
        const precedingRead = await handle.read(preceding, 0, 1, startOffset - 1);
        startsAtFileOffset = precedingRead.bytesRead === 0 || preceding[0] !== 0x0a;
      }
      return {
        content: buffer.subarray(0, result.bytesRead).toString('utf8'),
        bytesRead: result.bytesRead,
        startsAtFileOffset,
      };
    } finally {
      await handle.close();
    }
  }

  private async applyRetention(): Promise<void> {
    const files = await this.listDataFiles();
    const nowMs = Date.parse(this.now());
    if (!Number.isFinite(nowMs) || this.retentionMs === 0) {
      if (this.retentionMs === 0) {
        for (const file of files) await rm(file.path, { force: true });
      }
      return;
    }
    for (const file of files) {
      if (nowMs - file.modifiedMs > this.retentionMs) {
        try {
          await rm(file.path, { force: true });
        } catch {
          this.recordWarning('retention-delete-failed');
        }
      }
    }
  }

  private async listDataFiles(): Promise<DataFile[]> {
    let names: string[];
    try {
      names = await readdir(this.directory);
    } catch {
      return [];
    }
    const files: DataFile[] = [];
    for (const name of names.filter(dataFileName)) {
      try {
        const filePath = path.join(this.directory, name);
        const info = await stat(filePath);
        if (!info.isFile()) continue;
        files.push({ name, path: filePath, size: info.size, modifiedMs: info.mtimeMs });
      } catch {
        this.recordWarning('invalid-line-skipped');
      }
    }
    return files.sort((left, right) => left.modifiedMs - right.modifiedMs || left.name.localeCompare(right.name));
  }

  private pruneExpiredRecords(): void {
    if (this.records.length === 0 || this.retentionMs <= 0) {
      if (this.retentionMs === 0) this.records = [];
      return;
    }
    const nowMs = Date.parse(this.now());
    if (!Number.isFinite(nowMs)) return;
    const threshold = nowMs - this.retentionMs;
    this.records = this.records.filter((record) => {
      const timestampMs = Date.parse(record.event.timestamp);
      return !Number.isFinite(timestampMs) || timestampMs >= threshold;
    });
  }

  private async applyPosixMode(filePath: string, mode: number): Promise<void> {
    if (process.platform === 'win32') return;
    try {
      await chmod(filePath, mode);
    } catch {
      this.recordWarning('directory-failed');
    }
  }

  private recordWarning(code: AuditWarningCode): void {
    if (!AuditWarningCodeSchema.safeParse(code).success) return;
    const next = (this.warningCounts.get(code) ?? 0) + 1;
    this.warningCounts.set(code, next);
    this.lastWarningCode = code;
    try {
      this.onWarning?.(code);
    } catch {
      // A health observer is best effort and must never break the audit queue.
    }
  }
}
