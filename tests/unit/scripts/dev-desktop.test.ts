import { EventEmitter } from 'node:events';
import { mkdtemp, mkdir, rm, writeFile, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { desktopRuntimeFingerprint, stopDesktopChild } from '../../../scripts/dev-desktop.mjs';

afterEach(() => vi.useRealTimers());

it('tracks backend packages and preload without restarting for renderer-only changes', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'linkterm-dev-watch-'));
  try {
    for (const path of [
      'apps/desktop/dist/main',
      'apps/desktop/dist/preload',
      'apps/desktop/dist/platform',
      'apps/desktop/dist/ipc',
      'apps/desktop/dist/renderer',
      'packages/contracts/dist',
      'packages/runtime/dist',
      'packages/mcp/dist',
      'packages/ui/dist',
    ]) {
      await mkdir(join(directory, path), { recursive: true });
      await writeFile(join(directory, path, 'index.js'), 'export {};');
    }
    const initial = await desktopRuntimeFingerprint(directory);
    await writeFile(join(directory, 'packages/ui/dist/index.js'), 'export const updated = true;');
    expect(await desktopRuntimeFingerprint(directory)).toBe(initial);
    await utimes(join(directory, 'packages/runtime/dist/index.js'), new Date(1), new Date(1));
    expect(await desktopRuntimeFingerprint(directory)).not.toBe(initial);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

it('waits for graceful shutdown and only kills an unresponsive child after the deadline', async () => {
  vi.useFakeTimers();
  const child = Object.assign(new EventEmitter(), {
    exitCode: null,
    signalCode: null,
    connected: true,
    send: vi.fn(),
    kill: vi.fn(),
  });
  let stopped = false;
  const pending = stopDesktopChild(child, 500).then(() => {
    stopped = true;
  });
  expect(child.send).toHaveBeenCalledWith({ type: 'linkterm:dev:quit' }, expect.any(Function));
  await vi.advanceTimersByTimeAsync(499);
  expect(child.kill).not.toHaveBeenCalled();
  expect(stopped).toBe(false);
  child.emit('exit', 0, null);
  await pending;
  await vi.advanceTimersByTimeAsync(2);
  expect(child.kill).not.toHaveBeenCalled();

  const fallback = stopDesktopChild(child, 500);
  await vi.advanceTimersByTimeAsync(500);
  expect(child.kill).toHaveBeenCalledOnce();
  child.emit('exit', null, 'SIGTERM');
  await fallback;
});
