import path from 'node:path';
import { createHash } from 'node:crypto';

import {
  READINESS_SCHEMA_VERSION,
  CompensationCandidateSummarySchema,
  type CompensationCandidateSummary,
  ProfileSuggestionSummarySchema,
  type ProfileSuggestionSummary,
} from '../../shared/readiness-contract.js';
import type { ControlProfile } from '../workspace/index.js';
import type { FirmwareImageFormat } from '../workspace/firmware-image.js';

export interface VerifiedDeploymentEvidence {
  readonly workspace: {
    readonly root: string;
    readonly profile: ControlProfile;
  };
  readonly sourceOperationId: string;
  readonly targetLabel: string;
  readonly targetBindingDigest: string;
  readonly profileRevision: string;
  readonly workflowMode: string;
  readonly manifestDigest: string;
  readonly firmware: {
    readonly mainOwnedSourceRef: string;
    readonly displayName: string;
    readonly contentSha256: string;
    readonly byteLength: number;
    readonly format: 'bin' | 'hex' | 'elf' | 'unknown';
    readonly baseAddress: number;
  };
  readonly result: {
    readonly flashed: boolean;
    readonly verified: boolean;
    readonly observationSucceeded: boolean;
  };
}

export interface CompensationCandidateServiceOptions {
  readonly now?: () => Date;
  readonly createCandidateId?: () => string;
  readonly ttlMs?: number;
}

export interface CompensationCandidateSummaryOptions {
  readonly currentEvidence?: VerifiedDeploymentEvidence;
}

export interface CurrentVerifiedDeploymentEvidenceInput {
  readonly root: string;
  readonly profile: ControlProfile;
  readonly workflowMode: string;
  readonly observe?: unknown;
  readonly firmware: {
    readonly absolutePath: string;
    readonly sourcePath: string;
    readonly binary: Buffer;
    readonly format: FirmwareImageFormat;
    readonly baseAddress: number;
    readonly verify: boolean;
  };
}

export interface CompensationReflashRequest {
  readonly root: string;
}

export interface CompensationReflashRequestOptions {
  readonly currentEvidence?: VerifiedDeploymentEvidence;
}

export interface ProfileSuggestionSaveRequest {
  readonly root: string;
  readonly label: string;
  readonly profile: ControlProfile;
}

interface CompensationCandidate {
  readonly schemaVersion: typeof READINESS_SCHEMA_VERSION;
  readonly candidateId: string;
  readonly evidence: VerifiedDeploymentEvidence;
  readonly knownGoodAt: string;
  readonly expiresAt: string;
}

const DEFAULT_COMPENSATION_TTL_MS = 30 * 60 * 1000;

export class CompensationCandidateService {
  readonly #now: () => Date;
  readonly #createCandidateId: () => string;
  readonly #ttlMs: number;
  #candidate: CompensationCandidate | undefined;

  constructor(options: CompensationCandidateServiceOptions = {}) {
    this.#now = options.now ?? (() => new Date());
    this.#createCandidateId = options.createCandidateId ?? (() => `compensation_${Date.now()}`);
    this.#ttlMs = options.ttlMs ?? DEFAULT_COMPENSATION_TTL_MS;
  }

