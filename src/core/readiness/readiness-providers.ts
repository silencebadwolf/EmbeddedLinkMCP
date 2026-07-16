import type { SerialPortInfo, SessionSummary } from '../../shared/types.js';
import type {
  CompensationCandidateSummary,
  DeviceCandidate,
  ProfileSuggestionSummary,
  ReadinessCheck,
  ReadinessEvidence,
  ReusableProfile,
  ReusableSession,
} from '../../shared/readiness-contract.js';
import type { ReadinessProviderResult } from './runtime-readiness-service.js';
import { resolveDeviceCandidates, type SavedSerialProfileHint } from './device-candidate-resolver.js';

export interface RuntimeStatusFacts {
  readonly codeFresh: boolean;
  readonly runtimeFresh: boolean;
}

export interface RuntimeStatusProviderOptions {
  readonly getStatus: () => Promise<RuntimeStatusFacts>;
}

export interface SerialDiscoveryProviderOptions {
  readonly listPorts: () => Promise<readonly SerialPortInfo[]>;
  readonly savedProfiles?: () => Promise<readonly SavedSerialProfileHint[]>;
}

export interface ReusableSessionsProviderOptions {
  readonly listSessions: () => Promise<readonly SessionSummary[]>;
}

export interface WorkspaceProfileSummary {
  readonly id: string;
  readonly label: string;
  readonly root?: string;
}

export interface WorkspaceProfileProviderOptions {
  readonly listProfiles: () => Promise<readonly WorkspaceProfileSummary[]>;
}

export interface AgentIntegrationSummary {
  readonly id: string;
  readonly label: string;
  readonly installed: boolean;
  readonly diagnosticCode?: string;
}

export interface AgentIntegrationProviderOptions {
  readonly listAgents: () => Promise<readonly AgentIntegrationSummary[]>;
}

export interface JLinkReadinessProbeSummary {
  readonly probeId: string;
  readonly label?: string;
  readonly serialNumber?: string;
  readonly target?: string;
  readonly connected?: boolean;
}

export interface JLinkReadinessProviderOptions {
  readonly detectProbes?: () => Promise<readonly JLinkReadinessProbeSummary[]>;
  readonly targetName?: () => Promise<string | undefined>;
  readonly hasTargetInCatalog?: (targetName: string) => Promise<boolean>;
}

export interface FirmwareReadinessMetadata {
  readonly displayName: string;
  readonly hashSha256Prefix?: string;
  readonly byteLength: number;
  readonly format: 'bin' | 'hex' | 'elf' | 'unknown';
  readonly baseAddress: number;
  readonly verify: boolean;
}

export interface FirmwareReadinessProviderOptions {
  readonly readFirmwareMetadata?: () => Promise<FirmwareReadinessMetadata | undefined>;
}

export interface RttReadinessConfig {
  readonly channelIndex: number;
  readonly maxBytes: number;
  readonly timeoutMs: number;
  readonly markers: readonly string[];
}

export interface RttReadinessProviderOptions {
  readonly readRttConfig?: () => Promise<RttReadinessConfig | undefined>;
}

export interface CompensationSummaryProviderOptions {
  readonly summaries: () =>
    | readonly CompensationCandidateSummary[]
    | Promise<readonly CompensationCandidateSummary[]>;
  readonly profileSuggestions?: () =>
    | readonly ProfileSuggestionSummary[]
    | Promise<readonly ProfileSuggestionSummary[]>;
}

export function createRuntimeStatusProvider(options: RuntimeStatusProviderOptions) {
  return {
    id: 'runtime',
    scope: 'runtime',
    async collect({ checkedAt }: { readonly checkedAt: string }): Promise<ReadinessProviderResult> {
      const status = await options.getStatus();
      const ready = status.codeFresh && status.runtimeFresh;
      return {
        checks: [
          check({
            id: 'runtime',
            scope: 'runtime',
            status: ready ? 'ready' : 'action-required',
            severity: ready ? 'info' : 'warning',
            summaryCode: ready ? 'readiness.runtime.ready' : 'readiness.runtime.stale',
            checkedAt,
            evidence: [
              evidence('runtime', ready ? 'readiness.runtime.fresh' : 'readiness.runtime.stale'),
            ],
          }),
        ],
      };
    },
  } as const;
}

