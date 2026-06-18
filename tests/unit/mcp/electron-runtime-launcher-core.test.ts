import { describe, expect, it } from 'vitest';
import {
  buildOwnerRuntimeEnv,
  waitForHealthyRuntimeMetadata,
} from '@/mcp/electron-runtime-launcher-core.js';
import type { McpRuntimeMetadata } from '@/mcp/runtime-metadata.js';

const healthyMetadata: McpRuntimeMetadata = {
  schemaVersion: 'linkterm-mcp-runtime/1.0.0',
  pid: process.pid,
  url: 'http://127.0.0.1:12345/mcp',
  token: 'abcdefghijklmnopqrstuvwxyz1234567890',
  startedAt: '2026-06-18T00:00:00.000Z',
};

describe('electron runtime launcher core', () => {
  it('launches the owner runtime without direct stdio MCP mode', () => {
    const env = buildOwnerRuntimeEnv({
      ELECTRON_RUN_AS_NODE: '1',
      LINKTERM_MCP_STDIO: '1',
      LINKTERM_FORCE_DIST: '0',
      KEEP_ME: 'yes',
    });

    expect(env.ELECTRON_RUN_AS_NODE).toBeUndefined();
    expect(env.LINKTERM_MCP_STDIO).toBeUndefined();
    expect(env.LINKTERM_FORCE_DIST).toBe('1');
    expect(env.KEEP_ME).toBe('yes');
  });

  it('waits for runtime metadata and health before allowing stdio proxy startup', async () => {
    let reads = 0;
    let healthChecks = 0;

    const metadata = await waitForHealthyRuntimeMetadata({
      metadataPath: 'unused',
      timeoutMs: 100,
      retryMs: 1,
      readMetadata: async () => {
        reads += 1;
        return reads >= 3 ? healthyMetadata : null;
      },
      checkHealth: async () => {
        healthChecks += 1;
        return healthChecks >= 2;
      },
    });

    expect(metadata).toEqual(healthyMetadata);
    expect(reads).toBeGreaterThanOrEqual(4);
    expect(healthChecks).toBe(2);
  });

  it('returns null instead of exposing a partial tool surface when metadata never becomes healthy', async () => {
    const metadata = await waitForHealthyRuntimeMetadata({
      metadataPath: 'unused',
      timeoutMs: 5,
      retryMs: 1,
      readMetadata: async () => healthyMetadata,
      checkHealth: async () => false,
    });

    expect(metadata).toBeNull();
  });
});
