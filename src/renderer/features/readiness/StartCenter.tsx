import * as React from 'react';
import type {
  DeviceCandidate,
  ReadinessDiagnostic,
  RuntimeReadinessSnapshot,
  SafeReadinessCode,
} from '../../../shared/readiness-contract.js';
import { READINESS_MAX_DIAGNOSTICS } from '../../../shared/readiness-contract.js';
import type {
  RuntimeReadinessViewDiagnostic,
  RuntimeReadinessViewState,
} from './readiness-reducer.js';
import { useT, type TranslationKey } from '../../i18n/index.js';
import type { SavedConnectionSummary } from '../../../shared/preload-api.js';
import type { WorkspaceSummary } from '../workspaces/workspace-model.js';

export interface StartCenterProps {
  readonly state: RuntimeReadinessViewState;
  readonly savedWorkspaces?: readonly WorkspaceSummary[];
  readonly savedWorkspacesLoading?: boolean;
  readonly workspaceLoadError?: string | null;
  readonly onOpenWorkspace?: (workspace: WorkspaceSummary) => void;
  readonly openingWorkspaceId?: string | null;
  readonly workspaceOpenError?: { readonly workspaceId: string; readonly message: string } | null;
  readonly onRepairWorkspace?: (workspace: WorkspaceSummary) => void;
  readonly onDeleteWorkspace?: (workspace: WorkspaceSummary) => void;
  readonly deletingWorkspaceId?: string | null;
  readonly workspaceDeleteError?: string | null;
  readonly onNewWorkspace?: () => void;
  /** Deprecated compatibility prop; readiness is loaded when Advanced devices opens. */
  readonly onRefresh?: () => void;
  readonly onAdvancedConnection: () => void;
  readonly onAdvancedDevicesOpenChange?: (open: boolean) => void;
  readonly onOpenControlProfile?: () => void;
  readonly onOpenAgentIntegrations?: () => void;
  readonly onOpenSerialTerminal?: () => void;
  readonly onOpenFirstSuccessGuide?: () => void;
  readonly onUseCandidate: (candidate: DeviceCandidate) => void;
  readonly onCopyDiagnostics: (codes: string[]) => void;
  readonly savedConnections?: readonly SavedConnectionSummary[];
  readonly savedConnectionsLoading?: boolean;
  readonly onOpenSavedConnection?: (profile: SavedConnectionSummary) => void;
  readonly onReviewReflash?: (candidateId: string) => void;
  readonly onSaveProfileSuggestion?: (suggestionId: string) => void;
  readonly onSkipProfileSuggestion?: (suggestionId: string) => void;
}

