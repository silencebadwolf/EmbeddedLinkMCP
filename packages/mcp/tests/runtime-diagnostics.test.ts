import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { baseDiagnostics, createRuntimeDiagnosticsProvider } from '@linkterm/mcp/runtime-diagnostics';

const freshNow = Date.parse('2026-06-18T00:01:00.000Z');

function metadataJson(startedAt: string): string {
  return JSON.stringify({
    schemaVersion: 'linkterm-mcp-runtime/1.0.0',
    pid: process.pid,
    url: 'http://127.0.0.1:38217/mcp',
    token: 'abcdefghijklmnopqrstuvwxyz1234567890',
    startedAt,
  });
}

describe('runtime diagnostics', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'lt-runtime-diagnostics-'));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it.each(['owner', 'proxy', 'stdio', 'not-started'])('reports %s transport label without metadata', (mode) => {
    const diagnostics = baseDiagnostics(mode);

    expect(diagnostics.transport.mode).toBe(mode);
    expect(diagnostics.identity.pid).toBe(process.pid);
    expect(diagnostics.identity.runtimeId).toEqual(expect.any(String));
    expect(diagnostics.identity.startedAt).toEqual(expect.any(String));
    expect(diagnostics.metadata).toEqual({ available: false, fresh: false });
  });

  it('reports missing runtime metadata as unavailable', async () => {
    const metadataPath = path.join(root, 'missing-runtime.json');
    const provider = createRuntimeDiagnosticsProvider({ transportMode: 'proxy', metadataPath });

    await expect(provider()).resolves.toMatchObject({
      transport: { mode: 'proxy' },
      metadata: { available: false, fresh: false, path: metadataPath },
    });
  });

  it('reports valid runtime metadata as fresh and omits the bearer token', async () => {
    const metadataPath = path.join(root, 'mcp-runtime.json');
    await writeFile(metadataPath, metadataJson('2026-06-18T00:00:42.000Z'), 'utf-8');
    const provider = createRuntimeDiagnosticsProvider({
      transportMode: 'owner',
      metadataPath,
      now: () => freshNow,
    });

    const diagnostics = await provider();

    expect(diagnostics.transport.mode).toBe('owner');
    expect(diagnostics.metadata).toMatchObject({
      available: true,
      fresh: true,
      path: metadataPath,
      url: 'http://127.0.0.1:38217/mcp',
      ageMs: 18_000,
    });
    expect(JSON.stringify(diagnostics)).not.toContain('abcdefghijklmnopqrstuvwxyz1234567890');
  });

  it('reports existing but old runtime metadata as stale', async () => {
    const metadataPath = path.join(root, 'mcp-runtime.json');
    await writeFile(metadataPath, metadataJson('2026-06-18T00:00:00.000Z'), 'utf-8');
    const provider = createRuntimeDiagnosticsProvider({
      transportMode: 'proxy',
      metadataPath,
      now: () => freshNow,
      maxMetadataAgeMs: 1_000,
    });

    await expect(provider()).resolves.toMatchObject({
      transport: { mode: 'proxy' },
      metadata: {
        available: true,
        fresh: false,
        path: metadataPath,
        url: 'http://127.0.0.1:38217/mcp',
        ageMs: 60_000,
      },
    });
  });

  it('reports runtime code as stale when a watched artifact is newer than process startup', async () => {
    const metadataPath = path.join(root, 'mcp-runtime.json');
    const artifactPath = path.join(root, 'dist', 'main', 'jlink', 'segger-command-runner.js');
    await writeFile(metadataPath, metadataJson('2026-06-18T00:00:00.000Z'), 'utf-8');
    await mkdir(path.dirname(artifactPath), { recursive: true });
    await writeFile(artifactPath, 'compiled after owner startup', 'utf-8');
    const provider = createRuntimeDiagnosticsProvider({
      transportMode: 'owner',
      metadataPath,
      now: () => Date.parse('2026-06-18T00:02:00.000Z'),
      processStartedAt: '2026-06-18T00:00:00.000Z',
      artifactPaths: [artifactPath],
      statFile: async () => ({ mtimeMs: Date.parse('2026-06-18T00:01:00.000Z') }),
    });

    const diagnostics = await provider();

    expect(diagnostics.code).toMatchObject({
      fresh: false,
      staleArtifacts: [
        {
          path: artifactPath,
          modifiedAt: '2026-06-18T00:01:00.000Z',
        },
      ],
    });
  });
});
