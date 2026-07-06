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
  ControlProfileDownloadResultPayload,
  ControlProfileWorkflowStepPayload,
} from '../shared/preload-api.js';
import type { SessionId, SessionState } from '../shared/types.js';

/**
 * App 根组件.
 */
export function App(): React.ReactElement {
  // Phase 10：在根组件一次性挂载 MCP UI patch 订阅；卸载时随 React 自动清理。
  useUiPatchSubscription();
  useSessionHydration();

  const t = useT();
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
  const sessionList = React.useMemo(() => Array.from(sessions.values()), [sessions]);
  const openedControlProfileSessionId = getControlProfileSessionId(openedControlProfile);
  const visibleControlProfile =
    openedControlProfileSessionId === null || sessions.has(openedControlProfileSessionId)
      ? openedControlProfile
      : null;

  React.useEffect(() => {
    if (openedControlProfile === null || openedControlProfileSessionId === null) return;
    if (!sessions.has(openedControlProfileSessionId)) setOpenedControlProfile(null);
  }, [openedControlProfile, openedControlProfileSessionId, sessions]);

  React.useEffect(() => {
    setControlProfileDownload({ phase: 'idle' });
  }, [openedControlProfile?.record.id]);

  const connectControlProfile = React.useCallback(async (): Promise<void> => {
    if (openedControlProfile === null) return;
    const api = getLinkterm();
    if (!api) {
      setOpenedControlProfile({
        ...openedControlProfile,
        observation: {
          ...openedControlProfile.observation,
          error: t('controlProfile.error.preloadUnavailable'),
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
      setOpenedControlProfile({ ...openedControlProfile, observation });
    } finally {
      setControlProfileConnecting(false);
    }
  }, [addSession, openedControlProfile, setActive, t]);

  const disconnectControlProfile = React.useCallback(async (): Promise<void> => {
    if (openedControlProfileSessionId === null) {
      setOpenedControlProfile(null);
      return;
    }
    const api = getLinkterm();
    setControlProfileDisconnecting(true);
    try {
      if (api) {
        const result = await api.session.destroy({ sessionId: openedControlProfileSessionId });
        if (!result.success && openedControlProfile !== null) {
          setOpenedControlProfile({
            ...openedControlProfile,
            observation: { ...openedControlProfile.observation, error: result.error.message },
          });
          return;
        }
      }
      removeSession(openedControlProfileSessionId);
      setOpenedControlProfile(null);
    } finally {
      setControlProfileDisconnecting(false);
    }
  }, [openedControlProfile, openedControlProfileSessionId, removeSession]);

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
    const result = await api.controlProfile.runDownload({ root: openedControlProfile.record.root });
    if (result.success) {
      setControlProfileDownload({ phase: 'succeeded', result: result.data });
      return;
    }
    setControlProfileDownload({ phase: 'failed', error: result.error.message });
  }, [openedControlProfile, t]);

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
        onProfileOpened={setOpenedControlProfile}
      />
      <AgentIntegrationsPanel open={agentPanelOpen} onOpenChange={setAgentPanelOpen} />
    </div>
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
            {connecting ? t('controlProfile.connecting') : t('controlProfile.connect')}
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={onDisconnect}
            disabled={disconnecting || !canDisconnect}
          >
            {disconnecting ? t('controlProfile.disconnecting') : t('controlProfile.disconnect')}
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
  | { phase: 'running' }
  | { phase: 'succeeded'; result: ControlProfileDownloadResultPayload }
  | { phase: 'failed'; error: string };

function StatusBar({ download }: { download: ControlProfileDownloadState }): React.ReactElement {
  const t = useT();
  const label = describeDownloadPhase(download, t);
  const barClass =
    download.phase === 'failed'
      ? 'bg-red-500'
      : download.phase === 'succeeded'
        ? 'bg-emerald-500'
        : download.phase === 'running'
          ? 'bg-blue-500'
          : 'bg-gray-700';
  const width =
    download.phase === 'succeeded' ? '100%' : download.phase === 'running' ? '65%' : '18%';

  return (
    <div className="mt-3" data-testid="control-profile-status-bar" data-phase={download.phase}>
      <div className="flex items-center justify-between text-xs">
        <span className="text-gray-400">{t('controlProfile.statusBar')}</span>
        <span className="text-gray-200">{label}</span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded bg-gray-800">
        <div className={`h-full ${barClass}`} style={{ width }} />
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
  if (download.phase === 'idle' || download.phase === 'running') return null;
  if (download.phase === 'failed') {
    return (
      <div
        className="mt-3 rounded border border-red-900 bg-red-950 px-3 py-2 text-xs text-red-100"
        data-testid="control-profile-download-result"
      >
        <div className="font-medium">{t('controlProfile.download.failed')}</div>
        <div className="mt-1 break-words">{download.error}</div>
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
  const details = step.error?.message ?? formatEvidence(step.evidence);
  return (
    <div className="rounded border border-gray-800 bg-gray-900 px-2 py-2">
      <div className="flex items-center justify-between gap-2">
        <span className="min-w-0 truncate font-medium text-gray-100">{step.id}</span>
        <span className="shrink-0 text-gray-400">
          {step.status} / {step.durationMs} ms
        </span>
      </div>
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
      return t('controlProfile.download.downloading');
    case 'succeeded':
      return t('controlProfile.download.complete');
    case 'failed':
      return t('controlProfile.download.failed');
  }
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
