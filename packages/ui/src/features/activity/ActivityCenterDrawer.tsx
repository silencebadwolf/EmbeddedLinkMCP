import * as React from 'react';
import { useT, type TranslationKey } from '../../i18n/index.js';
import {
  selectActivityItems,
  selectDefaultActivityGroups,
  type ActivityCenterState,
  type ActivityDefaultGroup,
  type ActivityItemSummary,
  type ActivityItemFilter,
} from './activity-reducer.js';
import type { AuditStoreStatus } from '@linkterm/contracts/audit-contract';
import { getLinkterm } from '../../lib/linkterm-bridge.js';

interface ActivityCenterDrawerProps {
  readonly open: boolean;
  readonly state: ActivityCenterState;
  readonly filter?: ActivityItemFilter;
  readonly onCopySummary?: (summary: string) => void | Promise<void>;
  readonly onClose: () => void;
}

type VisibleActivityGroup = Pick<ActivityDefaultGroup, 'kind' | 'operationIds'>;
type ActivityDrawerMode = 'default' | 'history';

const MAX_VISIBLE_OPERATION_ROWS = 50;

export function ActivityCenterDrawer({
  open,
  state,
  filter,
  onCopySummary,
  onClose,
}: ActivityCenterDrawerProps): React.ReactElement | null {
  const t = useT();
  const drawerRef = React.useRef<HTMLElement>(null);
  const [searchText, setSearchText] = React.useState('');
  const [mode, setMode] = React.useState<ActivityDrawerMode>('default');
  const [auditStatus, setAuditStatus] = React.useState<AuditStoreStatus | null>(null);
  const [auditMessage, setAuditMessage] = React.useState<string | null>(null);
  const [clearArmed, setClearArmed] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    const api = getLinkterm();
    if (api === null) return;
    let disposed = false;
    void api.activity.status().then((result) => {
      if (disposed || !result.success) return;
      setAuditStatus(result.data.status);
    });
    return () => {
      disposed = true;
    };
  }, [open]);

  if (!open) {
    return null;
  }

  const trimmedSearchText = searchText.trim();
  const effectiveFilter =
    trimmedSearchText.length === 0 ? filter : { ...(filter ?? {}), text: trimmedSearchText };
  const items = selectActivityItems(state, effectiveFilter ?? {});
  const itemsById = new Map(items.map((item) => [item.operationId, item]));
  const visibleIds = new Set(items.map((item) => item.operationId));
  const hasExplicitFilter = filter !== undefined || trimmedSearchText.length > 0;
  const showHistoryRows = mode === 'history' || hasExplicitFilter;
  const groups: readonly VisibleActivityGroup[] = showHistoryRows
    ? [
        {
          kind: 'active' as const,
          operationIds: Object.freeze(items.map((item) => item.operationId)),
        },
      ]
    : selectDefaultActivityGroups(state)
        .map((group) => ({
          kind: group.kind,
          operationIds: group.operationIds.filter((operationId) => visibleIds.has(operationId)),
        }))
        .filter((group) => group.operationIds.length > 0);
  const renderGroups = limitVisibleOperationRows(groups);
  const totalOperationRows = countOperationRows(groups);
  const visibleOperationRows = countOperationRows(renderGroups);
  const latestError = state.status === 'error' ? state.diagnostics.at(-1) : undefined;
  const loading =
    state.status === 'loading' && state.events.length === 0 && Object.keys(state.operations).length === 0;

  return (
    <section
      ref={drawerRef}
      role="dialog"
      aria-label={t('activity.drawer.label')}
      tabIndex={-1}
      className="fixed inset-y-0 right-0 z-50 flex w-[28rem] max-w-full flex-col border-l border-gray-800 bg-gray-950 p-4 text-gray-100 shadow-xl"
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          onClose();
        }
      }}
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold">{t('activity.drawer.title')}</h2>
          <p className="mt-1 text-xs text-gray-400">{t('activity.drawer.description')}</p>
          {auditStatus === null ? null : (
            <p className="mt-2 text-xs text-gray-400" role="status">
              {formatAuditStatus(t, auditStatus)}
            </p>
          )}
          {auditMessage === null ? null : (
            <p className="mt-1 text-xs text-blue-200" role="status">{auditMessage}</p>
          )}
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            className="rounded px-2 py-1 text-sm text-gray-300 hover:bg-gray-800 hover:text-gray-100"
            aria-label={t('activity.drawer.close')}
            onClick={onClose}
          >
            ×
          </button>
          <button
            type="button"
            className="rounded border border-gray-700 px-2 py-1 text-xs text-gray-200 hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-50"
            aria-label={t('activity.audit.export')}
            onClick={() => {
              const api = getLinkterm();
              if (api === null) {
                setAuditMessage(t('activity.audit.error'));
                return;
              }
              void api.activity.export({ format: 'jsonl', pathMode: 'basename' }).then((result) => {
                if (result.success) {
                  setAuditMessage(t('activity.audit.exported').replace('{fileName}', result.data.fileName));
                } else {
                  setAuditMessage(t('activity.audit.error'));
                }
              });
            }}
          >
            {t('activity.audit.export')}
          </button>
          <button
            type="button"
            className="rounded border border-red-900 px-2 py-1 text-xs text-red-200 hover:bg-red-950"
            aria-label={clearArmed ? t('activity.audit.clearConfirm') : t('activity.audit.clear')}
            onClick={() => {
              if (!clearArmed) {
                setClearArmed(true);
                return;
              }
              setClearArmed(false);
              const api = getLinkterm();
              if (api === null) {
                setAuditMessage(t('activity.audit.error'));
                return;
              }
              void api.activity.clear({ confirm: true }).then((result) => {
                if (result.success) {
                  setAuditStatus((current) => current === null ? null : { ...current, eventCount: 0, fileCount: 0, byteCount: 0 });
                  setAuditMessage(t('activity.audit.cleared'));
                } else {
                  setAuditMessage(t('activity.audit.error'));
                }
              });
            }}
          >
            {clearArmed ? t('activity.audit.clearConfirm') : t('activity.audit.clear')}
          </button>
        </div>
      </div>

      <label className="mt-4 block text-xs text-gray-400">
        <span>{t('activity.filter.label')}</span>
        <input
          type="text"
          className="mt-1 w-full rounded border border-gray-800 bg-gray-950 px-3 py-2 text-sm text-gray-100 outline-none focus:border-blue-500"
          aria-label={t('activity.filter.label')}
          placeholder={t('activity.filter.placeholder')}
          value={searchText}
          onChange={(event) => setSearchText(event.currentTarget.value)}
        />
      </label>

      <div className="mt-3 flex gap-2" aria-label={t('activity.view.label')}>
        <button
          type="button"
          className="rounded border border-gray-800 px-2 py-1 text-xs text-gray-200 aria-pressed:bg-gray-800"
          aria-pressed={mode === 'default'}
          onClick={() => setMode('default')}
        >
          {t('activity.view.default')}
        </button>
        <button
          type="button"
          className="rounded border border-gray-800 px-2 py-1 text-xs text-gray-200 aria-pressed:bg-gray-800"
          aria-pressed={mode === 'history'}
          onClick={() => setMode('history')}
        >
          {t('activity.view.history')}
        </button>
      </div>

      <div className="mt-4 space-y-3 overflow-y-auto">
        {loading ? (
          <p className="rounded border border-gray-800 bg-gray-900/70 px-3 py-2 text-sm text-gray-400">
            {t('activity.drawer.loading')}
          </p>
        ) : null}
        {latestError === undefined ? null : (
          <div
            role="alert"
            className="rounded border border-red-900 bg-red-950 px-3 py-2 text-sm text-red-100"
          >
            <p>{t('activity.drawer.error')}</p>
            <p className="mt-1 font-mono text-xs text-red-200">{latestError.code}</p>
          </div>
        )}
        {!loading && latestError === undefined && state.historyTruncated ? (
          <p className="rounded border border-amber-900 bg-amber-950 px-3 py-2 text-sm text-amber-100">
            {t('activity.drawer.truncated')}
          </p>
        ) : null}
        {!loading && latestError === undefined && renderGroups.length === 0 ? (
          <p className="rounded border border-gray-800 bg-gray-900/70 px-3 py-2 text-sm text-gray-400">
            {t('activity.drawer.empty')}
          </p>
        ) : null}
        {loading || latestError !== undefined ? null : renderGroups.map((group) => {
          if (group.kind === 'read-only-burst') {
            return (
              <div
                key="read-only-burst"
                className="rounded border border-gray-800 bg-gray-900/70 px-3 py-2 text-sm text-gray-300"
              >
                {t('activity.drawer.readOnlyChecks')} · {group.operationIds.length}
              </div>
            );
          }

          return group.operationIds.map((operationId) => {
            const item = itemsById.get(operationId);
            return item === undefined ? null : (
              <ActivityOperationCard
                key={operationId}
                item={item}
                onCopySummary={onCopySummary}
              />
            );
          });
        })}
        {!loading && latestError === undefined && visibleOperationRows < totalOperationRows ? (
          <p className="rounded border border-gray-800 bg-gray-900/70 px-3 py-2 text-xs text-gray-400">
            {formatVisibleRows(t, visibleOperationRows, totalOperationRows)}
          </p>
        ) : null}
      </div>
    </section>
  );
}

