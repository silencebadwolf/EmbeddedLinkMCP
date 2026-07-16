import { describe, expect, it } from 'vitest';
import {
  DEFAULT_READINESS_PREFERENCES,
  loadReadinessPreferences,
  serializeReadinessPreferences,
} from '@/core/readiness/readiness-preferences.js';

describe('readiness preferences adapter', () => {
  it('loads current version preferences as safe hints only', () => {
    const result = loadReadinessPreferences(
      JSON.stringify({
        schemaVersion: '1.0.0',
        recentWorkspaces: [{ id: 'workspace_1', label: 'board-a' }],
        recentProfiles: [{ id: 'profile_1', label: 'board-a', kind: 'control-profile' }],
        dismissedHints: ['hint_manual_serial'],
      }),
    );

    expect(result.preferences.recentWorkspaces).toHaveLength(1);
    expect(result.preferences.recentProfiles).toHaveLength(1);
    expect(result.diagnostics).toEqual([]);
    expect(result.preferences).not.toHaveProperty('autoConnect');
  });

  it('migrates legacy 0.x preferences without treating them as readiness proof', () => {
    const result = loadReadinessPreferences(
      JSON.stringify({
        schemaVersion: '0.1.0',
        recentWorkspace: { id: 'workspace_1', label: 'board-a' },
        dismissedHints: ['hint_old'],
      }),
    );

    expect(result.preferences).toEqual({
      ...DEFAULT_READINESS_PREFERENCES,
      recentWorkspaces: [{ id: 'workspace_1', label: 'board-a' }],
      dismissedHints: ['hint_old'],
    });
    expect(result.diagnostics).toContainEqual({
      code: 'readiness.preferences.migrated',
      severity: 'info',
    });
  });

  it('falls back to safe defaults for corrupt, unknown, oversized, or unsafe payloads', () => {
    for (const raw of [
      '{not-json',
      JSON.stringify({ schemaVersion: '9.9.9', recentWorkspaces: [] }),
      'x'.repeat(32_001),
      JSON.stringify({
        schemaVersion: '1.0.0',
        recentWorkspaces: [{ id: 'workspace_1', label: 'C:/Users/Admin/private' }],
        recentProfiles: [],
        dismissedHints: [],
      }),
      JSON.stringify({
        schemaVersion: '1.0.0',
        recentWorkspaces: [],
        recentProfiles: [],
        dismissedHints: [],
        token: 'secret',
      }),
    ]) {
      const result = loadReadinessPreferences(raw);
      expect(result.preferences).toEqual(DEFAULT_READINESS_PREFERENCES);
      expect(result.diagnostics.length).toBeGreaterThan(0);
      expect(JSON.stringify(result)).not.toContain('private');
      expect(JSON.stringify(result)).not.toContain('secret');
    }
  });

  it('serializes only the strict current preference shape', () => {
    const serialized = serializeReadinessPreferences({
      ...DEFAULT_READINESS_PREFERENCES,
      recentWorkspaces: [{ id: 'workspace_1', label: 'board-a' }],
    });

    expect(JSON.parse(serialized)).toEqual({
      schemaVersion: '1.0.0',
      recentWorkspaces: [{ id: 'workspace_1', label: 'board-a' }],
      recentProfiles: [],
      dismissedHints: [],
    });
    expect(serialized).not.toMatch(/autoConnect|credential|token/i);
  });
});
