/**
 * 应用根组件：装配顶栏 + SessionTabBar + TerminalView + ConnectionDialog.
 *
 * 单一 store 模式 —— 所有共享状态都在 useAppStore.
 */

import * as React from 'react';
import { SessionTabBar } from './components/SessionTabBar.js';
import { TerminalView } from './components/TerminalView.js';
import { ConnectionDialog } from './components/ConnectionDialog.js';
import { AgentIntegrationsPanel } from './components/AgentIntegrationsPanel.js';
import { ControlProfilePanel, openObservationForRecord } from './components/ControlProfilePanel.js';
import { Button } from './components/ui/button.js';
import { getLinkterm } from './lib/linkterm-bridge.js';
import { useAppStore } from './store/app-store.js';
import { useT, type Locale } from './i18n/index.js';
import { useUiPatchSubscription } from './hooks/useUiPatchSubscription.js';
import { useSessionHydration } from './hooks/useSessionHydration.js';
import type { ControlProfileOpenedEvent } from './components/ControlProfilePanel.js';
import type {
  ControlProfileDownloadJobPayload,
  ControlProfileDownloadResultPayload,
  ControlProfileNamespace,
  ControlProfileWorkflowStepPayload,
  SavedControlProfileRecordPayload,
} from '../shared/preload-api.js';
import type { SessionId, SessionState } from '../shared/types.js';

const DOWNLOAD_POLL_INTERVAL_MS = 200;

/**
 * App 根组件.
 */
