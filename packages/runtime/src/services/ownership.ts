import { randomUUID } from 'node:crypto';
import { mkdir, open, readFile, realpath, unlink } from 'node:fs/promises';
import path from 'node:path';

export class RuntimeAlreadyOwnedError extends Error {
  readonly code = 'DATA_DIRECTORY_IN_USE';
  constructor(readonly lockPath: string) {
    super(`Runtime data directory is locked: ${lockPath}. Stop its owner first. If the owner crashed, verify it is no longer running before removing this lock.`);
    this.name = 'RuntimeAlreadyOwnedError';
  }
}

/** Atomic, conservative ownership: a crashed owner is never silently replaced. */
export async function acquireRuntimeOwnership(dataDir: string): Promise<{ release(): Promise<void> }> {
  await mkdir(dataDir, { recursive: true, mode: 0o700 });
  const directory = await realpath(dataDir);
  const lockPath = path.join(directory, '.runtime-owner.json');
  const id = randomUUID();
  let handle;
  try { handle = await open(lockPath, 'wx', 0o600); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new RuntimeAlreadyOwnedError(lockPath);
    throw error;
  }
  try {
    await handle.writeFile(JSON.stringify({ version: 1, id, pid: process.pid, startedAt: new Date().toISOString() }) + '\n');
    await handle.sync();
  } catch (error) {
    await handle.close(); await unlink(lockPath).catch(() => undefined); throw error;
  }
  await handle.close();
  let releasing: Promise<void> | undefined;
  return { release: () => releasing ??= (async () => {
    const current = JSON.parse(await readFile(lockPath, 'utf8')) as { id?: unknown };
    if (current.id !== id) throw new Error('Runtime ownership changed; refusing to remove another owner lock');
    await unlink(lockPath);
  })() };
}
