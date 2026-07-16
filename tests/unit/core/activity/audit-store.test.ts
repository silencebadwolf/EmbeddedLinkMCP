import { mkdtemp, readFile, readdir, stat, utimes, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { ActivityEventView } from '../../../../src/shared/activity-contract.js';
import { AuditStore } from '../../../../src/core/activity/audit-store.js';

const tempDirs: string[] = [];

async function createTempDir(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'linkterm-audit-'));
  tempDirs.push(directory);
  return directory;
}

function event(sequence: number, action = 'terminal.read'): ActivityEventView {
  return {
    schemaVersion: '1.0.0',
    kind: 'operation-transition',
    runtimeId: 'runtime-test',
    sequence,
    eventId: `event-${sequence}`,
    timestamp: `2026-07-15T00:00:${String(sequence % 60).padStart(2, '0')}.000Z`,
    operationId: `operation-${sequence}`,
    actor: { kind: 'agent', channel: 'local-mcp' },
    surface: 'terminal',
    action,
    risk: 'read-only',
    approvalPolicy: 'none',
    authorizationSource: 'none',
    targets: [{ kind: 'session', id: `session-${sequence}`, label: 'ttyUSB0' }],
    operationPhase: 'succeeded',
  };
}

describe('AuditStore', () => {
  afterEach(async () => {
    for (const directory of tempDirs.splice(0)) {
      await import('node:fs/promises').then(({ rm }) => rm(directory, { recursive: true, force: true }));
    }
  });

  it('persists only validated display-safe events and recovers them', async () => {
    const directory = await createTempDir();
    const store = new AuditStore({ directory, now: () => '2026-07-15T00:00:00.000Z' });
    await store.initialize();
    store.enqueue(event(1));
    await store.flush();

    const line = await readFile(path.join(directory, 'activity.jsonl'), 'utf8');
    expect(line).toContain('terminal.read');
    expect(line).not.toContain('password');
    expect(line).not.toContain('privateKey');
    expect(line).not.toContain('base64');
    expect(line).not.toContain(path.dirname(directory));

    const recovered = new AuditStore({ directory, now: () => '2026-07-15T00:00:01.000Z' });
    await recovered.initialize();
    expect(recovered.getRecords()).toHaveLength(1);
    expect(recovered.getRecords()[0]?.event.operationId).toBe('operation-1');
  });

  it('fails closed if a caller attempts to enqueue protected argument keys or Main-only fields', async () => {
    const directory = await createTempDir();
    const store = new AuditStore({ directory, now: () => '2026-07-15T00:00:00.000Z' });
    await store.initialize();
    store.enqueue({
      ...event(1),
      argumentSummary: {
        fieldCount: 1,
        items: [{ kind: 'identifier', key: 'password', value: 'not-safe' }],
      },
    });
    store.enqueue({ ...event(2), ...( { leaseId: 'internal' } as unknown as object) });
    await store.flush();
    expect(store.getRecords()).toHaveLength(0);
    expect(store.getStatus().lastWarningCode).toBe('append-failed');
  });

  it('rotates before the configured limit and keeps both files exportable', async () => {
    const directory = await createTempDir();
    const store = new AuditStore({ directory, maxFileBytes: 350, now: () => '2026-07-15T00:00:00.000Z' });
    await store.initialize();
    store.enqueue(event(1, 'terminal.read.long-action'));
    store.enqueue(event(2, 'terminal.read.long-action'));
    await store.flush();
    const files = (await readdir(directory)).filter((name) => name.endsWith('.jsonl'));
    expect(files.length).toBeGreaterThanOrEqual(2);
    const exported = await store.export({ format: 'json', pathMode: 'basename' });
    expect(exported.eventCount).toBe(2);
    expect(exported.redacted).toBe(true);
  });

  it('recovers a torn final line and reports a bounded warning', async () => {
    const directory = await createTempDir();
    await writeFile(
      path.join(directory, 'activity.jsonl'),
      `${JSON.stringify({ schemaVersion: '1.0.0', recordType: 'activity-event', event: event(1) })}\n{"schemaVersion":"1.0.0"`,
      'utf8',
    );
    const store = new AuditStore({ directory, now: () => '2026-07-15T00:00:00.000Z' });
    await store.initialize();
    expect(store.getRecords()).toHaveLength(1);
    expect(store.getStatus().lastWarningCode).toBe('trailing-line-recovered');
  });

  it('removes expired files during startup and supports disabled mode', async () => {
    const directory = await createTempDir();
    const oldFile = path.join(directory, 'activity.2020-01-01T00-00-00.000Z.1.jsonl');
    await writeFile(oldFile, `${JSON.stringify({ schemaVersion: '1.0.0', recordType: 'activity-event', event: event(1) })}\n`);
    const oldTime = new Date('2020-01-01T00:00:00.000Z');
    await utimes(oldFile, oldTime, oldTime);
    const store = new AuditStore({ directory, retentionMs: 1_000, now: () => '2026-07-15T00:00:00.000Z' });
    await store.initialize();
    expect(store.getStatus().fileCount).toBe(0);

    const disabled = new AuditStore({ directory, enabled: false });
    await disabled.initialize();
    disabled.enqueue(event(2));
    await disabled.flush();
    expect(disabled.getStatus().enabled).toBe(false);
    expect((await readdir(directory)).filter((name) => name.endsWith('.jsonl'))).toHaveLength(0);
  });

  it('clears local activity idempotently and never returns an absolute export path', async () => {
    const directory = await createTempDir();
    const store = new AuditStore({ directory, now: () => '2026-07-15T00:00:00.000Z' });
    await store.initialize();
    store.enqueue(event(1));
    await store.flush();
    const first = await store.clear();
    const second = await store.clear();
    expect(first.cleared).toBe(true);
    expect(second.cleared).toBe(true);
    expect(store.getRecords()).toHaveLength(0);
    const exportResult = await store.export({ format: 'jsonl', pathMode: 'full' });
    expect(exportResult.fileName).not.toContain(directory);
    expect(exportResult.redacted).toBe(true);
    const exportedFiles = await readdir(path.join(directory, 'exports'));
    const exportedContent = await readFile(
      path.join(directory, 'exports', exportedFiles[0] ?? exportResult.fileName),
      'utf8',
    );
    expect(exportedContent).not.toMatch(/principalId|preparedOperation|leaseId|C:\\audit/iu);
  });

  it('recovers the newest bounded events instead of the oldest file prefix', async () => {
    const directory = await createTempDir();
    const oldFile = path.join(directory, 'activity.2026-07-14T00-00-00-000Z.0.jsonl');
    const newFile = path.join(directory, 'activity.2026-07-15T00-00-00-000Z.1.jsonl');
    await writeFile(oldFile, `${JSON.stringify({ schemaVersion: '1.0.0', recordType: 'activity-event', event: event(1) })}\n`);
    await writeFile(newFile, `${JSON.stringify({ schemaVersion: '1.0.0', recordType: 'activity-event', event: event(2) })}\n`);
    const oldTime = new Date('2026-07-14T00:00:00.000Z');
    const newTime = new Date('2026-07-15T00:00:00.000Z');
    await utimes(oldFile, oldTime, oldTime);
    await utimes(newFile, newTime, newTime);
    const store = new AuditStore({
      directory,
      maxReadEvents: 1,
      now: () => '2026-07-15T00:00:01.000Z',
    });
    await store.initialize();
    expect(store.getRecords().map((record) => record.event.sequence)).toEqual([2]);
  });

  it('honors a bounded startup byte budget for oversized files', async () => {
    const directory = await createTempDir();
    const records = Array.from({ length: 20 }, (_, index) =>
      JSON.stringify({ schemaVersion: '1.0.0', recordType: 'activity-event', event: event(index + 1) }),
    ).join('\n');
    await writeFile(path.join(directory, 'activity.jsonl'), `${records}\n`, 'utf8');
    const store = new AuditStore({ directory, maxReadEvents: 100, maxReadBytes: 256, now: () => '2026-07-15T00:00:00.000Z' });
    await store.initialize();
    expect(store.getRecords().length).toBeLessThan(20);
    expect(store.getStatus().byteCount).toBeGreaterThan(256);
  });

  it('recovers and exports 10,000 events within the documented bounded baseline', async () => {
    const directory = await createTempDir();
    const store = new AuditStore({ directory, maxReadEvents: 10_000, now: () => '2026-07-15T00:00:00.000Z' });
    await store.initialize();
    const started = Date.now();
    for (let index = 1; index <= 10_000; index += 1) store.enqueue(event(index));
    await store.flush();
    const elapsed = Date.now() - started;
    expect(store.getRecords()).toHaveLength(10_000);
    expect(elapsed).toBeLessThan(5_000);
    const directoryStat = await stat(directory);
    expect(directoryStat.isDirectory()).toBe(true);
  });
});
