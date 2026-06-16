import * as React from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/dialog.js';
import { Button } from './ui/button.js';
import { getLinkterm } from '../lib/linkterm-bridge.js';
import { useT, type TranslationKey } from '../i18n/index.js';
import type {
  AgentIntegrationStatus,
  AgentIntegrationStatusKind,
  AgentIntegrationTargetId,
} from '../../shared/agent-integrations.js';

interface AgentIntegrationsPanelProps {
  open: boolean;
  onOpenChange(open: boolean): void;
}

const STATUS_KEYS: Record<AgentIntegrationStatusKind, TranslationKey> = {
  'not-found': 'agent.status.notFound',
  'invalid-json': 'agent.status.invalidJson',
  'not-configured': 'agent.status.notConfigured',
  'needs-update': 'agent.status.needsUpdate',
  configured: 'agent.status.configured',
};

const STATUS_CLASSES: Record<AgentIntegrationStatusKind, string> = {
  'not-found': 'bg-gray-800 text-gray-300',
  'invalid-json': 'bg-red-800 text-red-100',
  'not-configured': 'bg-yellow-800 text-yellow-100',
  'needs-update': 'bg-orange-800 text-orange-100',
  configured: 'bg-emerald-800 text-emerald-100',
};

/** Agent MCP integration panel with explicit install/repair actions. */
export function AgentIntegrationsPanel({
  open,
  onOpenChange,
}: AgentIntegrationsPanelProps): React.ReactElement {
  const t = useT();
  const [statuses, setStatuses] = React.useState<ReadonlyArray<AgentIntegrationStatus>>([]);
  const [loading, setLoading] = React.useState(false);
  const [installingId, setInstallingId] = React.useState<AgentIntegrationTargetId | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const load = React.useCallback(async (): Promise<void> => {
    const api = getLinkterm();
    if (!api) {
      setError('LinkTerm preload API is unavailable.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const result = await api.agentIntegrations.list();
      if (result.success) {
        setStatuses(result.data);
      } else {
        setError(result.error.message);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    if (!open) return;
    void load();
  }, [open, load]);

  const install = async (targetId: AgentIntegrationTargetId): Promise<void> => {
    const api = getLinkterm();
    if (!api) {
      setError(t('agent.error.unavailable'));
      return;
    }
    setInstallingId(targetId);
    setError(null);
    try {
      const result = await api.agentIntegrations.install({ targetId });
      if (!result.success) {
        setError(result.error.message);
        return;
      }
      setStatuses((prev) =>
        prev.map((status) =>
          status.id === targetId
            ? { ...result.data.status, backupPath: result.data.backupPath ?? result.data.status.backupPath }
            : status,
        ),
      );
    } finally {
      setInstallingId(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{t('agent.title')}</DialogTitle>
          <DialogDescription>{t('agent.description')}</DialogDescription>
        </DialogHeader>

        <div className="max-h-[60vh] space-y-3 overflow-y-auto">
          {loading ? <p className="text-sm text-gray-400">{t('agent.loading')}</p> : null}
          {error ? <p className="rounded border border-red-900 bg-red-950 px-3 py-2 text-sm text-red-100">{error}</p> : null}
          {!loading && statuses.length === 0 ? (
            <p className="text-sm text-gray-400">{t('agent.empty')}</p>
          ) : null}
          {statuses.map((status) => (
            <div key={status.id} className="rounded-lg border border-gray-800 bg-gray-900/60 p-4">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-sm font-semibold text-gray-100">{status.label}</h3>
                    <span className={`rounded px-2 py-0.5 text-xs ${STATUS_CLASSES[status.status]}`}>
                      {t(STATUS_KEYS[status.status])}
                    </span>
                  </div>
                  <p className="break-all text-xs text-gray-400">{status.configPath}</p>
                  {status.message ? <p className="text-xs text-red-200">{status.message}</p> : null}
                  {status.backupPath ? (
                    <p className="break-all text-xs text-gray-400">
                      {t('agent.backup')} {status.backupPath}
                    </p>
                  ) : null}
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant={status.configured ? 'secondary' : 'default'}
                  disabled={loading || !status.canInstall || installingId === status.id}
                  onClick={() => void install(status.id)}
                >
                  {installingId === status.id ? t('agent.installing') : t('agent.install')}
                </Button>
              </div>
            </div>
          ))}
        </div>

        <DialogFooter>
          <Button type="button" variant="secondary" onClick={() => void load()} disabled={loading}>
            {t('agent.refresh')}
          </Button>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            {t('dialog.cancel')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
