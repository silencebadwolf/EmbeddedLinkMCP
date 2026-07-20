import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { handlers, ipcMainMock } = vi.hoisted(() => {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  return {
    handlers,
    ipcMainMock: {
      handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
        handlers.set(channel, handler);
      }),
      removeHandler: vi.fn((channel: string) => {
        handlers.delete(channel);
      }),
    },
  };
});

const electronMock = { app: {}, ipcMain: ipcMainMock };
globalThis.__linktermElectronMock = electronMock;

vi.mock('electron', () => ({ default: electronMock, ...electronMock }));

import {
  ConnectionProfileManager,
  type SecretCodec,
} from '../../../../src/core/connections/index.js';
import { SessionManager } from '../../../../src/core/session/session-manager.js';
import { SerialSessionCoordinator } from '../../../../src/core/session/serial-session-coordinator.js';
import { SessionBase } from '../../../../src/core/session/session-base.js';
import { ControlProfileManager } from '../../../../src/core/workspace/control-profile-manager.js';
import type { registerConnectionProfilesIpc as RegisterConnectionProfilesIpc } from '../../../../src/main/ipc/connection-profiles-ipc.js';
import { IPC_CHANNELS } from '../../../../src/shared/ipc-protocol.js';
import { FakeJLinkBackend } from '../../../fixtures/fake-jlink-backend.js';
import { MockTransport } from '../../../fixtures/mock-transport.js';
import type { SessionId } from '../../../../src/shared/types.js';

class TestSerialSession extends SessionBase {
  constructor(id: SessionId) {
    super({ id, transport: new MockTransport() });
  }
}

class ReversibleCodec implements SecretCodec {
  isAvailable(): boolean {
    return true;
  }

  encryptUtf8(value: string): string {
    return Buffer.from(value, 'utf-8').toString('base64');
  }

  decryptUtf8(value: string): string {
    return Buffer.from(value, 'base64').toString('utf-8');
  }
}

let registerConnectionProfilesIpc: typeof RegisterConnectionProfilesIpc;

describe('registerConnectionProfilesIpc', () => {
  beforeEach(async () => {
    ({ registerConnectionProfilesIpc } = await import(
      '../../../../src/main/ipc/connection-profiles-ipc.js'
    ));
    handlers.clear();
    ipcMainMock.handle.mockClear();
    ipcMainMock.removeHandler.mockClear();
  });

  it('saves and opens RTT log profiles through the RTT open path', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'lt-rtt-saved-ipc-'));
    const connectionsPath = path.join(root, 'connections.json');
    try {
      const sessionManager = new SessionManager();
      const profileManager = new ConnectionProfileManager({
        filePath: connectionsPath,
        secretCodec: new ReversibleCodec(),
      });
      const controlProfileManager = new ControlProfileManager();
      await controlProfileManager.init(root, {
        jlink: { enabled: true, target: 'AT32F435RGT7', interface: 'swd', speedKHz: 4000 },
        rtt: { enabled: true, channels: [0], controlBlockAddress: '0x24005310' },
      });
      const backend = new FakeJLinkBackend();
      registerConnectionProfilesIpc(
        sessionManager,
        profileManager,
        backend,
        controlProfileManager,
      );
      const saveAndOpen = handlers.get(IPC_CHANNELS.CONNECTIONS_SAVE_AND_OPEN)!;

      const result = await saveAndOpen(undefined, {
        label: 'FNA1000 RTT',
        config: {
          type: 'rtt-log',
          root,
          channelIndex: 0,
        },
      });

      expect(result).toMatchObject({
        success: true,
        data: {
          profile: {
            label: 'FNA1000 RTT',
            type: 'rtt-log',
            config: { type: 'rtt-log', root, channelIndex: 0 },
          },
          state: 'open',
          rttLog: { probeId: expect.any(String), channelIndex: 0 },
        },
      });
      expect(sessionManager.listSummaries()).toEqual([
        expect.objectContaining({
          connectionType: 'rtt-log',
          label: 'FNA1000 RTT',
          rttLog: { probeId: expect.any(String), channelIndex: 0 },
        }),
      ]);
      expect(backend.callsOf('probeConnect')).toHaveLength(1);
      expect(backend.callsOf('gdbServerStart')).toHaveLength(1);
      expect(backend.callsOf('rttConnect')).toEqual([
        {
          method: 'rttConnect',
          args: [expect.any(String), { controlBlockAddress: 0x24005310 }],
        },
      ]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('reopens saved RTT log profiles through the RTT open path', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'lt-rtt-saved-open-ipc-'));
    const connectionsPath = path.join(root, 'connections.json');
    try {
      const sessionManager = new SessionManager();
      const profileManager = new ConnectionProfileManager({
        filePath: connectionsPath,
        secretCodec: new ReversibleCodec(),
      });
      const controlProfileManager = new ControlProfileManager();
      await controlProfileManager.init(root, {
        jlink: { enabled: true, target: 'AT32F435RGT7', interface: 'swd', speedKHz: 4000 },
        rtt: { enabled: true, channels: [0] },
      });
      const saved = await profileManager.save({
        label: 'Saved RTT',
        config: { type: 'rtt-log', root, channelIndex: 0 },
      });
      const backend = new FakeJLinkBackend();
      registerConnectionProfilesIpc(
        sessionManager,
        profileManager,
        backend,
        controlProfileManager,
      );
      const open = handlers.get(IPC_CHANNELS.CONNECTIONS_OPEN)!;

      const result = await open(undefined, { profileId: saved.id });

      expect(result).toMatchObject({
        success: true,
        data: {
          profile: { id: saved.id, type: 'rtt-log' },
          state: 'open',
          rttLog: { probeId: expect.any(String), channelIndex: 0 },
        },
      });
      expect(backend.callsOf('probeConnect')).toHaveLength(1);
      expect(backend.callsOf('gdbServerStart')).toHaveLength(1);
      expect(backend.callsOf('rttConnect')).toHaveLength(1);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('reuses an AI-opened serial session when the user opens a saved connection', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'lt-serial-saved-open-ipc-'));
    try {
      const sessionManager = new SessionManager();
      const coordinator = new SerialSessionCoordinator(sessionManager);
      const profileManager = new ConnectionProfileManager({
        filePath: path.join(root, 'connections.json'),
        secretCodec: new ReversibleCodec(),
      });
      const serialConfig = {
        type: 'serial' as const,
        port: 'COM7',
        baudRate: 115_200,
        mode: 'terminal' as const,
      };
      const saved = await profileManager.save({ label: 'Saved COM7', config: serialConfig });
      const aiOpened = await coordinator.openOrReuse(serialConfig, async () => {
        const session = await sessionManager.createAndOpen(
          (id) => new TestSerialSession(id),
          {
            connectionType: 'serial',
            createdBy: 'ai',
            serial: { port: 'COM7', baudRate: 115_200, mode: 'terminal' },
          },
        );
        return { sessionId: session.id, state: session.state };
      });
      registerConnectionProfilesIpc(
        sessionManager,
        profileManager,
        undefined,
        undefined,
        undefined,
        undefined,
        coordinator,
      );
      const open = handlers.get(IPC_CHANNELS.CONNECTIONS_OPEN)!;

      const result = await open(undefined, { profileId: saved.id });

      expect(result).toMatchObject({
        success: true,
        data: { sessionId: aiOpened.sessionId, state: 'open' },
      });
      expect(sessionManager.listSummaries()).toHaveLength(1);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
