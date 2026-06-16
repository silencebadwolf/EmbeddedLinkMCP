import { dialog, ipcMain } from 'electron';
import {
  ControlProfileAlreadyInitializedError,
  ControlProfileManager,
  ControlProfileNotFoundError,
  ControlProfileSchemaVersionMismatchError,
  ControlProfileTooLargeError,
  WorkspaceInvalidRootError,
  controlProfileBodySchema,
  controlProfilePath,
} from '../../core/workspace/index.js';
import { IPC_CHANNELS } from '../../shared/ipc-protocol.js';
import type { ControlProfileFilePayload, ControlProfilePayload, PreloadResult } from '../../shared/preload-api.js';

/** 保存/读取工作区控制配置 IPC handler。 */
export function registerControlProfileIpc(manager: ControlProfileManager): () => void {
  ipcMain.handle(
    IPC_CHANNELS.CONTROL_PROFILE_SAVE,
    async (_event, raw: unknown): Promise<PreloadResult<{ path: string; profile: ControlProfileFilePayload }>> => {
      try {
        const { root, profile } = parseSavePayload(raw);
        const saved = await manager.init(root, profile, { force: true });
        return {
          success: true,
          data: { path: controlProfilePath(root), profile: saved as ControlProfileFilePayload },
        };
      } catch (err) {
        return toIpcError(err);
      }
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.CONTROL_PROFILE_LOAD,
    async (_event, raw: unknown): Promise<PreloadResult<{ path: string; profile: ControlProfileFilePayload }>> => {
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
    async (): Promise<PreloadResult<{ path: string | null }>> => chooseFirmwareFile(),
  );

  return () => {
    ipcMain.removeHandler(IPC_CHANNELS.CONTROL_PROFILE_SAVE);
    ipcMain.removeHandler(IPC_CHANNELS.CONTROL_PROFILE_LOAD);
    ipcMain.removeHandler(IPC_CHANNELS.CONTROL_PROFILE_PICK_WORKSPACE_ROOT);
    ipcMain.removeHandler(IPC_CHANNELS.CONTROL_PROFILE_PICK_FIRMWARE_FILE);
  };
}

/**
 * 打开目录选择器并返回用户选择的工作区目录。
 *
 * @returns 成功结果；用户取消时 root 为 null
 */
async function chooseWorkspaceRoot(): Promise<PreloadResult<{ root: string | null }>> {
  const result = await dialog.showOpenDialog({
    title: 'Select workspace folder',
    properties: ['openDirectory'],
  });
  return { success: true, data: { root: result.canceled ? null : result.filePaths[0] ?? null } };
}

/**
 * 打开文件选择器并返回用户选择的固件文件路径。
 *
 * @returns 成功结果；用户取消时 path 为 null
 */
async function chooseFirmwareFile(): Promise<PreloadResult<{ path: string | null }>> {
  const result = await dialog.showOpenDialog({
    title: 'Select firmware file',
    properties: ['openFile'],
    filters: [
      { name: 'Firmware images', extensions: ['bin', 'hex', 'elf'] },
      { name: 'All files', extensions: ['*'] },
    ],
  });
  return { success: true, data: { path: result.canceled ? null : result.filePaths[0] ?? null } };
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

function toIpcError<T>(err: unknown): PreloadResult<T> {
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
  if (err instanceof WorkspaceInvalidRootError) {
    return { success: false, error: { code: err.code, message: err.message } };
  }
  const message = err instanceof Error ? err.message : String(err);
  return { success: false, error: { code: 'INVALID_PAYLOAD', message } };
}
