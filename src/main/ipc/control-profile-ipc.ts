import { execFile } from 'node:child_process';
import type { Dirent } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { electron } from '../electron-runtime.js';
import {
  ControlProfileAlreadyInitializedError,
  ControlProfileManager,
  ControlProfileNotFoundError,
  ControlProfileRecordManager,
  ControlProfileRecordNotFoundError,
  ControlProfileSchemaVersionMismatchError,
  ControlProfileTooLargeError,
  WorkspaceInvalidRootError,
  controlProfileBodySchema,
  controlProfilePath,
} from '../../core/workspace/index.js';
import {
  decodeFirmwareImageByPath,
  isSelfDescribingFirmwareImagePath,
} from '../../core/workspace/firmware-image.js';
import { formatHexAddress } from '../../core/workspace/intel-hex.js';
import type { IJLinkBackend, JLinkDeviceCatalog } from '../../jlink/index.js';
import type { SessionManager } from '../../core/session/session-manager.js';
import { defaultOpenSerial } from '../../mcp/surfaces/control-profile/tools.js';
import { ControlWorkflowJobManager } from '../../mcp/surfaces/control-workflow/job-manager.js';
import type { ControlWorkflowJobSnapshot } from '../../mcp/surfaces/control-workflow/job-manager.js';
import type { RunControlWorkflowInput } from '../../mcp/surfaces/control-workflow/schemas.js';
import { runControlWorkflow } from '../../mcp/surfaces/control-workflow/workflow-runner.js';
import { ToolError } from '../../mcp/registry.js';
import { IPC_CHANNELS } from '../../shared/ipc-protocol.js';
import type {
  ControlProfileDownloadJobPayload,
  ControlProfileDownloadResultPayload,
  ControlProfileFilePayload,
  ControlProfilePayload,
  PreloadResult,
  SavedControlProfileRecordPayload,
} from '../../shared/preload-api.js';

const { dialog, ipcMain } = electron;
const execFileAsync = promisify(execFile);

/** 保存/读取工作区控制配置 IPC handler。 */
export interface RegisterControlProfileIpcOptions {
  sessionManager?: SessionManager;
  jlinkBackend?: IJLinkBackend;
  jlinkDeviceCatalog?: JLinkDeviceCatalog;
  controlWorkflowJobManager?: ControlWorkflowJobManager;
}

