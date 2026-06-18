import type { McpRuntimeMetadata } from './runtime-metadata.js';
import { readRuntimeMetadata } from './runtime-metadata.js';

export interface WaitForHealthyRuntimeMetadataOptions {
  metadataPath: string;
  timeoutMs: number;
  retryMs: number;
  readMetadata?: (metadataPath: string) => Promise<McpRuntimeMetadata | null>;
  checkHealth?: (metadata: McpRuntimeMetadata) => Promise<boolean>;
  delay?: (ms: number) => Promise<void>;
  now?: () => number;
}

/**
 * Build the child-process environment for an Electron owner runtime.
 *
 * @param env Parent process environment.
 * @returns Environment for the owner runtime; stdio MCP mode is deliberately cleared.
 */
export function buildOwnerRuntimeEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const next = { ...env };
  delete next.ELECTRON_RUN_AS_NODE;
  delete next.LINKTERM_MCP_STDIO;
  next.LINKTERM_FORCE_DIST = '1';
  return next;
}

/**
 * Poll runtime metadata until its HTTP endpoint is healthy.
 *
 * @param options Metadata readers, health checker, and polling timing.
 * @returns Fresh metadata, or null if no healthy owner appears before timeout.
 */
export async function waitForHealthyRuntimeMetadata(
  options: WaitForHealthyRuntimeMetadataOptions,
): Promise<McpRuntimeMetadata | null> {
  const readMetadata = options.readMetadata ?? readRuntimeMetadata;
  const checkHealth = options.checkHealth ?? defaultCheckHealth;
  const delay = options.delay ?? defaultDelay;
  const now = options.now ?? Date.now;
  const deadline = now() + options.timeoutMs;

  do {
    const metadata = await readMetadata(options.metadataPath);
    if (metadata !== null && await checkHealth(metadata)) return metadata;
    if (now() >= deadline) break;
    await delay(options.retryMs);
  } while (true);

  return null;
}

/**
 * Check the LinkTerm HTTP runtime health endpoint.
 *
 * @param metadata Runtime metadata containing the MCP endpoint URL.
 * @returns True when `/health` reports a successful owner runtime.
 */
export async function defaultCheckHealth(metadata: McpRuntimeMetadata): Promise<boolean> {
  try {
    const url = new URL(metadata.url);
    url.pathname = '/health';
    url.search = '';
    const res = await fetch(url, {
      headers: { authorization: `Bearer ${metadata.token}` },
    });
    if (!res.ok) return false;
    const payload = await res.json() as { success?: unknown };
    return payload.success === true;
  } catch {
    return false;
  }
}

function defaultDelay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
