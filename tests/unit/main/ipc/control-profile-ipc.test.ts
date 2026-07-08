/** Control profile IPC handler tests. */

import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cortexMVectorImage, elf32LeImage } from '../../../fixtures/elf.js';
import { intelHexRecord, intelHexText } from '../../../fixtures/intel-hex.js';

const {
  handlers,
  ipcMainMock,
  showOpenDialogMock,
  execFileMock,
  execFileAsyncMock,
  readFileMock,
  readdirMock,
} = vi.hoisted(() => {
  const map = new Map<string, (event: unknown, payload: unknown) => unknown>();
  const execFile = vi.fn();
  const execFileAsync = vi.fn();
  (execFile as unknown as Record<symbol, unknown>)[Symbol.for('nodejs.util.promisify.custom')] =
    execFileAsync;
  return {
    handlers: map,
    ipcMainMock: {
      handle: vi.fn((channel: string, fn: (event: unknown, payload: unknown) => unknown) => {
        map.set(channel, fn);
      }),
      removeHandler: vi.fn((channel: string) => {
        map.delete(channel);
      }),
    },
    showOpenDialogMock: vi.fn(),
    execFileMock: execFile,
    execFileAsyncMock: execFileAsync,
    readFileMock: vi.fn(),
    readdirMock: vi.fn(),
  };
});

const electronMock = {
  app: {},
  ipcMain: ipcMainMock,
  dialog: { showOpenDialog: showOpenDialogMock },
};
globalThis.__linktermElectronMock = electronMock;

vi.mock('electron', () => ({ default: electronMock, ...electronMock }));
vi.mock('node:child_process', () => ({ execFile: execFileMock }));
vi.mock('node:fs/promises', () => ({ readFile: readFileMock, readdir: readdirMock }));

import { IPC_CHANNELS } from '../../../../src/shared/ipc-protocol.js';
import type {
  ControlProfileManager,
  ControlProfileRecordManager,
} from '../../../../src/core/workspace/index.js';
import type { registerControlProfileIpc as RegisterControlProfileIpc } from '../../../../src/main/ipc/control-profile-ipc.js';

let registerControlProfileIpc: typeof RegisterControlProfileIpc;
const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');

function setPlatform(value: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', {
    value,
    configurable: true,
  });
}

function installWslExecFileMock(): void {
  execFileAsyncMock.mockImplementation(async (_file: string, args: string[]) => {
    if (args[0] === '--list') {
      return {
        stdout:
          'U\u0000b\u0000u\u0000n\u0000t\u0000u\u0000-\u00002\u00004\u0000.\u00000\u00004\u0000\r\u0000\n\u0000',
        stderr: '',
      };
    }
    return { stdout: 'jianyin\n/home/jianyin\n', stderr: '' };
  });
}

