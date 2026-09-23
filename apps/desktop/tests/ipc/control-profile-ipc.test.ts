/** Control profile IPC handler tests. */

import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cortexMVectorImage, elf32LeImage } from '../../../../tests/fixtures/elf.js';
import { intelHexRecord, intelHexText } from '../../../../tests/fixtures/intel-hex.js';

const {
  handlers,
  ipcMainMock,
  showOpenDialogMock,
  execFileMock,
  execFileAsyncMock,
  readFileMock,
  readdirMock,
  runControlWorkflowMock,
  readCurrentDeploymentEvidenceMock,
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
    runControlWorkflowMock: vi.fn(),
    readCurrentDeploymentEvidenceMock: vi.fn(),
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
vi.mock('@linkterm/runtime/core/control-workflow/workflow-runner', () => ({
  runControlWorkflow: runControlWorkflowMock,
}));
vi.mock('@linkterm/runtime/services/current-deployment-evidence', () => ({
  readCurrentControlProfileDeploymentEvidence: readCurrentDeploymentEvidenceMock,
}));

import { IPC_CHANNELS } from '../../src/ipc/channels.js';
import type {
  ControlProfileManager,
  ControlProfileRecordManager,
} from '@linkterm/runtime/core/workspace/index';
import { OperationAdmissionCoordinator } from '@linkterm/runtime/core/operation-admission/operation-admission-coordinator';
import type { registerControlProfileIpc as RegisterControlProfileIpc } from '../../src/main/ipc/control-profile-ipc.js';

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
      await import('../../src/main/ipc/control-profile-ipc.js'));
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
    runControlWorkflowMock.mockReset();
    readCurrentDeploymentEvidenceMock.mockReset();
    runControlWorkflowMock.mockResolvedValue({
      mode: 'flash-observe',
      root: 'C:/repo',
      steps: [],
      summary: {
        serialOpened: false,
        probeConnected: false,
        gdbServerStarted: false,
        flashed: false,
        verified: false,
        reset: false,
        serialObserved: false,
        rttObserved: false,
        debugCaptured: false,
      },
      nextActions: [],
    });
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

  it('records manual saves and opens saved records from the workspace file without rewriting it', async () => {
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
    const workspaceProfile = {
      ...savedProfile,
      serial: { ...savedProfile.serial, port: 'COM10' },
      flash: { ...savedProfile.flash, binary: 'build/current.elf' },
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
    const init = vi.fn(async () => savedProfile);
    const load = vi.fn(async () => workspaceProfile);
    const manager = { init, load } as unknown as ControlProfileManager;
    const recordManager = {
      save: vi.fn(async () => record),
      list: vi.fn(async () => [record]),
      get: vi.fn(async () => record),
      delete: vi.fn(async () => undefined),
    } as unknown as ControlProfileRecordManager;
    registerControlProfileIpc(manager, recordManager, {
      serialDiscovery: {
        listPorts: async () => [
          {
            path: 'COM7',
            vendorId: '1366',
            productId: '0105',
            serialNumber: '123456789',
          },
        ],
      },
    });

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
    expect(init).toHaveBeenCalledWith(
      'C:/repo',
      expect.objectContaining({
        serial: expect.objectContaining({
          hardwareIdentity: expect.stringMatching(/^sha256:[a-f0-9]{64}$/u),
          parentIdentity: expect.stringMatching(/^sha256:[a-f0-9]{64}$/u),
        }),
      }),
      { force: true },
    );

    recordManager.save.mockClear();
    await expect(
      save(
        {},
        {
          root: 'C:/repo',
          profile: profileBody,
          recordId: record.id,
          expectedUpdatedAt: record.updatedAt,
        },
      ),
    ).resolves.toMatchObject({ success: true, data: { record } });
    expect(recordManager.save).toHaveBeenCalledWith({
      root: 'C:/repo',
      source: 'manual',
      profile: savedProfile,
      recordId: record.id,
      expectedUpdatedAt: record.updatedAt,
    });

    const list = handlers.get(IPC_CHANNELS.CONTROL_PROFILE_RECORDS_LIST)!;
    await expect(list({}, undefined)).resolves.toEqual({ success: true, data: [record] });

    init.mockClear();
    load.mockClear();
    recordManager.save.mockClear();
    const open = handlers.get(IPC_CHANNELS.CONTROL_PROFILE_RECORDS_OPEN)!;
    await expect(open({}, { recordId: 'ctrl_1' })).resolves.toEqual({
      success: true,
      data: {
        path: expect.stringMatching(/control-profile\.json$/u),
        record: { ...record, profile: workspaceProfile },
      },
    });
    expect(load).toHaveBeenCalledWith('C:/repo');
    expect(init).not.toHaveBeenCalled();
    expect(recordManager.save).not.toHaveBeenCalled();
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

    const start = handlers.get(
      (IPC_CHANNELS as Record<string, string>).CONTROL_PROFILE_START_DOWNLOAD,
    )!;
    const started = await start(
      {},
      {
        root: 'C:/repo',
        activityOrigin: 'agent',
        actor: { kind: 'agent', channel: 'local-mcp' },
      },
    );

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
        observe: { enabled: false, serial: false },
      }),
      activityOrigin: 'human',
    });
    expect(jobManager.start).toHaveBeenCalledWith('job-download-1', expect.any(Function));

    const status = handlers.get(
      (IPC_CHANNELS as Record<string, string>).CONTROL_PROFILE_DOWNLOAD_STATUS,
    )!;
    await expect(status({}, { jobId: 'job-download-1' })).resolves.toEqual({
      success: true,
      data: expect.objectContaining({
        jobId: 'job-download-1',
        currentStep: runningStep,
        workflow,
      }),
    });

    const read = handlers.get(
      (IPC_CHANNELS as Record<string, string>).CONTROL_PROFILE_DOWNLOAD_READ,
    )!;
    await expect(read({}, { jobId: 'job-download-1' })).resolves.toEqual({
      success: true,
      data: expect.objectContaining({ workflow }),
    });
  });

  it('requests stop for an active download job over IPC without adding hardware side effects', async () => {
    const stoppedJob = {
      jobId: 'job-download-1',
      state: 'running' as const,
      mode: 'flash-observe' as const,
      root: 'C:/repo',
      createdAt: 1,
      startedAt: 1,
      updatedAt: 3,
      cancelRequested: true,
      cancellationCapability: 'best-effort' as const,
      stopState: 'stop-requested' as const,
    };
    const jobManager = {
      create: vi.fn(),
      start: vi.fn(async () => undefined),
      cancel: vi.fn(() => stoppedJob),
      getStatus: vi.fn(() => ({
        jobId: 'job-start-1',
        state: 'running' as const,
        mode: 'flash-observe' as const,
        root: 'C:/repo',
        createdAt: 1,
        startedAt: 1,
        updatedAt: 1,
        currentStepId: 'flash_download',
        cancelRequested: false,
        workflow: {
          mode: 'flash-observe' as const,
          root: 'C:/repo',
          steps: [],
          summary: {},
          nextActions: [],
        },
      })),
      read: vi.fn(),
    };

    registerControlProfileIpc({} as ControlProfileManager, undefined, {
      controlWorkflowJobManager: jobManager,
    } as never);

    const cancel = handlers.get(IPC_CHANNELS.CONTROL_PROFILE_DOWNLOAD_CANCEL)!;
    const result = await cancel({}, { jobId: 'job-download-1' });

    expect(result).toEqual({
      success: true,
      data: expect.objectContaining({
        jobId: 'job-download-1',
        cancelRequested: true,
        cancellationCapability: 'best-effort',
        stopState: 'stop-requested',
      }),
    });
    expect(jobManager.cancel).toHaveBeenCalledWith('job-download-1');
    expect(runControlWorkflowMock).not.toHaveBeenCalled();
  });

  it('runs RUN_DOWNLOAD without confirmation fields', async () => {
    registerControlProfileIpc({} as ControlProfileManager, undefined, {
      sessionManager: {},
      jlinkBackend: {},
    } as never);

    const run = handlers.get(IPC_CHANNELS.CONTROL_PROFILE_RUN_DOWNLOAD)!;
    const result = await run({}, { root: 'C:/repo' });

    expect(result).toEqual({
      success: true,
      data: expect.objectContaining({ mode: 'flash-observe', root: 'C:/repo' }),
    });
    expect(runControlWorkflowMock).toHaveBeenCalledOnce();
    expect(runControlWorkflowMock.mock.calls[0]?.[1]).toEqual({
      root: 'C:/repo',
      mode: 'flash-observe',
      observe: { enabled: false, serial: false },
    });
  });

  it('ignores a legacy approval gate and executes RUN_DOWNLOAD immediately', async () => {
    const approvalGate = {
      evaluate: vi.fn(async () => ({
        kind: 'approval-required' as const,
        approvalId: 'approval_run_1',
        revision: 1,
        state: 'pending' as const,
        continuationKind: 'control-profile-run' as const,
      })),
    };
    registerControlProfileIpc({} as ControlProfileManager, undefined, {
      sessionManager: {},
      jlinkBackend: {},
      controlProfileApprovalGate: approvalGate,
    } as never);

    const run = handlers.get(IPC_CHANNELS.CONTROL_PROFILE_RUN_DOWNLOAD)!;
    const result = await run({ sender: { id: 7 } }, { root: 'C:/repo' });

    expect(result).toEqual({
      success: true,
      data: expect.objectContaining({ mode: 'flash-observe' }),
    });
    expect(approvalGate.evaluate).not.toHaveBeenCalled();
    expect(runControlWorkflowMock).toHaveBeenCalledOnce();
  });

  it('ignores a legacy approval gate before START_DOWNLOAD creates a job', async () => {
    const approvalGate = {
      evaluate: vi.fn(async () => ({
        kind: 'approval-required' as const,
        approvalId: 'approval_start_1',
        revision: 1,
        state: 'pending' as const,
        continuationKind: 'control-profile-start' as const,
      })),
    };
    const jobManager = {
      create: vi.fn(() => ({
        jobId: 'job-start-immediate',
        state: 'queued' as const,
        mode: 'flash-observe' as const,
        root: 'C:/repo',
        createdAt: 1,
        updatedAt: 1,
        cancelRequested: false,
      })),
      start: vi.fn(async () => undefined),
      getStatus: vi.fn(() => ({
        jobId: 'job-start-immediate',
        state: 'queued' as const,
        mode: 'flash-observe' as const,
        root: 'C:/repo',
        createdAt: 1,
        updatedAt: 1,
        cancelRequested: false,
      })),
      read: vi.fn(),
    };

    registerControlProfileIpc({} as ControlProfileManager, undefined, {
      sessionManager: {},
      jlinkBackend: {},
      controlWorkflowJobManager: jobManager,
      controlProfileApprovalGate: approvalGate,
    } as never);

    const start = handlers.get(IPC_CHANNELS.CONTROL_PROFILE_START_DOWNLOAD)!;
    const result = await start({ sender: { id: 8 } }, { root: 'C:/repo' });

    expect(result).toEqual({
      success: true,
      data: expect.objectContaining({ jobId: 'job-start-immediate' }),
    });
    expect(approvalGate.evaluate).not.toHaveBeenCalled();
    expect(jobManager.create).toHaveBeenCalledOnce();
  });

  it('ignores a legacy approval gate before compensation reflash starts a job', async () => {
    const approvalGate = {
      evaluate: vi.fn(async () => ({
        kind: 'approval-required' as const,
        approvalId: 'approval_reflash_1',
        revision: 1,
        state: 'pending' as const,
        continuationKind: 'control-profile-start' as const,
      })),
    };
    const currentEvidence = { manifestDigest: 'manifest_digest_1' };
    readCurrentDeploymentEvidenceMock.mockResolvedValueOnce(currentEvidence);
    const compensationCandidateService = {
      candidateWorkspaceRoot: vi.fn(() => 'C:/repo'),
      reflashRequest: vi.fn(() => ({ root: 'C:/repo' })),
    };
    const jobManager = {
      create: vi.fn(() => ({
        jobId: 'job-start-1',
        state: 'running' as const,
        mode: 'flash-observe' as const,
        root: 'C:/repo',
        createdAt: 1,
        startedAt: 1,
        updatedAt: 1,
        currentStepId: 'flash_download',
        cancelRequested: false,
        workflow: {
          mode: 'flash-observe' as const,
          root: 'C:/repo',
          steps: [],
          summary: {},
          nextActions: [],
        },
      })),
      start: vi.fn(async () => ({
        jobId: 'job-start-1',
        state: 'running' as const,
        mode: 'flash-observe' as const,
        root: 'C:/repo',
        createdAt: 1,
        startedAt: 1,
        updatedAt: 1,
        cancelRequested: false,
        workflow: {
          mode: 'flash-observe' as const,
          root: 'C:/repo',
          steps: [],
          summary: {},
          nextActions: [],
        },
      })),
      getStatus: vi.fn(() => ({
        jobId: 'job-start-1',
        state: 'running' as const,
        mode: 'flash-observe' as const,
        root: 'C:/repo',
        createdAt: 1,
        startedAt: 1,
        updatedAt: 1,
        cancelRequested: false,
        workflow: {
          mode: 'flash-observe' as const,
          root: 'C:/repo',
          steps: [],
          summary: {},
          nextActions: [],
        },
      })),
      read: vi.fn(),
    };

    registerControlProfileIpc({} as ControlProfileManager, undefined, {
      sessionManager: {},
      jlinkBackend: {},
      controlWorkflowJobManager: jobManager,
      controlProfileApprovalGate: approvalGate,
      compensationCandidateService,
    } as never);

    const reflash = handlers.get(IPC_CHANNELS.CONTROL_PROFILE_START_COMPENSATION_REFLASH)!;
    const result = await reflash({ sender: { id: 9 } }, { candidateId: 'candidate_1' });

    expect(result).toEqual({
      success: true,
      data: expect.objectContaining({ jobId: 'job-start-1' }),
    });
    expect(compensationCandidateService.candidateWorkspaceRoot).toHaveBeenCalledWith('candidate_1');
    expect(readCurrentDeploymentEvidenceMock).toHaveBeenCalledWith(expect.anything(), 'C:/repo');
    expect(compensationCandidateService.reflashRequest).toHaveBeenCalledWith('candidate_1', {
      currentEvidence,
    });
    expect(approvalGate.evaluate).not.toHaveBeenCalled();
    expect(jobManager.create).toHaveBeenCalledOnce();
  });

  it('saves profile suggestions through existing managers only after a suggestion id is confirmed', async () => {
    const suggestedProfile = {
      schemaVersion: 'linkterm-control/1.0.0' as const,
      jlink: {
        enabled: true,
        target: 'STM32H743II',
        interface: 'swd' as const,
        speedKHz: 4000,
      },
      flash: { binary: 'build/app.bin', baseAddress: '0x08000000', verify: true },
      rtt: { enabled: true, channels: [0], controlBlockAddress: '0x24000000' },
    };
    const savedRecord = {
      id: 'ctrl_suggested',
      label: 'STM32H743II',
      root: 'C:/repo',
      source: 'ai' as const,
      profile: suggestedProfile,
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
    };
    const manager = {
      init: vi.fn(async () => suggestedProfile),
    } as unknown as ControlProfileManager;
    const recordManager = {
      save: vi.fn(async () => savedRecord),
    } as unknown as ControlProfileRecordManager;
    const compensationCandidateService = {
      profileSuggestionSave: vi.fn(() => ({
        root: 'C:/repo',
        label: 'STM32H743II',
        profile: suggestedProfile,
      })),
    };

    registerControlProfileIpc(manager, recordManager, {
      compensationCandidateService,
    } as never);

    const saveSuggestion = handlers.get(IPC_CHANNELS.CONTROL_PROFILE_SAVE_PROFILE_SUGGESTION)!;
    const result = await saveSuggestion({}, { suggestionId: 'profile_suggestion_candidate_1' });

    expect(result).toEqual({
      success: true,
      data: {
        path: expect.stringMatching(/control-profile\.json$/u),
        profile: suggestedProfile,
        record: savedRecord,
      },
    });
    expect(compensationCandidateService.profileSuggestionSave).toHaveBeenCalledWith(
      'profile_suggestion_candidate_1',
    );
    expect(manager.init).toHaveBeenCalledWith(
      'C:/repo',
      {
        jlink: suggestedProfile.jlink,
        flash: suggestedProfile.flash,
        rtt: suggestedProfile.rtt,
      },
      { force: true },
    );
    expect(recordManager.save).toHaveBeenCalledWith({
      root: 'C:/repo',
      source: 'ai',
      profile: suggestedProfile,
      label: 'STM32H743II',
    });
    expect(runControlWorkflowMock).not.toHaveBeenCalled();
  });

  it('runs direct RUN_DOWNLOAD exactly once with an approved continuation', async () => {
    const approvalGate = {
      evaluate: vi.fn(async () => ({ kind: 'approved' as const })),
    };
    registerControlProfileIpc({} as ControlProfileManager, undefined, {
      sessionManager: {},
      jlinkBackend: {},
      controlProfileApprovalGate: approvalGate,
    } as never);

    const run = handlers.get(IPC_CHANNELS.CONTROL_PROFILE_RUN_DOWNLOAD)!;
    const result = await run(
      { sender: { id: 7 } },
      { root: 'C:/repo', kind: 'continue-approved', approvalId: 'approval_run_1' },
    );

    expect(result).toEqual({
      success: true,
      data: expect.objectContaining({ mode: 'flash-observe', root: 'C:/repo' }),
    });
    expect(approvalGate.evaluate).not.toHaveBeenCalled();
    expect(runControlWorkflowMock).toHaveBeenCalledOnce();
  });

  it('runs approved RUN_DOWNLOAD continuation while the legacy global pause latch is set', async () => {
    const operationAdmissionCoordinator = new OperationAdmissionCoordinator({
      runtimeId: 'control-profile-ipc-test-runtime',
      now: () => '2026-07-15T00:00:00.000Z',
    });
    const approvalGate = {
      evaluate: vi.fn(async () => ({ kind: 'approved' as const })),
    };
    registerControlProfileIpc({} as ControlProfileManager, undefined, {
      sessionManager: {},
      jlinkBackend: {},
      controlProfileApprovalGate: approvalGate,
      operationAdmissionCoordinator,
    } as never);

    const run = handlers.get(IPC_CHANNELS.CONTROL_PROFILE_RUN_DOWNLOAD)!;
    const result = await run(
      { sender: { id: 7 } },
      { root: 'C:/repo', kind: 'continue-approved', approvalId: 'approval_run_1' },
    );

    expect(result).toEqual({
      success: true,
      data: expect.objectContaining({ mode: 'flash-observe', root: 'C:/repo' }),
    });
    expect(approvalGate.evaluate).not.toHaveBeenCalled();
    expect(runControlWorkflowMock).toHaveBeenCalledOnce();
  });

  it('starts approved START_DOWNLOAD continuation while the legacy global pause latch is set', async () => {
    const operationAdmissionCoordinator = new OperationAdmissionCoordinator({
      runtimeId: 'control-profile-ipc-test-runtime',
      now: () => '2026-07-15T00:00:00.000Z',
    });
    const approvalGate = {
      evaluate: vi.fn(async () => ({ kind: 'approved' as const })),
    };
    const jobManager = {
      create: vi.fn(() => ({
        jobId: 'job-start-1',
        state: 'running' as const,
        mode: 'flash-observe' as const,
        root: 'C:/repo',
        createdAt: 1,
        startedAt: 1,
        updatedAt: 1,
        currentStepId: 'flash_download',
        cancelRequested: false,
        workflow: {
          mode: 'flash-observe' as const,
          root: 'C:/repo',
          steps: [],
          summary: {},
          nextActions: [],
        },
      })),
      start: vi.fn(async () => ({
        jobId: 'job-start-1',
        state: 'running' as const,
        mode: 'flash-observe' as const,
        root: 'C:/repo',
        createdAt: 1,
        startedAt: 1,
        updatedAt: 1,
        cancelRequested: false,
        workflow: {
          mode: 'flash-observe' as const,
          root: 'C:/repo',
          steps: [],
          summary: {},
          nextActions: [],
        },
      })),
      getStatus: vi.fn(() => ({
        jobId: 'job-start-1',
        state: 'running' as const,
        mode: 'flash-observe' as const,
        root: 'C:/repo',
        createdAt: 1,
        startedAt: 1,
        updatedAt: 1,
        currentStepId: 'flash_download',
        cancelRequested: false,
        workflow: {
          mode: 'flash-observe' as const,
          root: 'C:/repo',
          steps: [],
          summary: {},
          nextActions: [],
        },
      })),
      read: vi.fn(),
    };
    registerControlProfileIpc({} as ControlProfileManager, undefined, {
      sessionManager: {},
      jlinkBackend: {},
      controlWorkflowJobManager: jobManager,
      controlProfileApprovalGate: approvalGate,
      operationAdmissionCoordinator,
    } as never);

    const start = handlers.get(IPC_CHANNELS.CONTROL_PROFILE_START_DOWNLOAD)!;
    const result = await start(
      { sender: { id: 8 } },
      { root: 'C:/repo', kind: 'continue-approved', approvalId: 'approval_start_1' },
    );

    expect(result).toEqual(expect.objectContaining({ success: true }));
    expect(approvalGate.evaluate).not.toHaveBeenCalled();
    expect(jobManager.create).toHaveBeenCalledOnce();
    expect(jobManager.start).toHaveBeenCalledOnce();
  });

  it('runs approved RUN_DOWNLOAD continuation after global resume through admission', async () => {
    const operationAdmissionCoordinator = new OperationAdmissionCoordinator({
      runtimeId: 'control-profile-ipc-test-runtime',
      now: () => '2026-07-15T00:00:00.000Z',
    });
    const approvalGate = {
      evaluate: vi.fn(async () => ({ kind: 'approved' as const })),
    };
    registerControlProfileIpc({} as ControlProfileManager, undefined, {
      sessionManager: {},
      jlinkBackend: {},
      controlProfileApprovalGate: approvalGate,
      operationAdmissionCoordinator,
    } as never);

    const run = handlers.get(IPC_CHANNELS.CONTROL_PROFILE_RUN_DOWNLOAD)!;
    const result = await run(
      { sender: { id: 7 } },
      { root: 'C:/repo', kind: 'continue-approved', approvalId: 'approval_run_1' },
    );

    expect(result).toEqual({
      success: true,
      data: expect.objectContaining({ mode: 'flash-observe', root: 'C:/repo' }),
    });
    expect(approvalGate.evaluate).not.toHaveBeenCalled();
    expect(runControlWorkflowMock).toHaveBeenCalledOnce();
  });

  it('passes verified deployment recorder into direct RUN_DOWNLOAD execution', async () => {
    const onVerifiedDeployment = vi.fn();
    const approvalGate = {
      evaluate: vi.fn(async () => ({ kind: 'approved' as const })),
    };
    registerControlProfileIpc({} as ControlProfileManager, undefined, {
      sessionManager: {},
      jlinkBackend: {},
      controlProfileApprovalGate: approvalGate,
      onVerifiedDeployment,
    } as never);

    const run = handlers.get(IPC_CHANNELS.CONTROL_PROFILE_RUN_DOWNLOAD)!;
    await run(
      { sender: { id: 7 } },
      { root: 'C:/repo', kind: 'continue-approved', approvalId: 'approval_run_1' },
    );

    expect(runControlWorkflowMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ root: 'C:/repo', mode: 'flash-observe' }),
      expect.objectContaining({ onVerifiedDeployment }),
    );
  });

  it('passes verified deployment recorder into approved START_DOWNLOAD background jobs', async () => {
    const onVerifiedDeployment = vi.fn();
    const approvalGate = {
      evaluate: vi.fn(async () => ({ kind: 'approved' as const })),
    };
    const job = {
      jobId: 'job-download-approved',
      state: 'queued' as const,
      mode: 'flash-observe' as const,
      root: 'C:/repo',
      createdAt: 1,
      updatedAt: 1,
      cancelRequested: false,
    };
    const jobManager = {
      create: vi.fn(() => job),
      start: vi.fn(async (_jobId: string, runner: (input: unknown) => unknown) =>
        runner({ signal: new AbortController().signal, update: vi.fn() }),
      ),
      getStatus: vi.fn(() => job),
      read: vi.fn(() => job),
    };
    registerControlProfileIpc({} as ControlProfileManager, undefined, {
      sessionManager: {},
      jlinkBackend: {},
      controlWorkflowJobManager: jobManager,
      controlProfileApprovalGate: approvalGate,
      onVerifiedDeployment,
    } as never);

    const start = handlers.get(IPC_CHANNELS.CONTROL_PROFILE_START_DOWNLOAD)!;
    await start(
      { sender: { id: 8 } },
      { root: 'C:/repo', kind: 'continue-approved', approvalId: 'approval_start_1' },
    );

    expect(runControlWorkflowMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ root: 'C:/repo', mode: 'flash-observe' }),
      expect.objectContaining({
        signal: expect.any(AbortSignal),
        onUpdate: expect.any(Function),
        onVerifiedDeployment,
      }),
    );
  });

  it('does not create approval continuations for direct downloads', async () => {
    const approvalGate = {
      evaluate: vi.fn(async () => ({
        kind: 'rejected' as const,
        approvalId: 'approval_run_1',
        reason: 'APPROVAL_GRANT_ALREADY_CONSUMED',
        continuationKind: 'control-profile-run' as const,
      })),
    };
    registerControlProfileIpc({} as ControlProfileManager, undefined, {
      sessionManager: {},
      jlinkBackend: {},
      controlProfileApprovalGate: approvalGate,
    } as never);

    const run = handlers.get(IPC_CHANNELS.CONTROL_PROFILE_RUN_DOWNLOAD)!;
    const result = await run(
      { sender: { id: 7 } },
      { root: 'C:/repo', kind: 'continue-approved', approvalId: 'approval_run_1' },
    );

    expect(result).toEqual({
      success: true,
      data: expect.objectContaining({ mode: 'flash-observe' }),
    });
    expect(approvalGate.evaluate).not.toHaveBeenCalled();
    expect(runControlWorkflowMock).toHaveBeenCalledOnce();
  });

  it('connects and disconnects the profile chip over IPC without opening sessions', async () => {
    const savedProfile = {
      schemaVersion: 'linkterm-control/1.0.0' as const,
      serial: { enabled: true, port: 'COM7', baudRate: 115200, mode: 'terminal' as const },
      jlink: {
        enabled: true,
        target: 'STM32H743IIT6',
        interface: 'swd' as const,
        speedKHz: 4000,
      },
      flash: { binary: 'build/app.bin', baseAddress: '0x08000000', verify: true },
    };
    const manager = {
      load: vi.fn(async () => savedProfile),
    } as unknown as ControlProfileManager;
    const jlinkBackend = {
      probeConnect: vi.fn(async () => ({
        probeId: '11111111-1111-4111-8111-111111111111',
        serialNumber: 'JLINK-SERIAL-SHOULD-NOT-LEAK',
        target: 'STM32H743II',
        connected: true,
      })),
      probeDisconnect: vi.fn(async () => undefined),
    };
    registerControlProfileIpc(manager, undefined, {
      jlinkBackend,
    } as never);

    const connect = handlers.get(
      (IPC_CHANNELS as Record<string, string>).CONTROL_PROFILE_CONNECT_CHIP,
    )!;
    const connected = await connect({}, { root: 'C:/repo' });

    expect(connected).toEqual({
      success: true,
      data: {
        probe: {
          probeId: '11111111-1111-4111-8111-111111111111',
          target: 'STM32H743II',
          connected: true,
        },
      },
    });
    expect(jlinkBackend.probeConnect).toHaveBeenCalledWith({
      target: 'STM32H743II',
      interface: 'swd',
      speedKHz: 4000,
    });

    const disconnect = handlers.get(
      (IPC_CHANNELS as Record<string, string>).CONTROL_PROFILE_DISCONNECT_CHIP,
    )!;
    await expect(
      disconnect({}, { probeId: '11111111-1111-4111-8111-111111111111' }),
    ).resolves.toEqual({
      success: true,
      data: { probeId: '11111111-1111-4111-8111-111111111111', disconnected: true },
    });
    expect(jlinkBackend.probeDisconnect).toHaveBeenCalledWith(
      '11111111-1111-4111-8111-111111111111',
    );
  });

  it('returns a failed IPC result when target access has no positive hardware evidence', async () => {
    const { JLinkOperationError } = await import('@linkterm/runtime/jlink/errors');
    const manager = {
      load: vi.fn(async () => ({
        schemaVersion: 'linkterm-control/1.0.0' as const,
        serial: { enabled: false },
        jlink: {
          enabled: true,
          target: 'STM32H743II',
          interface: 'swd' as const,
          speedKHz: 4000,
        },
      })),
    } as unknown as ControlProfileManager;
    const jlinkBackend = {
      probeConnect: vi.fn(async () => {
        throw new JLinkOperationError(
          'J-Link probeConnect completed without positive target-access evidence',
          { operation: 'probeConnect' },
        );
      }),
    };
    registerControlProfileIpc(manager, undefined, { jlinkBackend } as never);

    const connect = handlers.get(
      (IPC_CHANNELS as Record<string, string>).CONTROL_PROFILE_CONNECT_CHIP,
    )!;

    await expect(connect({}, { root: 'C:/repo' })).resolves.toEqual({
      success: false,
      error: {
        code: 'JLINK_OPERATION_FAILED',
        message: 'J-Link probeConnect completed without positive target-access evidence',
      },
    });
  });
});
