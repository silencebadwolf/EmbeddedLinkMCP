/**
 * 应用根组件：装配顶栏 + SessionTabBar + TerminalView + ConnectionDialog。
 *
 * 单一 store 模式 —— 所有共享状态都在 useAppStore。
 */

import * as React from 'react';
import { SessionTabBar } from './components/SessionTabBar.js';
import { TerminalView } from './components/TerminalView.js';
import { ConnectionDialog } from './components/ConnectionDialog.js';
import { AgentIntegrationsPanel } from './components/AgentIntegrationsPanel.js';
import { Button } from './components/ui/button.js';
import { useAppStore } from './store/app-store.js';
import { useT, type Locale } from './i18n/index.js';
import { useUiPatchSubscription } from './hooks/useUiPatchSubscription.js';

/**
 * App 根组件。
 */
export function App(): React.ReactElement {
  // Phase 10：在根组件一次性挂载 MCP UI patch 订阅；卸载时随 React 自动清理。
  useUiPatchSubscription();

  const t = useT();
  const locale = useAppStore((s) => s.locale);
  const setLocale = useAppStore((s) => s.setLocale);
  const activeId = useAppStore((s) => s.activeSessionId);
  const sessions = useAppStore((s) => s.sessions);
  const [agentPanelOpen, setAgentPanelOpen] = React.useState(false);
  const sessionList = React.useMemo(() => Array.from(sessions.values()), [sessions]);

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

      <main className="relative flex-1 overflow-hidden">
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
      </main>

      <ConnectionDialog />
      <AgentIntegrationsPanel open={agentPanelOpen} onOpenChange={setAgentPanelOpen} />
    </div>
  );
}
