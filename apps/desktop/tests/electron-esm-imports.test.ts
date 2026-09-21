import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const ELECTRON_SOURCE_FILES = [
  'apps/desktop/src/main/app-lifecycle.ts',
  'apps/desktop/src/main/index.ts',
  'apps/desktop/src/preload/index.ts',
  'apps/desktop/src/main/connections/safe-storage-secret-codec.ts',
  'apps/desktop/src/main/ipc/agent-integrations-ipc.ts',
  'apps/desktop/src/main/ipc/connection-profiles-ipc.ts',
  'apps/desktop/src/main/ipc/control-profile-ipc.ts',
  'apps/desktop/src/main/ipc/index.ts',
  'apps/desktop/src/main/ipc/rtt-log-session-ipc.ts',
  'apps/desktop/src/main/ipc/serial-ipc.ts',
  'apps/desktop/src/main/ipc/session-create-handler.ts',
  'apps/desktop/src/main/ipc/session-ipc.ts',
] as const;

describe('Electron ESM imports', () => {
  it('uses the local Electron runtime resolver instead of bare runtime imports', async () => {
    const violations: string[] = [];
    for (const filePath of ELECTRON_SOURCE_FILES) {
      const source = await readFile(path.resolve(filePath), 'utf-8');
      const hasBareRuntimeImport =
        /^import\s+(?!type\b).*\s+from\s+['"]electron['"]/mu.test(source);
      if (hasBareRuntimeImport) {
        violations.push(filePath);
      }
    }

    expect(violations).toEqual([]);
  });
});