export function StartCenter({
  state,
  savedWorkspaces,
  savedWorkspacesLoading = false,
  workspaceLoadError = null,
  onOpenWorkspace,
  openingWorkspaceId = null,
  workspaceOpenError = null,
  onRepairWorkspace,
  onDeleteWorkspace,
  deletingWorkspaceId = null,
  workspaceDeleteError = null,
  onNewWorkspace,
  onRefresh,
  onAdvancedConnection,
  onAdvancedDevicesOpenChange,
  onOpenControlProfile,
  onOpenAgentIntegrations,
  onOpenSerialTerminal,
  onOpenFirstSuccessGuide,
  onUseCandidate,
  onCopyDiagnostics,
  savedConnections = [],
  savedConnectionsLoading = false,
  onOpenSavedConnection,
  onReviewReflash,
  onSaveProfileSuggestion,
  onSkipProfileSuggestion,
}: StartCenterProps): React.ReactElement {
  const t = useT();
  const snapshot = state.snapshot;
  const diagnosticCodes = collectDiagnosticCodes(state.diagnostics, snapshot?.diagnostics ?? []);
  const candidates = snapshot?.deviceCandidates ?? [];
  const advancedCandidates = candidates.filter((candidate) => candidate.serial === undefined);
  const openSerialTerminal = onOpenSerialTerminal ?? onAdvancedConnection;
  const workspaceMode = savedWorkspaces !== undefined || onNewWorkspace !== undefined;

  return (
    <section
      data-testid="start-center-shell"
      className="mx-auto flex h-full min-h-0 min-w-0 w-full max-w-none flex-col gap-4 overflow-y-auto overscroll-contain px-6 py-8 text-gray-100"
    >
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <p className="text-xs uppercase tracking-wide text-blue-300">
            {t('readiness.start.kicker')}
          </p>
          <h2 className="mt-1 text-2xl font-semibold" data-testid="start-center-title">
            {t('readiness.start.title')}
          </h2>
          <p
            data-testid="start-center-description"
            className="mt-2 w-full max-w-none text-sm text-gray-400"
          >
            {t('readiness.start.description')}
          </p>
        </div>
      </header>

      {workspaceMode ? (
        <>
          <SavedWorkspaceList
            workspaces={savedWorkspaces ?? []}
            loading={savedWorkspacesLoading}
            loadError={workspaceLoadError}
            onOpen={onOpenWorkspace}
            openingWorkspaceId={openingWorkspaceId}
            openError={workspaceOpenError}
            onRepair={onRepairWorkspace}
            onDelete={onDeleteWorkspace}
            deletingWorkspaceId={deletingWorkspaceId}
            deleteError={workspaceDeleteError}
          />
          <NewWorkspaceEntry onNewWorkspace={onNewWorkspace} />
        </>
      ) : (
        <>
          <SavedConnectionList
            profiles={savedConnections}
            loading={savedConnectionsLoading}
            onOpen={onOpenSavedConnection}
          />
          <section
            role="region"
            aria-labelledby="readiness-manual-open-title"
            data-testid="manual-open-entry"
            className="rounded border border-blue-500/40 bg-blue-950/20 p-4"
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 id="readiness-manual-open-title" className="text-sm font-semibold">
                  {t('readiness.action.manualOpen')}
                </h3>
                <p className="mt-1 text-xs text-gray-400">{t('readiness.action.manualHint')}</p>
              </div>
              <button
                type="button"
                data-testid="start-center-primary-action"
                className="rounded bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-500"
                onClick={openSerialTerminal}
              >
                {t('readiness.action.manualOpen')}
              </button>
            </div>
          </section>
        </>
      )}

      {!workspaceMode ? (
        <details
          data-testid="advanced-devices"
          className="rounded border border-gray-800 bg-gray-950/60 p-4"
          onToggle={(event) => onAdvancedDevicesOpenChange?.(event.currentTarget.open)}
        >
        <summary className="cursor-pointer text-sm font-semibold text-gray-100">
          {t('readiness.advanced.title')}
          <span className="ml-2 text-xs font-normal text-gray-500">
            {t('readiness.advanced.summary')}
          </span>
        </summary>
        <div className="mt-4 grid min-w-0 gap-4 lg:grid-cols-2">
          <div className="min-w-0 space-y-4">
            <DeviceCandidateList
              candidates={advancedCandidates}
              onUseCandidate={onUseCandidate}
              emptyKey="readiness.candidates.advancedEmpty"
            />
          </div>
          <div className="min-w-0 space-y-4">
            <CompensationCandidates
              candidates={snapshot?.compensationCandidates ?? []}
              onReviewReflash={onReviewReflash}
            />
            <ProfileSuggestions
              suggestions={snapshot?.profileSuggestions ?? []}
              onSaveProfileSuggestion={onSaveProfileSuggestion}
              onSkipProfileSuggestion={onSkipProfileSuggestion}
            />
            <DiagnosticsPanel
              localDiagnostics={state.diagnostics}
              providerDiagnostics={snapshot?.diagnostics ?? []}
              blockers={snapshot?.blockers ?? []}
              onCopy={() => onCopyDiagnostics(diagnosticCodes)}
            />
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-2 border-t border-gray-800 pt-3">
          {onRefresh !== undefined ? (
            <button
              type="button"
              className="rounded border border-gray-700 px-3 py-2 text-sm text-gray-100 hover:bg-gray-900 disabled:opacity-50"
              disabled={state.refreshing}
              onClick={onRefresh}
            >
              {state.refreshing ? t('readiness.action.refreshing') : t('readiness.action.refresh')}
            </button>
          ) : null}
          {!workspaceMode && onOpenControlProfile !== undefined ? (
            <button
              type="button"
              className="rounded border border-gray-700 px-3 py-2 text-sm text-gray-100 hover:bg-gray-900"
              onClick={onOpenControlProfile}
            >
              {t('controlProfile.entry')}
            </button>
          ) : null}
          {!workspaceMode && onOpenAgentIntegrations !== undefined ? (
            <button
              type="button"
              className="rounded border border-gray-700 px-3 py-2 text-sm text-gray-100 hover:bg-gray-900"
              onClick={onOpenAgentIntegrations}
            >
              {t('agent.entry')}
            </button>
          ) : null}
          {onOpenFirstSuccessGuide !== undefined ? (
            <button
              type="button"
              className="rounded border border-gray-700 px-3 py-2 text-sm text-gray-100 hover:bg-gray-900"
              onClick={onOpenFirstSuccessGuide}
            >
              {t('readiness.action.firstSuccessGuide')}
            </button>
          ) : null}
        </div>
        </details>
      ) : null}
    </section>
  );
}

