import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { connectionsFileSchema } from '@linkterm/runtime/core/connections/schemas';
import { migrateConnections } from '../src/migrate-connections.js';

it('previews and imports desktop metadata without bringing safeStorage secrets or overwriting a server file', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'linkterm-migration-'));
  const from = join(dir, 'desktop'); const to = join(dir, 'server');
  await mkdir(from);
  const saved = { schemaVersion: 'linkterm-connections/1.0.0', profiles: [
    { id: 'conn_ssh', label: 'Production SSH', type: 'ssh', config: { type: 'ssh', host: 'example.test', port: 22, username: 'operator' }, encryptedCredential: { provider: 'electron-safeStorage', version: 1, ciphertextBase64: 'old-secret' }, createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z' },
    { id: 'conn_shell', label: 'Local', type: 'local-shell', config: { type: 'local-shell' }, createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z' },
  ] };
  await writeFile(join(from, 'connections.json'), JSON.stringify(saved));
  try {
    const preview = await migrateConnections(from, to);
    expect(preview).toMatchObject({ profiles: 2, credentialsToReenter: 1, applied: false });
    await expect(stat(join(to, 'connections.json'))).rejects.toMatchObject({ code: 'ENOENT' });
    const applied = await migrateConnections(from, to, true);
    expect(applied.applied).toBe(true);
    const imported = connectionsFileSchema.parse(JSON.parse(await readFile(join(to, 'connections.json'), 'utf8')));
    expect(imported.profiles.map(profile => profile.id)).toEqual(['conn_ssh', 'conn_shell']);
    expect(imported.profiles[0].encryptedCredential).toBeUndefined();
    expect(await readFile(join(from, 'connections.json'), 'utf8')).toContain('old-secret');
    await expect(migrateConnections(from, to, true)).rejects.toMatchObject({ code: 'EEXIST' });
    expect(await readFile(join(to, 'connections.json'), 'utf8')).not.toContain('old-secret');
  } finally { await rm(dir, { recursive: true, force: true }); }
});
