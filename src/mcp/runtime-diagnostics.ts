import { randomUUID } from 'node:crypto';
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
}

/** Runtime diagnostics callback used by MCP tools. */
export type RuntimeDiagnosticsProvider = () => RuntimeDiagnostics | Promise<RuntimeDiagnostics>;

/** Options for building a runtime diagnostics provider. */
export interface RuntimeDiagnosticsProviderOptions {
  transportMode: string;
  metadataPath?: string;
  now?: () => number;
}

/**
 * Build a lightweight runtime diagnostics provider for MCP startup status.
 *
 * @param options Transport mode and optional metadata file path.
 * @returns Provider that reports identity, transport mode, and metadata validity without exposing tokens.
 */
export function createRuntimeDiagnosticsProvider(
  options: RuntimeDiagnosticsProviderOptions,
): RuntimeDiagnosticsProvider {
  const now = options.now ?? Date.now;
  return async () => {
    const base = baseDiagnostics(options.transportMode);
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
    return {
      ...base,
      metadata: {
        available: true,
        fresh: true,
        path: options.metadataPath,
        url: metadata.url,
        ageMs: Number.isNaN(startedMs) ? undefined : Math.max(0, now() - startedMs),
      },
    };
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