  recordDeployment(evidence: VerifiedDeploymentEvidence): CompensationCandidateSummary | null {
    if (!isVerifiedSuccessfulDeployment(evidence)) return null;

    const now = this.#now();
    this.#candidate = {
      schemaVersion: READINESS_SCHEMA_VERSION,
      candidateId: this.#createCandidateId(),
      evidence: cloneEvidence(evidence),
      knownGoodAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + this.#ttlMs).toISOString(),
    };
    return this.summaries({ currentEvidence: evidence })[0] ?? null;
  }

  summaries(options: CompensationCandidateSummaryOptions = {}): CompensationCandidateSummary[] {
    if (this.#candidate === undefined) return [];
    return [this.#projectSummary(this.#candidate, options.currentEvidence)];
  }

  profileSuggestions(): ProfileSuggestionSummary[] {
    if (this.#candidate === undefined) return [];
    if (this.#candidateExpired(this.#candidate)) return [];
    const candidate = this.#candidate;
    return [
      ProfileSuggestionSummarySchema.parse({
        schemaVersion: READINESS_SCHEMA_VERSION,
        suggestionId: `profile_suggestion_${candidate.candidateId}`,
        profileLabel: candidate.evidence.targetLabel,
        provenance: 'verified-jlink-rtt-success',
        fields: [
          { code: 'profile.target', label: candidate.evidence.targetLabel },
          { code: 'profile.firmware', label: candidate.evidence.firmware.displayName },
          { code: 'profile.workflow', label: candidate.evidence.workflowMode },
        ],
        saveActionCode: 'profile.suggestion.save',
        skipActionCode: 'profile.suggestion.skip',
      }),
    ];
  }

  activeCandidateWorkspaceRoot(): string | null {
    if (this.#candidate === undefined) return null;
    if (this.#candidateExpired(this.#candidate)) return null;
    return this.#candidate.evidence.workspace.root;
  }

  candidateWorkspaceRoot(candidateId: string): string | null {
    const candidate = this.#candidateForId(candidateId);
    if (candidate === undefined) return null;
    if (this.#candidateExpired(candidate)) return null;
    return candidate.evidence.workspace.root;
  }

  reflashRequest(
    candidateId: string,
    options: CompensationReflashRequestOptions = {},
  ): CompensationReflashRequest | null {
    const candidate = this.#candidateForId(candidateId);
    if (candidate === undefined) return null;
    if (this.#candidateExpired(candidate)) return null;
    if (
      options.currentEvidence === undefined ||
      !candidateMatchesEvidence(candidate.evidence, options.currentEvidence)
    ) {
      return null;
    }
    return { root: candidate.evidence.workspace.root };
  }

  profileSuggestionSave(suggestionId: string): ProfileSuggestionSaveRequest | null {
    if (this.#candidate === undefined) return null;
    if (this.#candidateExpired(this.#candidate)) return null;
    if (suggestionId !== `profile_suggestion_${this.#candidate.candidateId}`) return null;
    return {
      root: this.#candidate.evidence.workspace.root,
      label: this.#candidate.evidence.targetLabel,
      profile: cloneProfile(this.#candidate.evidence.workspace.profile),
    };
  }

  clear(): void {
    this.#candidate = undefined;
  }

  debugCandidateCount(): number {
    return this.#candidate === undefined ? 0 : 1;
  }

  #projectSummary(
    candidate: CompensationCandidate,
    currentEvidence: VerifiedDeploymentEvidence | undefined,
  ): CompensationCandidateSummary {
    const expired = this.#candidateExpired(candidate);
    const matches =
      currentEvidence !== undefined && candidateMatchesEvidence(candidate.evidence, currentEvidence);
    const eligibility = expired
      ? { status: 'hidden' as const, reasonCode: 'compensation.reflash.expired' }
      : matches
        ? { status: 'available' as const }
        : {
            status: 'disabled' as const,
            reasonCode: 'compensation.reflash.evidence_mismatch',
          };

    return CompensationCandidateSummarySchema.parse({
      schemaVersion: READINESS_SCHEMA_VERSION,
      candidateId: candidate.candidateId,
      targetLabel: candidate.evidence.targetLabel,
      firmware: {
        displayName: candidate.evidence.firmware.displayName,
        hashSha256Prefix: digestPrefix(candidate.evidence.firmware.contentSha256),
        byteLength: candidate.evidence.firmware.byteLength,
      },
      createdAt: candidate.knownGoodAt,
      expiresAt: candidate.expiresAt,
      eligibility,
      ...(eligibility.status === 'available'
        ? { actionCode: 'compensation.reflash.review' as const }
        : {}),
    });
  }

  #candidateForId(candidateId: string): CompensationCandidate | undefined {
    if (this.#candidate?.candidateId !== candidateId) return undefined;
    return this.#candidate;
  }

  #candidateExpired(candidate: CompensationCandidate): boolean {
    return new Date(candidate.expiresAt).getTime() <= this.#now().getTime();
  }
}

function isVerifiedSuccessfulDeployment(evidence: VerifiedDeploymentEvidence): boolean {
  return (
    evidence.result.flashed === true &&
    evidence.result.verified === true &&
    evidence.result.observationSucceeded === true
  );
}

function cloneEvidence(evidence: VerifiedDeploymentEvidence): VerifiedDeploymentEvidence {
  return {
    ...evidence,
    workspace: {
      root: evidence.workspace.root,
      profile: cloneProfile(evidence.workspace.profile),
    },
    firmware: { ...evidence.firmware },
    result: { ...evidence.result },
  };
}

function cloneProfile(profile: ControlProfile): ControlProfile {
  return {
    schemaVersion: profile.schemaVersion,
    ...(profile.serial !== undefined ? { serial: { ...profile.serial } } : {}),
    ...(profile.jlink !== undefined ? { jlink: { ...profile.jlink } } : {}),
    ...(profile.flash !== undefined ? { flash: { ...profile.flash } } : {}),
    ...(profile.rtt !== undefined
      ? { rtt: { ...profile.rtt, channels: profile.rtt.channels?.slice() } }
      : {}),
  };
}

function candidateMatchesEvidence(
  candidate: VerifiedDeploymentEvidence,
  current: VerifiedDeploymentEvidence,
): boolean {
  return (
    candidate.targetBindingDigest === current.targetBindingDigest &&
    candidate.profileRevision === current.profileRevision &&
    candidate.workflowMode === current.workflowMode &&
    candidate.manifestDigest === current.manifestDigest &&
    candidate.firmware.mainOwnedSourceRef === current.firmware.mainOwnedSourceRef &&
    normalizeDigest(candidate.firmware.contentSha256) ===
      normalizeDigest(current.firmware.contentSha256) &&
    candidate.firmware.byteLength === current.firmware.byteLength &&
    candidate.firmware.format === current.firmware.format &&
    candidate.firmware.baseAddress === current.firmware.baseAddress
  );
}

function digestPrefix(value: string): string {
  return normalizeDigest(value).slice(0, 16);
}

function normalizeDigest(value: string): string {
  const hex = value.startsWith('sha256:') ? value.slice('sha256:'.length) : value;
  return hex.toLowerCase();
}

export function buildCurrentVerifiedDeploymentEvidence(
  input: CurrentVerifiedDeploymentEvidenceInput,
): VerifiedDeploymentEvidence {
  const targetLabel = input.profile.jlink?.target ?? 'J-Link target';
  const contentSha256 = createHash('sha256').update(input.firmware.binary).digest('hex');
  const targetBindingDigest = digestCanonical({
    target: targetLabel,
    interface: input.profile.jlink?.interface,
    speedKHz: input.profile.jlink?.speedKHz,
  });
  return {
    workspace: {
      root: input.root,
      profile: cloneProfile(input.profile),
    },
    sourceOperationId: `workflow_${digestHex({
      root: input.root,
      targetBindingDigest,
      sourcePath: input.firmware.sourcePath,
      contentSha256,
    }).slice(0, 32)}`,
    targetLabel,
    targetBindingDigest,
    profileRevision: digestCanonical({ root: input.root, profile: input.profile }),
    workflowMode: input.workflowMode,
    manifestDigest: digestCanonical({
      mode: input.workflowMode,
      observe: input.observe,
      targetBindingDigest,
      firmware: {
        sourcePath: input.firmware.sourcePath,
        baseAddress: input.firmware.baseAddress,
        verify: input.firmware.verify,
        format: input.firmware.format,
        byteLength: input.firmware.binary.byteLength,
        contentSha256,
      },
    }),
    firmware: {
      mainOwnedSourceRef: input.firmware.absolutePath,
      displayName: path.basename(input.firmware.absolutePath),
      contentSha256,
      byteLength: input.firmware.binary.byteLength,
      format: readinessFirmwareFormat(input.firmware.format),
      baseAddress: input.firmware.baseAddress,
    },
    result: {
      flashed: true,
      verified: true,
      observationSucceeded: true,
    },
  };
}

function readinessFirmwareFormat(
  format: FirmwareImageFormat,
): VerifiedDeploymentEvidence['firmware']['format'] {
  switch (format) {
    case 'raw-binary':
      return 'bin';
    case 'intel-hex':
      return 'hex';
    case 'elf':
      return 'elf';
  }
}

function digestCanonical(value: unknown): string {
  return `sha256:${digestHex(value)}`;
}

function digestHex(value: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(canonicalize(value)), 'utf8')
    .digest('hex');
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, entryValue]) => entryValue !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entryValue]) => [key, canonicalize(entryValue)]),
    );
  }
  return value;
}
