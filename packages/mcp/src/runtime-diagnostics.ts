import { randomUUID } from 'node:crypto';
import { stat } from 'node:fs/promises';
import { readRuntimeMetadata } from './runtime-metadata.js';

const RUNTIME_ID = randomUUID();
const RUNTIME_STARTED_AT = new Date().toISOString();

/** Runtime identity and transport facts returned by startup health tools. */
export interface RuntimeDiagnostics {
  identity: {
    runtimeId: string;
    pid: number;
    startedAt: string;
  };
  transport: {
    mode: string;
  };
  metadata: {
    available: boolean;
    fresh: boolean;
    path?: string;
    url?: string;
    ageMs?: number;
  };
  code?: {
    fresh: boolean;
    staleArtifacts: Array<{
      path: string;
      modifiedAt: string;
    }>;
  };
}

type RuntimeCodeStaleArtifact = NonNullable<RuntimeDiagnostics['code']>['staleArtifacts'][number];

/** Runtime diagnostics callback used by MCP tools. */
export type RuntimeDiagnosticsProvider = () => RuntimeDiagnostics | Promise<RuntimeDiagnostics>;

/** Options for building a runtime diagnostics provider. */
export interface RuntimeDiagnosticsProviderOptions {
  transportMode: string;
  metadataPath?: string;
  now?: () => number;
  /** Metadata older than this is reported as available but not fresh. */
  maxMetadataAgeMs?: number;
  /** Process startup timestamp used to detect compiled artifacts newer than the running owner. */
  processStartedAt?: string;
  /** Compiled artifacts that should not be newer than the running process. */
  artifactPaths?: readonly string[];
  /** Injectable stat seam for deterministic tests. */
  statFile?: (filePath: string) => Promise<{ mtimeMs: number }>;
}

/**
 * Build a lightweight runtime diagnostics provider for MCP startup status.
 *
 * @param options Transport mode, optional metadata file path, and optional freshness threshold.
 * @returns Provider that reports identity, transport mode, and metadata validity without exposing tokens.
 */
export function createRuntimeDiagnosticsProvider(
  options: RuntimeDiagnosticsProviderOptions,
): RuntimeDiagnosticsProvider {
  const now = options.now ?? Date.now;
  const statFile = options.statFile ?? stat;
  return async () => {
    const base = await withCodeFreshness(baseDiagnostics(options.transportMode), options, statFile);
    if (options.metadataPath === undefined) return base;

    const metadata = await readRuntimeMetadata(options.metadataPath);
    if (metadata === null) {
      return {
        ...base,
        metadata: {
          available: false,
          fresh: false,
          path: options.metadataPath,
        },
      };
    }

    const startedMs = Date.parse(metadata.startedAt);
    const ageMs = Number.isNaN(startedMs) ? undefined : Math.max(0, now() - startedMs);
    return withCodeFreshness({
      ...base,
      metadata: {
        available: true,
        fresh: ageMs === undefined || options.maxMetadataAgeMs === undefined || ageMs <= options.maxMetadataAgeMs,
        path: options.metadataPath,
        url: metadata.url,
        ageMs,
      },
    }, { ...options, processStartedAt: options.processStartedAt ?? metadata.startedAt }, statFile);
  };
}

/**
 * Return process-local fallback diagnostics when no owner metadata is available.
 *
 * @param transportMode Runtime transport mode label.
 * @returns Runtime diagnostics without metadata.
 */
export function baseDiagnostics(transportMode: string): RuntimeDiagnostics {
  return {
    identity: {
      runtimeId: RUNTIME_ID,
      pid: process.pid,
      startedAt: RUNTIME_STARTED_AT,
    },
    transport: { mode: transportMode },
    metadata: {
      available: false,
      fresh: false,
    },
  };
}

async function withCodeFreshness(
  diagnostics: RuntimeDiagnostics,
  options: RuntimeDiagnosticsProviderOptions,
  statFile: (filePath: string) => Promise<{ mtimeMs: number }>,
): Promise<RuntimeDiagnostics> {
  const artifactPaths = options.artifactPaths ?? [];
  if (artifactPaths.length === 0) return diagnostics;

  const processStartedAt = options.processStartedAt ?? diagnostics.identity.startedAt;
  const processStartedMs = Date.parse(processStartedAt);
  if (Number.isNaN(processStartedMs)) {
    return { ...diagnostics, code: { fresh: true, staleArtifacts: [] } };
  }

  const staleArtifacts: RuntimeCodeStaleArtifact[] = [];
  for (const artifactPath of artifactPaths) {
    try {
      const stats = await statFile(artifactPath);
      if (stats.mtimeMs > processStartedMs) {
        staleArtifacts.push({
          path: artifactPath,
          modifiedAt: new Date(stats.mtimeMs).toISOString(),
        });
      }
    } catch {
      // Missing optional artifacts should not make startup health noisy.
    }
  }

  return {
    ...diagnostics,
    code: {
      fresh: staleArtifacts.length === 0,
      staleArtifacts,
    },
  };
}
