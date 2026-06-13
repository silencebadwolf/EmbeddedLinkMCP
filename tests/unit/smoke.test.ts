import { describe, it, expect } from 'vitest';
import { APP_NAME } from '@/shared/constants.js';
import { IPC_CHANNELS } from '@/shared/ipc-protocol.js';

describe('Phase 0 Smoke Test', () => {
  it('exports correct app name', () => {
    expect(APP_NAME).toBe('LinkTerm v2');
  });

  it('exports IPC channel names', () => {
    expect(IPC_CHANNELS.SESSION_CREATE).toBe('session:create');
    expect(IPC_CHANNELS.SERIAL_LIST_PORTS).toBe('serial:listPorts');
    expect(IPC_CHANNELS.UI_SCREENSHOT).toBe('ui:screenshot');
  });

  it('shared types compile correctly', async () => {
    const types = await import('../../src/shared/types.js');
    expect(types).toBeDefined();
  });
});
