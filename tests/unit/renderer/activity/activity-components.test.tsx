// @vitest-environment happy-dom

import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createInitialActivityCenterState,
  ingestActivitySnapshot,
  type ActivityCenterState,
} from '@/renderer/features/activity/activity-reducer.js';
import { AiStatusCapsule } from '@/renderer/features/activity/AiStatusCapsule.js';
import { ActivityCenterDrawer } from '@/renderer/features/activity/ActivityCenterDrawer.js';
import { useAppStore } from '@/renderer/store/app-store.js';
import { createMockPreloadAPI } from '../../../fixtures/mock-preload-api.js';
import {
  activitySnapshot,
  activityTimestamp,
  callEvent,
  operationEvent,
  workflowEvent,
} from './activity-fixtures.js';

type AuthorizationLabelInput = {
  readonly operationId: string;
  readonly action: string;
  readonly approvalPolicy: 'none' | 'notify' | 'human-once';
  readonly authorizationSource: 'none' | 'human-grant' | 'automation-policy';
  readonly clientAcknowledged?: boolean;
  readonly actorKind?: 'agent' | 'human' | 'system';
};

function authorizationOperation(input: AuthorizationLabelInput): ReturnType<typeof operationEvent> {
  return {
    ...operationEvent({
      sequence:
        input.operationId === 'operation_caller_ack'
          ? 1
          : input.operationId === 'operation_client_ack'
            ? 2
            : input.operationId === 'operation_human_approved'
              ? 3
              : input.operationId === 'operation_automation'
                ? 4
                : 5,
      operationId: input.operationId,
      phase:
        input.authorizationSource === 'none' && input.approvalPolicy !== 'none'
          ? 'awaiting-approval'
          : 'running',
      action: input.action,
      risk: 'destructive-or-unknown',
      targetKind: 'workspace',
      targetId: `workspace_${input.operationId}`,
      targetLabel: input.operationId,
      actorKind: input.actorKind,
    }),
    approvalPolicy: input.approvalPolicy,
    authorizationSource: input.authorizationSource,
    ...(input.clientAcknowledged === undefined
      ? {}
      : { clientAcknowledged: input.clientAcknowledged }),
  } as ReturnType<typeof operationEvent>;
}

function stateWithActivity(): ActivityCenterState {
  return ingestActivitySnapshot(
    createInitialActivityCenterState(),
    activitySnapshot([
      operationEvent({
        sequence: 1,
        operationId: 'operation_status_1',
        phase: 'succeeded',
        action: 'get_app_status',
        risk: 'read-only',
      }),
      operationEvent({
        sequence: 2,
        operationId: 'operation_status_2',
        phase: 'succeeded',
        action: 'get_app_status',
        risk: 'read-only',
      }),
      operationEvent({
        sequence: 3,
        operationId: 'operation_serial',
        phase: 'running',
        action: 'open_session',
        risk: 'state-affecting',
        targetKind: 'session',
        targetId: 'sess_serial',
        targetLabel: 'serial COM3',
      }),
      operationEvent({
        sequence: 4,
        operationId: 'operation_flash',
        phase: 'failed',
        action: 'run_control_workflow',
        risk: 'destructive-or-unknown',
        targetKind: 'job',
        targetId: 'job_flash',
        targetLabel: 'flash workflow',
        errorCode: 'WORKFLOW_FAILED',
      }),
    ]),
  );
}