export function createSerialDiscoveryProvider(options: SerialDiscoveryProviderOptions) {
  return {
    id: 'serial',
    scope: 'serial',
    async collect({ checkedAt }: { readonly checkedAt: string }): Promise<ReadinessProviderResult> {
      try {
        const [ports, savedProfiles] = await Promise.all([
          options.listPorts(),
          options.savedProfiles?.() ?? Promise.resolve([]),
        ]);
        const candidates = resolveDeviceCandidates({ serialPorts: ports, savedProfiles });
        return {
          checks: [
            check({
              id: 'serial',
              scope: 'serial',
              status: candidates.length > 0 ? 'ready' : 'action-required',
              severity: candidates.length > 0 ? 'info' : 'warning',
              summaryCode:
                candidates.length > 0 ? 'readiness.serial.ready' : 'readiness.serial.empty',
              checkedAt,
              evidence: [
                evidence('live-discovery', 'readiness.serial.scan_completed', [
                  { key: 'count', value: String(candidates.length) },
                ]),
              ],
            }),
          ],
          deviceCandidates: candidates,
        };
      } catch {
        return {
          checks: [
            check({
              id: 'serial',
              scope: 'serial',
              status: 'unavailable',
              severity: 'error',
              summaryCode: 'readiness.serial.discovery_failed',
              checkedAt,
              evidence: [],
            }),
          ],
          deviceCandidates: [],
          diagnostics: [{ code: 'readiness.serial.discovery_failed', severity: 'error', checkedAt }],
        };
      }
    },
  } as const;
}

export function createReusableSessionsProvider(options: ReusableSessionsProviderOptions) {
  return {
    id: 'session',
    scope: 'session',
    async collect({ checkedAt }: { readonly checkedAt: string }): Promise<ReadinessProviderResult> {
      const sessions = await options.listSessions();
      const reusableSessions = sessions
        .filter((session) => session.state === 'open')
        .map(
          (session): ReusableSession => ({
            id: safeCode(session.sessionId),
            label: safeLabel(session.label),
            kind: session.connectionType,
          }),
        );
      return {
        checks: [
          check({
            id: 'session',
            scope: 'session',
            status: reusableSessions.length > 0 ? 'ready' : 'unknown',
            severity: 'info',
            summaryCode:
              reusableSessions.length > 0
                ? 'readiness.session.reusable'
                : 'readiness.session.none',
            checkedAt,
            evidence: [
              evidence('session', 'readiness.session.count', [
                { key: 'count', value: String(reusableSessions.length) },
              ]),
            ],
          }),
        ],
        reusableSessions,
      };
    },
  } as const;
}

export function createWorkspaceProfileProvider(options: WorkspaceProfileProviderOptions) {
  return {
    id: 'workspace',
    scope: 'workspace',
    async collect({ checkedAt }: { readonly checkedAt: string }): Promise<ReadinessProviderResult> {
      try {
        const profiles = await options.listProfiles();
        const reusableProfiles = profiles.map(
          (profile): ReusableProfile => ({
            id: safeCode(profile.id),
            label: safeLabel(profile.label),
            kind: 'control-profile',
          }),
        );
        return {
          checks: [
            check({
              id: 'workspace',
              scope: 'workspace',
              status: reusableProfiles.length > 0 ? 'ready' : 'unavailable',
              severity: reusableProfiles.length > 0 ? 'info' : 'info',
              summaryCode:
                reusableProfiles.length > 0
                  ? 'readiness.workspace.profiles_available'
                  : 'readiness.workspace.not_selected',
              checkedAt,
              evidence:
                reusableProfiles.length > 0
                  ? [
                      evidence('saved-record', 'readiness.profile.count', [
                        { key: 'count', value: String(reusableProfiles.length) },
                      ]),
                    ]
                  : [],
            }),
          ],
          reusableProfiles,
        };
      } catch {
        return {
          checks: [
            check({
              id: 'workspace',
              scope: 'workspace',
              status: 'unavailable',
              severity: 'warning',
              summaryCode: 'readiness.workspace.unavailable',
              checkedAt,
              evidence: [],
            }),
          ],
          reusableProfiles: [],
          diagnostics: [{ code: 'readiness.workspace.unavailable', severity: 'warning', checkedAt }],
        };
      }
    },
  } as const;
}

