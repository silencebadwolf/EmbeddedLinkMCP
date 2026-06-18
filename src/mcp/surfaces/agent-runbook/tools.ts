import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { SessionManager } from '../../../core/session/session-manager.js';
import type { ControlProfileManager } from '../../../core/workspace/index.js';
import type { IJLinkBackend, ProbeInfo } from '../../../jlink/types.js';
import type { SerialPortInfo } from '../../../shared/types.js';
import type { SerialDiscovery } from '../../../transports/serial/serial-discovery.js';
import { ERROR_CODES } from '../../../shared/error-codes.js';
import { APP_NAME } from '../../../shared/constants.js';
import { JLinkError } from '../../../jlink/errors.js';
import { registerTool, ToolError, type ToolHandlerResult } from '../../registry.js';
import type { ToolSetDiagnostics } from '../../tool-set.js';
import { LINKTERM_MCP_SCHEMA_VERSION } from '../../versioning/version-check.js';
import type { RuntimeDiagnostics } from '../../runtime-diagnostics.js';
import type { CapturableWindow } from '../ui/types.js';
import {
  createAgentRunbook,
  createProfileStatusSummary,
  sanitizeControlProfileForRunbook,
  type RunbookProfileSummary,
} from './runbook.js';
import {
  getAgentRunbookInputSchema,
  getAppStatusInputSchema,
  type GetAgentRunbookInput,
  type GetAppStatusInput,
} from './schemas.js';

export interface AgentRunbookToolsDeps {
  sessionManager: SessionManager;
  serialDiscovery: SerialDiscovery;
  controlProfileManager?: ControlProfileManager;
  jlinkBackend: IJLinkBackend;
  getActiveWindow?: () => CapturableWindow | null;
  runtimeDiagnostics?: () => RuntimeDiagnostics | Promise<RuntimeDiagnostics>;
  toolSetDiagnostics?: () => ToolSetDiagnostics;
}

export function registerAgentRunbookTools(server: McpServer, deps: AgentRunbookToolsDeps): void {
  registerTool(server, {
    name: 'get_agent_runbook',
    description:
      'Return a runtime-generated AI operation runbook for LinkTerm, including safe workflows, high-impact confirmation rules, sanitized runtime/profile facts, and the current ownership boundary. This tool is read-only.',
    sensitivity: 'read-only',
    inputSchema: getAgentRunbookInputSchema,
    handler: async (input: GetAgentRunbookInput): Promise<ToolHandlerResult> => {
      try {
        const profileSummary = await buildProfileSummary(deps.controlProfileManager, input.root);
        const runbook = createAgentRunbook({
          schemaVersion: LINKTERM_MCP_SCHEMA_VERSION,
          profileSummary,
        });
        return {
          success: true,
          evidence: {
            kind: 'agent_runbook',
            data: runbook,
            cursor: 0,
          },
        };
      } catch (err) {
        if (err instanceof ToolError) throw err;
        throw new ToolError(ERROR_CODES.INTERNAL, err instanceof Error ? err.message : String(err));
      }
    },
  });

  registerTool(server, {
    name: 'get_app_status',
    description:
      'Return a read-only LinkTerm app status snapshot for AI startup: schema, sessions, serial ports, sanitized control profile summary, J-Link probe visibility, and UI availability. This tool never captures screenshots, flashes, resets, halts, starts GDB, or writes to sessions.',
    sensitivity: 'read-only',
    inputSchema: getAppStatusInputSchema,
    handler: async (input: GetAppStatusInput): Promise<ToolHandlerResult> => {
      try {
        const [profileSummary, serialStatus, jlinkStatus, runtimeStatus] = await Promise.all([
          buildProfileSummary(deps.controlProfileManager, input.root),
          buildSerialStatus(deps.serialDiscovery),
          buildJLinkStatus(deps.jlinkBackend),
          deps.runtimeDiagnostics?.() ?? defaultRuntimeDiagnostics(),
        ]);
        const sessionSummaries = deps.sessionManager.listSummaries();
        return {
          success: true,
          evidence: {
            kind: 'app_status',
            data: {
              app: {
                name: APP_NAME,
                schemaVersion: LINKTERM_MCP_SCHEMA_VERSION,
                mcpRunning: true,
                runtime: {
                  ...runtimeStatus,
                  toolSet: deps.toolSetDiagnostics?.() ?? emptyToolSetDiagnostics(),
                },
              },
              sessions: {
                count: sessionSummaries.length,
                items: sessionSummaries,
              },
              serial: serialStatus,
              controlProfile: profileSummary,
              jlink: jlinkStatus,
              ui: buildUiStatus(deps.getActiveWindow),
              recommendedNextActions: buildRecommendedNextActions(profileSummary, serialStatus, jlinkStatus),
            },
            cursor: 0,
          },
        };
      } catch (err) {
        if (err instanceof ToolError) throw err;
        throw new ToolError(ERROR_CODES.INTERNAL, err instanceof Error ? err.message : String(err));
      }
    },
  });
}