function SavedWorkspaceList({
  workspaces,
  loading,
  loadError,
  onOpen,
  openingWorkspaceId,
  openError,
  onRepair,
  onDelete,
  deletingWorkspaceId,
  deleteError,
}: {
  readonly workspaces: readonly WorkspaceSummary[];
  readonly loading: boolean;
  readonly loadError: string | null;
  readonly onOpen?: (workspace: WorkspaceSummary) => void;
  readonly openingWorkspaceId: string | null;
  readonly openError: { readonly workspaceId: string; readonly message: string } | null;
  readonly onRepair?: (workspace: WorkspaceSummary) => void;
  readonly onDelete?: (workspace: WorkspaceSummary) => void;
  readonly deletingWorkspaceId: string | null;
  readonly deleteError: string | null;
}): React.ReactElement {
  const t = useT();
  return (
    <section
      role="region"
      aria-labelledby="readiness-saved-workspaces-title"
      data-testid="saved-workspaces"
      className="rounded border border-gray-800 bg-gray-950/60 p-4"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 id="readiness-saved-workspaces-title" className="text-sm font-semibold">
            {t('workspace.saved.title')}
          </h3>
          <p className="mt-1 text-xs text-gray-500">{t('workspace.saved.description')}</p>
        </div>
      </div>
      {loading ? (
        <p className="mt-3 text-sm text-gray-400">{t('workspace.saved.loading')}</p>
      ) : workspaces.length === 0 && loadError === null ? (
        <p className="mt-3 text-sm text-gray-400">{t('workspace.saved.empty')}</p>
      ) : workspaces.length > 0 ? (
        <ul className="mt-3 max-h-64 space-y-2 overflow-y-auto pr-1">
          {workspaces.map((workspace) => (
            <li
              key={workspace.id}
              className="rounded border border-gray-800 bg-gray-900 px-3 py-2"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm text-gray-100">{workspace.label}</p>
                  <p className="truncate text-xs text-gray-500">
                    {workspace.kind === 'full'
                      ? t('workspace.kind.full')
                      : t('workspace.kind.serialOnly')}
                    {workspace.details.length > 0 ? ` · ${workspace.details.join(' · ')}` : ''}
                  </p>
                </div>
                <div className="flex shrink-0 flex-wrap gap-2">
                  <button
                    type="button"
                    className="rounded border border-blue-500/60 px-3 py-1.5 text-xs text-blue-200 hover:bg-blue-950/40 disabled:opacity-50"
                    disabled={
                      onOpen === undefined ||
                      deletingWorkspaceId === workspace.id ||
                      openingWorkspaceId !== null
                    }
                    onClick={() => onOpen?.(workspace)}
                  >
                    {openingWorkspaceId === workspace.id
                      ? t('workspace.action.opening')
                      : t('workspace.action.open')}
                  </button>
                  <button
                    type="button"
                    className="rounded border border-red-500/50 px-3 py-1.5 text-xs text-red-200 hover:bg-red-950/40 disabled:opacity-50"
                    disabled={
                      onDelete === undefined ||
                      deletingWorkspaceId !== null ||
                      openingWorkspaceId !== null
                    }
                    onClick={() => onDelete?.(workspace)}
                  >
                    {deletingWorkspaceId === workspace.id
                      ? t('workspace.action.deleting')
                      : t('workspace.action.delete')}
                  </button>
                </div>
              </div>
              {openError?.workspaceId === workspace.id ? (
                <div className="mt-2 flex flex-wrap items-center justify-between gap-2 border-t border-red-900/70 pt-2">
                  <p role="alert" className="min-w-0 flex-1 break-words text-xs text-red-200">
                    {openError.message}
                  </p>
                  {onRepair !== undefined ? (
                    <button
                      type="button"
                      className="rounded border border-amber-500/60 px-3 py-1.5 text-xs text-amber-100 hover:bg-amber-950/40"
                      onClick={() => onRepair(workspace)}
                    >
                      {t('workspace.action.repair')}
                    </button>
                  ) : null}
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {loadError !== null ? (
        <p role="alert" className="mt-3 text-sm text-red-300">
          {loadError}
        </p>
      ) : null}
      {deleteError !== null ? (
        <p role="alert" className="mt-3 text-sm text-red-300">
          {deleteError}
        </p>
      ) : null}
    </section>
  );
}

function NewWorkspaceEntry({ onNewWorkspace }: { readonly onNewWorkspace?: () => void }): React.ReactElement {
  const t = useT();
  return (
    <section
      role="region"
      aria-labelledby="new-workspace-entry-title"
      data-testid="new-workspace-entry"
      className="rounded border border-blue-500/40 bg-blue-950/20 p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 id="new-workspace-entry-title" className="text-sm font-semibold">
            {t('workspace.new.title')}
          </h3>
          <p className="mt-1 text-xs text-gray-400">{t('workspace.new.description')}</p>
        </div>
        <button
          type="button"
          className="rounded bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
          disabled={onNewWorkspace === undefined}
          onClick={() => onNewWorkspace?.()}
        >
          {t('workspace.action.new')}
        </button>
      </div>
    </section>
  );
}

function SavedConnectionList({
  profiles,
  loading,
  onOpen,
}: {
  readonly profiles: readonly SavedConnectionSummary[];
  readonly loading: boolean;
  readonly onOpen?: (profile: SavedConnectionSummary) => void;
}): React.ReactElement | null {
  const t = useT();
  return (
    <section
      role="region"
      aria-labelledby="readiness-saved-connections-title"
      data-testid="saved-connections"
      className="rounded border border-gray-800 bg-gray-950/60 p-4"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 id="readiness-saved-connections-title" className="text-sm font-semibold">
            {t('readiness.saved.title')}
          </h3>
          <p className="mt-1 text-xs text-gray-500">{t('readiness.saved.description')}</p>
        </div>
      </div>
      {loading ? (
        <p className="mt-3 text-sm text-gray-400">{t('readiness.saved.loading')}</p>
      ) : profiles.length === 0 ? (
        <p className="mt-3 text-sm text-gray-400">{t('readiness.saved.empty')}</p>
      ) : (
        <ul className="mt-3 max-h-64 space-y-2 overflow-y-auto pr-1">
          {profiles.map((profile) => (
            <li
              key={profile.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded border border-gray-800 bg-gray-900 px-3 py-2"
            >
              <div className="min-w-0">
                <p className="truncate text-sm text-gray-100">{profile.label}</p>
                <p className="truncate text-xs text-gray-500">{savedConnectionDetails(profile)}</p>
              </div>
              <button
                type="button"
                className="shrink-0 rounded border border-blue-500/60 px-3 py-1.5 text-xs text-blue-200 hover:bg-blue-950/40 disabled:opacity-50"
                disabled={onOpen === undefined}
                onClick={() => onOpen?.(profile)}
              >
                {t('readiness.saved.open')}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function savedConnectionDetails(profile: SavedConnectionSummary): string {
  const config = profile.config;
  switch (config.type) {
    case 'serial':
      return `${config.port} · ${config.baudRate}`;
    case 'ssh':
      return `${config.username}@${config.host}:${config.port}`;
    case 'local-shell':
      return config.shell ?? config.cwd ?? 'local shell';
    case 'rtt-log':
      return `${config.root ?? config.probeId ?? 'RTT'} · ch${config.channelIndex}`;
  }
}

function DeviceCandidateList({
  candidates,
  onUseCandidate,
  titleKey = 'readiness.candidates.title',
  headingId = 'readiness-candidates-title',
  emptyKey = 'readiness.candidates.empty',
}: {
  readonly candidates: readonly DeviceCandidate[];
  readonly onUseCandidate: (candidate: DeviceCandidate) => void;
  readonly titleKey?: TranslationKey;
  readonly headingId?: string;
  readonly emptyKey?: TranslationKey;
}): React.ReactElement {
  const t = useT();
  return (
    <section
      role="region"
      aria-labelledby={headingId}
      className="rounded border border-gray-800 bg-gray-950/60 p-4"
    >
      <h3 id={headingId} className="text-sm font-semibold">
        {t(titleKey)}
      </h3>
      {candidates.length === 0 ? (
        <p className="mt-3 text-sm text-gray-400">{t(emptyKey)}</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {candidates.slice(0, 6).map((candidate) => (
            <li
              key={candidate.id}
              data-testid={`device-candidate-${candidate.id}`}
              className="rounded border border-gray-800 bg-gray-900 px-3 py-2"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium text-gray-100">{candidate.label}</span>
                <span className="rounded bg-gray-800 px-2 py-0.5 text-xs text-gray-300">
                  {candidateConfidenceLabel(candidate.confidence, t)}
                </span>
              </div>
              {candidate.requiresUserConfirmation ? (
                <p className="mt-1 text-xs text-amber-300">
                  {t('readiness.candidates.needsConfirmation')}
                </p>
              ) : null}
              <div className="mt-2 space-y-1 text-xs text-gray-400">
                {candidate.evidence.map((item, index) => (
                  <div key={`${item.summaryCode}-${index}`}>
                    <span>{readinessCodeLabel(item.summaryCode, t)}</span>
                    {item.params?.map((param) => (
                      <span key={`${param.key}-${param.value}`} className="ml-2">
                        {readinessParamLabel(param.key, t)}: {param.value}
                      </span>
                    ))}
                  </div>
                ))}
              </div>
              <button
                type="button"
                className="mt-3 rounded border border-blue-500/60 px-3 py-1.5 text-xs text-blue-200 hover:bg-blue-950/40"
                onClick={() => onUseCandidate(candidate)}
              >
                {candidate.kind === 'jlink'
                  ? t('readiness.candidates.reviewJlink')
                  : t('readiness.candidates.openTerminal')}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function CompensationCandidates({
  candidates,
  onReviewReflash,
}: {
  readonly candidates: NonNullable<RuntimeReadinessSnapshot['compensationCandidates']>;
  readonly onReviewReflash?: (candidateId: string) => void;
}): React.ReactElement | null {
  const t = useT();
  if (candidates.length === 0) return null;
  return (
    <section
      role="region"
      aria-labelledby="readiness-compensation-title"
      className="rounded border border-gray-800 bg-gray-950/60 p-4"
    >
      <h3 id="readiness-compensation-title" className="text-sm font-semibold">
        {t('readiness.compensation.title')}
      </h3>
      <p className="mt-1 text-xs text-gray-500">{t('readiness.compensation.description')}</p>
      <ul className="mt-3 space-y-2">
        {candidates.slice(0, 4).map((candidate) => {
          const available = candidate.eligibility.status === 'available';
          return (
            <li key={candidate.candidateId} className="rounded border border-gray-800 bg-gray-900 px-3 py-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm font-medium text-gray-100">{candidate.targetLabel}</span>
                <span className="rounded bg-gray-800 px-2 py-0.5 text-xs text-gray-300">
                  {compensationEligibilityLabel(candidate.eligibility.status, t)}
                </span>
              </div>
              <p className="mt-1 text-xs text-gray-400">
                {candidate.firmware.displayName} · {candidate.firmware.byteLength} B
                {candidate.firmware.hashSha256Prefix !== undefined
                  ? ` · ${candidate.firmware.hashSha256Prefix}`
                  : ''}
              </p>
              {candidate.eligibility.reasonCode !== undefined ? (
                <p className="mt-1 text-xs text-amber-300">
                  {readinessCodeLabel(candidate.eligibility.reasonCode, t)}
                </p>
              ) : null}
              <button
                type="button"
                className="mt-3 rounded border border-blue-500/60 px-3 py-1.5 text-xs text-blue-200 disabled:border-gray-700 disabled:text-gray-500"
                disabled={!available || onReviewReflash === undefined}
                onClick={() => onReviewReflash?.(candidate.candidateId)}
              >
                {t('readiness.compensation.reviewReflash')}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function ProfileSuggestions({
  suggestions,
  onSaveProfileSuggestion,
  onSkipProfileSuggestion,
}: {
  readonly suggestions: NonNullable<RuntimeReadinessSnapshot['profileSuggestions']>;
  readonly onSaveProfileSuggestion?: (suggestionId: string) => void;
  readonly onSkipProfileSuggestion?: (suggestionId: string) => void;
}): React.ReactElement | null {
  const t = useT();
  if (suggestions.length === 0) return null;
  return (
    <section
      role="region"
      aria-labelledby="readiness-profile-suggestions-title"
      className="rounded border border-gray-800 bg-gray-950/60 p-4"
    >
      <h3 id="readiness-profile-suggestions-title" className="text-sm font-semibold">
        {t('readiness.profileSuggestions.title')}
      </h3>
      <ul className="mt-3 space-y-2">
        {suggestions.slice(0, 4).map((suggestion) => (
          <li key={suggestion.suggestionId} className="rounded border border-gray-800 bg-gray-900 px-3 py-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm font-medium text-gray-100">{suggestion.profileLabel}</span>
              <span className="rounded bg-gray-800 px-2 py-0.5 text-xs text-gray-300">
                {profileSuggestionProvenanceLabel(suggestion.provenance, t)}
              </span>
            </div>
            <ul className="mt-2 space-y-1 text-xs text-gray-400">
              {suggestion.fields.map((field) => (
                <li key={`${field.code}-${field.label}`}>
                  {readinessCodeLabel(field.code, t)}: {field.label}
                </li>
              ))}
            </ul>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                className="rounded border border-blue-500/60 px-3 py-1.5 text-xs text-blue-200 disabled:border-gray-700 disabled:text-gray-500"
                disabled={onSaveProfileSuggestion === undefined}
                onClick={() => onSaveProfileSuggestion?.(suggestion.suggestionId)}
              >
                {t('readiness.profileSuggestions.save')}
              </button>
              <button
                type="button"
                className="rounded border border-gray-700 px-3 py-1.5 text-xs text-gray-300"
                disabled={onSkipProfileSuggestion === undefined}
                onClick={() => onSkipProfileSuggestion?.(suggestion.suggestionId)}
              >
                {t('readiness.profileSuggestions.skip')}
              </button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function DiagnosticsPanel({
  localDiagnostics,
  providerDiagnostics,
  blockers,
  onCopy,
}: {
  readonly localDiagnostics: readonly RuntimeReadinessViewDiagnostic[];
  readonly providerDiagnostics: readonly ReadinessDiagnostic[];
  readonly blockers: readonly string[];
  readonly onCopy: () => void;
}): React.ReactElement {
  const t = useT();
  const codes = collectDiagnosticCodes(localDiagnostics, providerDiagnostics);
  const visibleCodesAndBlockers = [...codes, ...blockers].slice(0, READINESS_MAX_DIAGNOSTICS);
  return (
    <section
      role="region"
      aria-labelledby="readiness-diagnostics-title"
      className="rounded border border-gray-800 bg-gray-950/60 p-4"
    >
      <div className="flex items-center justify-between gap-2">
        <h3 id="readiness-diagnostics-title" className="text-sm font-semibold">
          {t('readiness.diagnostics.title')}
        </h3>
        <button type="button" className="text-xs text-blue-300 hover:text-blue-200" onClick={onCopy}>
          {t('readiness.diagnostics.copy')}
        </button>
      </div>
      {visibleCodesAndBlockers.length === 0 ? (
        <p className="mt-3 text-sm text-gray-400">{t('readiness.diagnostics.empty')}</p>
      ) : (
        <ul className="mt-3 space-y-1 text-xs text-gray-300">
          {visibleCodesAndBlockers.map((code) => (
            <li key={code}>{readinessCodeLabel(code, t)}</li>
          ))}
        </ul>
      )}
    </section>
  );
}

function collectDiagnosticCodes(
  localDiagnostics: readonly RuntimeReadinessViewDiagnostic[],
  providerDiagnostics: readonly ReadinessDiagnostic[],
): string[] {
  return Array.from(
    new Set([
      ...localDiagnostics.map((diagnostic) => diagnostic.code),
      ...providerDiagnostics.map((diagnostic) => diagnostic.code),
    ]),
  ).slice(0, READINESS_MAX_DIAGNOSTICS);
}

const READINESS_CODE_LABELS: Partial<Record<SafeReadinessCode, TranslationKey>> = {
  'readiness.runtime.ready': 'readiness.message.runtimeReady',
  'readiness.runtime.fresh': 'readiness.message.runtimeFresh',
  'readiness.runtime.stale': 'readiness.message.runtimeStale',
  'readiness.runtime.blocked': 'readiness.message.runtimeBlocked',
  'readiness.serial.ready': 'readiness.message.serialReady',
  'readiness.serial.empty': 'readiness.message.serialEmpty',
  'readiness.serial.detected': 'readiness.message.serialDetected',
  'readiness.serial.scan_completed': 'readiness.message.serialScanCompleted',
  'readiness.serial.discovery_failed': 'readiness.message.serialDiscoveryFailed',
  'readiness.serial.permission_blocked': 'readiness.message.serialPermissionBlocked',
  'readiness.preferences.corrupt': 'readiness.message.preferencesCorrupt',
  'readiness.refresh_failed': 'readiness.message.refreshFailed',
  'readiness.refresh_recovered': 'readiness.message.refreshRecovered',
  'readiness.invalid_payload': 'readiness.message.invalidPayload',
  'readiness.provider_failed': 'readiness.message.providerFailed',
  'readiness.provider_timeout': 'readiness.message.providerTimeout',
  'readiness.provider_invalid': 'readiness.message.providerInvalid',
  'readiness.provider_truncated': 'readiness.message.providerTruncated',
  'readiness.workspace.profiles_available': 'readiness.message.workspaceProfilesAvailable',
  'readiness.workspace.not_selected': 'readiness.message.workspaceNotSelected',
  'readiness.workspace.unavailable': 'readiness.message.workspaceUnavailable',
  'readiness.profile.matched': 'readiness.message.profileMatched',
  'readiness.profile.conflict': 'readiness.message.profileConflict',
  'readiness.profile.count': 'readiness.message.profileCount',
  'readiness.session.reusable': 'readiness.message.sessionReusable',
  'readiness.session.none': 'readiness.message.sessionNone',
  'readiness.session.count': 'readiness.message.sessionCount',
  'readiness.agent.ready': 'readiness.message.agentReady',
  'readiness.agent.action_required': 'readiness.message.agentActionRequired',
  'readiness.agent.count': 'readiness.message.agentCount',
  'readiness.jlink.ready': 'readiness.message.jlinkReady',
  'readiness.jlink.backend.available': 'readiness.message.jlinkBackendAvailable',
  'readiness.jlink.backend.unavailable': 'readiness.message.jlinkBackendUnavailable',
  'readiness.jlink.probe.empty': 'readiness.message.jlinkProbeEmpty',
  'readiness.jlink.probe.count': 'readiness.message.jlinkProbeCount',
  'readiness.jlink.probe.detected': 'readiness.message.jlinkProbeDetected',
  'readiness.jlink.discovery_failed': 'readiness.message.jlinkDiscoveryFailed',
  'readiness.jlink.target_not_in_catalog': 'readiness.message.jlinkTargetNotInCatalog',
  'readiness.jlink.target.catalog_checked': 'readiness.message.jlinkTargetCatalogChecked',
  'readiness.jlink.target.catalog_miss': 'readiness.message.jlinkTargetCatalogMiss',
  'readiness.jlink.target.evidence': 'readiness.message.jlinkTargetEvidence',
  'readiness.firmware.ready': 'readiness.message.firmwareReady',
  'readiness.firmware.missing': 'readiness.message.firmwareMissing',
  'readiness.firmware.metadata.ready': 'readiness.message.firmwareMetadataReady',
  'readiness.firmware.metadata_failed': 'readiness.message.firmwareMetadataFailed',
  'readiness.rtt.ready': 'readiness.message.rttReady',
  'readiness.rtt.config.ready': 'readiness.message.rttConfigReady',
  'readiness.rtt.config_missing': 'readiness.message.rttConfigMissing',
  'readiness.rtt.config_failed': 'readiness.message.rttConfigFailed',
  'compensation.reflash.expired': 'readiness.compensation.expired',
  'compensation.reflash.evidence_mismatch': 'readiness.compensation.evidenceMismatch',
  'profile.target': 'readiness.profileSuggestions.fieldTarget',
  'profile.firmware': 'readiness.profileSuggestions.fieldFirmware',
  'profile.workflow': 'readiness.profileSuggestions.fieldWorkflow',
};

function readinessCodeLabel(code: string, t: ReturnType<typeof useT>): string {
  const key = READINESS_CODE_LABELS[code];
  if (key !== undefined) return t(key);
  return code.replace(/^readiness[._-]?/u, '').replace(/[._-]+/gu, ' ');
}

function readinessParamLabel(key: string, t: ReturnType<typeof useT>): string {
  switch (key) {
    case 'baudRate':
      return t('readiness.param.baudRate');
    case 'count':
      return t('readiness.param.count');
    case 'livePort':
      return t('readiness.param.livePort');
    case 'name':
      return t('readiness.param.name');
    case 'port':
      return t('readiness.param.port');
    case 'profile':
      return t('readiness.param.profile');
    case 'profilePort':
      return t('readiness.param.profilePort');
    case 'target':
      return t('readiness.param.target');
    case 'firmware':
      return t('readiness.param.firmware');
    case 'format':
      return t('readiness.param.format');
    case 'bytes':
      return t('readiness.param.bytes');
    case 'hash':
      return t('readiness.param.hash');
    default:
      return key.replace(/[._-]+/gu, ' ');
  }
}

function compensationEligibilityLabel(
  status: NonNullable<RuntimeReadinessSnapshot['compensationCandidates']>[number]['eligibility']['status'],
  t: ReturnType<typeof useT>,
): string {
  switch (status) {
    case 'available':
      return t('readiness.compensation.available');
    case 'disabled':
      return t('readiness.compensation.disabled');
    case 'hidden':
      return t('readiness.compensation.hidden');
  }
}

function profileSuggestionProvenanceLabel(
  provenance: NonNullable<RuntimeReadinessSnapshot['profileSuggestions']>[number]['provenance'],
  t: ReturnType<typeof useT>,
): string {
  switch (provenance) {
    case 'verified-jlink-rtt-success':
      return t('readiness.profileSuggestions.verifiedJlinkRtt');
  }
}

function candidateConfidenceLabel(
  confidence: DeviceCandidate['confidence'],
  t: ReturnType<typeof useT>,
): string {
  switch (confidence) {
    case 'exact':
      return t('readiness.confidence.exact');
    case 'likely':
      return t('readiness.confidence.likely');
    case 'unknown':
      return t('readiness.confidence.unknown');
  }
}
