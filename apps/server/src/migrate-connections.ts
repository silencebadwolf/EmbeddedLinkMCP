import { randomUUID } from 'node:crypto';
import { link, mkdir, open, readFile, stat, unlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { connectionsFileSchema } from '@linkterm/runtime/core/connections/schemas';

export interface ConnectionMigrationPreview {
  readonly profiles: number;
  readonly credentialsToReenter: number;
  readonly source: string;
  readonly destination: string;
  readonly applied: boolean;
}

/** Import desktop connection metadata without exposing safeStorage ciphertext on the server. */
export async function migrateConnections(sourceDataDir: string, targetDataDir: string, apply = false): Promise<ConnectionMigrationPreview> {
  const source = path.resolve(sourceDataDir, 'connections.json');
  const destination = path.resolve(targetDataDir, 'connections.json');
  if (source === destination) throw new Error('Source and destination data directories must differ');
  if ((await stat(source)).size > 64 * 1024 * 1024) throw new Error('Connections file exceeds the migration size limit');
  const original = connectionsFileSchema.parse(JSON.parse(await readFile(source, 'utf8')));
  const profiles = original.profiles.map(profile => ({
    id: profile.id,
    label: profile.label,
    type: profile.type,
    config: profile.config,
    createdAt: profile.createdAt,
    updatedAt: profile.updatedAt,
  }));
  const preview: ConnectionMigrationPreview = {
    profiles: profiles.length,
    credentialsToReenter: original.profiles.filter(profile => profile.encryptedCredential !== undefined).length,
    source, destination, applied: apply,
  };
  if (!apply) return preview;
  await mkdir(targetDataDir, { recursive: true, mode: 0o700 });
  try { await stat(path.join(targetDataDir, '.runtime-owner.json')); throw new Error('Stop the server before migrating connection profiles'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  const temporary = path.join(targetDataDir, `.connections-import-${randomUUID()}.tmp`);
  try {
    const file = await open(temporary, 'wx', 0o600);
    try { await file.writeFile(JSON.stringify({ schemaVersion: original.schemaVersion, profiles }, null, 2) + '\n'); await file.sync(); }
    finally { await file.close(); }
    await link(temporary, destination);
  } finally { await unlink(temporary).catch(error => { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }); }
  return preview;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const sourceIndex = process.argv.indexOf('--from');
  const targetIndex = process.argv.indexOf('--to');
  const source = sourceIndex >= 0 ? process.argv[sourceIndex + 1] : undefined;
  const target = targetIndex >= 0 ? process.argv[targetIndex + 1] : undefined;
  if (!source || !target) throw new Error('Usage: node migrate-connections.js --from <desktop-data-dir> --to <server-data-dir> [--apply]');
  const report = await migrateConnections(source, target, process.argv.includes('--apply'));
  console.log(JSON.stringify(report, null, 2));
  if (!report.applied) console.log('Preview only. Add --apply to import into an empty, stopped server data directory.');
}