export function registerControlProfileIpc(
  manager: ControlProfileManager,
  recordManager?: ControlProfileRecordManager,
  options: RegisterControlProfileIpcOptions = {},
): () => void {
  const jobManager = options.controlWorkflowJobManager ?? new ControlWorkflowJobManager();

  ipcMain.handle(
    IPC_CHANNELS.CONTROL_PROFILE_SAVE,
    async (
      _event,
      raw: unknown,
    ): Promise<
      PreloadResult<{
        path: string;
        profile: ControlProfileFilePayload;
        record?: SavedControlProfileRecordPayload;
      }>
    > => {
      try {
        const { root, profile } = parseSavePayload(raw);
        const saved = await manager.init(root, profile, { force: true });
        const record = await recordManager?.save({
          root,
          source: 'manual',
          profile: saved,
        });
        return {
          success: true,
          data: {
            path: controlProfilePath(root),
            profile: saved as ControlProfileFilePayload,
            ...(record ? { record: record as SavedControlProfileRecordPayload } : {}),
          },
        };
      } catch (err) {
        return toIpcError(err);
      }
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.CONTROL_PROFILE_RECORDS_LIST,
    async (): Promise<PreloadResult<ReadonlyArray<SavedControlProfileRecordPayload>>> => {
      try {
        if (!recordManager) throw new Error('Control profile records are unavailable');
        return {
          success: true,
          data: (await recordManager.list()) as ReadonlyArray<SavedControlProfileRecordPayload>,
        };
      } catch (err) {
        return toIpcError(err);
      }
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.CONTROL_PROFILE_RECORDS_OPEN,
    async (
      _event,
      raw: unknown,
    ): Promise<PreloadResult<{ path: string; record: SavedControlProfileRecordPayload }>> => {
      try {
        if (!recordManager) throw new Error('Control profile records are unavailable');
        const recordId = parseRecordIdPayload(raw);
        const record = await recordManager.get(recordId);
        const saved = await manager.init(record.root, profileFileToBody(record.profile), {
          force: true,
        });
        const savedRecord = await recordManager.save({
          root: record.root,
          source: record.source,
          profile: saved,
          label: record.label,
        });
        return {
          success: true,
          data: {
            path: controlProfilePath(record.root),
            record: savedRecord as SavedControlProfileRecordPayload,
          },
        };
      } catch (err) {
        return toIpcError(err);
      }
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.CONTROL_PROFILE_RECORDS_DELETE,
    async (_event, raw: unknown): Promise<PreloadResult<{ deleted: true }>> => {
      try {
        if (!recordManager) throw new Error('Control profile records are unavailable');
        await recordManager.delete(parseRecordIdPayload(raw));
        return { success: true, data: { deleted: true } };
      } catch (err) {
        return toIpcError(err);
      }
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.CONTROL_PROFILE_RUN_DOWNLOAD,
    async (_event, raw: unknown): Promise<PreloadResult<ControlProfileDownloadResultPayload>> => {
      try {
        if (!options.sessionManager || !options.jlinkBackend) {
          throw new Error('Control workflow runtime is unavailable');
        }
        const input = parseRunDownloadPayload(raw);
        const data = await runControlWorkflow(
          buildRunDownloadDeps(manager, options),
          buildRunDownloadWorkflowInput(input),
        );
        return { success: true, data: data as ControlProfileDownloadResultPayload };
      } catch (err) {
        return toIpcError(err);
      }
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.CONTROL_PROFILE_START_DOWNLOAD,
    async (_event, raw: unknown): Promise<PreloadResult<ControlProfileDownloadJobPayload>> => {
      try {
        if (!options.sessionManager || !options.jlinkBackend) {
          throw new Error('Control workflow runtime is unavailable');
        }
        const input = parseRunDownloadPayload(raw);
        const workflowInput = buildRunDownloadWorkflowInput(input);
        const runnerDeps = buildRunDownloadDeps(manager, options);
        const job = jobManager.create({ input: workflowInput });
        void jobManager
          .start(job.jobId, ({ signal, update }) =>
            runControlWorkflow(runnerDeps, workflowInput, { signal, onUpdate: update }),
          )
          .catch(() => undefined);
        return { success: true, data: toDownloadJobPayload(jobManager.getStatus(job.jobId)) };
      } catch (err) {
        return toIpcError(err);
      }
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.CONTROL_PROFILE_DOWNLOAD_STATUS,
    async (_event, raw: unknown): Promise<PreloadResult<ControlProfileDownloadJobPayload>> => {
      try {
        const jobId = parseJobIdPayload(raw);
        return { success: true, data: toDownloadJobPayload(jobManager.getStatus(jobId)) };
      } catch (err) {
        return toIpcError(err);
      }
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.CONTROL_PROFILE_DOWNLOAD_READ,
    async (_event, raw: unknown): Promise<PreloadResult<ControlProfileDownloadJobPayload>> => {
      try {
        const jobId = parseJobIdPayload(raw);
        return { success: true, data: toDownloadJobPayload(jobManager.read(jobId)) };
      } catch (err) {
        return toIpcError(err);
      }
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.CONTROL_PROFILE_LOAD,
    async (
      _event,
      raw: unknown,
    ): Promise<PreloadResult<{ path: string; profile: ControlProfileFilePayload }>> => {
      try {
        const root = parseRootPayload(raw);
        const profile = await manager.load(root);
        return {
          success: true,
          data: { path: controlProfilePath(root), profile: profile as ControlProfileFilePayload },
        };
      } catch (err) {
        return toIpcError(err);
      }
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.CONTROL_PROFILE_PICK_WORKSPACE_ROOT,
    async (): Promise<PreloadResult<{ root: string | null }>> => chooseWorkspaceRoot(),
  );

  ipcMain.handle(
    IPC_CHANNELS.CONTROL_PROFILE_PICK_FIRMWARE_FILE,
    async (): Promise<PreloadResult<{ path: string | null; baseAddress?: string }>> =>
      chooseFirmwareFile(),
  );

  return () => {
    ipcMain.removeHandler(IPC_CHANNELS.CONTROL_PROFILE_SAVE);
    ipcMain.removeHandler(IPC_CHANNELS.CONTROL_PROFILE_LOAD);
    ipcMain.removeHandler(IPC_CHANNELS.CONTROL_PROFILE_RECORDS_LIST);
    ipcMain.removeHandler(IPC_CHANNELS.CONTROL_PROFILE_RECORDS_OPEN);
    ipcMain.removeHandler(IPC_CHANNELS.CONTROL_PROFILE_RECORDS_DELETE);
    ipcMain.removeHandler(IPC_CHANNELS.CONTROL_PROFILE_RUN_DOWNLOAD);
    ipcMain.removeHandler(IPC_CHANNELS.CONTROL_PROFILE_START_DOWNLOAD);
    ipcMain.removeHandler(IPC_CHANNELS.CONTROL_PROFILE_DOWNLOAD_STATUS);
    ipcMain.removeHandler(IPC_CHANNELS.CONTROL_PROFILE_DOWNLOAD_READ);
    ipcMain.removeHandler(IPC_CHANNELS.CONTROL_PROFILE_PICK_WORKSPACE_ROOT);
    ipcMain.removeHandler(IPC_CHANNELS.CONTROL_PROFILE_PICK_FIRMWARE_FILE);
  };
}

function buildRunDownloadDeps(
  manager: ControlProfileManager,
  options: RegisterControlProfileIpcOptions,
): Parameters<typeof runControlWorkflow>[0] {
  if (!options.sessionManager || !options.jlinkBackend) {
    throw new Error('Control workflow runtime is unavailable');
  }
  return {
    controlProfileManager: manager,
    sessionManager: options.sessionManager,
    jlinkBackend: options.jlinkBackend,
    jlinkDeviceCatalog: options.jlinkDeviceCatalog,
    openSerial: defaultOpenSerial(options.sessionManager),
  };
}

function buildRunDownloadWorkflowInput(input: {
  root: string;
  timeoutMs?: number;
}): RunControlWorkflowInput {
  return {
    root: input.root,
    mode: 'flash-observe',
    confirm: true,
    observe: { enabled: false, serial: false },
    ...(input.timeoutMs !== undefined ? { firmware: { timeoutMs: input.timeoutMs } } : {}),
  };
}

function toDownloadJobPayload(job: ControlWorkflowJobSnapshot): ControlProfileDownloadJobPayload {
  const currentStep = job.workflow?.steps.at(-1);
  return {
    jobId: job.jobId,
    state: job.state,
    mode: job.mode,
    root: job.root,
    createdAt: job.createdAt,
    ...(job.startedAt !== undefined ? { startedAt: job.startedAt } : {}),
    ...(job.completedAt !== undefined ? { completedAt: job.completedAt } : {}),
    ...(job.expiresAt !== undefined ? { expiresAt: job.expiresAt } : {}),
    updatedAt: job.updatedAt,
    ...(job.currentStepId !== undefined ? { currentStepId: job.currentStepId } : {}),
    ...(currentStep !== undefined ? { currentStep } : {}),
    cancelRequested: job.cancelRequested,
    ...(job.workflow?.summary !== undefined ? { summary: job.workflow.summary } : {}),
    ...(job.workflow?.failedStep !== undefined ? { failedStep: job.workflow.failedStep } : {}),
    ...(job.workflow?.failureCode !== undefined ? { failureCode: job.workflow.failureCode } : {}),
    ...(job.workflow !== undefined ? { workflow: job.workflow as ControlProfileDownloadResultPayload } : {}),
  };
}

/**
 * 打开目录选择器并返回用户选择的工作区目录。
 *
 * @returns 成功结果；用户取消时 root 为 null
 */
async function chooseWorkspaceRoot(): Promise<PreloadResult<{ root: string | null }>> {
  const defaultPath = await resolveWorkspaceDialogDefaultPath();
  const result = await dialog.showOpenDialog({
    title: 'Select workspace folder',
    properties: ['openDirectory'],
    ...(defaultPath ? { defaultPath } : {}),
  });
  return { success: true, data: { root: result.canceled ? null : (result.filePaths[0] ?? null) } };
}

async function resolveWorkspaceDialogDefaultPath(): Promise<string | undefined> {
  if (process.platform !== 'win32') return undefined;
  const home = await discoverDefaultWslHomePath();
  if (home) return home;
  return discoverFirstWslShareRoot();
}

async function discoverDefaultWslHomePath(): Promise<string | undefined> {
  let distros: string[];
  try {
    const { stdout } = await execFileAsync('wsl.exe', ['--list', '--quiet'], {
      windowsHide: true,
      timeout: 5000,
    });
    distros = stdout
      .replace(/^\uFEFF/u, '')
      .split(/\r?\n/u)
      .map(normalizeWslText)
      .filter(Boolean);
  } catch {
    return undefined;
  }

  for (const distroName of distros) {
    try {
      const { stdout } = await execFileAsync(
        'wsl.exe',
        ['-d', distroName, '--', 'sh', '-lc', 'printf "%s\\n%s\\n" "$(id -un)" "$HOME"'],
        { windowsHide: true, timeout: 5000 },
      );
      const [, linuxHomePath] = stdout.split(/\r?\n/u).map(normalizeWslText).filter(Boolean);
      if (linuxHomePath) return linuxPathToWslUnc(distroName, linuxHomePath);
    } catch {
      // Ignore unavailable distros and try the next registered one.
    }
  }
  return undefined;
}

async function discoverFirstWslShareRoot(): Promise<string | undefined> {
  for (const host of ['wsl.localhost', 'wsl$']) {
    const base = `\\\\${host}\\`;
    let entries: Dirent[];
    try {
      entries = await readdir(base, { withFileTypes: true });
    } catch {
      continue;
    }
    const firstDistro = entries.find((entry) => entry.isDirectory());
    if (firstDistro) return path.win32.join(base, firstDistro.name);
  }
  return undefined;
}

function linuxPathToWslUnc(distroName: string, linuxPath: string): string {
  const normalized = path.posix.normalize(linuxPath).replace(/^\/+/u, '').replace(/\//gu, '\\');
  return `\\\\wsl.localhost\\${distroName}\\${normalized}`;
}

function normalizeWslText(value: string): string {
  return value
    .replace(/\u0000/gu, '')
    .replace(/^\uFEFF/u, '')
    .trim();
}

/**
 * 打开文件选择器并返回用户选择的固件文件路径。
 *
 * @returns 成功结果；用户取消时 path 为 null
 */
async function chooseFirmwareFile(): Promise<
  PreloadResult<{ path: string | null; baseAddress?: string }>
> {
  try {
    const result = await dialog.showOpenDialog({
      title: 'Select firmware file',
      properties: ['openFile'],
      filters: [
        { name: 'Firmware images', extensions: ['bin', 'hex', 'elf'] },
        { name: 'All files', extensions: ['*'] },
      ],
    });
    const selectedPath = result.canceled ? null : (result.filePaths[0] ?? null);
    if (selectedPath === null || !isSelfDescribingFirmwareImagePath(selectedPath)) {
      return { success: true, data: { path: selectedPath } };
    }
    const image = decodeFirmwareImageByPath(selectedPath, await readFile(selectedPath));
    return {
      success: true,
      data: {
        path: selectedPath,
        ...(image.baseAddress !== undefined
          ? { baseAddress: formatHexAddress(image.baseAddress) }
          : {}),
      },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: { code: 'INVALID_FIRMWARE_IMAGE', message } };
  }
}

/**
 * 解析保存请求。
 *
 * @param raw IPC 原始 payload
 * @returns root 和已校验 profile
 */
function parseSavePayload(raw: unknown): { root: string; profile: ControlProfilePayload } {
  if (typeof raw !== 'object' || raw === null) throw new Error('Invalid payload');
  const r = raw as { root?: unknown; profile?: unknown };
  if (typeof r.root !== 'string' || r.root.trim().length === 0) throw new Error('root is required');
  const profile = controlProfileBodySchema.parse(r.profile) as ControlProfilePayload;
  return { root: r.root, profile };
}

function profileFileToBody(profile: ControlProfileFilePayload): ControlProfilePayload {
  const body: ControlProfilePayload = {
    ...(profile.serial ? { serial: profile.serial } : {}),
    ...(profile.jlink ? { jlink: profile.jlink } : {}),
    ...(profile.flash ? { flash: profile.flash } : {}),
    ...(profile.rtt ? { rtt: profile.rtt } : {}),
  };
  return controlProfileBodySchema.parse(body) as ControlProfilePayload;
}

/**
 * 解析读取请求。
 *
 * @param raw IPC 原始 payload
 * @returns root
 */
function parseRootPayload(raw: unknown): string {
  if (typeof raw !== 'object' || raw === null) throw new Error('Invalid payload');
  const root = (raw as { root?: unknown }).root;
  if (typeof root !== 'string' || root.trim().length === 0) throw new Error('root is required');
  return root;
}

function parseRecordIdPayload(raw: unknown): string {
  if (typeof raw !== 'object' || raw === null) throw new Error('Invalid payload');
  const recordId = (raw as { recordId?: unknown }).recordId;
  if (typeof recordId !== 'string' || recordId.length === 0)
    throw new Error('recordId is required');
  return recordId;
}

function parseRunDownloadPayload(raw: unknown): { root: string; timeoutMs?: number } {
  if (typeof raw !== 'object' || raw === null) throw new Error('Invalid payload');
  const root = parseRootPayload(raw);
  const rawTimeoutMs = (raw as { timeoutMs?: unknown }).timeoutMs;
  if (
    rawTimeoutMs !== undefined &&
    (typeof rawTimeoutMs !== 'number' ||
      !Number.isInteger(rawTimeoutMs) ||
      rawTimeoutMs <= 0 ||
      rawTimeoutMs > 600_000)
  ) {
    throw new Error('timeoutMs must be a positive integer no greater than 600000');
  }
  return {
    root,
    ...(rawTimeoutMs !== undefined ? { timeoutMs: rawTimeoutMs } : {}),
  };
}

function parseJobIdPayload(raw: unknown): string {
  if (typeof raw !== 'object' || raw === null) throw new Error('Invalid payload');
  const jobId = (raw as { jobId?: unknown }).jobId;
  if (typeof jobId !== 'string' || jobId.trim().length === 0) throw new Error('jobId is required');
  return jobId;
}

function toIpcError<T>(err: unknown): PreloadResult<T> {
  if (err instanceof ToolError) {
    return { success: false, error: { code: err.code, message: err.message } };
  }
  if (err instanceof ControlProfileAlreadyInitializedError) {
    return { success: false, error: { code: err.code, message: err.message } };
  }
  if (err instanceof ControlProfileNotFoundError) {
    return { success: false, error: { code: err.code, message: err.message } };
  }
  if (err instanceof ControlProfileTooLargeError) {
    return { success: false, error: { code: err.code, message: err.message } };
  }
  if (err instanceof ControlProfileSchemaVersionMismatchError) {
    return { success: false, error: { code: err.code, message: err.message } };
  }
  if (err instanceof ControlProfileRecordNotFoundError) {
    return { success: false, error: { code: err.code, message: err.message } };
  }
  if (err instanceof WorkspaceInvalidRootError) {
    return { success: false, error: { code: err.code, message: err.message } };
  }
  const message = err instanceof Error ? err.message : String(err);
  return { success: false, error: { code: 'INVALID_PAYLOAD', message } };
}
