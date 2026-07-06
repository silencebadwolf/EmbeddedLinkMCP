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
import { ControlProfilePanel } from './components/ControlProfilePanel.js';
import { Button } from './components/ui/button.js';
import { useAppStore } from './store/app-store.js';
import { useT, type Locale } from './i18n/index.js';
import { useUiPatchSubscription } from './hooks/useUiPatchSubscription.js';
import { useSessionHydration } from './hooks/useSessionHydration.js';
import type { ControlProfileOpenedEvent } from './components/ControlProfilePanel.js';
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
  const [agentPanelOpen, setAgentPanelOpen] = React.useState(false);
  const [controlPanelOpen, setControlPanelOpen] = React.useState(false);
  const [openedControlProfile, setOpenedControlProfile] =
    React.useState<ControlProfileOpenedEvent | null>(null);
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
          <ControlProfileStatusPanel event={visibleControlProfile} />
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
}: {
  event: ControlProfileOpenedEvent;
}): React.ReactElement {
  const t = useT();
  const sessionState = useControlProfileSessionState(event);
  const record = event.record;
  const profile = record.profile;
  const observation = event.observation;
  const stateLabel = sessionState !== null ? t(`session.state.${sessionState}`) : null;

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

      <dl className="mt-3 grid gap-2 text-xs text-gray-300">
        <ProfileFact label={t('controlProfile.target')} value={profile.jlink?.target} />
        <ProfileFact label={t('controlProfile.debugInterface')} value={profile.jlink?.interface} />
        <ProfileFact
          label={t('controlProfile.jlinkSpeed')}
          value={
            profile.jlink?.speedKHz !== undefined ? String(profile.jlink.speedKHz) : undefined
          }
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
    </section>
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