async function buildProfileSummary(
  manager: ControlProfileManager | undefined,
  root: string | undefined,
): Promise<RunbookProfileSummary> {
  if (root === undefined) {
    return createProfileStatusSummary('root-not-provided', false);
  }
  if (manager === undefined) {
    return createProfileStatusSummary('manager-unavailable', true, 'ControlProfileManager is not available in this runtime.');
  }
  try {
    const profile = await manager.load(root);
    return sanitizeControlProfileForRunbook(profile, 'loaded');
  } catch (err) {
    if (err instanceof ToolError) throw err;
    if (err instanceof Error && 'code' in err && (err as { code?: string }).code === 'CONTROL_PROFILE_NOT_FOUND') {
      return createProfileStatusSummary('profile-not-found', true, err.message);
    }
    if (err instanceof Error && 'code' in err && (err as { code?: string }).code === 'CONTROL_PROFILE_SCHEMA_VERSION_MISMATCH') {
      return createProfileStatusSummary('schema-version-mismatch', true, err.message);
    }
    if (err instanceof Error && 'code' in err && (err as { code?: string }).code === 'CONTROL_PROFILE_TOO_LARGE') {
      return createProfileStatusSummary('profile-too-large', true, err.message);
    }
    if (err instanceof Error && 'code' in err && (err as { code?: string }).code === 'WORKSPACE_INVALID_ROOT') {
      return createProfileStatusSummary('invalid-root', true, err.message);
    }
    return createProfileStatusSummary('invalid-profile', true, err instanceof Error ? err.message : String(err));
  }
}

async function buildSerialStatus(serialDiscovery: SerialDiscovery): Promise<{
  portCount: number;
  ports: readonly SerialPortInfo[];
  error?: { code: string; message: string };
}> {
  try {
    const ports = await serialDiscovery.listPorts();
    return { portCount: ports.length, ports };
  } catch (err) {
    return {
      portCount: 0,
      ports: [],
      error: { code: 'SERIAL_DISCOVERY_FAILED', message: err instanceof Error ? err.message : String(err) },
    };
  }
}

async function buildJLinkStatus(jlinkBackend: IJLinkBackend): Promise<{
  available: boolean;
  probeCount: number;
  probes: Array<Omit<ProbeInfo, 'serialNumber'>>;
  error?: { code: string; message: string };
}> {
  try {
    const probes = (await jlinkBackend.probeDetect()).map(sanitizeProbeForStatus);
    return { available: true, probeCount: probes.length, probes };
  } catch (err) {
    return {
      available: false,
      probeCount: 0,
      probes: [],
      error: {
        code: err instanceof JLinkError ? err.code : ERROR_CODES.INTERNAL,
        message: err instanceof Error ? err.message : String(err),
      },
    };
  }
}

function sanitizeProbeForStatus(p: ProbeInfo): Omit<ProbeInfo, 'serialNumber'> {
  const { serialNumber: _serialNumber, ...rest } = p;
  void _serialNumber;
  return rest;
}

function defaultRuntimeDiagnostics(): RuntimeDiagnostics {
  return {
    identity: {
      runtimeId: 'unknown',
      pid: process.pid,
      startedAt: 'unknown',
    },
    transport: { mode: 'unknown' },
    metadata: { available: false, fresh: false },
  };
}

function emptyToolSetDiagnostics(): ToolSetDiagnostics {
  return {
    count: 0,
    hash: '',
    core: {
      expected: [],
      complete: false,
      missing: [],
    },
  };
}

function buildUiStatus(getActiveWindow: (() => CapturableWindow | null) | undefined): {
  available: boolean;
  screenshotCaptured: false;
  error?: { code: string; message: string };
} {
  try {
    const activeWindow = getActiveWindow?.() ?? null;
    return { available: activeWindow !== null, screenshotCaptured: false };
  } catch (err) {
    return {
      available: false,
      screenshotCaptured: false,
      error: { code: 'UI_STATUS_FAILED', message: err instanceof Error ? err.message : String(err) },
    };
  }
}

function buildRecommendedNextActions(
  profileSummary: RunbookProfileSummary,
  serialStatus: { portCount: number },
  jlinkStatus: { available: boolean; probeCount: number },
): string[] {
  if (profileSummary.status === 'loaded') {
    return ['Use activate_control_profile for non-destructive control activation when needed.'];
  }
  if (profileSummary.status === 'profile-not-found' || profileSummary.status === 'root-not-provided') {
    return ['Use inspect_control_profile before workspace-specific hardware workflows.'];
  }
  if (serialStatus.portCount > 0 || jlinkStatus.probeCount > 0) {
    return ['Use LinkTerm MCP read-only tools for more targeted evidence before state-affecting operations.'];
  }
  return ['Ask the user for the workspace root or connection target before operating hardware.'];
}
