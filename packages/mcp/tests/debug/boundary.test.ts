import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const debugSurfaceFiles = [
  'packages/mcp/src/surfaces/debug/tools.ts',
  'packages/mcp/src/surfaces/debug/tools-binary.ts',
  'packages/mcp/src/surfaces/debug/error-translate.ts',
  'packages/mcp/src/surfaces/debug/binary-codec.ts',
  'packages/mcp/src/surfaces/debug/schemas.ts',
];

const forbiddenPatterns = [
  /from ['"]node:child_process['"]/,
  /from ['"]child_process['"]/,
  /segger-command-runner/,
  /jlink-adapter/,
  /JLinkExe/i,
  /JLinkGDBServer/i,
  /arm-none-eabi-gdb/i,
  /serialport/i,
  /node-pty/i,
  /run_task/,
  /create_and_run_task/,
  /vscode/i,
];

describe('debug MCP surface boundary', () => {
  it('does not import or invoke external CLI/task fallback layers', async () => {
    for (const file of debugSurfaceFiles) {
      const text = await readFile(path.resolve(file), 'utf-8');

      for (const pattern of forbiddenPatterns) {
        expect(text, `${file} must not match ${pattern}`).not.toMatch(pattern);
      }
    }
  });

  it('keeps debug execution delegated through the IJLinkBackend dependency', async () => {
    const text = await readFile(path.resolve('packages/mcp/src/surfaces/debug/tools.ts'), 'utf-8');

    expect(text).toMatch(/jlinkBackend:\s*IJLinkBackend/);
    expect(text).toMatch(/const \{ jlinkBackend \} = deps/);
    expect(text).toMatch(/jlinkBackend\./);
    expect(text).not.toMatch(/new\s+JLinkAdapter/);
  });
});