export function createAgentIntegrationProvider(options: AgentIntegrationProviderOptions) {
  return {
    id: 'agent',
    scope: 'agent',
    async collect({ checkedAt }: { readonly checkedAt: string }): Promise<ReadinessProviderResult> {
      const agents = await options.listAgents();
      const missing = agents.filter((agent) => !agent.installed);
      return {
        checks: [
          check({
            id: 'agent',
            scope: 'agent',
            status: missing.length === 0 ? 'ready' : 'action-required',
            severity: missing.length === 0 ? 'info' : 'warning',
            summaryCode:
              missing.length === 0
                ? 'readiness.agent.ready'
                : missing[0]?.diagnosticCode ?? 'readiness.agent.action_required',
            checkedAt,
            evidence: [
              evidence('agent-integration', 'readiness.agent.count', [
                { key: 'count', value: String(agents.length) },
              ]),
            ],
          }),
        ],
      };
    },
  } as const;
}

export function createJLinkReadinessProvider(options: JLinkReadinessProviderOptions) {
  return {
    id: 'jlink',
    scope: 'jlink',
    async collect({ checkedAt }: { readonly checkedAt: string }): Promise<ReadinessProviderResult> {
      if (options.detectProbes === undefined) {
        return {
          checks: [
            check({
              id: 'jlink',
              scope: 'jlink',
              status: 'unavailable',
              severity: 'error',
              summaryCode: 'readiness.jlink.backend.unavailable',
              checkedAt,
              evidence: [],
            }),
          ],
          deviceCandidates: [],
          diagnostics: [
            {
              code: 'readiness.jlink.backend.unavailable',
              severity: 'error',
              checkedAt,
            },
          ],
        };
      }

      try {
        const [probes, requestedTarget] = await Promise.all([
          options.detectProbes(),
          options.targetName?.() ?? Promise.resolve(undefined),
        ]);
        const target = requestedTarget?.trim();
        const catalogHasTarget =
          target !== undefined && target !== '' && options.hasTargetInCatalog !== undefined
            ? await options.hasTargetInCatalog(target)
            : undefined;
        const targetMissing = catalogHasTarget === false;
        const noProbes = probes.length === 0;
        const status = noProbes || targetMissing ? 'action-required' : 'ready';
        const summaryCode = noProbes
          ? 'readiness.jlink.probe.empty'
          : targetMissing
            ? 'readiness.jlink.target_not_in_catalog'
            : 'readiness.jlink.ready';
        const safeTarget = target !== undefined && target !== '' ? safeLabel(target) : undefined;
        return {
          checks: [
            check({
              id: 'jlink',
              scope: 'jlink',
              status,
              severity: status === 'ready' ? 'info' : 'warning',
              summaryCode,
              checkedAt,
              evidence: [
                evidence('jlink-backend', 'readiness.jlink.backend.available'),
                evidence('probe-detect', 'readiness.jlink.probe.count', [
                  { key: 'count', value: String(probes.length) },
                ]),
                ...(safeTarget !== undefined
                  ? [
                      evidence(
                        'device-catalog',
                        targetMissing
                          ? 'readiness.jlink.target.catalog_miss'
                          : 'readiness.jlink.target.catalog_checked',
                        [{ key: 'target', value: safeTarget }],
                      ),
                    ]
                  : []),
              ],
            }),
          ],
          deviceCandidates: probes.map((probe, index) =>
            jlinkCandidate(probe, index, safeTarget, probes.length, targetMissing),
          ),
        };
      } catch {
        return {
          checks: [
            check({
              id: 'jlink',
              scope: 'jlink',
              status: 'unavailable',
              severity: 'error',
              summaryCode: 'readiness.jlink.discovery_failed',
              checkedAt,
              evidence: [],
            }),
          ],
          deviceCandidates: [],
          diagnostics: [
            {
              code: 'readiness.jlink.discovery_failed',
              severity: 'error',
              checkedAt,
            },
          ],
        };
      }
    },
  } as const;
}

