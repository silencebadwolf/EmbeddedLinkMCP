import {
  READINESS_MAX_CANDIDATES,
  READINESS_MAX_CHECKS,
  READINESS_MAX_COMPENSATION_SUMMARIES,
  READINESS_MAX_DIAGNOSTICS,
  READINESS_MAX_PARAMS,
  READINESS_MAX_PROFILE_SUGGESTIONS,
  READINESS_MAX_RECENT_ITEMS,
  READINESS_SCHEMA_VERSION,
  type CompensationCandidateSummary,
  RuntimeReadinessSnapshotSchema,
  type DeviceCandidate,
  type ProfileSuggestionSummary,
  type ReadinessCheck,
  type ReadinessDiagnostic,
  type ReadinessScope,
  type ReusableProfile,
  type ReusableSession,
  type RuntimeReadinessSnapshot,
  type SafeReadinessCode,
} from '../../shared/readiness-contract.js';

export interface ReadinessProviderContext {
  readonly generation: number;
  readonly checkedAt: string;
  readonly signal: AbortSignal;
}

export interface ReadinessProviderResult {
  readonly checks?: readonly ReadinessCheck[];
  readonly deviceCandidates?: readonly DeviceCandidate[];
  readonly reusableSessions?: readonly ReusableSession[];
  readonly reusableProfiles?: readonly ReusableProfile[];
  readonly blockers?: readonly SafeReadinessCode[];
  readonly diagnostics?: readonly ReadinessDiagnostic[];
  readonly compensationCandidates?: readonly CompensationCandidateSummary[];
  readonly profileSuggestions?: readonly ProfileSuggestionSummary[];
}

export interface ReadinessProvider {
  readonly id: SafeReadinessCode;
  readonly scope: ReadinessScope;
  collect(context: ReadinessProviderContext): Promise<ReadinessProviderResult>;
}

export interface RuntimeReadinessServiceOptions {
  readonly providers: readonly ReadinessProvider[];
  readonly providerTimeoutMs?: number;
  readonly now?: () => string;
  readonly createSnapshotId?: (generation: number) => SafeReadinessCode;
}

interface ProviderContribution {
  readonly checks: readonly ReadinessCheck[];
  readonly deviceCandidates: readonly DeviceCandidate[];
  readonly reusableSessions: readonly ReusableSession[];
  readonly reusableProfiles: readonly ReusableProfile[];
  readonly blockers: readonly SafeReadinessCode[];
  readonly diagnostics: readonly ReadinessDiagnostic[];
  readonly compensationCandidates: readonly CompensationCandidateSummary[];
  readonly profileSuggestions: readonly ProfileSuggestionSummary[];
}

const DEFAULT_PROVIDER_TIMEOUT_MS = 2_000;

export class RuntimeReadinessService {
  readonly #providers: readonly ReadinessProvider[];
  readonly #providerTimeoutMs: number;
  readonly #now: () => string;
  readonly #createSnapshotId: (generation: number) => SafeReadinessCode;
  #latestStartedGeneration = 0;
  #current: RuntimeReadinessSnapshot;

