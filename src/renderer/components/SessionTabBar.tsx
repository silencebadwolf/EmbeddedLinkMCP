/**
 * 多会话标签栏。
 *
 * 每个 tab 显示：连接图标 + label + state badge + OriginIndicator + 关闭按钮。
 * 右侧 "+" 按钮触发 ConnectionDialog 打开。
 */

import * as React from 'react';
import { Tabs, TabsList, TabsTrigger } from './ui/tabs.js';
import { Button } from './ui/button.js';
import { OriginIndicator } from './OriginIndicator.js';
import { useSessions } from '../hooks/useSession.js';
import { useAppStore } from '../store/app-store.js';
import { useT } from '../i18n/index.js';
import { cn } from '../lib/cn.js';
import type { SessionMeta } from '../store/app-store.js';

const STATE_BADGE_CLS: Record<string, string> = {
  idle: 'bg-gray-700 text-gray-200',
  opening: 'bg-yellow-600 text-yellow-50',
  open: 'bg-emerald-600 text-emerald-50',
  closing: 'bg-yellow-700 text-yellow-50',
  closed: 'bg-gray-800 text-gray-300',
  errored: 'bg-red-700 text-red-50',
};

const TYPE_ICON: Record<SessionMeta['connectionType'], string> = {
  serial: 'S',
  ssh: 'H',
  'local-shell': 'L',
};

/**
 * SessionTabBar 组件。
 */
export function SessionTabBar(): React.ReactElement {
  const t = useT();
  const { sessions, activeId, destroy, select } = useSessions();
  const openDialog = useAppStore((s) => s.openDialog);
  const originActivity = useAppStore((s) => s.originActivity);

  return (
    <div className="flex items-center gap-2 border-b border-gray-800 bg-gray-950 px-3 py-2">
      <Tabs value={activeId ?? undefined} onValueChange={(v) => select(v)}>
        <TabsList>
          {sessions.length === 0 ? (
            <span className="text-xs text-gray-500" data-testid="tabs-empty">
              {t('tabs.empty.subtitle')}
            </span>
          ) : (
            sessions.map((s) => {
              const stateKey = `session.state.${s.state}` as const;
              return (
                <TabsTrigger key={s.id} value={s.id} data-testid={`tab-${s.id}`}>
                  <span
                    className="inline-flex h-5 w-5 items-center justify-center rounded bg-gray-800 text-[10px] font-bold text-gray-300"
                    aria-hidden
                  >
                    {TYPE_ICON[s.connectionType]}
                  </span>
                  <span className="max-w-[160px] truncate">{s.label}</span>
                  <span
                    className={cn(
                      'rounded px-1.5 py-0.5 text-[10px] font-medium uppercase',
                      STATE_BADGE_CLS[s.state] ?? 'bg-gray-700 text-gray-200',
                    )}
                  >
                    {t(stateKey)}
                  </span>
                  <OriginIndicator activity={originActivity[s.id]} />
                  <button
                    type="button"
                    aria-label={`close ${s.label}`}
                    data-testid={`tab-close-${s.id}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      void destroy(s.id);
                    }}
                    className="ml-1 inline-flex h-4 w-4 items-center justify-center rounded text-gray-500 hover:bg-gray-700 hover:text-gray-100"
                  >
                    x
                  </button>
                </TabsTrigger>
              );
            })
          )}
        </TabsList>
      </Tabs>
      <div className="ml-auto">
        <Button
          variant="secondary"
          size="sm"
          onClick={openDialog}
          data-testid="tabs-new"
        >
          + {t('tabs.new')}
        </Button>
      </div>
    </div>
  );
}
