/** RTT log session IPC handler tests. */

import { describe, expect, it, vi, beforeEach } from 'vitest';

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

import { SessionManager } from '../../../../src/core/session/session-manager.js';
import { ControlProfileManager } from '../../../../src/core/workspace/control-profile-manager.js';
import type { registerRttLogSessionIpc as RegisterRttLogSessionIpc } from '../../../../src/main/ipc/rtt-log-session-ipc.js';
import { IPC_CHANNELS } from '../../../../src/shared/ipc-protocol.js';
import { FakeJLinkBackend } from '../../../fixtures/fake-jlink-backend.js';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

let registerRttLogSessionIpc: typeof RegisterRttLogSessionIpc;

describe('registerRttLogSessionIpc', () => {
  beforeEach(async () => {
    ({ registerRttLogSessionIpc } = await import('../../../../src/main/ipc/rtt-log-session-ipc.js'));
    handlers.clear();
    ipcMainMock.handle.mockClear();
    ipcMainMock.removeHandler.mockClear();
  });

  it('registers rttLog:open channel', () => {
    registerRttLogSessionIpc(new SessionManager(), new FakeJLinkBackend());
    expect(ipcMainMock.handle).toHaveBeenCalledWith(
      IPC_CHANNELS.RTT_LOG_OPEN,
      expect.any(Function),
    );
  });

  it('opens an RTT log session and exposes it through session summaries', async () => {
    const sessionManager = new SessionManager();
    const backend = new FakeJLinkBackend();
    const probe = await backend.probeConnect({ target: 'AT32F435VGT7' });
    registerRttLogSessionIpc(sessionManager, backend);
    const handler = handlers.get(IPC_CHANNELS.RTT_LOG_OPEN)!;

    const result = await handler(undefined, {
      probeId: probe.probeId,
      channelIndex: 0,
      pollIntervalMs: 50,
      maxBytesPerRead: 32,
      label: 'RTT channel 0',
    });

    expect(result).toMatchObject({
      success: true,
      data: {
        state: 'open',
        reused: false,
      },
    });
    expect(sessionManager.listSummaries()).toEqual([
      expect.objectContaining({
        connectionType: 'rtt-log',
        label: 'RTT channel 0',
        rttLog: { probeId: probe.probeId, channelIndex: 0 },
      }),
    ]);
  });

  it('auto-connects J-Link and opens RTT log from a workspace control profile', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'lt-rtt-ipc-'));
    try {
      const sessionManager = new SessionManager();
      const backend = new FakeJLinkBackend();
      const controlProfileManager = new ControlProfileManager();
      await controlProfileManager.init(root, {
        jlink: { enabled: true, target: 'AT32F435RGT7', interface: 'swd', speedKHz: 4000 },
        rtt: { enabled: true, channels: [0], controlBlockAddress: '0x24005310' },
      } as Parameters<ControlProfileManager['init']>[1]);
      registerRttLogSessionIpc(sessionManager, backend, controlProfileManager);
      const handler = handlers.get(IPC_CHANNELS.RTT_LOG_OPEN)!;

      const result = await handler(undefined, {
        root,
        label: 'RTT auto',
      });

      expect(result).toMatchObject({
        success: true,
        data: {
          state: 'open',
          reused: false,
          channelIndex: 0,
        },
      });
      const probeConnect = backend.callsOf('probeConnect');
      expect(probeConnect).toEqual([
        {
          method: 'probeConnect',
          args: [{ target: 'AT32F435RGT7', interface: 'swd', speedKHz: 4000 }],
        },
      ]);
      expect(backend.callsOf('gdbServerStart')).toHaveLength(1);
      const rttConnect = backend.callsOf('rttConnect');
      expect(rttConnect).toEqual([
        {
          method: 'rttConnect',
          args: [expect.any(String), { controlBlockAddress: 0x24005310 }],
        },
      ]);
      const methods = backend.calls.map((call) => call.method);
      expect(methods.indexOf('gdbServerStart')).toBeGreaterThan(methods.indexOf('probeConnect'));
      expect(methods.indexOf('rttConnect')).toBeGreaterThan(methods.indexOf('gdbServerStart'));
      const summary = sessionManager.listSummaries()[0];
      expect(summary).toEqual(expect.objectContaining({
        connectionType: 'rtt-log',
        label: 'RTT auto',
        rttLog: { probeId: expect.any(String), channelIndex: 0 },
      }));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('continues RTT auto-open when profile target is absent from XML catalog', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'lt-rtt-ipc-catalog-'));
    try {
      const sessionManager = new SessionManager();
      const backend = new FakeJLinkBackend();
      const controlProfileManager = new ControlProfileManager();
      const catalog = {
        search: vi.fn(async () => ({ available: true, sourceFiles: ['JLinkDevices.xml'], devices: [] })),
        get: vi.fn(async () => undefined),
        has: vi.fn(async () => false),
        refresh: vi.fn(async () => undefined),
      };
      registerRttLogSessionIpc(sessionManager, backend, controlProfileManager, catalog);
      await controlProfileManager.init(root, {
        jlink: { enabled: true, target: 'STM32H743IIT6', interface: 'swd', speedKHz: 4000 },
        rtt: { enabled: true },
      }, { force: true });

      const handler = handlers.get(IPC_CHANNELS.RTT_LOG_OPEN)!;
      const result = await handler({}, { root }) as { success: boolean; data?: { channelIndex: number } };

      expect(result.success).toBe(true);
      expect(result.data?.channelIndex).toBe(0);
      expect(backend.callsOf('probeConnect')).toEqual([
        {
          method: 'probeConnect',
          args: [{ target: 'STM32H743II', interface: 'swd', speedKHz: 4000 }],
        },
      ]);
      expect(backend.callsOf('gdbServerStart')).toHaveLength(1);
      expect(backend.callsOf('rttConnect')).toHaveLength(1);
      const methods = backend.calls.map((call) => call.method);
      expect(methods.indexOf('gdbServerStart')).toBeGreaterThan(methods.indexOf('probeConnect'));
      expect(methods.indexOf('rttConnect')).toBeGreaterThan(methods.indexOf('gdbServerStart'));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('rejects RTT log open input that includes both probeId and root', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'lt-rtt-ipc-mutual-'));
    try {
      const sessionManager = new SessionManager();
      const backend = new FakeJLinkBackend();
      const controlProfileManager = new ControlProfileManager();
      await controlProfileManager.init(root, {
        jlink: { enabled: true, target: 'AT32F435RGT7', interface: 'swd', speedKHz: 4000 },
        rtt: { enabled: true },
      } as Parameters<ControlProfileManager['init']>[1]);
      registerRttLogSessionIpc(sessionManager, backend, controlProfileManager);
      const handler = handlers.get(IPC_CHANNELS.RTT_LOG_OPEN)!;

      const result = await handler(undefined, {
        probeId: 'probe-existing',
        root,
        channelIndex: 0,
      });

      expect(result).toMatchObject({
        success: false,
        error: {
          code: 'INVALID_ARGUMENT',
        },
      });
      expect(backend.callsOf('probeConnect')).toEqual([]);
      expect(backend.callsOf('rttConnect')).toEqual([]);
      expect(sessionManager.listSummaries()).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('returns a structured failure for invalid RTT log open input', async () => {
    const sessionManager = new SessionManager();
    const backend = new FakeJLinkBackend();
    registerRttLogSessionIpc(sessionManager, backend);
    const handler = handlers.get(IPC_CHANNELS.RTT_LOG_OPEN)!;

    const result = await handler(undefined, {
      probeId: '',
      channelIndex: -1,
    });

    expect(result).toMatchObject({
      success: false,
      error: {
        code: 'INVALID_ARGUMENT',
      },
    });
    expect(sessionManager.listSummaries()).toEqual([]);
  });

  it('returns a structured failure when backend RTT readiness is missing', async () => {
    const sessionManager = new SessionManager();
    const backend = new FakeJLinkBackend();
    registerRttLogSessionIpc(sessionManager, backend);
    const handler = handlers.get(IPC_CHANNELS.RTT_LOG_OPEN)!;

    const result = await handler(undefined, {
      probeId: 'missing-probe',
      channelIndex: 0,
    });

    expect(result).toMatchObject({
      success: false,
      error: {
        code: 'PROBE_NOT_FOUND',
      },
    });
    expect(sessionManager.listSummaries()).toEqual([]);
  });

  it('unregisters rttLog:open channel', () => {
    const dispose = registerRttLogSessionIpc(new SessionManager(), new FakeJLinkBackend());
    dispose();
    expect(ipcMainMock.removeHandler).toHaveBeenCalledWith(IPC_CHANNELS.RTT_LOG_OPEN);
  });
});