describe('registerControlProfileIpc', () => {
  beforeEach(async () => {
    vi.resetModules();
    ({ registerControlProfileIpc } =
      await import('../../../../src/main/ipc/control-profile-ipc.js'));
    setPlatform('win32');
    handlers.clear();
    ipcMainMock.handle.mockClear();
    ipcMainMock.removeHandler.mockClear();
    showOpenDialogMock.mockReset();
    showOpenDialogMock.mockResolvedValue({ canceled: true, filePaths: [] });
    execFileMock.mockReset();
    execFileAsyncMock.mockReset();
    readFileMock.mockReset();
    readdirMock.mockReset();
    installWslExecFileMock();
  });

  afterAll(() => {
    if (originalPlatform) {
      Object.defineProperty(process, 'platform', originalPlatform);
    }
  });

  it('opens the workspace directory picker at the discovered WSL home on Windows', async () => {
    registerControlProfileIpc({} as ControlProfileManager);

    const handler = handlers.get(IPC_CHANNELS.CONTROL_PROFILE_PICK_WORKSPACE_ROOT)!;
    const result = await handler({}, undefined);

    expect(result).toEqual({ success: true, data: { root: null } });
    expect(showOpenDialogMock).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Select workspace folder',
        properties: ['openDirectory'],
        defaultPath: '\\\\wsl.localhost\\Ubuntu-24.04\\home\\jianyin',
      }),
    );
  });

  it('opens the workspace directory picker without a default path when WSL is unavailable', async () => {
    execFileAsyncMock.mockRejectedValueOnce(new Error('wsl.exe not found'));
    readdirMock.mockRejectedValue(new Error('share unavailable'));
    registerControlProfileIpc({} as ControlProfileManager);

    const handler = handlers.get(IPC_CHANNELS.CONTROL_PROFILE_PICK_WORKSPACE_ROOT)!;
    const result = await handler({}, undefined);

    expect(result).toEqual({ success: true, data: { root: null } });
    expect(showOpenDialogMock).toHaveBeenCalledWith({
      title: 'Select workspace folder',
      properties: ['openDirectory'],
    });
  });

  it('detects the lowest Intel HEX address when picking firmware', async () => {
    const hexPath = 'C:/repo/build/app.hex';
    showOpenDialogMock.mockResolvedValueOnce({ canceled: false, filePaths: [hexPath] });
    readFileMock.mockResolvedValueOnce(
      intelHexText([
        intelHexRecord(0, 0x04, [0x08, 0x00]),
        intelHexRecord(0x8000, 0x00, [0x00, 0x20, 0x00, 0x20]),
        intelHexRecord(0, 0x01, []),
      ]),
    );
    registerControlProfileIpc({} as ControlProfileManager);

    const handler = handlers.get(IPC_CHANNELS.CONTROL_PROFILE_PICK_FIRMWARE_FILE)!;
    const result = await handler({}, undefined);

    expect(result).toEqual({
      success: true,
      data: { path: hexPath, baseAddress: '0x08008000' },
    });
  });

  it('detects the lowest ELF load address when picking firmware', async () => {
    const elfPath = 'C:/repo/build/app.elf';
    showOpenDialogMock.mockResolvedValueOnce({ canceled: false, filePaths: [elfPath] });
    readFileMock.mockResolvedValueOnce(
      elf32LeImage([{ paddr: 0x08008000, data: cortexMVectorImage(0x08008000) }]),
    );
    registerControlProfileIpc({} as ControlProfileManager);

    const handler = handlers.get(IPC_CHANNELS.CONTROL_PROFILE_PICK_FIRMWARE_FILE)!;
    const result = await handler({}, undefined);

    expect(result).toEqual({
      success: true,
      data: { path: elfPath, baseAddress: '0x08008000' },
    });
  });

  it('records manual saves and opens saved control profile records', async () => {
    const savedProfile = {
      schemaVersion: 'linkterm-control/1.0.0' as const,
      serial: { enabled: true, port: 'COM7', baudRate: 115200, mode: 'terminal' as const },
      jlink: {
        enabled: true,
        target: 'STM32H743II',
        interface: 'swd' as const,
        speedKHz: 'auto' as const,
      },
      flash: { binary: 'build/app.bin', baseAddress: '0x08000000', verify: true },
    };
    const profileBody = {
      serial: savedProfile.serial,
      jlink: savedProfile.jlink,
      flash: savedProfile.flash,
    };
    const record = {
      id: 'ctrl_1',
      label: 'repo - STM32H743II',
      root: 'C:/repo',
      source: 'manual' as const,
      profile: savedProfile,
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
    };
    const manager = {
      init: vi.fn(async () => savedProfile),
      load: vi.fn(async () => savedProfile),
    } as unknown as ControlProfileManager;
    const recordManager = {
      save: vi.fn(async () => record),
      list: vi.fn(async () => [record]),
      get: vi.fn(async () => record),
      delete: vi.fn(async () => undefined),
    } as unknown as ControlProfileRecordManager;
    registerControlProfileIpc(manager, recordManager);

    const save = handlers.get(IPC_CHANNELS.CONTROL_PROFILE_SAVE)!;
    const saveResult = await save({}, { root: 'C:/repo', profile: profileBody });
    expect(saveResult).toEqual({
      success: true,
      data: {
        path: expect.stringMatching(/control-profile\.json$/u),
        profile: savedProfile,
        record,
      },
    });
    expect(recordManager.save).toHaveBeenCalledWith({
      root: 'C:/repo',
      source: 'manual',
      profile: savedProfile,
    });

    const list = handlers.get(IPC_CHANNELS.CONTROL_PROFILE_RECORDS_LIST)!;
    await expect(list({}, undefined)).resolves.toEqual({ success: true, data: [record] });

    const open = handlers.get(IPC_CHANNELS.CONTROL_PROFILE_RECORDS_OPEN)!;
    await expect(open({}, { recordId: 'ctrl_1' })).resolves.toEqual({
      success: true,
      data: {
        path: expect.stringMatching(/control-profile\.json$/u),
        record,
      },
    });
    expect(manager.init).toHaveBeenLastCalledWith('C:/repo', profileBody, { force: true });
  });

  it('starts a background download job and exposes live status over IPC', async () => {
    const summary = {
      serialOpened: false,
      probeConnected: true,
      gdbServerStarted: false,
      flashed: false,
      verified: false,
      reset: false,
      serialObserved: false,
      rttObserved: false,
      debugCaptured: false,
    };
    const runningStep = {
      id: 'flash_download',
      status: 'running' as const,
      durationMs: 0,
      evidence: {
        progress: {
          phase: 'programming',
          message: 'Programming flash',
          percent: 42,
          bytesWritten: 1720,
          bytesTotal: 4096,
        },
      },
    };
    const workflow = {
      mode: 'flash-observe' as const,
      root: 'C:/repo',
      steps: [runningStep],
      summary,
      nextActions: [],
    };
    const job = {
      jobId: 'job-download-1',
      state: 'running' as const,
      mode: 'flash-observe' as const,
      root: 'C:/repo',
      createdAt: 1,
      startedAt: 1,
      updatedAt: 2,
      currentStepId: 'flash_download',
      cancelRequested: false,
      workflow,
    };
    const jobManager = {
      create: vi.fn(() => job),
      start: vi.fn(async () => job),
      getStatus: vi.fn(() => job),
      read: vi.fn(() => job),
    };

    registerControlProfileIpc({} as ControlProfileManager, undefined, {
      sessionManager: {},
      jlinkBackend: {},
      controlWorkflowJobManager: jobManager,
    } as never);

    const start = handlers.get((IPC_CHANNELS as Record<string, string>).CONTROL_PROFILE_START_DOWNLOAD)!;
    const started = await start({}, { root: 'C:/repo' });

    expect(started).toEqual({
      success: true,
      data: expect.objectContaining({
        jobId: 'job-download-1',
        state: 'running',
        currentStep: runningStep,
        workflow,
      }),
    });
    expect(jobManager.create).toHaveBeenCalledWith({
      input: expect.objectContaining({
        root: 'C:/repo',
        mode: 'flash-observe',
        confirm: true,
        observe: { enabled: false, serial: false },
      }),
    });
    expect(jobManager.start).toHaveBeenCalledWith('job-download-1', expect.any(Function));

    const status = handlers.get((IPC_CHANNELS as Record<string, string>).CONTROL_PROFILE_DOWNLOAD_STATUS)!;
    await expect(status({}, { jobId: 'job-download-1' })).resolves.toEqual({
      success: true,
      data: expect.objectContaining({
        jobId: 'job-download-1',
        currentStep: runningStep,
        workflow,
      }),
    });

    const read = handlers.get((IPC_CHANNELS as Record<string, string>).CONTROL_PROFILE_DOWNLOAD_READ)!;
    await expect(read({}, { jobId: 'job-download-1' })).resolves.toEqual({
      success: true,
      data: expect.objectContaining({ workflow }),
    });
  });
});