export function App(): React.ReactElement {
  // Phase 10：在根组件一次性挂载 MCP UI patch 订阅；卸载时随 React 自动清理。
  useUiPatchSubscription();
  useSessionHydration();

  const t = useT();
  const preloadUnavailableMessage = t('controlProfile.error.preloadUnavailable');
  const locale = useAppStore((s) => s.locale);
  const setLocale = useAppStore((s) => s.setLocale);
  const activeId = useAppStore((s) => s.activeSessionId);
  const sessions = useAppStore((s) => s.sessions);
  const addSession = useAppStore((s) => s.addSession);
  const removeSession = useAppStore((s) => s.removeSession);
  const setActive = useAppStore((s) => s.setActive);
  const [agentPanelOpen, setAgentPanelOpen] = React.useState(false);
  const [controlPanelOpen, setControlPanelOpen] = React.useState(false);
  const [openedControlProfile, setOpenedControlProfile] =
    React.useState<ControlProfileOpenedEvent | null>(null);
  const [controlProfileDownload, setControlProfileDownload] =
    React.useState<ControlProfileDownloadState>({ phase: 'idle' });
  const [controlProfileConnecting, setControlProfileConnecting] = React.useState(false);
  const [controlProfileDisconnecting, setControlProfileDisconnecting] = React.useState(false);
  const [controlProfileRecords, setControlProfileRecords] = React.useState<
    ReadonlyArray<SavedControlProfileRecordPayload>
  >([]);
  const [controlProfileRecordsLoading, setControlProfileRecordsLoading] = React.useState(false);
  const [controlProfileRecordsError, setControlProfileRecordsError] = React.useState<string | null>(
    null,
  );
  const [openingControlProfileId, setOpeningControlProfileId] = React.useState<string | null>(null);
  const [openedControlProfilesByRecordId, setOpenedControlProfilesByRecordId] = React.useState<
    ReadonlyMap<string, ControlProfileOpenedEvent>
  >(new Map());
  const sessionList = React.useMemo(() => Array.from(sessions.values()), [sessions]);
  const openedControlProfileSessionId = getControlProfileSessionId(openedControlProfile);
  const visibleControlProfile =
    openedControlProfileSessionId === null || sessions.has(openedControlProfileSessionId)
      ? openedControlProfile
      : null;
  const activeControlProfileRecordId = React.useMemo(() => {
    for (const [recordId, event] of openedControlProfilesByRecordId) {
      if (getControlProfileSessionId(event) === activeId) return recordId;
    }
    return visibleControlProfile?.record.id ?? null;
  }, [activeId, openedControlProfilesByRecordId, visibleControlProfile]);

  const rememberOpenedControlProfile = React.useCallback((event: ControlProfileOpenedEvent) => {
    setOpenedControlProfile(event);
    setOpenedControlProfilesByRecordId((records) => {
      const next = new Map(records);
      next.set(event.record.id, event);
      return next;
    });
    setControlProfileRecords((records) => upsertControlProfileRecord(records, event.record));
  }, []);

  const loadControlProfileRecords = React.useCallback(async (): Promise<void> => {
    const api = getLinkterm();
    if (!api) {
      setControlProfileRecordsError(preloadUnavailableMessage);
      return;
    }
    setControlProfileRecordsLoading(true);
    setControlProfileRecordsError(null);
    try {
      const result = await api.controlProfile.listRecords();
      if (result.success) {
        setControlProfileRecords(result.data);
        return;
      }
      setControlProfileRecordsError(result.error.message);
    } finally {
      setControlProfileRecordsLoading(false);
    }
  }, [preloadUnavailableMessage]);

  React.useEffect(() => {
    void loadControlProfileRecords();
  }, [loadControlProfileRecords]);

  React.useEffect(() => {
    if (openedControlProfile !== null && openedControlProfileSessionId !== null) {
      if (!sessions.has(openedControlProfileSessionId)) setOpenedControlProfile(null);
    }
    setOpenedControlProfilesByRecordId((records) => {
      let next: Map<string, ControlProfileOpenedEvent> | null = null;
      for (const [recordId, event] of records) {
        const sessionId = getControlProfileSessionId(event);
        if (sessionId !== null && !sessions.has(sessionId)) {
          next ??= new Map(records);
          next.delete(recordId);
        }
      }
      return next ?? records;
    });
  }, [openedControlProfile, openedControlProfileSessionId, sessions]);

  React.useEffect(() => {
    setControlProfileDownload({ phase: 'idle' });
  }, [openedControlProfile?.record.id]);

  const openControlProfileRecord = React.useCallback(
    async (recordId: string): Promise<void> => {
      const existing = openedControlProfilesByRecordId.get(recordId);
      const existingSessionId = getControlProfileSessionId(existing ?? null);
      if (existing !== undefined && existingSessionId !== null && sessions.has(existingSessionId)) {
        setOpenedControlProfile(existing);
        setActive(existingSessionId);
        return;
      }

      const api = getLinkterm();
      if (!api) {
        setControlProfileRecordsError(preloadUnavailableMessage);
        return;
      }
      setOpeningControlProfileId(recordId);
      setControlProfileRecordsError(null);
      try {
        const result = await api.controlProfile.openRecord({ recordId });
        if (!result.success) {
          setControlProfileRecordsError(result.error.message);
          return;
        }
        const record = result.data.record;
        setControlProfileRecords((records) => upsertControlProfileRecord(records, record));
        const observation = await openObservationForRecord(api, record, addSession, setActive);
        rememberOpenedControlProfile({ path: result.data.path, record, observation });
      } finally {
        setOpeningControlProfileId(null);
      }
    },
    [
      addSession,
      openedControlProfilesByRecordId,
      rememberOpenedControlProfile,
      sessions,
      setActive,
      preloadUnavailableMessage,
    ],
  );

  const connectControlProfile = React.useCallback(async (): Promise<void> => {
    if (openedControlProfile === null) return;
    const api = getLinkterm();
    if (!api) {
      rememberOpenedControlProfile({
        ...openedControlProfile,
        observation: {
          ...openedControlProfile.observation,
          error: preloadUnavailableMessage,
        },
      });
      return;
    }
    setControlProfileConnecting(true);
    try {
      const observation = await openObservationForRecord(
        api,
        openedControlProfile.record,
        addSession,
        setActive,
      );
      rememberOpenedControlProfile({ ...openedControlProfile, observation });
    } finally {
      setControlProfileConnecting(false);
    }
  }, [
    addSession,
    openedControlProfile,
    preloadUnavailableMessage,
    rememberOpenedControlProfile,
    setActive,
  ]);

  const disconnectControlProfile = React.useCallback(async (): Promise<void> => {
    if (openedControlProfile === null || openedControlProfileSessionId === null) return;
    const api = getLinkterm();
    setControlProfileDisconnecting(true);
    try {
      if (api) {
        const result = await api.session.destroy({ sessionId: openedControlProfileSessionId });
        if (!result.success) {
          setOpenedControlProfile({
            ...openedControlProfile,
            observation: { ...openedControlProfile.observation, error: result.error.message },
          });
          return;
        }
      }
      removeSession(openedControlProfileSessionId);
      rememberOpenedControlProfile({
        ...openedControlProfile,
        observation: disconnectObservation(openedControlProfile.observation),
      });
    } finally {
      setControlProfileDisconnecting(false);
    }
  }, [
    openedControlProfile,
    openedControlProfileSessionId,
    rememberOpenedControlProfile,
    removeSession,
  ]);

  const downloadControlProfile = React.useCallback(async (): Promise<void> => {
    if (openedControlProfile === null) return;
    const api = getLinkterm();
    if (!api) {
      setControlProfileDownload({
        phase: 'failed',
        error: t('controlProfile.error.preloadUnavailable'),
      });
      return;
    }
    setControlProfileDownload({ phase: 'running' });
    const result = await api.controlProfile.startDownload({ root: openedControlProfile.record.root });
    if (result.success) {
      setControlProfileDownload({ phase: 'running', job: result.data });
      return;
    }
    setControlProfileDownload({ phase: 'failed', error: result.error.message });
  }, [openedControlProfile, t]);

  const runningDownloadJobId =
    controlProfileDownload.phase === 'running' ? controlProfileDownload.job?.jobId : undefined;

  React.useEffect(() => {
    if (runningDownloadJobId === undefined) return;
    const api = getLinkterm();
    if (!api) {
      setControlProfileDownload({ phase: 'failed', error: preloadUnavailableMessage });
      return;
    }

    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const poll = async (): Promise<void> => {
      const result = await api.controlProfile.getDownloadStatus({ jobId: runningDownloadJobId });
      if (disposed) return;
      if (!result.success) {
        setControlProfileDownload({ phase: 'failed', error: result.error.message });
        return;
      }

      const job = result.data;
      if (isActiveDownloadJob(job)) {
        setControlProfileDownload({ phase: 'running', job });
        timer = setTimeout(() => void poll(), DOWNLOAD_POLL_INTERVAL_MS);
        return;
      }

      const finalJob = job.workflow
        ? job
        : await readDownloadJob(api.controlProfile, runningDownloadJobId, job);
      if (disposed) return;
      const workflow = finalJob.workflow;
      if (finalJob.state === 'succeeded' && workflow !== undefined) {
        setControlProfileDownload({ phase: 'succeeded', result: workflow });
        return;
      }
      setControlProfileDownload({
        phase: 'failed',
        error: describeDownloadJobFailure(finalJob),
        ...(workflow !== undefined ? { result: workflow } : {}),
      });
    };

    void poll();
    return () => {
      disposed = true;
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [runningDownloadJobId, preloadUnavailableMessage]);

  return (
    <div className="flex h-screen flex-col bg-gray-950 text-gray-100">
      <header className="flex items-center justify-between border-b border-gray-800 px-4 py-3">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded bg-blue-600 text-sm font-bold">
            LT
          </div>
          <div>
            <h1 className="text-base font-semibold leading-tight">{t('app.title')}</h1>
            <p className="text-xs text-gray-400 leading-tight">{t('app.subtitle')}</p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setControlPanelOpen(true)}
            data-testid="control-profile-open"
          >
            {t('controlProfile.entry')}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setAgentPanelOpen(true)}
            data-testid="agent-integrations-open"
          >
            {t('agent.entry')}
          </Button>
          {(['en', 'zh'] as Locale[]).map((l) => (
            <Button
              key={l}
              variant={locale === l ? 'default' : 'ghost'}
              size="sm"
              onClick={() => setLocale(l)}
              data-testid={`locale-${l}`}
            >
              {t(l === 'en' ? 'header.locale.en' : 'header.locale.zh')}
            </Button>
          ))}
        </div>
      </header>

      <SessionTabBar />

      <main className="flex min-h-0 flex-1 overflow-hidden">
        <ControlProfileSidebar
          records={controlProfileRecords}
          loading={controlProfileRecordsLoading}
          error={controlProfileRecordsError}
          activeRecordId={activeControlProfileRecordId}
          openingRecordId={openingControlProfileId}
          onOpenRecord={(recordId) => void openControlProfileRecord(recordId)}
          onRefresh={() => void loadControlProfileRecords()}
          onConfigure={() => setControlPanelOpen(true)}
        />
        {visibleControlProfile ? (
          <ControlProfileStatusPanel
            event={visibleControlProfile}
            download={controlProfileDownload}
            connecting={controlProfileConnecting}
            disconnecting={controlProfileDisconnecting}
            onConnect={() => void connectControlProfile()}
            onDisconnect={() => void disconnectControlProfile()}
            onDownload={() => void downloadControlProfile()}
          />
        ) : null}
        <div className="relative min-w-0 flex-1 overflow-hidden">
          {sessionList.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center text-center">
              <h2 className="text-lg font-medium text-gray-300">{t('tabs.empty.title')}</h2>
              <p className="mt-1 text-sm text-gray-500">{t('tabs.empty.subtitle')}</p>
            </div>
          ) : (
            sessionList.map((session) => {
              const active = session.id === activeId;
              return (
                <div
                  key={session.id}
                  className={
                    active
                      ? 'absolute inset-0 h-full w-full'
                      : 'absolute inset-0 h-full w-full invisible pointer-events-none'
                  }
                  aria-hidden={!active}
                >
                  <TerminalView sessionId={session.id} />
                </div>
              );
            })
          )}
        </div>
      </main>

      <ConnectionDialog />
      <ControlProfilePanel
        open={controlPanelOpen}
        onOpenChange={setControlPanelOpen}
        onProfileOpened={rememberOpenedControlProfile}
        onRecordsChanged={() => void loadControlProfileRecords()}
      />
      <AgentIntegrationsPanel open={agentPanelOpen} onOpenChange={setAgentPanelOpen} />
    </div>
  );
}

