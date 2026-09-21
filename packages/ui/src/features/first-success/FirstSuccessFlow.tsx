import * as React from 'react';
import type { SerialConnectionDraft } from '@linkterm/contracts/readiness-contract';
import { useT } from '../../i18n/index.js';
import type { FirstSuccessState } from './first-success-reducer.js';

export interface FirstSuccessFlowProps {
  readonly draft: SerialConnectionDraft;
  readonly state: FirstSuccessState;
  readonly errorMessage?: string | null;
  readonly onConfirmConnect: (draft: SerialConnectionDraft) => void;
  readonly onCancel: () => void;
  readonly onKeepWaiting: () => void;
  readonly onDisconnectAndEdit: () => void;
  readonly onBackToSession: () => void;
  readonly onDisconnect: () => void;
  readonly onRetry: () => void;
  readonly onGoToTerminal: () => void;
}

export function FirstSuccessFlow({
  draft,
  state,
  errorMessage,
  onConfirmConnect,
  onCancel,
  onKeepWaiting,
  onDisconnectAndEdit,
  onBackToSession,
  onDisconnect,
  onRetry,
  onGoToTerminal,
}: FirstSuccessFlowProps): React.ReactElement {
  const t = useT();
  const canConfirm =
    state.phase === 'reviewing-plan' ||
    state.phase === 'ready-to-connect' ||
    state.phase === 'errored' ||
    state.phase === 'disconnected';
  const showRecovery =
    state.phase === 'silent' ||
    state.phase === 'display-unavailable' ||
    state.phase === 'errored' ||
    state.phase === 'disconnected';

  return (
    <section
      aria-labelledby="first-success-title"
      className="mx-auto flex h-full max-w-4xl flex-col gap-4 overflow-auto px-6 py-8 text-gray-100"
      data-testid="first-success-flow"
    >
      <header>
        <p className="text-xs uppercase tracking-wide text-blue-300">
          {t('firstSuccess.kicker')}
        </p>
        <h2 id="first-success-title" className="mt-1 text-2xl font-semibold">
          {t('firstSuccess.title')}
        </h2>
        <p className="mt-2 max-w-2xl text-sm text-gray-400">
          {t('firstSuccess.description')}
        </p>
      </header>

      <div
        role="status"
        className="rounded border border-gray-800 bg-gray-900/80 px-4 py-3 text-sm"
      >
        {statusLabel(state, errorMessage ?? undefined, t)}
      </div>

      <section className="rounded border border-gray-800 bg-gray-950/60 p-4">
        <h3 className="text-sm font-semibold">{t('firstSuccess.plan.title')}</h3>
        <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
          <PlanFact label={t('firstSuccess.plan.port')} value={draft.portLabel ?? '-'} />
          <PlanFact
            label={t('firstSuccess.plan.baudRate')}
            value={String(draft.parameters.baudRate.value)}
          />
          <PlanFact
            label={t('firstSuccess.plan.dataBits')}
            value={String(draft.parameters.dataBits.value)}
          />
          <PlanFact
            label={t('firstSuccess.plan.stopBits')}
            value={String(draft.parameters.stopBits.value)}
          />
          <PlanFact label={t('firstSuccess.plan.parity')} value={draft.parameters.parity.value} />
          <PlanFact label={t('firstSuccess.plan.source')} value={draft.source} />
        </dl>
      </section>

      <section className="rounded border border-amber-900/60 bg-amber-950/20 p-4">
        <h3 className="text-sm font-semibold text-amber-100">
          {t('firstSuccess.sideEffects.title')}
        </h3>
        <ul className="mt-3 space-y-2 text-sm text-amber-50/90">
          <li>{t('firstSuccess.sideEffects.reservesPort')}</li>
          <li>{t('firstSuccess.sideEffects.noPayload')}</li>
          <li>
            {draft.sideEffects.controlLineBehaviorCode === undefined
              ? t('firstSuccess.sideEffects.controlLinesUnknown')
              : t('firstSuccess.sideEffects.controlLinesDefault')}
          </li>
          {draft.sideEffects.mayResetBoard === true ? (
            <li>{t('firstSuccess.sideEffects.mayReset')}</li>
          ) : null}
        </ul>
      </section>

      <div className="flex flex-wrap gap-2">
        {canConfirm ? (
          <button
            type="button"
            className="rounded bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-500"
            onClick={() => onConfirmConnect(draft)}
          >
            {t('firstSuccess.action.confirmConnect')}
          </button>
        ) : null}
        <button
          type="button"
          className="rounded border border-gray-700 px-3 py-2 text-sm text-gray-100 hover:bg-gray-900"
          onClick={onCancel}
        >
          {t('firstSuccess.action.cancel')}
        </button>
        {showRecovery ? (
          <>
            <button
              type="button"
              className="rounded border border-gray-700 px-3 py-2 text-sm text-gray-100 hover:bg-gray-900"
              onClick={onKeepWaiting}
            >
              {t('firstSuccess.action.keepWaiting')}
            </button>
            {state.ownsSession === true ? (
              <button
                type="button"
                className="rounded border border-gray-700 px-3 py-2 text-sm text-gray-100 hover:bg-gray-900"
                onClick={onDisconnectAndEdit}
              >
                {t('firstSuccess.action.disconnectAndEdit')}
              </button>
            ) : null}
            <button
              type="button"
              className="rounded border border-gray-700 px-3 py-2 text-sm text-gray-100 hover:bg-gray-900"
              onClick={onBackToSession}
            >
              {t('firstSuccess.action.backToSession')}
            </button>
            <button
              type="button"
              className="rounded border border-gray-700 px-3 py-2 text-sm text-gray-100 hover:bg-gray-900"
              onClick={onDisconnect}
            >
              {t('firstSuccess.action.disconnect')}
            </button>
            <button
              type="button"
              className="rounded border border-gray-700 px-3 py-2 text-sm text-gray-100 hover:bg-gray-900"
              onClick={onRetry}
            >
              {t('firstSuccess.action.retry')}
            </button>
          </>
        ) : null}
        {state.goToTerminalAvailable ? (
          <button
            type="button"
            className="rounded bg-emerald-700 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-600"
            onClick={onGoToTerminal}
          >
            {t('firstSuccess.action.goToTerminal')}
          </button>
        ) : null}
      </div>
    </section>
  );
}

