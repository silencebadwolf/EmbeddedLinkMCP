import { spawn, type ChildProcess } from 'node:child_process';
import type { McpRuntimeMetadata } from './runtime-metadata.js';
import { startMcpStdioProxy, type McpStdioProxy } from './stdio-proxy.js';
import {
  buildOwnerRuntimeEnv,
  waitForHealthyRuntimeMetadata,
} from './electron-runtime-launcher-core.js';

const RUNTIME_METADATA_WAIT_MS = 10_000;
const RUNTIME_METADATA_RETRY_MS = 100;

/**
 * Launch the real Electron owner runtime while this wrapper owns MCP stdio.
 *
 * @param runtimePath Electron executable or packaged LinkTerm executable.
 * @param args Arguments forwarded to the real Electron runtime.
 * @returns Spawned owner process.
 */
function launchElectronRuntime(runtimePath: string, args: string[]): ChildProcess {
  const child = spawn(runtimePath, args, {
    env: buildOwnerRuntimeEnv(),
    stdio: ['ignore', 'ignore', 'pipe'],
    windowsHide: true,
  });

  if (child.stderr) child.stderr.pipe(process.stderr);

  const terminate = (): void => {
    child.kill();
  };
  process.once('SIGINT', terminate);
  process.once('SIGTERM', terminate);

  child.once('error', (err) => {
    console.error(`Failed to launch LinkTerm MCP runtime: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });

  child.once('exit', (code, signal) => {
    process.off('SIGINT', terminate);
    process.off('SIGTERM', terminate);
    if (code !== 0) {
      process.exit(typeof code === 'number' ? code : signal ? 1 : 0);
    }
  });

  return child;
}

/**
 * Attach stdio directly to an already running LinkTerm HTTP runtime.
 *
 * @param metadata Runtime endpoint metadata written by the owner Electron process.
 */
async function runProxy(metadata: McpRuntimeMetadata): Promise<void> {
  const proxy = await startMcpStdioProxy(metadata);
  installProxyShutdownHooks(proxy);
}

/**
 * Install process shutdown hooks for the direct Node-mode stdio proxy.
 *
 * @param proxy Proxy handle to stop on stdin close or process termination.
 */
function installProxyShutdownHooks(proxy: McpStdioProxy): void {
  let stopping = false;
  const stopAndExit = (): void => {
    if (stopping) return;
    stopping = true;
    void proxy.stop().finally(() => process.exit(0));
  };
  process.stdin.once('end', stopAndExit);
  process.stdin.once('close', stopAndExit);
  process.stdin.once('error', stopAndExit);
  process.once('SIGINT', stopAndExit);
  process.once('SIGTERM', stopAndExit);
}

/** Start the launcher in App-first proxy mode when possible, otherwise spawn a headless owner runtime. */
async function main(): Promise<void> {
  const [, , metadataPath, runtimePath, ...forwardedArgs] = process.argv;

  if (!metadataPath || !runtimePath) {
    console.error('Missing LinkTerm metadata path or runtime path for MCP launcher.');
    process.exit(1);
  }

  const existing = await waitForHealthyRuntimeMetadata({
    metadataPath,
    timeoutMs: 0,
    retryMs: RUNTIME_METADATA_RETRY_MS,
  });
  if (existing) {
    await runProxy(existing);
    return;
  }

  launchElectronRuntime(runtimePath, forwardedArgs);
  const metadata = await waitForHealthyRuntimeMetadata({
    metadataPath,
    timeoutMs: RUNTIME_METADATA_WAIT_MS,
    retryMs: RUNTIME_METADATA_RETRY_MS,
  });
  if (!metadata) {
    throw new Error('LinkTerm MCP runtime metadata is unavailable or unhealthy after owner startup.');
  }
  await runProxy(metadata);
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.stack ?? err.message : String(err);
  console.error(message);
  process.exit(1);
});