  constructor(options: RuntimeReadinessServiceOptions) {
    this.#providers = Object.freeze([...options.providers]);
    this.#providerTimeoutMs = options.providerTimeoutMs ?? DEFAULT_PROVIDER_TIMEOUT_MS;
    this.#now = options.now ?? (() => new Date().toISOString());
    this.#createSnapshotId = options.createSnapshotId ?? ((generation) => `readiness_${generation}`);
    this.#current = RuntimeReadinessSnapshotSchema.parse({
      schemaVersion: READINESS_SCHEMA_VERSION,
      snapshotId: this.#createSnapshotId(0),
      generation: 0,
      status: 'checking',
      generatedAt: this.#now(),
      checks: [],
      deviceCandidates: [],
      reusableSessions: [],
      reusableProfiles: [],
      blockers: [],
      diagnostics: [],
      compensationCandidates: [],
      profileSuggestions: [],
    });
  }

  getCurrent(): RuntimeReadinessSnapshot {
    return this.#current;
  }

  async refresh(): Promise<RuntimeReadinessSnapshot> {
    const generation = this.#latestStartedGeneration + 1;
    this.#latestStartedGeneration = generation;
    const checkedAt = this.#now();
    const contributions = await Promise.all(
      this.#providers.map((provider) => this.#collectProvider(provider, generation, checkedAt)),
    );
    const snapshot = RuntimeReadinessSnapshotSchema.parse({
      schemaVersion: READINESS_SCHEMA_VERSION,
      snapshotId: this.#createSnapshotId(generation),
      generation,
      status: aggregateStatus(contributions),
      generatedAt: checkedAt,
      checks: contributions.flatMap((contribution) => contribution.checks),
      deviceCandidates: contributions.flatMap((contribution) => contribution.deviceCandidates),
      reusableSessions: contributions.flatMap((contribution) => contribution.reusableSessions),
      reusableProfiles: contributions.flatMap((contribution) => contribution.reusableProfiles),
      blockers: contributions.flatMap((contribution) => contribution.blockers),
      diagnostics: contributions.flatMap((contribution) => contribution.diagnostics),
      compensationCandidates: contributions.flatMap(
        (contribution) => contribution.compensationCandidates,
      ),
      profileSuggestions: contributions.flatMap((contribution) => contribution.profileSuggestions),
    });

    if (generation === this.#latestStartedGeneration) {
      this.#current = snapshot;
    }
    return snapshot;
  }

  async #collectProvider(
    provider: ReadinessProvider,
    generation: number,
    checkedAt: string,
  ): Promise<ProviderContribution> {
    const controller = new AbortController();
    let timedOut = false;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        timedOut = true;
        controller.abort();
        reject(new Error('readiness provider timeout'));
      }, this.#providerTimeoutMs);
    });
    const collect = Promise.resolve(
      provider.collect({ generation, checkedAt, signal: controller.signal }),
    );
    collect.catch(() => undefined);

    try {
      const raw = await Promise.race([collect, timeout]);
      const contribution = normalizeProviderResult(raw, checkedAt);
      const parsed = RuntimeReadinessSnapshotSchema.safeParse({
        schemaVersion: READINESS_SCHEMA_VERSION,
        snapshotId: `provider_${provider.id}_${generation}`,
        generation,
        status: aggregateStatus([contribution]),
        generatedAt: checkedAt,
        checks: contribution.checks,
        deviceCandidates: contribution.deviceCandidates,
        reusableSessions: contribution.reusableSessions,
        reusableProfiles: contribution.reusableProfiles,
        blockers: contribution.blockers,
        diagnostics: contribution.diagnostics,
        compensationCandidates: contribution.compensationCandidates,
        profileSuggestions: contribution.profileSuggestions,
      });
      return parsed.success
        ? contribution
        : failureContribution(provider, checkedAt, 'readiness.provider_invalid');
    } catch {
      return failureContribution(
        provider,
        checkedAt,
        timedOut ? 'readiness.provider_timeout' : 'readiness.provider_failed',
      );
    } finally {
      if (timeoutId !== undefined) clearTimeout(timeoutId);
    }
  }
}

