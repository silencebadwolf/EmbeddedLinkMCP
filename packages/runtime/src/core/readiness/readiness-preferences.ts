import {
  READINESS_SCHEMA_VERSION,
  ReadinessPreferencesSchema,
  type ReadinessPreferences,
} from '@linkterm/contracts/readiness-contract';

export interface ReadinessPreferenceDiagnostic {
  readonly code: string;
  readonly severity: 'info' | 'warning' | 'error';
}

export interface LoadReadinessPreferencesResult {
  readonly preferences: ReadinessPreferences;
  readonly diagnostics: readonly ReadinessPreferenceDiagnostic[];
}

const MAX_PREFERENCES_BYTES = 32_000;

export const DEFAULT_READINESS_PREFERENCES: ReadinessPreferences = ReadinessPreferencesSchema.parse({
  schemaVersion: READINESS_SCHEMA_VERSION,
  recentWorkspaces: [],
  recentProfiles: [],
  dismissedHints: [],
});

export function loadReadinessPreferences(raw: string | undefined | null): LoadReadinessPreferencesResult {
  if (raw === undefined || raw === null || raw.trim().length === 0) {
    return { preferences: DEFAULT_READINESS_PREFERENCES, diagnostics: [] };
  }
  if (raw.length > MAX_PREFERENCES_BYTES) {
    return fallback('readiness.preferences.oversized');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return fallback('readiness.preferences.corrupt');
  }

  const current = ReadinessPreferencesSchema.safeParse(parsed);
  if (current.success) {
    return { preferences: current.data, diagnostics: [] };
  }

  const migrated = migrateLegacyPreferences(parsed);
  if (migrated !== undefined) {
    const migrationResult = ReadinessPreferencesSchema.safeParse(migrated);
    if (migrationResult.success) {
      return {
        preferences: migrationResult.data,
        diagnostics: [{ code: 'readiness.preferences.migrated', severity: 'info' }],
      };
    }
  }

  return fallback('readiness.preferences.invalid');
}

export function serializeReadinessPreferences(preferences: ReadinessPreferences): string {
  const parsed = ReadinessPreferencesSchema.parse(preferences);
  return JSON.stringify(parsed);
}

function fallback(code: string): LoadReadinessPreferencesResult {
  return {
    preferences: DEFAULT_READINESS_PREFERENCES,
    diagnostics: [{ code, severity: 'warning' }],
  };
}

function migrateLegacyPreferences(value: unknown): unknown | undefined {
  if (!isRecord(value) || value.schemaVersion !== '0.1.0') return undefined;
  const recentWorkspace = isRecord(value.recentWorkspace)
    ? {
        id: typeof value.recentWorkspace.id === 'string' ? value.recentWorkspace.id : 'workspace',
        label: typeof value.recentWorkspace.label === 'string' ? value.recentWorkspace.label : 'workspace',
      }
    : undefined;
  const dismissedHints = Array.isArray(value.dismissedHints)
    ? value.dismissedHints.filter((item): item is string => typeof item === 'string')
    : [];
  return {
    schemaVersion: READINESS_SCHEMA_VERSION,
    recentWorkspaces: recentWorkspace === undefined ? [] : [recentWorkspace],
    recentProfiles: [],
    dismissedHints,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
