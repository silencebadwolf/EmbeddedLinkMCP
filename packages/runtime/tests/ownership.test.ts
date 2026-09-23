import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { acquireRuntimeOwnership } from '@linkterm/runtime/services/ownership';

it('allows one owner, rejects concurrent ownership, and releases idempotently', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'linkterm-owner-'));
  try {
    const owner = await acquireRuntimeOwnership(dataDir);
    await expect(acquireRuntimeOwnership(dataDir)).rejects.toMatchObject({ code: 'DATA_DIRECTORY_IN_USE' });
    expect(JSON.parse(await readFile(join(dataDir, '.runtime-owner.json'), 'utf8')).pid).toBe(process.pid);
    const releasing = owner.release();
    expect(owner.release()).toBe(releasing);
    await releasing;
    const replacement = await acquireRuntimeOwnership(dataDir);
    await replacement.release();
  } finally { await rm(dataDir, { recursive: true, force: true }); }
});

it('does not steal a stale lock or remove a replacement lock', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'linkterm-owner-'));
  const lockPath = join(dataDir, '.runtime-owner.json');
  try {
    await writeFile(lockPath, JSON.stringify({ id: 'old', pid: -1 }));
    await expect(acquireRuntimeOwnership(dataDir)).rejects.toMatchObject({ code: 'DATA_DIRECTORY_IN_USE' });
    await rm(lockPath);
    const owner = await acquireRuntimeOwnership(dataDir);
    await writeFile(lockPath, JSON.stringify({ id: 'replacement', pid: process.pid }));
    await expect(owner.release()).rejects.toThrow('refusing to remove');
    expect(JSON.parse(await readFile(lockPath, 'utf8')).id).toBe('replacement');
  } finally { await rm(dataDir, { recursive: true, force: true }); }
});