function ControlProfileSidebar({
  records,
  loading,
  error,
  activeRecordId,
  openingRecordId,
  onOpenRecord,
  onRefresh,
  onConfigure,
}: {
  records: ReadonlyArray<SavedControlProfileRecordPayload>;
  loading: boolean;
  error: string | null;
  activeRecordId: string | null;
  openingRecordId: string | null;
  onOpenRecord(recordId: string): void;
  onRefresh(): void;
  onConfigure(): void;
}): React.ReactElement {
  const t = useT();

  return (
    <aside
      className="flex w-64 shrink-0 flex-col border-r border-gray-800 bg-gray-950"
      data-testid="control-profile-sidebar"
    >
      <div className="border-b border-gray-800 px-3 py-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="min-w-0 truncate text-sm font-semibold text-gray-100">
            {t('controlProfile.sidebar.title')}
          </h2>
          <div className="flex shrink-0 items-center gap-1">
            <Button type="button" variant="ghost" size="sm" onClick={onRefresh}>
              {t('controlProfile.sidebar.refresh')}
            </Button>
            <Button type="button" variant="secondary" size="sm" onClick={onConfigure}>
              {t('controlProfile.sidebar.edit')}
            </Button>
          </div>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
        {loading ? (
          <div className="px-2 py-2 text-xs text-gray-500" data-testid="control-profile-loading">
            {t('controlProfile.sidebar.loading')}
          </div>
        ) : null}
        {error ? (
          <div
            className="mb-2 rounded border border-red-900 bg-red-950 px-2 py-2 text-xs text-red-100"
            data-testid="control-profile-sidebar-error"
          >
            {error}
          </div>
        ) : null}
        {!loading && records.length === 0 ? (
          <div className="px-2 py-2 text-xs text-gray-500" data-testid="control-profile-empty">
            {t('controlProfile.sidebar.empty')}
          </div>
        ) : null}
        <div className="space-y-1">
          {records.map((record) => {
            const active = record.id === activeRecordId;
            const opening = record.id === openingRecordId;
            return (
              <button
                key={record.id}
                type="button"
                onClick={() => onOpenRecord(record.id)}
                disabled={opening}
                aria-current={active ? 'page' : undefined}
                data-testid={`control-profile-sidebar-item-${record.id}`}
                className={[
                  'flex w-full min-w-0 flex-col rounded px-2 py-2 text-left transition-colors',
                  active
                    ? 'bg-blue-950 text-blue-50 ring-1 ring-blue-700'
                    : 'text-gray-200 hover:bg-gray-900',
                  opening ? 'opacity-70' : '',
                ].join(' ')}
              >
                <span className="flex min-w-0 items-center justify-between gap-2">
                  <span className="min-w-0 truncate text-sm font-medium">{record.label}</span>
                  <span className="shrink-0 rounded bg-gray-800 px-1.5 py-0.5 text-[10px] uppercase text-gray-300">
                    {record.source === 'ai'
                      ? t('controlProfile.record.source.ai')
                      : t('controlProfile.record.source.manual')}
                  </span>
                </span>
                <span className="mt-1 truncate text-xs text-gray-500">
                  {opening
                    ? t('controlProfile.record.opening')
                    : describeControlProfileRecord(record, t)}
                </span>
                <span className="mt-0.5 truncate text-[11px] text-gray-600">{record.root}</span>
              </button>
            );
          })}
        </div>
      </div>
    </aside>
  );
}