export function createFirmwareReadinessProvider(options: FirmwareReadinessProviderOptions) {
  return {
    id: 'firmware',
    scope: 'firmware',
    async collect({ checkedAt }: { readonly checkedAt: string }): Promise<ReadinessProviderResult> {
      if (options.readFirmwareMetadata === undefined) {
        return missingFirmware(checkedAt);
      }
      try {
        const metadata = await options.readFirmwareMetadata();
        if (metadata === undefined) return missingFirmware(checkedAt);
        const firmwareLabel = safeBasename(metadata.displayName);
        return {
          checks: [
            check({
              id: 'firmware',
              scope: 'firmware',
              status: 'ready',
              severity: 'info',
              summaryCode: 'readiness.firmware.ready',
              checkedAt,
              evidence: [
                evidence('firmware-metadata', 'readiness.firmware.metadata.ready', [
                  { key: 'firmware', value: firmwareLabel },
                  { key: 'format', value: metadata.format },
                  { key: 'bytes', value: String(metadata.byteLength) },
                  ...(metadata.hashSha256Prefix !== undefined
                    ? [{ key: 'hash', value: metadata.hashSha256Prefix }]
                    : []),
                ]),
              ],
            }),
          ],
          diagnostics: [],
        };
      } catch {
        return {
          checks: [
            check({
              id: 'firmware',
              scope: 'firmware',
              status: 'unavailable',
              severity: 'error',
              summaryCode: 'readiness.firmware.metadata_failed',
              checkedAt,
              evidence: [],
            }),
          ],
          diagnostics: [
            {
              code: 'readiness.firmware.metadata_failed',
              severity: 'error',
              checkedAt,
            },
          ],
        };
      }
    },
  } as const;
}

export function createRttReadinessProvider(options: RttReadinessProviderOptions) {
  return {
    id: 'rtt',
    scope: 'rtt',
    async collect({ checkedAt }: { readonly checkedAt: string }): Promise<ReadinessProviderResult> {
      if (options.readRttConfig === undefined) {
        return missingRttConfig(checkedAt);
      }
      try {
        const config = await options.readRttConfig();
        if (config === undefined) return missingRttConfig(checkedAt);
        return {
          checks: [
            check({
              id: 'rtt',
              scope: 'rtt',
              status: 'ready',
              severity: 'info',
              summaryCode: 'readiness.rtt.ready',
              checkedAt,
              evidence: [
                evidence('rtt-config', 'readiness.rtt.config.ready', [
                  { key: 'channel', value: `RTT up ${config.channelIndex}` },
                  { key: 'maxBytes', value: String(config.maxBytes) },
                  { key: 'timeoutMs', value: String(config.timeoutMs) },
                  { key: 'markers', value: String(config.markers.length) },
                ]),
              ],
            }),
          ],
        };
      } catch {
        return {
          checks: [
            check({
              id: 'rtt',
              scope: 'rtt',
              status: 'unavailable',
              severity: 'error',
              summaryCode: 'readiness.rtt.config_failed',
              checkedAt,
              evidence: [],
            }),
          ],
          diagnostics: [
            {
              code: 'readiness.rtt.config_failed',
              severity: 'error',
              checkedAt,
            },
          ],
        };
      }
    },
  } as const;
}