function PlanFact({ label, value }: { readonly label: string; readonly value: string }): React.ReactElement {
  return (
    <div className="min-w-0 rounded border border-gray-800 bg-gray-900 px-3 py-2">
      <dt className="text-xs text-gray-500">{label}</dt>
      <dd className="mt-1 truncate text-gray-100">{value}</dd>
    </div>
  );
}

function statusLabel(
  state: FirstSuccessState,
  errorMessage: string | undefined,
  t: ReturnType<typeof useT>,
): string {
  if (errorMessage !== undefined && errorMessage.length > 0) return errorMessage;
  switch (state.phase) {
    case 'checking':
    case 'needs-device':
    case 'ready-to-connect':
    case 'reviewing-plan':
      return t('firstSuccess.status.reviewingPlan');
    case 'connecting':
      return t('firstSuccess.status.connecting');
    case 'waiting-for-output':
      return t('firstSuccess.status.waitingForOutput');
    case 'data-received':
      return t('firstSuccess.status.dataReceived');
    case 'display-unavailable':
      return t('firstSuccess.status.displayUnavailable');
    case 'silent':
      return t('firstSuccess.status.silent');
    case 'errored':
      return state.errorCode ?? t('firstSuccess.status.errored');
    case 'disconnected':
      return t('firstSuccess.status.disconnected');
    case 'cancelled':
      return t('firstSuccess.status.cancelled');
    case 'completed':
      return t('firstSuccess.status.completed');
  }
}
