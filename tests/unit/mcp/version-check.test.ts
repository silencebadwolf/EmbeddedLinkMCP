import { describe, expect, it } from 'vitest';
import {
  checkSchemaVersion,
  LINKTERM_MCP_SCHEMA_VERSION,
} from '@/mcp/versioning/version-check.js';

describe('checkSchemaVersion', () => {
  it('returns ok when client version is undefined (legacy client)', () => {
    const result = checkSchemaVersion(undefined, 'state-affecting');
    expect(result.ok).toBe(true);
    expect(result.warning).toBeUndefined();
    expect(result.serverVersion).toBe(LINKTERM_MCP_SCHEMA_VERSION);
  });

  it('returns ok when client version exactly matches server', () => {
    const result = checkSchemaVersion(LINKTERM_MCP_SCHEMA_VERSION, 'state-affecting');
    expect(result.ok).toBe(true);
    expect(result.warning).toBeUndefined();
  });

  it('rejects state-affecting tool on mismatch', () => {
    const result = checkSchemaVersion('linkterm-mcp/0.9.0', 'state-affecting');
    expect(result.ok).toBe(false);
    expect(result.warning).toMatch(/mismatch/i);
    expect(result.warning).toMatch(/Refusing/);
    expect(result.clientVersion).toBe('linkterm-mcp/0.9.0');
    expect(result.serverVersion).toBe(LINKTERM_MCP_SCHEMA_VERSION);
  });

  it('allows read-only tool on mismatch but returns warning', () => {
    const result = checkSchemaVersion('linkterm-mcp/0.9.0', 'read-only');
    expect(result.ok).toBe(true);
    expect(result.warning).toMatch(/mismatch/i);
    expect(result.warning).not.toMatch(/Refusing/);
  });

  it('treats different but non-empty version as mismatch even if newer-looking', () => {
    const future = 'linkterm-mcp/2.0.0';
    const result = checkSchemaVersion(future, 'state-affecting');
    expect(result.ok).toBe(false);
    expect(result.clientVersion).toBe(future);
  });
});