function expectedLocalActivityTime(timestamp: string): string {
  const date = new Date(timestamp);
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

beforeEach(() => {
  useAppStore.setState({ locale: 'en' });
  delete (globalThis as { window?: { linkterm?: unknown } }).window?.linkterm;
});

describe('AiStatusCapsule', () => {
  it('prioritizes attention over running and ignores completed read-only bursts for the top status', () => {
    const open = vi.fn();

    render(<AiStatusCapsule state={stateWithActivity()} onOpen={open} />);

    const capsule = screen.getByRole('button', { name: 'AI: Needs attention' });
    expect(capsule).toHaveTextContent('Needs attention');
    expect(capsule).not.toHaveTextContent('get_app_status');
    fireEvent.click(capsule);
    expect(open).toHaveBeenCalledOnce();
  });

  it('shows idle when only retained read-only history exists', () => {
    const state = ingestActivitySnapshot(
      createInitialActivityCenterState(),
      activitySnapshot([
        operationEvent({
          sequence: 1,
          operationId: 'operation_status',
          phase: 'succeeded',
          action: 'get_app_status',
          risk: 'read-only',
        }),
      ]),
    );

    render(<AiStatusCapsule state={state} onOpen={() => undefined} />);

    expect(screen.getByRole('button', { name: 'AI: Idle' })).toHaveTextContent('Idle');
  });

  it('keeps legacy approval-shaped activity observable without creating an approval status', () => {
    const state = ingestActivitySnapshot(
      createInitialActivityCenterState(),
      activitySnapshot([
        operationEvent({
          sequence: 1,
          operationId: 'operation_approval',
          phase: 'awaiting-approval',
          action: 'run_control_workflow',
          risk: 'destructive-or-unknown',
        }),
      ]),
    );

    render(<AiStatusCapsule state={state} onOpen={() => undefined} />);

    expect(screen.getByRole('button', { name: 'AI: Running' })).toHaveTextContent('Running');
  });

  it('keeps status understandable when reduced motion is preferred', () => {
    const originalMatchMedia = window.matchMedia;
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: query === '(prefers-reduced-motion: reduce)',
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
      onchange: null,
    }));

    try {
      render(<AiStatusCapsule state={stateWithActivity()} onOpen={() => undefined} />);
      const capsule = screen.getByRole('button', { name: 'AI: Needs attention' });
      expect(capsule).toHaveTextContent('AI');
      expect(capsule).toHaveTextContent('Needs attention');
    } finally {
      window.matchMedia = originalMatchMedia;
    }
  });
});

