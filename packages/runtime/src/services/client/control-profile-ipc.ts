import type { ClientServiceHost } from './ports.js';

import { randomUUID } from 'node:crypto';
import { readCurrentControlProfileDeploymentEvidence } from '../../services/current-deployment-evidence.js';
import { findStableSerialIdentity } from '../../core/readiness/serial-identity.js';
import type { SerialDiscovery } from '../../transports/serial/serial-discovery.js';
import {
  JLinkVcomRecoveryError,
  type JLinkVcomRecoveryService,
} from '../../core/recovery/jlink-vcom-recovery-service.js';
import {
  ControlProfileAlreadyInitializedError,
  ControlProfileManager,
  ControlProfileNotFoundError,
  ControlProfileRecordManager,
  ControlProfileRecordConflictError,
  ControlProfileRecordNotFoundError,
  ControlProfileSchemaVersionMismatchError,
  ControlProfileTooLargeError,
  WorkspaceInvalidRootError,
  controlProfileBodySchema,
  controlProfilePath,
} from '../../core/workspace/index.js';
import {
  ControlProfileChipConfigError,
  connectControlProfileChip,
} from '../../core/workspace/control-profile-chip.js';
import { JLinkError } from '../../jlink/errors.js';
import type { IJLinkBackend, JLinkDeviceCatalog } from '../../jlink/index.js';
import {
  CompensationCandidateService,
  type VerifiedDeploymentEvidence,
} from '../../core/compensation/index.js';
import type { SessionManager } from '../../core/session/session-manager.js';
import { defaultOpenSerial } from '../control-profile-serial.js';
import { ControlWorkflowJobManager } from '../../core/control-workflow/job-manager.js';
import type { ControlWorkflowJobSnapshot } from '../../core/control-workflow/job-manager.js';
import type { RunControlWorkflowInput } from '../../core/control-workflow/input.js';
import { runControlWorkflow } from '../../core/control-workflow/workflow-runner.js';
import { ToolError } from '../../core/errors.js';
import type { OperationAdmissionCoordinator } from '../../core/operation-admission/operation-admission-coordinator.js';
import type { SerialSessionCoordinator } from '../../core/session/serial-session-coordinator.js';
import { ERROR_CODES } from '@linkterm/contracts/error-codes';
import { CLIENT_CHANNELS as IPC_CHANNELS } from '@linkterm/contracts/client-protocol';
import type {
  ControlProfileDownloadJobPayload,
  ControlProfileDownloadResultPayload,
  ControlProfileChipProbePayload,
  ControlProfileFilePayload,
  ControlProfilePayload,
  PreloadResult,
  SavedControlProfileRecordPayload,
} from '@linkterm/contracts/preload-api';

/** 保存/读取工作区控制配置 IPC handler。 */
export interface RegisterControlProfileIpcOptions {
  sessionManager?: SessionManager;
  jlinkBackend?: IJLinkBackend;
  jlinkDeviceCatalog?: JLinkDeviceCatalog;
  controlWorkflowJobManager?: ControlWorkflowJobManager;
  operationAdmissionCoordinator?: OperationAdmissionCoordinator;
  compensationCandidateService?: CompensationCandidateService;
  onVerifiedDeployment?: (evidence: VerifiedDeploymentEvidence) => void;
  serialSessionCoordinator?: SerialSessionCoordinator;
  serialDiscovery?: Pick<SerialDiscovery, 'listPorts'>;
  jlinkVcomRecoveryService?: JLinkVcomRecoveryService;
}

export interface RunDownloadPayload {
  readonly root: string;
  readonly timeoutMs?: number;
}

export interface CompensationReflashPayload {
  readonly candidateId: string;
  readonly timeoutMs?: number;
}

