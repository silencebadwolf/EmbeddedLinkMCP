import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import {
  readOrCreateRuntimeHttpSettings,
  runtimeHttpSettingsPath,
} from '../../../src/mcp/runtime-metadata.js';

describe('runtime HTTP settings', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'lt-mcp-runtime-metadata-'));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('persists stable HTTP settings for external agent configuration', async () => {
    const filePath = path.join(root, 'mcp-http-settings.json');

    const first = await readOrCreateRuntimeHttpSettings(filePath);
    const second = await readOrCreateRuntimeHttpSettings(filePath);

    expect(second).toEqual(first);
    expect(first.host).toBe('127.0.0.1');
    expect(first.port).toBe(57371);
    expect(first.token.length).toBeGreaterThanOrEqual(32);
    expect(await readFile(filePath, 'utf-8')).toContain('linkterm-mcp-http-settings/1.0.0');
  });

  it('builds the stable HTTP settings path under userData', () => {
    expect(runtimeHttpSettingsPath(root)).toBe(path.join(root, 'mcp-http-settings.json'));
  });
});