describe('ActivityCenterDrawer', () => {
  it('uses local time instead of an opaque session id in cards and copied summaries', () => {
    const sessionId = 'sess_049c8cfd-8099-47e5-aafe-e5160f15b384';
    const copySummary = vi.fn();
    const state = ingestActivitySnapshot(
      createInitialActivityCenterState(),
      activitySnapshot([
        operationEvent({
          sequence: 1,
          operationId: 'operation_send_wait',
          phase: 'failed',
          action: 'send_and_wait',
          risk: 'state-affecting',
          targetKind: 'session',
          targetId: sessionId,
        }),
      ]),
    );

    render(
      <ActivityCenterDrawer
        open
        state={state}
        onCopySummary={copySummary}
        onClose={() => undefined}
      />,
    );

    const drawer = screen.getByRole('dialog', { name: 'Activity Center' });
    const expectedTime = expectedLocalActivityTime(activityTimestamp);
    expect(within(drawer).getByText(expectedTime)).toBeInTheDocument();

    fireEvent.click(within(drawer).getByRole('button', { name: `Copy summary for ${expectedTime}` }));
    expect(copySummary).toHaveBeenCalledWith(
      `send_and_wait · failed · state-affecting · ${expectedTime}`,
    );
    expect(copySummary.mock.calls[0]?.[0]).not.toContain(sessionId);

    fireEvent.click(within(drawer).getByText('Details'));
    expect(within(drawer).getByText('Target ID')).toBeInTheDocument();
    expect(within(drawer).getByText(sessionId)).toBeInTheDocument();
  });

  it('renders the active/attention default view and folds read-only bursts', () => {
    render(<ActivityCenterDrawer open state={stateWithActivity()} onClose={() => undefined} />);

    const drawer = screen.getByRole('dialog', { name: 'Activity Center' });
    expect(within(drawer).getByRole('heading', { name: 'Activity · Observation & audit' }))
      .toBeInTheDocument();
    expect(within(drawer).getByText('open_session')).toBeInTheDocument();
    expect(within(drawer).getByText('serial COM3')).toBeInTheDocument();
    expect(within(drawer).getByText('run_control_workflow')).toBeInTheDocument();
    expect(within(drawer).getByText('flash workflow')).toBeInTheDocument();
    expect(within(drawer).getByText('Recent read-only checks · 2')).toBeInTheDocument();
    expect(within(drawer).queryAllByText('get_app_status')).toHaveLength(0);
  });

  it('renders every execution as automatic observation, including legacy approval-shaped records', () => {
    const state = ingestActivitySnapshot(
      createInitialActivityCenterState(),
      activitySnapshot([
        authorizationOperation({
          operationId: 'operation_no_approval',
          action: 'get_activity_snapshot',
          approvalPolicy: 'none',
          authorizationSource: 'none',
        }),
        authorizationOperation({
          operationId: 'operation_caller_ack',
          action: 'inspect_workspace',
          approvalPolicy: 'notify',
          authorizationSource: 'none',
          clientAcknowledged: true,
        }),
        authorizationOperation({
          operationId: 'operation_client_ack',
          action: 'run_control_workflow',
          approvalPolicy: 'human-once',
          authorizationSource: 'none',
          clientAcknowledged: true,
        }),
        authorizationOperation({
          operationId: 'operation_automation',
          action: 'run_control_workflow',
          approvalPolicy: 'human-once',
          authorizationSource: 'automation-policy',
        }),
        authorizationOperation({
          operationId: 'operation_human',
          action: 'write_to_session',
          approvalPolicy: 'none',
          authorizationSource: 'none',
          actorKind: 'human',
        }),
      ]),
    );

    render(<ActivityCenterDrawer open state={state} onClose={() => undefined} />);

    const drawer = screen.getByRole('dialog', { name: 'Activity Center' });
    const observationBadges = within(drawer).getAllByLabelText(
      'Execution: automatic, observation only',
    );

    expect(observationBadges).toHaveLength(4);
    for (const badge of observationBadges) {
      expect(badge).toHaveTextContent('•');
      expect(badge).toHaveTextContent('Auto-executed · observation only');
    }
    expect(drawer).not.toHaveTextContent(/principal|grant|nonce|source_ref/i);
  });

  it('reveals folded read-only operations through the activity filter', () => {
    render(<ActivityCenterDrawer open state={stateWithActivity()} onClose={() => undefined} />);

    const drawer = screen.getByRole('dialog', { name: 'Activity Center' });
    fireEvent.change(within(drawer).getByRole('textbox', { name: 'Filter activity' }), {
      target: { value: 'get_app_status' },
    });

    expect(within(drawer).getAllByText('get_app_status')).toHaveLength(2);
    expect(within(drawer).queryByText('Recent read-only checks · 2')).not.toBeInTheDocument();
  });

  it('reveals retained read-only operations through history mode without requiring a search term', () => {
    render(<ActivityCenterDrawer open state={stateWithActivity()} onClose={() => undefined} />);

    const drawer = screen.getByRole('dialog', { name: 'Activity Center' });
    fireEvent.click(within(drawer).getByRole('button', { name: 'History' }));

    const operationCards = within(drawer).getAllByRole('article');
    expect(operationCards[0]).toHaveTextContent('run_control_workflow');
    expect(operationCards[1]).toHaveTextContent('open_session');
    expect(within(drawer).getAllByText('get_app_status')).toHaveLength(2);
    expect(within(drawer).queryByText('Recent read-only checks · 2')).not.toBeInTheDocument();
  });

  it('renders loading and safe diagnostic error states without raw payloads', () => {
    const { rerender } = render(
      <ActivityCenterDrawer
        open
        state={createInitialActivityCenterState()}
        onClose={() => undefined}
      />,
    );

    expect(screen.getByRole('dialog', { name: 'Activity Center' })).toHaveTextContent(
      'Loading activity...',
    );

    const invalidState = ingestActivitySnapshot(createInitialActivityCenterState(), {
      rawEvidence: 'secret terminal output',
    });
    rerender(
      <ActivityCenterDrawer open state={invalidState} onClose={() => undefined} />,
    );

    const drawer = screen.getByRole('dialog', { name: 'Activity Center' });
    expect(drawer).toHaveTextContent('Activity history unavailable.');
    expect(drawer).toHaveTextContent('invalid-snapshot');
    expect(drawer).not.toHaveTextContent('secret terminal output');
  });

  it('shows a bounded warning when retained activity history is truncated', () => {
    const state = ingestActivitySnapshot(
      createInitialActivityCenterState(),
      activitySnapshot(
        [
          operationEvent({
            sequence: 8,
            operationId: 'operation_recent',
            phase: 'succeeded',
            action: 'get_app_status',
            risk: 'read-only',
          }),
        ],
        { sequence: 8, truncated: true },
      ),
    );

    render(<ActivityCenterDrawer open state={state} onClose={() => undefined} />);

    expect(screen.getByRole('dialog', { name: 'Activity Center' })).toHaveTextContent(
      'Older activity may be unavailable.',
    );
  });

  it('renders workflow milestone progress with display-safe step labels', () => {
    const state = ingestActivitySnapshot(
      createInitialActivityCenterState(),
      activitySnapshot([
        operationEvent({
          sequence: 1,
          operationId: 'operation_flash',
          phase: 'running',
          action: 'run_control_workflow',
          risk: 'destructive-or-unknown',
          targetKind: 'job',
          targetId: 'job_flash',
          targetLabel: 'flash workflow',
        }),
        workflowEvent({
          sequence: 2,
          operationId: 'operation_flash',
          action: 'run_control_workflow',
          risk: 'destructive-or-unknown',
          current: 1,
          total: 4,
          percent: 25,
          stepId: 'flash_download',
          messageCode: 'workflow.flash.download',
          targetId: 'job_flash',
          targetLabel: 'flash workflow',
        }),
      ]),
    );

    render(<ActivityCenterDrawer open state={state} onClose={() => undefined} />);

    const drawer = screen.getByRole('dialog', { name: 'Activity Center' });
    expect(within(drawer).getByText('workflow.flash.download')).toBeInTheDocument();
    expect(within(drawer).getByText('25%')).toBeInTheDocument();
    expect(within(drawer).getByText('flash_download')).toBeInTheDocument();
  });

  it('shows ordinary failures and admitted-running states without internal lease identifiers', () => {
    const state = ingestActivitySnapshot(
      createInitialActivityCenterState(),
      activitySnapshot([
        operationEvent({
          sequence: 1,
          operationId: 'operation_paused',
          phase: 'failed',
          action: 'write_to_session',
          risk: 'state-affecting',
          targetKind: 'session',
          targetId: 'sess_1',
          targetLabel: 'COM7',
          errorCode: 'INTERNAL',
        }),
        {
          ...operationEvent({
            sequence: 2,
            operationId: 'operation_admitted',
            phase: 'running',
            action: 'run_control_workflow',
            risk: 'destructive-or-unknown',
            targetKind: 'job',
            targetId: 'job_1',
            targetLabel: 'flash workflow',
          }),
          authorizationSource: 'human-grant' as const,
        },
      ]),
    );

    render(<ActivityCenterDrawer open state={state} onClose={() => undefined} />);

    const drawer = screen.getByRole('dialog', { name: 'Activity Center' });
    expect(drawer).toHaveTextContent('failed');
    expect(drawer).not.toHaveTextContent(/AI pause|Paused/);
    expect(drawer).toHaveTextContent('running');
    expect(drawer).not.toHaveTextContent(/lease|principal|fingerprint|grant/i);
  });

  it('renders a bilingual fallback label for unknown workflow step data', () => {
    const state = ingestActivitySnapshot(
      createInitialActivityCenterState(),
      activitySnapshot([
        operationEvent({
          sequence: 1,
          operationId: 'operation_flash',
          phase: 'running',
          action: 'run_control_workflow',
          risk: 'destructive-or-unknown',
          targetKind: 'job',
          targetId: 'job_flash',
          targetLabel: 'flash workflow',
        }),
        workflowEvent({
          sequence: 2,
          operationId: 'operation_flash',
          action: 'run_control_workflow',
          risk: 'destructive-or-unknown',
          current: 1,
          total: 4,
          percent: 25,
          targetId: 'job_flash',
          targetLabel: 'flash workflow',
        }),
      ]),
    );

    render(<ActivityCenterDrawer open state={state} onClose={() => undefined} />);

    expect(screen.getByRole('dialog', { name: 'Activity Center' })).toHaveTextContent(
      'Unknown workflow step',
    );
  });


  it('expands safe operation details with retained call attempts only', () => {
    const state = ingestActivitySnapshot(
      createInitialActivityCenterState(),
      activitySnapshot([
        operationEvent({
          sequence: 1,
          operationId: 'operation_status',
          phase: 'succeeded',
          action: 'get_app_status',
          risk: 'read-only',
        }),
        callEvent({
          sequence: 2,
          operationId: 'operation_status',
          callId: 'call_status_1',
          phase: 'failed',
          action: 'get_app_status',
          risk: 'read-only',
        }),
      ]),
    );

    render(<ActivityCenterDrawer open state={state} onClose={() => undefined} />);

    const drawer = screen.getByRole('dialog', { name: 'Activity Center' });
    fireEvent.click(within(drawer).getByRole('button', { name: 'History' }));
    fireEvent.click(within(drawer).getByText('Details'));

    expect(within(drawer).getByText('call_status_1')).toBeInTheDocument();
    expect(within(drawer).getByText('failed')).toBeInTheDocument();
    expect(drawer).not.toHaveTextContent('rawEvidence');
    expect(drawer).not.toHaveTextContent('secret terminal output');
  });

  it('does not render drawer content when closed and calls onClose from Escape', () => {
    const close = vi.fn();
    const { rerender } = render(
      <ActivityCenterDrawer open={false} state={stateWithActivity()} onClose={close} />,
    );
    expect(screen.queryByRole('dialog', { name: 'Activity Center' })).not.toBeInTheDocument();

    rerender(<ActivityCenterDrawer open state={stateWithActivity()} onClose={close} />);
    fireEvent.keyDown(screen.getByRole('dialog', { name: 'Activity Center' }), { key: 'Escape' });
    expect(close).toHaveBeenCalledOnce();
  });

  it('does not steal focus from the workspace when opened', () => {
    const before = document.createElement('button');
    before.type = 'button';
    before.textContent = 'Terminal workspace';
    document.body.append(before);
    before.focus();

    render(<ActivityCenterDrawer open state={stateWithActivity()} onClose={() => undefined} />);

    const drawer = screen.getByRole('dialog', { name: 'Activity Center' });
    expect(drawer).not.toHaveAttribute('aria-modal', 'true');
    expect(before).toHaveFocus();
  });

  it('shows durable audit status and requires an explicit clear confirmation', async () => {
    const mock = createMockPreloadAPI();
    (globalThis as { window?: { linkterm?: unknown } }).window = { linkterm: mock.api };
    render(<ActivityCenterDrawer open state={stateWithActivity()} onClose={() => undefined} />);

    expect(await screen.findByText(/Durable audit: enabled/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Export redacted activity' }));
    expect(mock.spies.activity.export).toHaveBeenCalledWith({ format: 'jsonl', pathMode: 'basename' });

    fireEvent.click(screen.getByRole('button', { name: 'Delete local activity' }));
    expect(screen.getByRole('button', { name: 'Confirm delete' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm delete' }));
    expect(mock.spies.activity.clear).toHaveBeenCalledWith({ confirm: true });
  });

  it('does not trap keyboard focus inside the non-modal drawer', () => {
    render(
      <ActivityCenterDrawer
        open
        state={stateWithActivity()}
        onClose={() => undefined}
      />,
    );

    const drawer = screen.getByRole('dialog', { name: 'Activity Center' });
    const closeButton = within(drawer).getByRole('button', { name: 'Close Activity Center' });
    const lastButton = within(drawer).getByRole('button', {
      name: 'Copy summary for flash workflow',
    });

    closeButton.focus();
    expect(fireEvent.keyDown(drawer, { key: 'Tab', shiftKey: true })).toBe(true);
    expect(closeButton).toHaveFocus();

    lastButton.focus();
    expect(fireEvent.keyDown(drawer, { key: 'Tab' })).toBe(true);
    expect(lastButton).toHaveFocus();
  });

  it('uses Chinese chrome copy from the shared translation table', () => {
    useAppStore.setState({ locale: 'zh' });
    const state = ingestActivitySnapshot(
      createInitialActivityCenterState(),
      activitySnapshot([
        operationEvent({
          sequence: 1,
          operationId: 'operation_status',
          phase: 'succeeded',
          action: 'get_app_status',
          risk: 'read-only',
        }),
        operationEvent({
          sequence: 2,
          operationId: 'operation_serial',
          phase: 'running',
          action: 'open_session',
          risk: 'state-affecting',
          targetKind: 'session',
          targetId: 'sess_serial',
          targetLabel: 'serial COM3',
        }),
      ]),
    );

    render(
      <>
        <AiStatusCapsule state={state} onOpen={() => undefined} />
        <ActivityCenterDrawer open state={state} onClose={() => undefined} />
      </>,
    );

    expect(screen.getByRole('button', { name: 'AI：运行中' })).toHaveTextContent('运行中');
    const drawer = screen.getByRole('dialog', { name: '活动中心' });
    expect(within(drawer).getByRole('heading', { name: '活动 · 观察与审计' }))
      .toBeInTheDocument();
    expect(within(drawer).getByText('最近只读检查 · 1')).toBeInTheDocument();
    expect(within(drawer).getByRole('button', { name: '关闭活动中心' })).toBeInTheDocument();
  });

  it('keeps the Activity Center observation-only while allowing summary copy', () => {
    const copySummary = vi.fn();

    render(
      <ActivityCenterDrawer
        open
        state={stateWithActivity()}
        onCopySummary={copySummary}
        onClose={() => undefined}
      />,
    );

    const drawer = screen.getByRole('dialog', { name: 'Activity Center' });
    expect(within(drawer).queryByRole('button', { name: /Go to session/i })).not.toBeInTheDocument();
    expect(within(drawer).queryByRole('button', { name: /stop/i })).not.toBeInTheDocument();

    expect(within(drawer).queryByRole('button', { name: /diagnose/i })).not.toBeInTheDocument();

    fireEvent.click(within(drawer).getByRole('button', { name: 'Copy summary for serial COM3' }));
    expect(copySummary).toHaveBeenCalledWith(
      expect.stringContaining('open_session · running · state-affecting · serial COM3'),
    );
    expect(copySummary.mock.calls[0]?.[0]).not.toContain('rawEvidence');
    expect(copySummary.mock.calls[0]?.[0]).not.toContain('token');
  });

  it('bounds visible operation rows for large retained histories', () => {
    const state = ingestActivitySnapshot(
      createInitialActivityCenterState(),
      activitySnapshot(
        Array.from({ length: 1_000 }, (_, index) =>
          operationEvent({
            sequence: index + 1,
            operationId: `operation_running_${index}`,
            phase: 'running',
            action: 'open_session',
            risk: 'state-affecting',
            targetKind: 'session',
            targetId: `sess_${index}`,
            targetLabel: `serial COM${index}`,
          }),
        ),
      ),
    );

    render(<ActivityCenterDrawer open state={state} onClose={() => undefined} />);

    const drawer = screen.getByRole('dialog', { name: 'Activity Center' });
    expect(within(drawer).getAllByRole('article')).toHaveLength(50);
    expect(within(drawer).getByText('Showing 50 of 1000 operations')).toBeInTheDocument();
  });
});