export function registerControlProfileIpc(
  host: ClientServiceHost,
  manager: ControlProfileManager,
  recordManager?: ControlProfileRecordManager,
  options: RegisterControlProfileIpcOptions = {},
): () => void {
  const ipcMain = host.requests;

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
        const { root, profile, recordId, expectedUpdatedAt } = parseSavePayload(raw);
        const profileWithIdentity = await enrichControlSerialIdentity(
          profile,
          recordId,
          recordManager,
          options.serialDiscovery,
        );
        const saved = await manager.init(root, profileWithIdentity, { force: true });
        const record = await recordManager?.save({
          root,
          source: 'manual',
          profile: saved,
          ...(recordId !== undefined ? { recordId, expectedUpdatedAt } : {}),
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
        const profile = await manager.load(record.root);
        return {
          success: true,
          data: {
            path: controlProfilePath(record.root),
            record: { ...record, profile } as SavedControlProfileRecordPayload,
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
    IPC_CHANNELS.CONTROL_PROFILE_RECOVER_JLINK_VCOM,
    async (_event, raw: unknown): Promise<PreloadResult<unknown>> => {
      try {
        if (options.jlinkVcomRecoveryService === undefined) {
          throw new Error('J-Link VCOM recovery is unavailable');
        }
        const input = parseRecordUpdateIdentity(raw);
        return { success: true, data: await options.jlinkVcomRecoveryService.recover(input) };
      } catch (err) {
        return toIpcError(err);
      }
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.CONTROL_PROFILE_RUN_DOWNLOAD,
    async (event, raw: unknown): Promise<PreloadResult<ControlProfileDownloadResultPayload>> => {
      try {
        if (!options.sessionManager || !options.jlinkBackend) {
          throw new Error('Control workflow runtime is unavailable');
        }
        const input = parseRunDownloadPayload(raw);
        const data = await withControlProfileAdmission(options, 'run', input, () =>
          runControlWorkflow(
            buildRunDownloadDeps(manager, options),
            buildRunDownloadWorkflowInput(input),
            { onVerifiedDeployment: options.onVerifiedDeployment },
          ),
        );
        return { success: true, data: data as ControlProfileDownloadResultPayload };
      } catch (err) {
        return toIpcError(err);
      }
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.CONTROL_PROFILE_START_DOWNLOAD,
    async (event, raw: unknown): Promise<PreloadResult<ControlProfileDownloadJobPayload>> => {
      try {
        if (!options.sessionManager || !options.jlinkBackend) {
          throw new Error('Control workflow runtime is unavailable');
        }
        const input = parseRunDownloadPayload(raw);
        const job = await withControlProfileAdmission(options, 'start', input, async () => {
          const workflowInput = buildRunDownloadWorkflowInput(input);
          const runnerDeps = buildRunDownloadDeps(manager, options);
          const created = jobManager.create({ input: workflowInput, activityOrigin: 'human' });
          void jobManager
            .start(created.jobId, ({ signal, update }) =>
              runControlWorkflow(runnerDeps, workflowInput, {
                signal,
                onUpdate: update,
                onVerifiedDeployment: options.onVerifiedDeployment,
              }),
            )
            .catch(() => undefined);
          return created;
        });
        return { success: true, data: toDownloadJobPayload(jobManager.getStatus(job.jobId)) };
      } catch (err) {
        return toIpcError(err);
      }
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.CONTROL_PROFILE_START_COMPENSATION_REFLASH,
    async (event, raw: unknown): Promise<PreloadResult<ControlProfileDownloadJobPayload>> => {
      try {
        if (!options.sessionManager || !options.jlinkBackend) {
          throw new Error('Control workflow runtime is unavailable');
        }
        if (options.compensationCandidateService === undefined) {
          throw new Error('Compensation candidates are unavailable');
        }
        const payload = parseCompensationReflashPayload(raw);
        const candidateRoot = options.compensationCandidateService.candidateWorkspaceRoot(
          payload.candidateId,
        );
        const currentEvidence =
          candidateRoot === null
            ? undefined
            : await readCurrentControlProfileDeploymentEvidence(manager, candidateRoot);
        const reflash = options.compensationCandidateService.reflashRequest(payload.candidateId, {
          currentEvidence,
        });
        if (reflash === null) {
          throw new Error('Compensation candidate is unavailable, expired, or no longer matches');
        }
        const input: RunDownloadPayload = {
          root: reflash.root,
          ...(payload.timeoutMs !== undefined ? { timeoutMs: payload.timeoutMs } : {}),
        };
        const job = await withControlProfileAdmission(options, 'start', input, async () => {
          const workflowInput = buildRunDownloadWorkflowInput(input);
          const runnerDeps = buildRunDownloadDeps(manager, options);
          const created = jobManager.create({ input: workflowInput, activityOrigin: 'human' });
          void jobManager
            .start(created.jobId, ({ signal, update }) =>
              runControlWorkflow(runnerDeps, workflowInput, {
                signal,
                onUpdate: update,
                onVerifiedDeployment: options.onVerifiedDeployment,
              }),
            )
            .catch(() => undefined);
          return created;
        });
        return { success: true, data: toDownloadJobPayload(jobManager.getStatus(job.jobId)) };
      } catch (err) {
        return toIpcError(err);
      }
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.CONTROL_PROFILE_SAVE_PROFILE_SUGGESTION,
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
        if (options.compensationCandidateService === undefined) {
          throw new Error('Profile suggestions are unavailable');
        }
        const suggestionId = parseSuggestionIdPayload(raw);
        const suggestion = options.compensationCandidateService.profileSuggestionSave(suggestionId);
        if (suggestion === null) {
          throw new Error('Profile suggestion is unavailable or expired');
        }
        const saved = await manager.init(suggestion.root, profileFileToBody(suggestion.profile), {
          force: true,
        });
        const record = await recordManager?.save({
          root: suggestion.root,
          source: 'ai',
          profile: saved,
          label: suggestion.label,
        });
        return {
          success: true,
          data: {
            path: controlProfilePath(suggestion.root),
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
    IPC_CHANNELS.CONTROL_PROFILE_DOWNLOAD_CANCEL,
    async (_event, raw: unknown): Promise<PreloadResult<ControlProfileDownloadJobPayload>> => {
      try {
        const jobId = parseJobIdPayload(raw);
        return { success: true, data: toDownloadJobPayload(jobManager.cancel(jobId)) };
      } catch (err) {
        return toIpcError(err);
      }
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.CONTROL_PROFILE_CONNECT_CHIP,
    async (
      _event,
      raw: unknown,
    ): Promise<PreloadResult<{ probe: ControlProfileChipProbePayload }>> => {
      try {
        if (!options.jlinkBackend) throw new Error('J-Link runtime is unavailable');
        const root = parseRootPayload(raw);
        const profile = await manager.load(root);
        const probe = await connectControlProfileChip(profile, options.jlinkBackend);
        if (probe === undefined) {
          throw new ControlProfileChipConfigError(
            'jlink.enabled=true is required in control-profile.json',
          );
        }
        return { success: true, data: { probe } };
      } catch (err) {
        return toIpcError(err);
      }
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.CONTROL_PROFILE_DISCONNECT_CHIP,
    async (
      _event,
      raw: unknown,
    ): Promise<PreloadResult<{ probeId: string; disconnected: true }>> => {
      try {
        if (!options.jlinkBackend) throw new Error('J-Link runtime is unavailable');
        const probeId = parseProbeIdPayload(raw);
        await options.jlinkBackend.probeDisconnect(probeId);
        return { success: true, data: { probeId, disconnected: true } };
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
    async (): Promise<PreloadResult<{ root: string | null }>> => host.chooseWorkspaceRoot(),
  );

  ipcMain.handle(
    IPC_CHANNELS.CONTROL_PROFILE_PICK_FIRMWARE_FILE,
    async (): Promise<PreloadResult<{ path: string | null; baseAddress?: string }>> =>
      host.chooseFirmwareFile(),
  );

  return () => {
    ipcMain.removeHandler(IPC_CHANNELS.CONTROL_PROFILE_SAVE);
    ipcMain.removeHandler(IPC_CHANNELS.CONTROL_PROFILE_LOAD);
    ipcMain.removeHandler(IPC_CHANNELS.CONTROL_PROFILE_RECORDS_LIST);
    ipcMain.removeHandler(IPC_CHANNELS.CONTROL_PROFILE_RECORDS_OPEN);
    ipcMain.removeHandler(IPC_CHANNELS.CONTROL_PROFILE_RECORDS_DELETE);
    ipcMain.removeHandler(IPC_CHANNELS.CONTROL_PROFILE_RECOVER_JLINK_VCOM);
    ipcMain.removeHandler(IPC_CHANNELS.CONTROL_PROFILE_RUN_DOWNLOAD);
    ipcMain.removeHandler(IPC_CHANNELS.CONTROL_PROFILE_START_DOWNLOAD);
    ipcMain.removeHandler(IPC_CHANNELS.CONTROL_PROFILE_START_COMPENSATION_REFLASH);
    ipcMain.removeHandler(IPC_CHANNELS.CONTROL_PROFILE_SAVE_PROFILE_SUGGESTION);
    ipcMain.removeHandler(IPC_CHANNELS.CONTROL_PROFILE_DOWNLOAD_STATUS);
    ipcMain.removeHandler(IPC_CHANNELS.CONTROL_PROFILE_DOWNLOAD_READ);
    ipcMain.removeHandler(IPC_CHANNELS.CONTROL_PROFILE_DOWNLOAD_CANCEL);
    ipcMain.removeHandler(IPC_CHANNELS.CONTROL_PROFILE_CONNECT_CHIP);
    ipcMain.removeHandler(IPC_CHANNELS.CONTROL_PROFILE_DISCONNECT_CHIP);
    ipcMain.removeHandler(IPC_CHANNELS.CONTROL_PROFILE_PICK_WORKSPACE_ROOT);
    ipcMain.removeHandler(IPC_CHANNELS.CONTROL_PROFILE_PICK_FIRMWARE_FILE);
  };
}

async function enrichControlSerialIdentity(
  profile: ControlProfilePayload,
  recordId: string | undefined,
  recordManager: ControlProfileRecordManager | undefined,
  serialDiscovery: Pick<SerialDiscovery, 'listPorts'> | undefined,
): Promise<ControlProfilePayload> {
  if (profile.serial?.port === undefined) return profile;
  const liveIdentity =
    serialDiscovery === undefined
      ? undefined
      : await serialDiscovery
          .listPorts()
          .then((ports) => findStableSerialIdentity(profile.serial!.port!, ports))
          .catch(() => undefined);
  let savedIdentity: { hardwareIdentity?: string; parentIdentity?: string } | undefined;
  if (recordId !== undefined && recordManager !== undefined) {
    const current = await recordManager.get(recordId).catch(() => undefined);
    savedIdentity = current?.profile.serial;
  }
  const hardwareIdentity =
    liveIdentity?.hardwareIdentity ??
    savedIdentity?.hardwareIdentity ??
    profile.serial.hardwareIdentity;
  const parentIdentity =
    liveIdentity?.parentIdentity ?? savedIdentity?.parentIdentity ?? profile.serial.parentIdentity;
  return {
    ...profile,
    serial: {
      ...profile.serial,
      ...(hardwareIdentity !== undefined ? { hardwareIdentity } : {}),
      ...(parentIdentity !== undefined ? { parentIdentity } : {}),
    },
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
    openSerial: defaultOpenSerial(options.sessionManager, options.serialSessionCoordinator),
  };
}

function buildRunDownloadWorkflowInput(input: {
  root: string;
  timeoutMs?: number;
}): RunControlWorkflowInput {
  return {
    root: input.root,
    mode: 'flash-observe',
    observe: { enabled: false, serial: false },
    ...(input.timeoutMs !== undefined ? { firmware: { timeoutMs: input.timeoutMs } } : {}),
  };
}

async function withControlProfileAdmission<T>(
  options: RegisterControlProfileIpcOptions,
  kind: 'run' | 'start',
  input: RunDownloadPayload,
  execute: () => Promise<T>,
): Promise<T> {
  const coordinator = options.operationAdmissionCoordinator;
  if (coordinator === undefined) return execute();

  const result = await coordinator.withAdmission(
    {
      operationId: `control-profile:${kind}:${randomUUID()}`,
      principalId: 'control-profile:operator',
      origin: 'ai',
      mode: 'destructive-or-unknown',
      revalidate: async () => ({ ok: true }),
    },
    async () => execute(),
  );

  if (result.ok) return result.value;
  throw new ToolError(
    ERROR_CODES.INVALID_STATE,
    'The control profile download could not be admitted.',
    { operation: operationNameForDownload(kind) },
  );
}

function operationNameForDownload(kind: 'run' | 'start'): string {
  return kind === 'run' ? 'controlProfile.runDownload' : 'controlProfile.startDownload';
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
    cancellationCapability: job.cancellationCapability,
    ...(job.stopState !== undefined ? { stopState: job.stopState } : {}),
    ...(job.workflow?.summary !== undefined ? { summary: job.workflow.summary } : {}),
    ...(job.workflow?.failedStep !== undefined ? { failedStep: job.workflow.failedStep } : {}),
    ...(job.workflow?.failureCode !== undefined ? { failureCode: job.workflow.failureCode } : {}),
    ...(job.workflow !== undefined
      ? { workflow: job.workflow as ControlProfileDownloadResultPayload }
      : {}),
  };
}

/**
 * 解析保存请求。
 *
 * @param raw IPC 原始 payload
 * @returns root 和已校验 profile
 */
function parseSavePayload(raw: unknown): {
  root: string;
  profile: ControlProfilePayload;
  recordId?: string;
  expectedUpdatedAt?: string;
} {
  if (typeof raw !== 'object' || raw === null) throw new Error('Invalid payload');
  const r = raw as {
    root?: unknown;
    profile?: unknown;
    recordId?: unknown;
    expectedUpdatedAt?: unknown;
  };
  if (typeof r.root !== 'string' || r.root.trim().length === 0) throw new Error('root is required');
  const profile = controlProfileBodySchema.parse(r.profile) as ControlProfilePayload;
  const hasUpdateIdentity = r.recordId !== undefined || r.expectedUpdatedAt !== undefined;
  if (!hasUpdateIdentity) return { root: r.root, profile };
  if (typeof r.recordId !== 'string' || r.recordId.length === 0) {
    throw new Error('recordId is required when updating a record');
  }
  if (typeof r.expectedUpdatedAt !== 'string' || Number.isNaN(Date.parse(r.expectedUpdatedAt))) {
    throw new Error('expectedUpdatedAt must be an ISO timestamp when updating a record');
  }
  return {
    root: r.root,
    profile,
    recordId: r.recordId,
    expectedUpdatedAt: r.expectedUpdatedAt,
  };
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

function parseRecordUpdateIdentity(raw: unknown): {
  recordId: string;
  expectedUpdatedAt: string;
} {
  if (typeof raw !== 'object' || raw === null) throw new Error('Invalid payload');
  const recordId = parseRecordIdPayload(raw);
  const expectedUpdatedAt = (raw as { expectedUpdatedAt?: unknown }).expectedUpdatedAt;
  if (typeof expectedUpdatedAt !== 'string' || Number.isNaN(Date.parse(expectedUpdatedAt))) {
    throw new Error('expectedUpdatedAt must be an ISO timestamp');
  }
  return { recordId, expectedUpdatedAt };
}

function parseRunDownloadPayload(raw: unknown): RunDownloadPayload {
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
  return { root, ...(rawTimeoutMs !== undefined ? { timeoutMs: rawTimeoutMs } : {}) };
}

function parseCompensationReflashPayload(raw: unknown): CompensationReflashPayload {
  if (typeof raw !== 'object' || raw === null) throw new Error('Invalid payload');
  const candidateId = (raw as { candidateId?: unknown }).candidateId;
  if (typeof candidateId !== 'string' || candidateId.trim().length === 0) {
    throw new Error('candidateId is required');
  }
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
    candidateId,
    ...(rawTimeoutMs !== undefined ? { timeoutMs: rawTimeoutMs } : {}),
  };
}

function parseSuggestionIdPayload(raw: unknown): string {
  if (typeof raw !== 'object' || raw === null) throw new Error('Invalid payload');
  const suggestionId = (raw as { suggestionId?: unknown }).suggestionId;
  if (typeof suggestionId !== 'string' || suggestionId.trim().length === 0) {
    throw new Error('suggestionId is required');
  }
  return suggestionId;
}

function parseJobIdPayload(raw: unknown): string {
  if (typeof raw !== 'object' || raw === null) throw new Error('Invalid payload');
  const jobId = (raw as { jobId?: unknown }).jobId;
  if (typeof jobId !== 'string' || jobId.trim().length === 0) throw new Error('jobId is required');
  return jobId;
}

function parseProbeIdPayload(raw: unknown): string {
  if (typeof raw !== 'object' || raw === null) throw new Error('Invalid payload');
  const probeId = (raw as { probeId?: unknown }).probeId;
  if (typeof probeId !== 'string' || probeId.trim().length === 0)
    throw new Error('probeId is required');
  return probeId;
}

function toIpcError<T>(err: unknown): PreloadResult<T> {
  if (err instanceof ToolError) {
    return {
      success: false,
      error: {
        code: err.code,
        message: err.message,
        ...(err.details !== undefined ? { details: err.details } : {}),
      },
    };
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
  if (err instanceof ControlProfileRecordConflictError) {
    return {
      success: false,
      error: {
        code: err.code,
        message: err.message,
        details: {
          recordId: err.recordId,
          expectedUpdatedAt: err.expectedUpdatedAt,
          actualUpdatedAt: err.actualUpdatedAt,
        },
      },
    };
  }
  if (err instanceof JLinkVcomRecoveryError) {
    return { success: false, error: { code: err.code, message: err.message } };
  }
  if (err instanceof WorkspaceInvalidRootError) {
    return { success: false, error: { code: err.code, message: err.message } };
  }
  if (err instanceof ControlProfileChipConfigError) {
    return { success: false, error: { code: err.code, message: err.message } };
  }
  if (err instanceof JLinkError) {
    return { success: false, error: { code: err.code, message: err.message } };
  }
  const message = err instanceof Error ? err.message : String(err);
  return { success: false, error: { code: 'INVALID_PAYLOAD', message } };
}
