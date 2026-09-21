import { realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { RuntimeReadinessService } from '../core/readiness/runtime-readiness-service.js';
import {
  createAgentIntegrationProvider,
  createCompensationSummaryProvider,
  createFirmwareReadinessProvider,
  createJLinkReadinessProvider,
  createReusableSessionsProvider,
  createRttReadinessProvider,
  createRuntimeStatusProvider,
  createSerialDiscoveryProvider,
  createWorkspaceProfileProvider,
  type FirmwareReadinessMetadata,
  type JLinkReadinessProbeSummary,
  type RttReadinessConfig,
} from '../core/readiness/readiness-providers.js';
import type { CompensationCandidateService } from '../core/compensation/index.js';
import type { SessionManager } from '../core/session/session-manager.js';
import type {
  ControlProfileManager,
  ControlProfileRecordManager,
} from '../core/workspace/index.js';
import type { AgentIntegrationManager } from '../core/agent-integrations/index.js';
import type { IJLinkBackend, JLinkDeviceCatalog, ProbeInfo } from '../jlink/index.js';
import type { SerialDiscovery } from '../transports/serial/serial-discovery.js';
import type { RuntimeStatus } from '../ports.js';
import { readCurrentControlProfileDeploymentEvidence } from './current-deployment-evidence.js';

export function createRuntimeReadinessService(input: {
  readonly getRuntimeStatus: () => Promise<RuntimeStatus>;
  readonly serialDiscovery: SerialDiscovery;
  readonly sessionManager: SessionManager;
  readonly controlProfileManager: ControlProfileManager;
  readonly controlProfileRecordManager: ControlProfileRecordManager;
  readonly agentIntegrations: Pick<AgentIntegrationManager, 'listStatuses'>;
  readonly jlinkBackend: IJLinkBackend;
  readonly jlinkDeviceCatalog: JLinkDeviceCatalog;
  readonly compensationCandidateService: CompensationCandidateService;
}): RuntimeReadinessService {
  return new RuntimeReadinessService({
    providers: [
      createRuntimeStatusProvider({
        getStatus: input.getRuntimeStatus,
      }),
      createSerialDiscoveryProvider({
        listPorts: () => input.serialDiscovery.listPorts(),
        savedProfiles: async () => {
          try {
            const records = await input.controlProfileRecordManager.list();
            return records.map((record) => ({
              id: record.id,
              label: record.label,
              portLabel: record.profile.serial?.port,
              baudRate: record.profile.serial?.baudRate,
              hardwareIdentity: record.profile.serial?.hardwareIdentity,
              parentIdentity: record.profile.serial?.parentIdentity,
            }));
          } catch {
            return [];
          }
        },
      }),
      createReusableSessionsProvider({
        listSessions: async () => input.sessionManager.listSummaries(),
      }),
      createWorkspaceProfileProvider({
        listProfiles: async () => {
          const records = await input.controlProfileRecordManager.list();
          return records.map((record) => ({
            id: record.id,
            label: record.label,
            root: record.root,
          }));
        },
      }),
      createJLinkReadinessProvider({
        detectProbes: async () =>
          (await input.jlinkBackend.probeDetect()).map(projectJLinkReadinessProbe),
        targetName: async () => readSavedJLinkTarget(input.controlProfileRecordManager),
        hasTargetInCatalog: async (targetName) => input.jlinkDeviceCatalog.has(targetName),
      }),
      createFirmwareReadinessProvider({
        readFirmwareMetadata: async () =>
          readSavedFirmwareMetadata(input.controlProfileRecordManager),
      }),
      createRttReadinessProvider({
        readRttConfig: async () => readSavedRttConfig(input.controlProfileRecordManager),
      }),
      createCompensationSummaryProvider({
        summaries: async () => {
          const root = input.compensationCandidateService.activeCandidateWorkspaceRoot();
          const currentEvidence =
            root === null
              ? undefined
              : await readCurrentControlProfileDeploymentEvidence(
                  input.controlProfileManager,
                  root,
                );
          return input.compensationCandidateService.summaries({ currentEvidence });
        },
        profileSuggestions: () => input.compensationCandidateService.profileSuggestions(),
      }),
      createAgentIntegrationProvider({
        listAgents: async () => {
          const statuses = await input.agentIntegrations.listStatuses();
          return statuses.map((status) => ({
            id: status.id,
            label: status.label,
            installed: status.configured,
            diagnosticCode: 'readiness.agent.integration_missing',
          }));
        },
      }),
    ],
  });
}

function projectJLinkReadinessProbe(probe: ProbeInfo): JLinkReadinessProbeSummary {
  const maybeLabel = (probe as { readonly label?: unknown }).label;
  return {
    probeId: probe.probeId,
    label: typeof maybeLabel === 'string' && maybeLabel.trim() !== '' ? maybeLabel : 'J-Link probe',
    target: probe.target,
    connected: probe.connected,
  };
}

async function readSavedJLinkTarget(
  manager: ControlProfileRecordManager,
): Promise<string | undefined> {
  const record = (await manager.list()).find(
    (item) => item.profile.jlink?.enabled === true && item.profile.jlink.target !== undefined,
  );
  return record?.profile.jlink?.target;
}

async function readSavedFirmwareMetadata(
  manager: ControlProfileRecordManager,
): Promise<FirmwareReadinessMetadata | undefined> {
  const record = (await manager.list()).find(
    (item) =>
      item.profile.flash?.binary !== undefined && item.profile.flash.baseAddress !== undefined,
  );
  const flash = record?.profile.flash;
  if (record === undefined || flash?.binary === undefined || flash.baseAddress === undefined) {
    return undefined;
  }

  const firmwarePath = resolveWorkspaceChildPath(record.root, flash.binary);
  const baseAddress = parseReadinessHexAddress(flash.baseAddress);
  if (firmwarePath === undefined || baseAddress === undefined) return undefined;

  const safeFirmwarePath = await resolveWorkspaceRealChildPath(record.root, firmwarePath);
  if (safeFirmwarePath === undefined) return undefined;

  const firmwareStat = await stat(safeFirmwarePath);
  if (!firmwareStat.isFile()) return undefined;
  return {
    displayName: flash.binary,
    byteLength: firmwareStat.size,
    format: firmwareFormatForPath(flash.binary),
    baseAddress,
    verify: flash.verify ?? true,
  };
}

async function readSavedRttConfig(
  manager: ControlProfileRecordManager,
): Promise<RttReadinessConfig | undefined> {
  const record = (await manager.list()).find((item) => item.profile.rtt?.enabled === true);
  const rtt = record?.profile.rtt;
  if (rtt?.enabled !== true) return undefined;
  return {
    channelIndex: rtt.channels?.[0] ?? 0,
    maxBytes: 4096,
    timeoutMs: 15_000,
    markers: [],
  };
}

function resolveWorkspaceChildPath(root: string, childPath: string): string | undefined {
  const trimmed = childPath.trim();
  if (trimmed === '') return undefined;
  const normalizedRoot = path.resolve(root);
  const resolved = path.resolve(normalizedRoot, trimmed);
  const relative = path.relative(normalizedRoot, resolved);
  if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) {
    return undefined;
  }
  return resolved;
}

async function resolveWorkspaceRealChildPath(
  root: string,
  resolvedChildPath: string,
): Promise<string | undefined> {
  try {
    const realRoot = await realpath(root);
    const realChild = await realpath(resolvedChildPath);
    return isPathInside(realRoot, realChild) ? realChild : undefined;
  } catch {
    return undefined;
  }
}

function isPathInside(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function parseReadinessHexAddress(value: string): number | undefined {
  if (!/^0x[0-9a-fA-F]+$/u.test(value)) return undefined;
  const parsed = Number.parseInt(value.slice(2), 16);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : undefined;
}

function firmwareFormatForPath(filePath: string): FirmwareReadinessMetadata['format'] {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === '.bin') return 'bin';
  if (extension === '.hex') return 'hex';
  if (extension === '.elf') return 'elf';
  return 'unknown';
}
