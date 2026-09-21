import { describe, expect, it, vi } from 'vitest';
import { SessionBase } from '@linkterm/runtime/core/session/session-base';
import { SessionManager } from '@linkterm/runtime/core/session/session-manager';
import { SerialSessionCoordinator } from '@linkterm/runtime/core/session/serial-session-coordinator';
import { defaultOpenSerial } from '@linkterm/mcp/surfaces/control-profile/tools';
import type { SessionId } from '@/shared/types.js';
import { MockTransport } from '../../../tests/fixtures/mock-transport.js';

class TestSerialSession extends SessionBase {
  constructor(id: SessionId) {
    super({ id, transport: new MockTransport() });
  }
}

describe('defaultOpenSerial', () => {
  it('reuses one managed session across control-profile activations', async () => {
    const manager = new SessionManager();
    const coordinator = new SerialSessionCoordinator(manager);
    const realCreateAndOpen = manager.createAndOpen.bind(manager);
    const createAndOpen = vi.spyOn(manager, 'createAndOpen').mockImplementation((_factory, metadata) =>
      realCreateAndOpen((id) => new TestSerialSession(id), metadata),
    );
    const openSerial = defaultOpenSerial(manager, coordinator);
    const config = {
      type: 'serial' as const,
      port: 'COM7',
      baudRate: 921_600,
      mode: 'terminal' as const,
    };

    const first = await openSerial(config);
    const second = await openSerial(config);

    expect(second).toEqual({ sessionId: first.sessionId, state: 'open', reused: true });
    expect(createAndOpen).toHaveBeenCalledTimes(1);
    expect(manager.listSummaries()).toHaveLength(1);
  });

  it('returns a stable conflict before opening a second control-profile session', async () => {
    const manager = new SessionManager();
    const coordinator = new SerialSessionCoordinator(manager);
    const realCreateAndOpen = manager.createAndOpen.bind(manager);
    const createAndOpen = vi.spyOn(manager, 'createAndOpen').mockImplementation((_factory, metadata) =>
      realCreateAndOpen((id) => new TestSerialSession(id), metadata),
    );
    const openSerial = defaultOpenSerial(manager, coordinator);
    await openSerial({ type: 'serial', port: 'COM7', baudRate: 921_600, mode: 'terminal' });

    await expect(
      openSerial({ type: 'serial', port: 'COM7', baudRate: 115_200, mode: 'terminal' }),
    ).rejects.toMatchObject({ code: 'SERIAL_SESSION_CONFLICT' });
    expect(createAndOpen).toHaveBeenCalledTimes(1);
  });
});
