import { randomBytes } from 'node:crypto';
import { chmod, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

const RUNTIME_METADATA_FILE = 'mcp-runtime.json';
const RUNTIME_METADATA_SCHEMA_VERSION = 'linkterm-mcp-runtime/1.0.0';
const RUNTIME_HTTP_SETTINGS_FILE = 'mcp-http-settings.json';
const RUNTIME_HTTP_SETTINGS_SCHEMA_VERSION = 'linkterm-mcp-http-settings/1.0.0';
const DEFAULT_RUNTIME_HTTP_PORT = 57371;

/** LinkTerm MCP HTTP runtime endpoint metadata persisted for local stdio proxy processes. */
export interface McpRuntimeMetadata {
  schemaVersion: typeof RUNTIME_METADATA_SCHEMA_VERSION;
  pid: number;
  url: string;
  token: string;
  startedAt: string;
}

export interface McpHttpSettings {
  schemaVersion: typeof RUNTIME_HTTP_SETTINGS_SCHEMA_VERSION;
  host: '127.0.0.1';
  port: number;
  token: string;
}

/**
 * Build the metadata file path under Electron userData.
 *
 * @param userDataDir Electron userData directory.
 * @returns Absolute runtime metadata file path.
 */
export function runtimeMetadataPath(userDataDir: string): string {
  return path.join(userDataDir, RUNTIME_METADATA_FILE);
}

export function runtimeHttpSettingsPath(userDataDir: string): string {
  return path.join(userDataDir, RUNTIME_HTTP_SETTINGS_FILE);
}

/**
 * Generate a bearer token for localhost MCP HTTP proxy authentication.
 *
 * @returns URL-safe random token string.
 */
export function createRuntimeToken(): string {
  return randomBytes(32).toString('base64url');
}

/**
 * Persist MCP runtime metadata for later local stdio proxy attachment.
 *
 * @param filePath Metadata file path.
 * @param metadata Runtime endpoint metadata.
 */
export async function writeRuntimeMetadata(
  filePath: string,
  metadata: Omit<McpRuntimeMetadata, 'schemaVersion' | 'startedAt'>,
): Promise<void> {
  const payload: McpRuntimeMetadata = {
    schemaVersion: RUNTIME_METADATA_SCHEMA_VERSION,
    startedAt: new Date().toISOString(),
    ...metadata,
  };
  await writeFile(filePath, JSON.stringify(payload), { encoding: 'utf-8', mode: 0o600 });
  await chmod(filePath, 0o600).catch(() => undefined);
}

/**
 * Read and validate MCP runtime metadata.
 *
 * @param filePath Metadata file path.
 * @returns Runtime metadata, or null if absent/invalid/stale.
 */
export async function readRuntimeMetadata(filePath: string): Promise<McpRuntimeMetadata | null> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(filePath, 'utf-8'));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const candidate = parsed as Partial<McpRuntimeMetadata>;
  if (candidate.schemaVersion !== RUNTIME_METADATA_SCHEMA_VERSION) return null;
  if (typeof candidate.pid !== 'number' || !Number.isInteger(candidate.pid) || candidate.pid <= 0) {
    return null;
  }
  if (typeof candidate.url !== 'string' || !candidate.url.startsWith('http://127.0.0.1:')) {
    return null;
  }
  if (typeof candidate.token !== 'string' || candidate.token.length < 32) return null;
  if (typeof candidate.startedAt !== 'string') return null;
  if (!isProcessAlive(candidate.pid)) return null;
  return candidate as McpRuntimeMetadata;
}

export async function readRuntimeHttpSettings(filePath: string): Promise<McpHttpSettings | null> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(filePath, 'utf-8'));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const candidate = parsed as Partial<McpHttpSettings>;
  if (candidate.schemaVersion !== RUNTIME_HTTP_SETTINGS_SCHEMA_VERSION) return null;
  if (candidate.host !== '127.0.0.1') return null;
  if (
    typeof candidate.port !== 'number' ||
    !Number.isInteger(candidate.port) ||
    candidate.port <= 0 ||
    candidate.port > 65535
  ) {
    return null;
  }
  if (typeof candidate.token !== 'string' || candidate.token.length < 32) return null;
  return candidate as McpHttpSettings;
}

export async function writeRuntimeHttpSettings(
  filePath: string,
  settings: McpHttpSettings,
): Promise<void> {
  await writeFile(filePath, JSON.stringify(settings, null, 2), { encoding: 'utf-8', mode: 0o600 });
  await chmod(filePath, 0o600).catch(() => undefined);
}

export async function readOrCreateRuntimeHttpSettings(
  filePath: string,
): Promise<McpHttpSettings> {
  const existing = await readRuntimeHttpSettings(filePath);
  if (existing) return existing;
  const settings: McpHttpSettings = {
    schemaVersion: RUNTIME_HTTP_SETTINGS_SCHEMA_VERSION,
    host: '127.0.0.1',
    port: DEFAULT_RUNTIME_HTTP_PORT,
    token: createRuntimeToken(),
  };
  await writeRuntimeHttpSettings(filePath, settings);
  return settings;
}

/**
 * Remove the runtime metadata file on clean shutdown.
 *
 * @param filePath Metadata file path.
 */
export async function removeRuntimeMetadata(filePath: string): Promise<void> {
  await rm(filePath, { force: true });
}

/**
 * Check whether a pid still exists.
 *
 * @param pid Process id from metadata.
 * @returns True when the process appears alive.
 */
function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