function normalizeProviderResult(
  result: ReadinessProviderResult,
  checkedAt: string,
): ProviderContribution {
  const checks = truncate(result.checks ?? [], READINESS_MAX_CHECKS);
  const deviceCandidates = truncate(result.deviceCandidates ?? [], READINESS_MAX_CANDIDATES);
  const reusableSessions = truncate(result.reusableSessions ?? [], READINESS_MAX_RECENT_ITEMS);
  const reusableProfiles = truncate(result.reusableProfiles ?? [], READINESS_MAX_RECENT_ITEMS);
  const blockers = truncate(result.blockers ?? [], READINESS_MAX_PARAMS);
  const diagnostics = truncate(result.diagnostics ?? [], READINESS_MAX_DIAGNOSTICS);
  const compensationCandidates = truncate(
    result.compensationCandidates ?? [],
    READINESS_MAX_COMPENSATION_SUMMARIES,
  );
  const profileSuggestions = truncate(
    result.profileSuggestions ?? [],
    READINESS_MAX_PROFILE_SUGGESTIONS,
  );
  const truncated =
    checks.truncated ||
    deviceCandidates.truncated ||
    reusableSessions.truncated ||
    reusableProfiles.truncated ||
    blockers.truncated ||
    diagnostics.truncated ||
    compensationCandidates.truncated ||
    profileSuggestions.truncated;
  return {
    checks: Object.freeze(checks.items),
    deviceCandidates: Object.freeze(deviceCandidates.items),
    reusableSessions: Object.freeze(reusableSessions.items),
    reusableProfiles: Object.freeze(reusableProfiles.items),
    blockers: Object.freeze(blockers.items),
    diagnostics: Object.freeze(
      appendTruncationDiagnostic(diagnostics.items, checkedAt, truncated),
    ),
    compensationCandidates: Object.freeze(compensationCandidates.items),
    profileSuggestions: Object.freeze(profileSuggestions.items),
  };
}

function truncate<T>(
  items: readonly T[],
  maxItems: number,
): { readonly items: readonly T[]; readonly truncated: boolean } {
  return {
    items: items.slice(0, maxItems),
    truncated: items.length > maxItems,
  };
}

function appendTruncationDiagnostic(
  diagnostics: readonly ReadinessDiagnostic[],
  checkedAt: string,
  truncated: boolean,
): readonly ReadinessDiagnostic[] {
  if (!truncated) return diagnostics;
  const truncationDiagnostic: ReadinessDiagnostic = {
    code: 'readiness.provider_truncated',
    severity: 'warning',
    checkedAt,
  };
  if (diagnostics.length < READINESS_MAX_DIAGNOSTICS) {
    return [...diagnostics, truncationDiagnostic];
  }
  return [...diagnostics.slice(0, READINESS_MAX_DIAGNOSTICS - 1), truncationDiagnostic];
}

function failureContribution(
  provider: ReadinessProvider,
  checkedAt: string,
  code: SafeReadinessCode,
): ProviderContribution {
  return {
    checks: Object.freeze([
      {
        id: provider.id,
        scope: provider.scope,
        status: 'unavailable',
        severity: 'error',
        summaryCode: code,
        evidence: Object.freeze([]),
        recommendedActions: Object.freeze([
          {
            kind: 'refresh' as const,
            code: 'readiness.refresh',
          },
        ]),
        checkedAt,
      },
    ]),
    deviceCandidates: Object.freeze([]),
    reusableSessions: Object.freeze([]),
    reusableProfiles: Object.freeze([]),
    blockers: Object.freeze([]),
    diagnostics: Object.freeze([
      {
        code,
        severity: 'error',
        checkedAt,
      },
    ]),
    compensationCandidates: Object.freeze([]),
    profileSuggestions: Object.freeze([]),
  };
}

function aggregateStatus(contributions: readonly ProviderContribution[]): RuntimeReadinessSnapshot['status'] {
  const checks = contributions.flatMap((contribution) => contribution.checks);
  const blockers = contributions.flatMap((contribution) => contribution.blockers);
  if (blockers.length > 0 || checks.some((check) => check.status === 'blocked')) {
    return 'blocked';
  }
  if (checks.length === 0) return 'checking';
  const readinessDefiningChecks = checks.filter((check) => !isOptionalMissingCheck(check));
  if (readinessDefiningChecks.length === 0) return 'ready';
  if (readinessDefiningChecks.every((check) => check.status === 'unavailable')) return 'unavailable';
  if (
    readinessDefiningChecks.some(
      (check) => check.status === 'action-required' || check.status === 'unavailable',
    )
  ) {
    return 'action-required';
  }
  if (
    readinessDefiningChecks.some((check) => check.status === 'checking' || check.status === 'unknown')
  ) {
    return 'checking';
  }
  return 'ready';
}

function isOptionalMissingCheck(check: ReadinessCheck): boolean {
  return (
    (check.scope === 'workspace' || check.scope === 'profile') &&
    check.status === 'unavailable' &&
    check.severity === 'info'
  );
}
