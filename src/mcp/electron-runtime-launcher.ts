import { spawn } from 'node:child_process';
import { readRuntimeMetadata, type McpRuntimeMetadata } from './runtime-metadata.js';
import { startMcpStdioProxy, type McpStdioProxy } from './stdio-proxy.js';

/**
 * Return a child-process environment that forces LinkTerm MCP mode while clearing Electron's Node-mode flag.
 *
 * @returns Environment variables for the real Electron runtime child process.
 */
function buildChildEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  env.LINKTERM_MCP_STDIO = '1';
  env.LINKTERM_FORCE_DIST = '1';
  return env;
}

/**
 * Launch the real Electron runtime as a child while this wrapper itself runs in Electron's Node mode.
 *
 * @param runtimePath Electron executable or packaged LinkTerm executable.
 * @param args Arguments forwarded to the real Electron runtime.
 */
function launchElectronRuntime(runtimePath: string, args: string[]): void {
  const child = spawn(runtimePath, args, {
    env: buildChildEnv(),
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });

  if (child.stdin) process.stdin.pipe(child.stdin);
  if (child.stdout) child.stdout.pipe(process.stdout);
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
    if (typeof code === 'number') {
      process.exit(code);
    }
    process.exit(signal ? 1 : 0);
  });
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

  const metadata = await readRuntimeMetadata(metadataPath);
  if (metadata) {
    await runProxy(metadata);
    return;
  }

  launchElectronRuntime(runtimePath, forwardedArgs);
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.stack ?? err.message : String(err);
  console.error(message);
  process.exit(1);
});