function ControlProfileStatusPanel({
  event,
  download,
  connecting,
  disconnecting,
  onConnect,
  onDisconnect,
  onDownload,
}: {
  event: ControlProfileOpenedEvent;
  download: ControlProfileDownloadState;
  connecting: boolean;
  disconnecting: boolean;
  onConnect(): void;
  onDisconnect(): void;
  onDownload(): void;
}): React.ReactElement {
  const t = useT();
  const sessionState = useControlProfileSessionState(event);
  const sessionId = getControlProfileSessionId(event);
  const record = event.record;
  const profile = record.profile;
  const observation = event.observation;
  const stateLabel = sessionState !== null ? t(`session.state.${sessionState}`) : null;
  const canDisconnect = sessionId !== null;
  const isSerialObservation = observation.type === 'serial';
  const connectLabel = isSerialObservation
    ? t('controlProfile.serial.open')
    : t('controlProfile.connect');
  const connectingLabel = isSerialObservation
    ? t('controlProfile.serial.opening')
    : t('controlProfile.connecting');
  const disconnectLabel = isSerialObservation
    ? t('controlProfile.serial.disconnect')
    : t('controlProfile.disconnect');
  const disconnectingLabel = isSerialObservation
    ? t('controlProfile.serial.disconnecting')
    : t('controlProfile.disconnecting');

  return (
    <section
      className="w-80 shrink-0 overflow-y-auto border-r border-gray-800 bg-gray-900 px-4 py-3"
      data-panel-position="left"
      data-testid="control-profile-status"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-gray-100">{record.label}</div>
          <div className="mt-1 truncate text-xs text-gray-400">{record.root}</div>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="rounded bg-gray-800 px-2 py-1 text-gray-200">
            {describeObservation(observation)}
          </span>
          {stateLabel ? (
            <span className="rounded bg-gray-800 px-2 py-1 text-gray-200">{stateLabel}</span>
          ) : null}
        </div>
      </div>

      <div className="mt-3 grid gap-2">
        <div className="grid grid-cols-2 gap-2">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={onConnect}
            disabled={connecting || canDisconnect}
          >
            {connecting ? connectingLabel : connectLabel}
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={onDisconnect}
            disabled={disconnecting || !canDisconnect}
          >
            {disconnecting ? disconnectingLabel : disconnectLabel}
          </Button>
        </div>
        <Button
          type="button"
          size="sm"
          onClick={onDownload}
          disabled={download.phase === 'running'}
        >
          {download.phase === 'running'
            ? t('controlProfile.download.downloading')
            : t('controlProfile.download')}
        </Button>
      </div>

      <StatusBar download={download} />

      <dl className="mt-3 grid gap-2 text-xs text-gray-300">
        <ProfileFact label={t('controlProfile.target')} value={profile.jlink?.target} />
        <ProfileFact label={t('controlProfile.debugInterface')} value={profile.jlink?.interface} />
        <ProfileFact
          label={t('controlProfile.jlinkSpeed')}
          value={profile.jlink?.speedKHz !== undefined ? String(profile.jlink.speedKHz) : undefined}
        />
        <ProfileFact label={t('controlProfile.firmwarePath')} value={profile.flash?.binary} />
        <ProfileFact
          label={t('controlProfile.flashBaseAddress')}
          value={profile.flash?.baseAddress}
        />
        {profile.serial?.enabled === true ? (
          <>
            <ProfileFact label={t('controlProfile.serialPort')} value={profile.serial.port} />
            <ProfileFact
              label={t('controlProfile.baudRate')}
              value={
                profile.serial.baudRate !== undefined ? String(profile.serial.baudRate) : undefined
              }
            />
          </>
        ) : null}
        {profile.rtt?.enabled === true ? (
          <>
            <ProfileFact
              label={t('controlProfile.rttLog.channel')}
              value={String(observation.type === 'rtt' ? observation.channelIndex : 0)}
            />
            <ProfileFact
              label={t('controlProfile.rttControlBlockAddress')}
              value={profile.rtt.controlBlockAddress}
            />
          </>
        ) : null}
      </dl>

      {observation.error ? (
        <p className="mt-2 rounded border border-red-900 bg-red-950 px-3 py-2 text-xs text-red-100">
          {observation.error}
        </p>
      ) : null}

      <DownloadResultPanel download={download} />
    </section>
  );
}