function ActivityOperationCard({
  item,
  onCopySummary,
}: {
  readonly item: ActivityItemSummary;
  readonly onCopySummary?: (summary: string) => void | Promise<void>;
}): React.ReactElement {
  const t = useT();
  const target = item.targets[0];
  const targetLabel = getTargetLabel(item);

  return (
    <article className="rounded border border-gray-800 bg-gray-900/80 px-3 py-2">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-medium text-gray-100">{item.action}</h3>
        <span className="rounded bg-gray-800 px-2 py-0.5 text-xs text-gray-300">
          {item.phase}
        </span>
      </div>
      {target === undefined ? null : (
        <p className="mt-1 text-xs text-gray-400">{targetLabel}</p>
      )}
      {item.errorCode === undefined ? null : (
        <p className="mt-2 text-xs text-red-200">{item.errorCode}</p>
      )}
      <AuthorizationBadge item={item} />
      {item.progress === undefined ? null : (
        <div className="mt-2 rounded border border-gray-800 bg-gray-950/60 px-2 py-1 text-xs text-gray-300">
          <div className="flex items-center justify-between gap-3">
            <span>
              {item.progress.messageCode ?? item.progress.stepId ?? t('activity.workflow.stepUnknown')}
            </span>
            <span>{Math.round(item.progress.percent)}%</span>
          </div>
          {item.progress.stepId === undefined ? null : (
            <div className="mt-1 text-gray-500">{item.progress.stepId}</div>
          )}
        </div>
      )}
      <details className="mt-3 rounded border border-gray-800 bg-gray-950/50 px-2 py-1 text-xs text-gray-300">
        <summary className="cursor-pointer text-gray-200">{t('activity.details.toggle')}</summary>
        <dl className="mt-2 grid gap-1">
          <div className="flex justify-between gap-3">
            <dt className="text-gray-500">{t('activity.details.actor')}</dt>
            <dd>{`${item.actor.kind}/${item.actor.channel}`}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-gray-500">{t('activity.details.risk')}</dt>
            <dd>{item.risk}</dd>
          </div>
          {target === undefined ? null : (
            <div className="flex justify-between gap-3">
              <dt className="text-gray-500">{t('activity.details.targetId')}</dt>
              <dd className="break-all font-mono text-right">{target.id}</dd>
            </div>
          )}
        </dl>
        {item.calls.length === 0 ? null : (
          <div className="mt-2">
            <div className="text-gray-500">{t('activity.details.calls')}</div>
            <ul className="mt-1 space-y-1">
              {item.calls.map((call) => (
                <li key={call.callId} className="rounded bg-gray-900 px-2 py-1">
                  <span className="font-mono text-gray-200">{call.callId}</span>
                  <span className="ml-2 text-gray-400">{call.phase}</span>
                  {call.errorCode === undefined ? null : (
                    <span className="ml-2 text-red-200">{call.errorCode}</span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </details>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          className="rounded border border-gray-700 px-2 py-1 text-xs text-gray-200 hover:bg-gray-800"
          aria-label={formatActivityActionLabel(t, 'activity.action.copySummaryFor', targetLabel)}
          onClick={() => void copyActivitySummary(item, onCopySummary)}
        >
          {t('activity.action.copySummary')}
        </button>
      </div>
    </article>
  );
}

function AuthorizationBadge({
  item,
}: {
  readonly item: ActivityItemSummary;
}): React.ReactElement | null {
  const t = useT();
  const display = authorizationDisplay(item, t);
  if (display === undefined) return null;

  return (
    <p
      aria-label={display.ariaLabel}
      className="mt-2 inline-flex items-center gap-1 rounded border border-gray-800 bg-gray-950/70 px-2 py-1 text-xs text-gray-300"
    >
      <span aria-hidden="true">{display.icon}</span>
      <span>{display.label}</span>
    </p>
  );
}

function authorizationDisplay(
  _item: ActivityItemSummary,
  t: ReturnType<typeof useT>,
):
  | {
      readonly icon: string;
      readonly label: string;
      readonly ariaLabel: string;
    }
  | undefined {
  // Authorization metadata remains in the activity contract for backwards-compatible
  // replay of old records, but it no longer changes execution or user-facing status.
  // Every current operation is automatic; this badge is observation-only by design.
  if (_item.actor.kind !== 'agent') return undefined;
  return {
    icon: '•',
    label: t('activity.authorization.approvalNotRequired'),
    ariaLabel: t('activity.authorization.aria.approvalNotRequired'),
  };
}

function formatActivityActionLabel(
  t: ReturnType<typeof useT>,
  key: TranslationKey,
  label: string,
): string {
  return t(key).replace('{label}', label);
}

function limitVisibleOperationRows(
  groups: readonly VisibleActivityGroup[],
): readonly VisibleActivityGroup[] {
  let remaining = MAX_VISIBLE_OPERATION_ROWS;
  return groups
    .map((group) => {
      if (group.kind === 'read-only-burst') return group;
      const operationIds = group.operationIds.slice(0, Math.max(0, remaining));
      remaining -= operationIds.length;
      return { ...group, operationIds };
    })
    .filter((group) => group.kind === 'read-only-burst' || group.operationIds.length > 0);
}

function countOperationRows(groups: readonly VisibleActivityGroup[]): number {
  return groups
    .filter((group) => group.kind !== 'read-only-burst')
    .reduce((total, group) => total + group.operationIds.length, 0);
}

function formatVisibleRows(
  t: ReturnType<typeof useT>,
  visible: number,
  total: number,
): string {
  return t('activity.drawer.visibleRows')
    .replace('{visible}', String(visible))
    .replace('{total}', String(total));
}

function formatAuditStatus(
  t: ReturnType<typeof useT>,
  status: AuditStoreStatus,
): string {
  return t('activity.audit.status')
    .replace('{state}', status.enabled ? t('activity.audit.enabled') : t('activity.audit.disabled'))
    .replace('{events}', String(status.eventCount))
    .replace('{warnings}', String(status.warningCount));
}

function getTargetLabel(item: ActivityItemSummary): string {
  const target = item.targets[0];
  return target === undefined ? item.operationId : getTargetDisplayLabel(item, target);
}

function getTargetDisplayLabel(
  item: ActivityItemSummary,
  target: ActivityItemSummary['targets'][number],
): string {
  if (target.label !== undefined && target.label.length > 0) return target.label;
  if (target.kind === 'session') return formatLocalActivityTime(item.startedAt);
  return target.id;
}

function formatLocalActivityTime(timestamp: string): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return timestamp;
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

async function copyActivitySummary(
  item: ActivityItemSummary,
  onCopySummary: ((summary: string) => void | Promise<void>) | undefined,
): Promise<void> {
  const summary = buildActivitySummary(item);
  if (onCopySummary !== undefined) {
    await onCopySummary(summary);
    return;
  }
  await globalThis.navigator?.clipboard?.writeText(summary);
}

function buildActivitySummary(item: ActivityItemSummary): string {
  const targetLabels = item.targets
    .map((target) => getTargetDisplayLabel(item, target))
    .filter((label) => label.length > 0)
    .join(', ');
  const summary = [item.action, item.phase, item.risk, targetLabels]
    .filter((part) => part.length > 0)
    .join(' · ');
  return summary.slice(0, 512);
}
