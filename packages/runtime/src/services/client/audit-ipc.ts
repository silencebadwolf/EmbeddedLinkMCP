import type { ClientServiceHost } from './ports.js';

import {
  AuditClearRequestSchema,
  AuditExportRequestSchema,
  AuditStoreStatusSchema,
  type AuditClearResult,
  type AuditExportResult,
  type AuditStoreStatus,
} from '@linkterm/contracts/audit-contract';
import { CLIENT_CHANNELS as IPC_CHANNELS } from '@linkterm/contracts/client-protocol';
import { ERROR_CODES } from '@linkterm/contracts/error-codes';
import type { PreloadResult } from '@linkterm/contracts/preload-api';
import type { AuditStore } from '../../core/activity/audit-store.js';

export interface RegisterAuditIpcOptions {
  readonly auditStore: AuditStore;
  readonly isTrustedSender?: (senderId: number) => boolean;
}

const invalidRequest = (): PreloadResult<never> => ({
  success: false,
  error: { code: ERROR_CODES.INVALID_AUDIT_REQUEST, message: 'Invalid audit request' },
});

const untrustedSender = (): PreloadResult<never> => ({
  success: false,
  error: { code: ERROR_CODES.UNTRUSTED_SENDER, message: 'Untrusted renderer sender' },
});

const operationFailed = (code: string): PreloadResult<never> => ({
  success: false,
  error: { code, message: 'Audit operation failed' },
});

function trusted(options: RegisterAuditIpcOptions, senderId: number): boolean {
  try {
    return options.isTrustedSender?.(senderId) ?? false;
  } catch {
    return false;
  }
}

/** Register Main-only durable activity status/export/clear handlers. */
export function registerAuditIpc(
  host: ClientServiceHost,
  options: RegisterAuditIpcOptions,
): () => void {
  const ipcMain = host.requests;

  ipcMain.handle(
    IPC_CHANNELS.ACTIVITY_STATUS,
    (event, raw: unknown): PreloadResult<{ readonly status: AuditStoreStatus }> => {
      if (!trusted(options, event.sender.id)) return untrustedSender();
      if (
        raw !== undefined &&
        (typeof raw !== 'object' || raw === null || Object.keys(raw).length > 0)
      ) {
        return invalidRequest();
      }
      try {
        const status = AuditStoreStatusSchema.parse(options.auditStore.getStatus());
        return { success: true, data: { status } };
      } catch {
        return operationFailed(ERROR_CODES.AUDIT_STATUS_FAILED);
      }
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.ACTIVITY_EXPORT,
    async (event, raw: unknown): Promise<PreloadResult<AuditExportResult>> => {
      if (!trusted(options, event.sender.id)) return untrustedSender();
      const parsed = AuditExportRequestSchema.safeParse(raw);
      if (!parsed.success) return invalidRequest();
      try {
        return { success: true, data: await options.auditStore.export(parsed.data) };
      } catch {
        return operationFailed(ERROR_CODES.AUDIT_EXPORT_FAILED);
      }
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.ACTIVITY_CLEAR,
    async (event, raw: unknown): Promise<PreloadResult<AuditClearResult>> => {
      if (!trusted(options, event.sender.id)) return untrustedSender();
      if (!AuditClearRequestSchema.safeParse(raw).success) return invalidRequest();
      try {
        return { success: true, data: await options.auditStore.clear() };
      } catch {
        return operationFailed(ERROR_CODES.AUDIT_CLEAR_FAILED);
      }
    },
  );

  return () => {
    ipcMain.removeHandler(IPC_CHANNELS.ACTIVITY_STATUS);
    ipcMain.removeHandler(IPC_CHANNELS.ACTIVITY_EXPORT);
    ipcMain.removeHandler(IPC_CHANNELS.ACTIVITY_CLEAR);
  };
}