type ControlProfileDownloadState =
  | { phase: 'idle' }
  | { phase: 'running'; job?: ControlProfileDownloadJobPayload }
  | { phase: 'succeeded'; result: ControlProfileDownloadResultPayload }
  | { phase: 'failed'; error: string; result?: ControlProfileDownloadResultPayload };

function StatusBar({ download }: { download: ControlProfileDownloadState }): React.ReactElement {
  const t = useT();
  const label = describeDownloadPhase(download, t);
  const width = `${getDownloadProgressPercent(download)}%`;
  const barClass =
    download.phase === 'failed'
      ? 'bg-red-500'
      : download.phase === 'succeeded'
        ? 'bg-emerald-500'
        : download.phase === 'running'
          ? 'bg-blue-500'
          : 'bg-gray-700';

  return (
    <div className="mt-3" data-testid="control-profile-status-bar" data-phase={download.phase}>
      <div className="flex items-center justify-between text-xs">
        <span className="text-gray-400">{t('controlProfile.statusBar')}</span>
        <span className="text-gray-200">{label}</span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded bg-gray-800">
        <div
          className={`h-full ${barClass} transition-[width] duration-200 ease-out`}
          style={{ width }}
        />
      </div>
    </div>
  );
}

function DownloadResultPanel({
  download,
}: {
  download: ControlProfileDownloadState;
}): React.ReactElement | null {
  const t = useT();
  if (download.phase === 'idle') return null;
  if (download.phase === 'running') {
    const workflow = download.job?.workflow;
    const steps = workflow?.steps ?? (download.job?.currentStep ? [download.job.currentStep] : []);
    const progress = getCurrentFlashProgress(download);
    if (download.job === undefined && steps.length === 0) return null;
    return (
      <div
        className="mt-3 space-y-3 rounded border border-gray-800 bg-gray-950/60 px-3 py-2 text-xs text-gray-200"
        data-testid="control-profile-download-result"
      >
        <div className="font-medium text-blue-200">{t('controlProfile.download.downloading')}</div>
        {progress ? (
          <div className="rounded border border-blue-900 bg-blue-950/40 px-2 py-2 text-blue-50">
            <div className="flex items-center justify-between gap-2">
              <span className="min-w-0 truncate">{progress.message}</span>
              {progress.percent !== undefined ? (
                <span className="shrink-0 font-medium">{progress.percent}%</span>
              ) : null}
            </div>
            {formatProgressBytes(progress) ? (
              <div className="mt-1 text-[11px] text-blue-200">{formatProgressBytes(progress)}</div>
            ) : null}
          </div>
        ) : null}
        {steps.length > 0 ? (
          <div className="space-y-2">
            {steps.map((step) => (
              <DownloadStep key={step.id} step={step} />
            ))}
          </div>
        ) : null}
      </div>
    );
  }
  if (download.phase === 'failed') {
    return (
      <div
        className="mt-3 rounded border border-red-900 bg-red-950 px-3 py-2 text-xs text-red-100"
        data-testid="control-profile-download-result"
      >
        <div className="font-medium">{t('controlProfile.download.failed')}</div>
        <div className="mt-1 break-words">{download.error}</div>
        {download.result?.steps.length ? (
          <div className="mt-2 space-y-2">
            {download.result.steps.map((step) => (
              <DownloadStep key={step.id} step={step} />
            ))}
          </div>
        ) : null}
      </div>
    );
  }

  const summaryFacts = summarizeDownload(download.result);
  return (
    <div
      className="mt-3 space-y-3 rounded border border-gray-800 bg-gray-950/60 px-3 py-2 text-xs text-gray-200"
      data-testid="control-profile-download-result"
    >
      <div className="font-medium text-emerald-200">{t('controlProfile.download.complete')}</div>
      {summaryFacts.length > 0 ? (
        <div className="flex flex-wrap gap-1">
          {summaryFacts.map((fact) => (
            <span key={fact} className="rounded bg-gray-800 px-2 py-0.5">
              {fact}
            </span>
          ))}
        </div>
      ) : null}
      {download.result.steps.length > 0 ? (
        <div className="space-y-2">
          {download.result.steps.map((step) => (
            <DownloadStep key={step.id} step={step} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function DownloadStep({ step }: { step: ControlProfileWorkflowStepPayload }): React.ReactElement {
  const progress = getStepFlashProgress(step);
  const details = step.error?.message ?? formatEvidence(step.evidence);
  return (
    <div className="rounded border border-gray-800 bg-gray-900 px-2 py-2">
      <div className="flex items-center justify-between gap-2">
        <span className="min-w-0 truncate font-medium text-gray-100">{step.id}</span>
        <span className="shrink-0 text-gray-400">
          {step.status} / {step.durationMs} ms
        </span>
      </div>
      {progress ? (
        <div className="mt-1 flex items-center justify-between gap-2 text-[11px] text-blue-200">
          <span className="min-w-0 truncate">{progress.message}</span>
          {progress.percent !== undefined ? <span className="shrink-0">{progress.percent}%</span> : null}
        </div>
      ) : null}
      {details ? (
        <pre className="mt-1 max-h-28 overflow-auto whitespace-pre-wrap break-words rounded bg-gray-950 p-2 font-mono text-[11px] text-gray-300">
          {details}
        </pre>
      ) : null}
    </div>
  );
}

function ProfileFact({
  label,
  value,
}: {
  label: string;
  value: string | undefined;
}): React.ReactElement {
  return (
    <div className="min-w-0">
      <dt className="text-gray-500">{label}</dt>
      <dd className="truncate text-gray-100">{value ?? '-'}</dd>
    </div>
  );
}

function describeDownloadPhase(
  download: ControlProfileDownloadState,
  t: ReturnType<typeof useT>,
): string {
  switch (download.phase) {
    case 'idle':
      return t('controlProfile.download.idle');
    case 'running':
      return describeRunningDownload(download, t);
    case 'succeeded':
      return t('controlProfile.download.complete');
    case 'failed':
      return t('controlProfile.download.failed');
  }
}

interface FlashProgressView {
  phase?: string;
  message: string;
  percent?: number;
  bytesWritten?: number;
  bytesTotal?: number;
}

function describeRunningDownload(
  download: Extract<ControlProfileDownloadState, { phase: 'running' }>,
  t: ReturnType<typeof useT>,
): string {
  const progress = getCurrentFlashProgress(download);
  if (progress?.percent !== undefined) return `${progress.message} ${progress.percent}%`;
  if (progress) return progress.message;
  return t('controlProfile.download.downloading');
}

function getDownloadProgressPercent(download: ControlProfileDownloadState): number {
  if (download.phase === 'idle') return 18;
  if (download.phase === 'succeeded') return 100;

  const progress = getCurrentFlashProgress(download);
  if (progress?.percent !== undefined) return clampPercent(progress.percent);
  if (download.phase === 'failed') return 100;

  const steps = download.job?.workflow?.steps ?? [];
  if (steps.length === 0) return 8;
  const completed = steps.filter((step) => step.status === 'passed' || step.status === 'skipped').length;
  const runningBonus = steps.some((step) => step.status === 'running') ? 0.5 : 0;
  return Math.min(95, Math.max(8, Math.round(((completed + runningBonus) / (steps.length + 1)) * 100)));
}

function getCurrentFlashProgress(
  download: ControlProfileDownloadState,
): FlashProgressView | null {
  if (download.phase === 'idle') return null;
  const currentStep =
    download.phase === 'running' ? download.job?.currentStep : download.result?.steps.at(-1);
  return getStepFlashProgress(currentStep);
}

function getStepFlashProgress(
  step: ControlProfileWorkflowStepPayload | undefined,
): FlashProgressView | null {
  if (!step || !isRecord(step.evidence)) return null;
  const progress = step.evidence.progress;
  if (!isRecord(progress)) return null;
  const rawPercent = progress.percent;
  const percent =
    typeof rawPercent === 'number' && Number.isFinite(rawPercent)
      ? clampPercent(rawPercent)
      : undefined;
  const rawBytesWritten = progress.bytesWritten;
  const rawBytesTotal = progress.bytesTotal;
  return {
    ...(typeof progress.phase === 'string' ? { phase: progress.phase } : {}),
    message: typeof progress.message === 'string' ? progress.message : step.id,
    ...(percent !== undefined ? { percent } : {}),
    ...(typeof rawBytesWritten === 'number' && Number.isFinite(rawBytesWritten)
      ? { bytesWritten: Math.max(0, Math.round(rawBytesWritten)) }
      : {}),
    ...(typeof rawBytesTotal === 'number' && Number.isFinite(rawBytesTotal)
      ? { bytesTotal: Math.max(0, Math.round(rawBytesTotal)) }
      : {}),
  };
}

function formatProgressBytes(progress: FlashProgressView): string | null {
  if (progress.bytesWritten !== undefined && progress.bytesTotal !== undefined) {
    return `${progress.bytesWritten} / ${progress.bytesTotal} bytes`;
  }
  if (progress.bytesTotal !== undefined) return `${progress.bytesTotal} bytes`;
  return null;
}

function clampPercent(value: number): number {
  return Math.min(100, Math.max(0, Math.round(value)));
}

function isActiveDownloadJob(job: ControlProfileDownloadJobPayload): boolean {
  return job.state === 'queued' || job.state === 'running';
}

async function readDownloadJob(
  controlProfile: ControlProfileNamespace,
  jobId: string,
  fallback: ControlProfileDownloadJobPayload,
): Promise<ControlProfileDownloadJobPayload> {
  const result = await controlProfile.readDownload({ jobId });
  return result.success ? result.data : fallback;
}

function describeDownloadJobFailure(job: ControlProfileDownloadJobPayload): string {
  if (job.state === 'cancelled') return 'Download cancelled';
  const failedStep =
    job.workflow?.steps.find((step) => step.id === job.failedStep) ??
    job.workflow?.steps.find((step) => step.status === 'failed');
  return failedStep?.error?.message ?? 'Download failed';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function summarizeDownload(result: ControlProfileDownloadResultPayload): string[] {
  return Object.entries(result.summary)
    .filter(([, value]) => value)
    .map(([key]) => key);
}

function formatEvidence(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function useControlProfileSessionState(event: ControlProfileOpenedEvent): SessionState | null {
  const sessions = useAppStore((s) => s.sessions);
  if (event.observation.type !== 'serial' && event.observation.type !== 'rtt') return null;
  const sessionId = event.observation.sessionId;
  if (sessionId === undefined) return event.observation.state ?? null;
  return sessions.get(sessionId)?.state ?? event.observation.state ?? null;
}

function getControlProfileSessionId(event: ControlProfileOpenedEvent | null): SessionId | null {
  if (event === null) return null;
  if (event.observation.type !== 'serial' && event.observation.type !== 'rtt') return null;
  return event.observation.sessionId ?? null;
}

function disconnectObservation(
  observation: ControlProfileOpenedEvent['observation'],
): ControlProfileOpenedEvent['observation'] {
  switch (observation.type) {
    case 'serial':
      return { type: 'serial' };
    case 'rtt':
      return {
        type: 'rtt',
        channelIndex: observation.channelIndex,
        ...(observation.probeId !== undefined ? { probeId: observation.probeId } : {}),
        ...(observation.reused !== undefined ? { reused: observation.reused } : {}),
      };
    case 'none':
      return observation;
  }
}

function describeObservation(observation: ControlProfileOpenedEvent['observation']): string {
  switch (observation.type) {
    case 'serial':
      return 'Serial';
    case 'rtt':
      return `RTT ch${observation.channelIndex}`;
    case 'none':
      return 'No observation';
  }
}

function describeControlProfileRecord(
  record: SavedControlProfileRecordPayload,
  t: ReturnType<typeof useT>,
): string {
  if (record.profile.serial?.enabled === true) {
    const port = record.profile.serial.port ?? '-';
    const baudRate = record.profile.serial.baudRate;
    return baudRate !== undefined
      ? `${t('controlProfile.observation.serial')} / ${port} / ${baudRate}`
      : `${t('controlProfile.observation.serial')} / ${port}`;
  }
  if (record.profile.rtt?.enabled === true) {
    const channelIndex = record.profile.rtt.channels?.[0] ?? 0;
    return `${t('controlProfile.observation.rtt')} / ch${channelIndex}`;
  }
  return 'No observation';
}

function upsertControlProfileRecord(
  records: ReadonlyArray<SavedControlProfileRecordPayload>,
  next: SavedControlProfileRecordPayload,
): ReadonlyArray<SavedControlProfileRecordPayload> {
  return [next, ...records.filter((record) => record.id !== next.id)].sort((a, b) =>
    b.updatedAt.localeCompare(a.updatedAt),
  );
}