export function createCompensationSummaryProvider(options: CompensationSummaryProviderOptions) {
  return {
    id: 'compensation',
    scope: 'jlink',
    async collect(): Promise<ReadinessProviderResult> {
      return {
        checks: [],
        compensationCandidates: await options.summaries(),
        profileSuggestions: options.profileSuggestions === undefined ? [] : await options.profileSuggestions(),
      };
    },
  } as const;
}

function check(input: {
  readonly id: ReadinessCheck['id'];
  readonly scope: ReadinessCheck['scope'];
  readonly status: ReadinessCheck['status'];
  readonly severity: ReadinessCheck['severity'];
  readonly summaryCode: ReadinessCheck['summaryCode'];
  readonly checkedAt: string;
  readonly evidence: readonly ReadinessEvidence[];
}): ReadinessCheck {
  return {
    id: input.id,
    scope: input.scope,
    status: input.status,
    severity: input.severity,
    summaryCode: input.summaryCode,
    checkedAt: input.checkedAt,
    evidence: input.evidence,
    recommendedActions: [],
  };
}

function evidence(
  source: ReadinessEvidence['source'],
  summaryCode: string,
  params: ReadinessEvidence['params'] = [],
): ReadinessEvidence {
  return {
    source,
    summaryCode,
    ...(params.length > 0 ? { params } : {}),
  };
}

function safeCode(value: string): string {
  const sanitized = value.replace(/[^A-Za-z0-9._:-]+/gu, '_').replace(/^_+/u, '');
  return sanitized.length > 0 ? sanitized.slice(0, 96) : 'item';
}

function safeLabel(value: string): string {
  const sanitized = value
    .replace(/^[A-Za-z]:/u, '')
    .replace(/[\/\\\p{Cc}]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
  return sanitized.length > 0 ? sanitized.slice(0, 128) : 'item';
}

function jlinkCandidate(
  probe: JLinkReadinessProbeSummary,
  index: number,
  target: string | undefined,
  probeCount: number,
  targetMissing: boolean,
): DeviceCandidate {
  const probeLabel = safeLabel(probe.label ?? `J-Link probe ${index + 1}`);
  const targetLabel = target ?? (probe.target !== undefined ? safeLabel(probe.target) : undefined);
  const label = safeLabel(targetLabel === undefined ? probeLabel : `${probeLabel} · ${targetLabel}`);
  return {
    id: safeCode(`candidate_jlink_${probe.probeId}`),
    kind: 'jlink',
    label,
    confidence: probeCount === 1 && !targetMissing ? 'likely' : 'unknown',
    requiresUserConfirmation: true,
    evidence: [
      evidence('probe-detect', 'readiness.jlink.probe.detected', [
        { key: 'probe', value: probeLabel },
      ]),
      ...(targetLabel === undefined
        ? []
        : [
            evidence('device-catalog', 'readiness.jlink.target.evidence', [
              { key: 'target', value: targetLabel },
            ]),
          ]),
    ],
    jlink: {
      probeLabel,
      ...(targetLabel === undefined ? {} : { targetLabel }),
    },
  };
}

function missingFirmware(checkedAt: string): ReadinessProviderResult {
  return {
    checks: [
      check({
        id: 'firmware',
        scope: 'firmware',
        status: 'action-required',
        severity: 'warning',
        summaryCode: 'readiness.firmware.missing',
        checkedAt,
        evidence: [],
      }),
    ],
  };
}

function missingRttConfig(checkedAt: string): ReadinessProviderResult {
  return {
    checks: [
      check({
        id: 'rtt',
        scope: 'rtt',
        status: 'action-required',
        severity: 'warning',
        summaryCode: 'readiness.rtt.config_missing',
        checkedAt,
        evidence: [],
      }),
    ],
  };
}

function safeBasename(value: string): string {
  const normalized = value.replace(/\\/gu, '/');
  const lastSegment = normalized.split('/').filter((segment) => segment.trim() !== '').at(-1);
  return safeLabel(lastSegment ?? value);
}
