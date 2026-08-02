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
import { ActivityCenterDrawer } from './features/activity/ActivityCenterDrawer.js';
import { AiStatusCapsule } from './features/activity/AiStatusCapsule.js';
import { useActivityCenterState } from './features/activity/useActivityCenterState.js';
import type { ActivityItemFilter } from './features/activity/activity-reducer.js';
import { FirstSuccessFlow } from './features/first-success/FirstSuccessFlow.js';
import {
  createInitialFirstSuccessState,
  reduceFirstSuccessState,
  type FirstSuccessAction,
  type FirstSuccessState,
} from './features/first-success/first-success-reducer.js';
import { StartCenter } from './features/readiness/StartCenter.js';
import { useRuntimeReadinessState } from './features/readiness/useRuntimeReadinessState.js';
import {
  createDraftFromCandidate,
  draftToNonSensitivePrefill,
  fingerprintDeviceCandidate,
} from '../shared/serial-connection-draft.js';
import { createJLinkRttDraftFromCandidate } from '../shared/jlink-rtt-draft.js';
import {
  FIRST_SIGNAL_SCHEMA_VERSION,
  type FirstSignalStopReason,
} from '../shared/first-signal-contract.js';
import { getLinkterm } from './lib/linkterm-bridge.js';
import { useAppStore } from './store/app-store.js';
import { useT, type Locale } from './i18n/index.js';
import { useUiPatchSubscription } from './hooks/useUiPatchSubscription.js';
import { useSessionHydration } from './hooks/useSessionHydration.js';
import type { ControlProfileOpenedEvent } from './components/ControlProfilePanel.js';
import type {
  ControlProfileDownloadJobPayload,
  ControlProfileDownloadResultPayload,
  ControlProfileChipProbePayload,
  ControlProfileNamespace,
  ControlProfileWorkflowStepPayload,
  NonSensitivePrefill,
  SavedConnectionSummary,
  SavedControlProfileRecordPayload,
} from '../shared/preload-api.js';
import type {
  DeviceCandidate,
  JLinkRttDownloadObserveDraft,
  RuntimeReadinessSnapshot,
} from '../shared/readiness-contract.js';
import type { SerialSessionConfig, SessionId, SessionState } from '../shared/types.js';
import type { SerialConnectionDraft } from '../shared/readiness-contract.js';
import {
  summarizeControlProfileRecord,
  summarizeSerialConnection,
  type WorkspaceSummary,
} from './features/workspaces/workspace-model.js';

const DOWNLOAD_POLL_INTERVAL_MS = 200;
const FIRST_SIGNAL_TIMEOUT_MS = 30_000;

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
  const openDialog = useAppStore((s) => s.openDialog);
  const dialogOpen = useAppStore((s) => s.dialogOpen);
  const setConnectionDialogPrefill = useAppStore((s) => s.setConnectionDialogPrefill);
  const activityState = useActivityCenterState();
  const [advancedDevicesOpen, setAdvancedDevicesOpen] = React.useState(false);
  const readinessState = useRuntimeReadinessState(advancedDevicesOpen);
  const [firstSuccessDraft, setFirstSuccessDraft] = React.useState<SerialConnectionDraft | null>(
    null,
  );
  const [jlinkRttReview, setJLinkRttReview] = React.useState<JLinkRttReviewState | null>(null);
  const [firstSuccessState, setFirstSuccessState] = React.useState<FirstSuccessState>(() =>
    createInitialFirstSuccessState(),
  );
  const [firstSuccessErrorMessage, setFirstSuccessErrorMessage] = React.useState<string | null>(
    null,
  );
  const firstSuccessAttemptCounter = React.useRef(0);
  const [activityDrawerOpen, setActivityDrawerOpen] = React.useState(false);
  const [activityFilter, setActivityFilter] = React.useState<ActivityItemFilter | undefined>();
  const activityReturnFocusRef = React.useRef<HTMLElement | null>(null);
  const [agentPanelOpen, setAgentPanelOpen] = React.useState(false);
  const [controlPanelOpen, setControlPanelOpen] = React.useState(false);
  const [controlProfileRepairRecord, setControlProfileRepairRecord] =
    React.useState<SavedControlProfileRecordPayload | null>(null);
  const [openedControlProfile, setOpenedControlProfile] =
    React.useState<ControlProfileOpenedEvent | null>(null);
  const [controlProfileDownload, setControlProfileDownload] =
    React.useState<ControlProfileDownloadState>({ phase: 'idle' });
  const [controlProfileChip, setControlProfileChip] = React.useState<ControlProfileChipState>({
    phase: 'idle',
  });
  const [controlProfileConnecting, setControlProfileConnecting] = React.useState(false);
  const [controlProfileDisconnecting, setControlProfileDisconnecting] = React.useState(false);
  const [controlProfileRecords, setControlProfileRecords] = React.useState<
    ReadonlyArray<SavedControlProfileRecordPayload>
  >([]);
  const [controlProfileRecordsLoading, setControlProfileRecordsLoading] = React.useState(true);
  const [controlProfileRecordsError, setControlProfileRecordsError] = React.useState<string | null>(
    null,
  );
  const [savedConnections, setSavedConnections] = React.useState<
    ReadonlyArray<SavedConnectionSummary>
  >([]);
  const [savedConnectionsLoading, setSavedConnectionsLoading] = React.useState(true);
  const [savedConnectionsError, setSavedConnectionsError] = React.useState<string | null>(null);
  const [openingWorkspaceId, setOpeningWorkspaceId] = React.useState<string | null>(null);
  const [workspaceOpenError, setWorkspaceOpenError] = React.useState<{
    readonly workspaceId: string;
    readonly message: string;
  } | null>(null);
  const [deletingWorkspaceId, setDeletingWorkspaceId] = React.useState<string | null>(null);
  const [workspaceDeleteError, setWorkspaceDeleteError] = React.useState<string | null>(null);
  const [openingControlProfileId, setOpeningControlProfileId] = React.useState<string | null>(null);
  const [openedControlProfilesByRecordId, setOpenedControlProfilesByRecordId] = React.useState<
    ReadonlyMap<string, ControlProfileOpenedEvent>
  >(new Map());
  const sessionList = React.useMemo(() => Array.from(sessions.values()), [sessions]);
  const savedWorkspaces = React.useMemo<readonly WorkspaceSummary[]>(() => {
    const full = controlProfileRecords.map(summarizeControlProfileRecord);
    const serialOnly = savedConnections
      .map(summarizeSerialConnection)
      .filter((summary): summary is WorkspaceSummary => summary !== null);
    return [...full, ...serialOnly].sort((left, right) =>
      right.updatedAt.localeCompare(left.updatedAt),
    );
  }, [controlProfileRecords, savedConnections]);
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
  const rememberActivityReturnFocus = React.useCallback(() => {
    const activeElement = document.activeElement;
    activityReturnFocusRef.current = activeElement instanceof HTMLElement ? activeElement : null;
  }, []);

  const openActivityCenter = React.useCallback(() => {
    rememberActivityReturnFocus();
    setActivityFilter(undefined);
    setActivityDrawerOpen(true);
  }, [rememberActivityReturnFocus]);

  const openActivityCenterForSession = React.useCallback(
    (sessionId: SessionId) => {
      rememberActivityReturnFocus();
      setActivityFilter({ sessionId });
      setActivityDrawerOpen(true);
    },
    [rememberActivityReturnFocus],
  );

  const dispatchFirstSuccess = React.useCallback((action: FirstSuccessAction) => {
    setFirstSuccessState((state) => reduceFirstSuccessState(state, action));
  }, []);

  const openFirstSuccessReview = React.useCallback((draft: SerialConnectionDraft) => {
    setJLinkRttReview(null);
    setFirstSuccessDraft(draft);
    setFirstSuccessErrorMessage(null);
    setFirstSuccessState(
      reduceFirstSuccessState(
        reduceFirstSuccessState(createInitialFirstSuccessState(), {
          type: 'serial-draft-ready',
          draftId: draft.draftId,
        }),
        { type: 'review-plan' },
      ),
    );
  }, []);

  const closeFirstSuccessReview = React.useCallback(() => {
    setFirstSuccessDraft(null);
    setFirstSuccessErrorMessage(null);
    setFirstSuccessState(createInitialFirstSuccessState());
  }, []);

  const closeJLinkRttReview = React.useCallback(() => {
    setJLinkRttReview(null);
  }, []);

  const openAdvancedConnection = React.useCallback(() => {
    setConnectionDialogPrefill(null);
    openDialog();
  }, [openDialog, setConnectionDialogPrefill]);

  const openSerialTerminal = React.useCallback(() => {
    setFirstSuccessDraft(null);
    setFirstSuccessErrorMessage(null);
    setJLinkRttReview(null);
    setConnectionDialogPrefill(null);
    openDialog();
  }, [openDialog, setConnectionDialogPrefill]);

  const openSerialDraftInDialog = React.useCallback(
    (draft: SerialConnectionDraft): void => {
      setFirstSuccessDraft(null);
      setFirstSuccessErrorMessage(null);
      setJLinkRttReview(null);
      setConnectionDialogPrefill(draftToNonSensitivePrefill(draft));
      openDialog();
    },
    [openDialog, setConnectionDialogPrefill],
  );

  const openCandidateSerialConnection = React.useCallback(
    (candidate: DeviceCandidate) => {
      if (candidate.kind === 'jlink') {
        setFirstSuccessDraft(null);
        setFirstSuccessErrorMessage(null);
        setFirstSuccessState(createInitialFirstSuccessState());
        setJLinkRttReview({
          draft: createJLinkRttDraftFromCandidate(candidate, { draftId: candidate.id }),
          candidateLabel: candidate.label,
        });
        return;
      }
      const draft = createDraftFromCandidate(candidate, { draftId: candidate.id });
      openSerialDraftInDialog(draft);
    },
    [openSerialDraftInDialog],
  );

  const openFirstSuccessGuide = React.useCallback(() => {
    void (async () => {
      let snapshot = readinessState.snapshot;
      if (snapshot === undefined) {
        const api = getLinkterm();
        const result = await api?.readiness.get();
        if (result?.success === true) snapshot = result.data;
      }
      const serialCandidates =
        snapshot?.deviceCandidates.filter((candidate) => candidate.serial !== undefined) ?? [];
      if (serialCandidates.length === 1) {
        openFirstSuccessReview(
          createDraftFromCandidate(serialCandidates[0], { draftId: serialCandidates[0].id }),
        );
        return;
      }
      openAdvancedConnection();
    })();
  }, [openAdvancedConnection, openFirstSuccessReview, readinessState.snapshot]);

  const refreshReadiness = React.useCallback(() => {
    void readinessState.refresh();
  }, [readinessState]);

  const copyReadinessDiagnostics = React.useCallback((codes: string[]) => {
    const text = codes.join('\n');
    void navigator.clipboard?.writeText(text).catch(() => undefined);
  }, []);

  const markFirstSuccessError = React.useCallback((code: string, message: string) => {
    setFirstSuccessErrorMessage(message);
    setFirstSuccessState((state) => toErroredFirstSuccessState(state, code));
  }, []);

  const confirmFirstSuccessConnect = React.useCallback(
    async (draft: SerialConnectionDraft): Promise<void> => {
      const api = getLinkterm();
      if (!api) {
        markFirstSuccessError('PRELOAD_UNAVAILABLE', preloadUnavailableMessage);
        return;
      }
      const latestReadiness = await api.readiness.get();
      if (!latestReadiness.success && draft.candidateId !== undefined) {
        markFirstSuccessError(
          'FIRST_SIGNAL_CANDIDATE_REVALIDATION_FAILED',
          t('firstSuccess.error.candidateChanged'),
        );
        return;
      }
      const revalidationSnapshot = latestReadiness.success
        ? latestReadiness.data
        : readinessState.snapshot;
      if (isDraftCandidateStale(draft, revalidationSnapshot)) {
        markFirstSuccessError(
          'FIRST_SIGNAL_CANDIDATE_CHANGED',
          t('firstSuccess.error.candidateChanged'),
        );
        return;
      }
      const config = serialConfigFromDraft(draft);
      if (config === null) {
        markFirstSuccessError('SERIAL_PORT_REQUIRED', t('controlProfile.error.serialPortRequired'));
        return;
      }

      const clientAttemptKey = createFirstSuccessClientAttemptKey(
        firstSuccessAttemptCounter.current + 1,
      );
      firstSuccessAttemptCounter.current += 1;
      setFirstSuccessErrorMessage(null);
      setFirstSuccessState((state) => ({
        ...reduceFirstSuccessState(state, { type: 'connect-started' }),
        clientAttemptKey,
      }));

      const createResult = await api.session.create({
        config,
        label: draft.portLabel ?? config.port,
      });
      if (!createResult.success) {
        markFirstSuccessError(createResult.error.code, createResult.error.message);
        return;
      }

      const sessionId = createResult.data.sessionId;
      addSession({
        id: sessionId,
        label: draft.portLabel ?? config.port,
        connectionType: 'serial',
        state: createResult.data.state,
      });
      setActive(sessionId);

      const startResult = await api.firstSignal.start({
        schemaVersion: FIRST_SIGNAL_SCHEMA_VERSION,
        clientAttemptKey,
        sessionId,
        ownsSession: true,
        baselineCursor: 0,
        timeoutMs: FIRST_SIGNAL_TIMEOUT_MS,
      });
      if (!startResult.success) {
        markFirstSuccessError(startResult.error.code, startResult.error.message);
        return;
      }

      dispatchFirstSuccess({ type: 'observation-updated', observation: startResult.data });
      const subscribeResult = await api.firstSignal.subscribe({
        attemptId: startResult.data.attemptId,
        sinceRevision: startResult.data.revision,
      });
      if (subscribeResult.success) {
        dispatchFirstSuccess({
          type: 'observation-updated',
          observation: subscribeResult.data,
        });
        return;
      }
      markFirstSuccessError(subscribeResult.error.code, subscribeResult.error.message);
    },
    [
      addSession,
      dispatchFirstSuccess,
      markFirstSuccessError,
      preloadUnavailableMessage,
      readinessState.snapshot,
      setActive,
      t,
    ],
  );

  React.useEffect(() => {
    const api = getLinkterm();
    if (!api) return undefined;
    return api.firstSignal.onEvent(
      (event) => {
        setFirstSuccessErrorMessage(null);
        setFirstSuccessState((state) => {
          if (state.draftId === undefined) return state;
          return reduceFirstSuccessState(state, {
            type: 'observation-updated',
            observation: event.observation,
          });
        });
      },
      () => {
        markFirstSuccessError('FIRST_SIGNAL_INVALID_PAYLOAD', t('firstSuccess.status.errored'));
      },
    );
  }, [markFirstSuccessError, t]);

  const stopFirstSuccessObservation = React.useCallback(
    async (reason: FirstSignalStopReason): Promise<void> => {
      const attemptId = firstSuccessState.attemptId;
      if (attemptId === undefined) return;
      const api = getLinkterm();
      if (!api) return;
      await api.firstSignal.stop({ attemptId, reason });
    },
    [firstSuccessState.attemptId],
  );

  const destroyFirstSuccessSession = React.useCallback(async (): Promise<void> => {
    const sessionId = firstSuccessState.sessionId;
    if (sessionId === undefined) return;
    const api = getLinkterm();
    if (api) {
      const result = await api.session.destroy({ sessionId });
      if (!result.success) {
        markFirstSuccessError(result.error.code, result.error.message);
        return;
      }
    }
    removeSession(sessionId);
  }, [firstSuccessState.sessionId, markFirstSuccessError, removeSession]);

  const keepWaitingForFirstSignal = React.useCallback(() => {
    dispatchFirstSuccess({ type: 'keep-waiting' });
  }, [dispatchFirstSuccess]);

  const disconnectAndEditFirstSignal = React.useCallback(async (): Promise<void> => {
    await stopFirstSuccessObservation('disconnect-and-edit');
    await destroyFirstSuccessSession();
    dispatchFirstSuccess({ type: 'disconnect-and-edit' });
  }, [destroyFirstSuccessSession, dispatchFirstSuccess, stopFirstSuccessObservation]);

  const backToFirstSuccessSession = React.useCallback(async (): Promise<void> => {
    await stopFirstSuccessObservation('back-to-session');
    dispatchFirstSuccess({ type: 'back-to-session' });
    setFirstSuccessDraft(null);
  }, [dispatchFirstSuccess, stopFirstSuccessObservation]);

  const disconnectFirstSuccessSession = React.useCallback(async (): Promise<void> => {
    await stopFirstSuccessObservation('user');
    await destroyFirstSuccessSession();
    dispatchFirstSuccess({ type: 'user-disconnected' });
  }, [destroyFirstSuccessSession, dispatchFirstSuccess, stopFirstSuccessObservation]);

  const retryFirstSignal = React.useCallback(() => {
    if (firstSuccessDraft === null) return;
    void (async () => {
      await stopFirstSuccessObservation('retry');
      const previousSessionId = firstSuccessState.sessionId;
      if (firstSuccessState.ownsSession === true) {
        await destroyFirstSuccessSession();
        if (
          previousSessionId !== undefined &&
          useAppStore.getState().sessions.has(previousSessionId)
        ) {
          return;
        }
      }
      dispatchFirstSuccess({
        type: 'retry-started',
        nextClientAttemptKey: createFirstSuccessClientAttemptKey(
          firstSuccessAttemptCounter.current + 1,
        ),
      });
      await confirmFirstSuccessConnect(firstSuccessDraft);
    })();
  }, [
    confirmFirstSuccessConnect,
    destroyFirstSuccessSession,
    dispatchFirstSuccess,
    firstSuccessDraft,
    firstSuccessState.ownsSession,
    firstSuccessState.sessionId,
    stopFirstSuccessObservation,
  ]);

  const goToFirstSuccessTerminal = React.useCallback(() => {
    setFirstSuccessDraft(null);
  }, []);

  const handleVisibleDeviceSequence = React.useCallback(
    ({ sessionId, sequence }: { readonly sessionId: SessionId; readonly sequence: number }) => {
      const attemptId = firstSuccessState.attemptId;
      if (attemptId === undefined) return;
      dispatchFirstSuccess({
        type: 'visible-device-sequence',
        attemptId,
        sessionId,
        sequence,
        focusPolicy: {
          canFocusTerminal: canAutoFocusFirstSuccessTerminal({
            sessionId,
            activeSessionId: activeId,
            firstSuccessDraftOpen: firstSuccessDraft !== null,
            activityDrawerOpen,
            dialogOpen,
            agentPanelOpen,
            controlPanelOpen,
            activeElement: document.activeElement,
          }),
        },
      });
    },
    [
      activeId,
      activityDrawerOpen,
      agentPanelOpen,
      controlPanelOpen,
      dialogOpen,
      dispatchFirstSuccess,
      firstSuccessDraft,
      firstSuccessState.attemptId,
    ],
  );

  const handleTranscriptDisplayUnavailable = React.useCallback(
    (reasonCode: string) => {
      dispatchFirstSuccess({ type: 'transcript-display-unavailable', reasonCode });
    },
    [dispatchFirstSuccess],
  );

  const handleTranscriptDisplayRecovered = React.useCallback(() => {
    dispatchFirstSuccess({ type: 'transcript-display-recovered' });
  }, [dispatchFirstSuccess]);

  const closeActivityCenter = React.useCallback(() => {
    setActivityDrawerOpen(false);
    const returnFocus = activityReturnFocusRef.current;
    activityReturnFocusRef.current = null;
    if (returnFocus?.isConnected === true) returnFocus.focus();
  }, []);

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
      setControlProfileRecordsLoading(false);
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

  const loadSavedConnections = React.useCallback(async (): Promise<void> => {
    const api = getLinkterm();
    if (!api) {
      setSavedConnectionsError(preloadUnavailableMessage);
      setSavedConnectionsLoading(false);
      return;
    }
    setSavedConnectionsLoading(true);
    setSavedConnectionsError(null);
    try {
      const result = await api.connections.list();
      if (result.success) {
        setSavedConnections(result.data);
        return;
      }
      setSavedConnectionsError(result.error.message);
    } finally {
      setSavedConnectionsLoading(false);
    }
  }, [preloadUnavailableMessage]);

  React.useEffect(() => {
    void loadSavedConnections();
  }, [loadSavedConnections]);

  const openSavedConnection = React.useCallback(
    async (profile: SavedConnectionSummary): Promise<string | null> => {
      const api = getLinkterm();
      if (!api) return preloadUnavailableMessage;
      const result = await api.connections.open({ profileId: profile.id });
      if (!result.success) return result.error.message;
      const opened = result.data;
      addSession({
        id: opened.sessionId,
        label: opened.profile.label || opened.sessionId.slice(-4),
        connectionType: opened.profile.type,
        state: opened.state,
        ...(opened.rttLog ? { rttLog: opened.rttLog } : {}),
      });
      setActive(opened.sessionId);
      return null;
    },
    [addSession, preloadUnavailableMessage, setActive],
  );

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
    setControlProfileChip({ phase: 'idle' });
  }, [openedControlProfile?.record.id]);

  const openControlProfileRecord = React.useCallback(
    async (recordId: string): Promise<string | null> => {
      const existing = openedControlProfilesByRecordId.get(recordId);
      const existingSessionId = getControlProfileSessionId(existing ?? null);
      if (existing !== undefined && existingSessionId !== null && sessions.has(existingSessionId)) {
        setOpenedControlProfile(existing);
        setActive(existingSessionId);
        return null;
      }

      const api = getLinkterm();
      if (!api) {
        setControlProfileRecordsError(preloadUnavailableMessage);
        return preloadUnavailableMessage;
      }
      setOpeningControlProfileId(recordId);
      setControlProfileRecordsError(null);
      try {
        const result = await api.controlProfile.openRecord({ recordId });
        if (!result.success) {
          setControlProfileRecordsError(result.error.message);
          return result.error.message;
        }
        const record = result.data.record;
        setControlProfileRecords((records) => upsertControlProfileRecord(records, record));
        const observation = await openObservationForRecord(api, record, addSession, setActive);
        rememberOpenedControlProfile({ path: result.data.path, record, observation });
        return null;
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

  const openWorkspace = React.useCallback(
    async (workspace: WorkspaceSummary): Promise<void> => {
      setOpeningWorkspaceId(workspace.id);
      setWorkspaceOpenError(null);
      try {
        let error: string | null = null;
        if (
          workspace.source === 'control-profile' &&
          workspace.controlProfileRecordId !== undefined
        ) {
          error = await openControlProfileRecord(workspace.controlProfileRecordId);
          if (error !== null) setControlProfileRecordsError(null);
        } else if (workspace.connectionProfileId !== undefined) {
          const profile = savedConnections.find(
            (item) => item.id === workspace.connectionProfileId,
          );
          error =
            profile === undefined
              ? t('workspace.open.unavailable')
              : await openSavedConnection(profile);
        } else {
          error = t('workspace.open.unavailable');
        }
        if (error !== null) setWorkspaceOpenError({ workspaceId: workspace.id, message: error });
      } catch (error) {
        setWorkspaceOpenError({
          workspaceId: workspace.id,
          message: error instanceof Error ? error.message : t('workspace.open.unavailable'),
        });
      } finally {
        setOpeningWorkspaceId(null);
      }
    },
    [openControlProfileRecord, openSavedConnection, savedConnections, t],
  );

  const repairWorkspace = React.useCallback(
    (workspace: WorkspaceSummary): void => {
      setWorkspaceOpenError(null);
      if (workspace.source === 'control-profile') {
        const record = controlProfileRecords.find(
          (item) => item.id === workspace.controlProfileRecordId,
        );
        if (record === undefined) {
          setWorkspaceOpenError({
            workspaceId: workspace.id,
            message: t('workspace.open.unavailable'),
          });
          return;
        }
        setControlProfileRepairRecord(record);
        setControlPanelOpen(true);
        return;
      }

      const profile = savedConnections.find((item) => item.id === workspace.connectionProfileId);
      if (profile === undefined || profile.config.type !== 'serial') {
        setWorkspaceOpenError({
          workspaceId: workspace.id,
          message: t('workspace.open.unavailable'),
        });
        return;
      }
      setConnectionDialogPrefill(serialConnectionRepairPrefill(profile));
      openDialog();
    },
    [controlProfileRecords, openDialog, savedConnections, setConnectionDialogPrefill, t],
  );

  const handleControlPanelOpenChange = React.useCallback((open: boolean): void => {
    setControlPanelOpen(open);
    if (!open) setControlProfileRepairRecord(null);
  }, []);

  const deleteWorkspace = React.useCallback(
    async (workspace: WorkspaceSummary): Promise<void> => {
      if (!window.confirm(t('workspace.delete.confirm'))) return;

      const api = getLinkterm();
      if (!api) {
        setWorkspaceDeleteError(preloadUnavailableMessage);
        return;
      }

      setDeletingWorkspaceId(workspace.id);
      setWorkspaceDeleteError(null);
      try {
        if (workspace.source === 'control-profile') {
          const recordId = workspace.controlProfileRecordId;
          if (recordId === undefined) return;
          const result = await api.controlProfile.deleteRecord({ recordId });
          if (!result.success) {
            setWorkspaceDeleteError(result.error.message);
            return;
          }
          setControlProfileRecords((records) => records.filter((record) => record.id !== recordId));
          return;
        }

        const profileId = workspace.connectionProfileId;
        if (profileId === undefined) return;
        const result = await api.connections.delete({ profileId });
        if (!result.success) {
          setWorkspaceDeleteError(result.error.message);
          return;
        }
        setSavedConnections((profiles) => profiles.filter((profile) => profile.id !== profileId));
      } finally {
        setDeletingWorkspaceId(null);
      }
    },
    [preloadUnavailableMessage, t],
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

  const connectControlProfileChip = React.useCallback(async (): Promise<void> => {
    if (openedControlProfile === null) return;
    const api = getLinkterm();
    if (!api) {
      setControlProfileChip({ phase: 'failed', error: preloadUnavailableMessage });
      return;
    }
    setControlProfileChip({ phase: 'connecting' });
    const result = await api.controlProfile.connectChip({ root: openedControlProfile.record.root });
    if (result.success) {
      setControlProfileChip({ phase: 'connected', probe: result.data.probe });
      return;
    }
    setControlProfileChip({ phase: 'failed', error: result.error.message });
  }, [openedControlProfile, preloadUnavailableMessage]);

  const disconnectControlProfileChip = React.useCallback(async (): Promise<void> => {
    if (controlProfileChip.phase !== 'connected') return;
    const api = getLinkterm();
    if (!api) {
      setControlProfileChip({
        phase: 'failed',
        error: preloadUnavailableMessage,
        probe: controlProfileChip.probe,
      });
      return;
    }
    const probe = controlProfileChip.probe;
    setControlProfileChip({ phase: 'disconnecting', probe });
    const result = await api.controlProfile.disconnectChip({ probeId: probe.probeId });
    if (result.success) {
      setControlProfileChip({ phase: 'disconnected' });
      return;
    }
    setControlProfileChip({ phase: 'failed', error: result.error.message, probe });
  }, [controlProfileChip, preloadUnavailableMessage]);

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
    const result = await api.controlProfile.startDownload({
      root: openedControlProfile.record.root,
    });
    if (result.success) {
      setControlProfileDownload({ phase: 'running', job: result.data });
      return;
    }
    setControlProfileDownload({ phase: 'failed', error: result.error.message });
  }, [openedControlProfile, t]);

  const reviewCompensationReflash = React.useCallback(
    async (candidateId: string): Promise<void> => {
      const api = getLinkterm();
      if (!api) {
        setControlProfileDownload({
          phase: 'failed',
          error: t('controlProfile.error.preloadUnavailable'),
        });
        return;
      }
      const result = await api.controlProfile.startCompensationReflash({ candidateId });
      if (result.success) {
        setControlProfileDownload({ phase: 'running', job: result.data });
        return;
      }
      setControlProfileDownload({ phase: 'failed', error: result.error.message });
    },
    [t],
  );

  const saveProfileSuggestion = React.useCallback(
    async (suggestionId: string): Promise<void> => {
      const api = getLinkterm();
      if (!api) {
        setControlProfileRecordsError(preloadUnavailableMessage);
        return;
      }
      const result = await api.controlProfile.saveProfileSuggestion({ suggestionId });
      if (!result.success) {
        setControlProfileRecordsError(result.error.message);
        return;
      }
      if (result.data.record !== undefined) {
        setControlProfileRecords((records) =>
          upsertControlProfileRecord(records, result.data.record!),
        );
      }
      void readinessState.refresh();
    },
    [preloadUnavailableMessage, readinessState],
  );

  const skipProfileSuggestion = React.useCallback(
    (_suggestionId: string): void => {
      void readinessState.refresh();
    },
    [readinessState],
  );

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
          <AiStatusCapsule state={activityState} onOpen={openActivityCenter} />
          {sessionList.length > 0 ? (
            <>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setControlPanelOpen(true)}
                data-testid="control-profile-open"
              >
                {t('controlProfile.entry')}
              </Button>
            </>
          ) : null}
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

      <SessionTabBar
        onOpenActivityForSession={openActivityCenterForSession}
        showNew={sessionList.length > 0}
      />

      <main className="flex min-h-0 flex-1 overflow-hidden">
        {sessionList.length > 0 ||
        firstSuccessDraft !== null ||
        jlinkRttReview !== null ||
        visibleControlProfile !== null ? (
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
        ) : null}
        {visibleControlProfile ? (
          <ControlProfileStatusPanel
            event={visibleControlProfile}
            download={controlProfileDownload}
            chip={controlProfileChip}
            connecting={controlProfileConnecting}
            disconnecting={controlProfileDisconnecting}
            onConnect={() => void connectControlProfile()}
            onDisconnect={() => void disconnectControlProfile()}
            onConnectChip={() => void connectControlProfileChip()}
            onDisconnectChip={() => void disconnectControlProfileChip()}
            onDownload={() => void downloadControlProfile()}
          />
        ) : null}
        <div className="relative min-w-0 flex-1 overflow-hidden">
          {sessionList.length === 0 && firstSuccessDraft === null && jlinkRttReview === null ? (
            <StartCenter
              state={readinessState}
              savedWorkspaces={savedWorkspaces}
              savedWorkspacesLoading={controlProfileRecordsLoading || savedConnectionsLoading}
              workspaceLoadError={controlProfileRecordsError ?? savedConnectionsError}
              onOpenWorkspace={openWorkspace}
              openingWorkspaceId={openingWorkspaceId}
              workspaceOpenError={workspaceOpenError}
              onRepairWorkspace={repairWorkspace}
              onDeleteWorkspace={(workspace) => void deleteWorkspace(workspace)}
              deletingWorkspaceId={deletingWorkspaceId}
              workspaceDeleteError={workspaceDeleteError}
              onNewWorkspace={() => setControlPanelOpen(true)}
              onRefresh={refreshReadiness}
              onAdvancedConnection={openAdvancedConnection}
              onAdvancedDevicesOpenChange={setAdvancedDevicesOpen}
              onOpenFirstSuccessGuide={openFirstSuccessGuide}
              onUseCandidate={openCandidateSerialConnection}
              onCopyDiagnostics={copyReadinessDiagnostics}
              onReviewReflash={(candidateId) => void reviewCompensationReflash(candidateId)}
              onSaveProfileSuggestion={(suggestionId) => void saveProfileSuggestion(suggestionId)}
              onSkipProfileSuggestion={skipProfileSuggestion}
            />
          ) : sessionList.length === 0 && jlinkRttReview !== null ? (
            <JLinkRttReviewPanel
              review={jlinkRttReview}
              onCancel={closeJLinkRttReview}
              onConfigure={() => setControlPanelOpen(true)}
            />
          ) : sessionList.length === 0 && firstSuccessDraft !== null ? (
            <FirstSuccessFlow
              draft={firstSuccessDraft}
              state={firstSuccessState}
              errorMessage={firstSuccessErrorMessage}
              onConfirmConnect={(draft) => void confirmFirstSuccessConnect(draft)}
              onCancel={closeFirstSuccessReview}
              onKeepWaiting={keepWaitingForFirstSignal}
              onDisconnectAndEdit={() => void disconnectAndEditFirstSignal()}
              onBackToSession={() => void backToFirstSuccessSession()}
              onDisconnect={() => void disconnectFirstSuccessSession()}
              onRetry={retryFirstSignal}
              onGoToTerminal={goToFirstSuccessTerminal}
            />
          ) : (
            <>
              {sessionList.map((session) => {
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
                    <TerminalView
                      sessionId={session.id}
                      focusRequestToken={0}
                      onVisibleDeviceSequence={handleVisibleDeviceSequence}
                      onTranscriptDisplayUnavailable={handleTranscriptDisplayUnavailable}
                      onTranscriptDisplayRecovered={handleTranscriptDisplayRecovered}
                    />
                  </div>
                );
              })}
              {firstSuccessDraft !== null ? (
                <div className="absolute right-4 top-4 z-10 max-h-[calc(100%-2rem)] w-[min(32rem,calc(100%-2rem))] overflow-auto rounded border border-gray-800 bg-gray-950/95 shadow-2xl">
                  <FirstSuccessFlow
                    draft={firstSuccessDraft}
                    state={firstSuccessState}
                    errorMessage={firstSuccessErrorMessage}
                    onConfirmConnect={(draft) => void confirmFirstSuccessConnect(draft)}
                    onCancel={closeFirstSuccessReview}
                    onKeepWaiting={keepWaitingForFirstSignal}
                    onDisconnectAndEdit={() => void disconnectAndEditFirstSignal()}
                    onBackToSession={() => void backToFirstSuccessSession()}
                    onDisconnect={() => void disconnectFirstSuccessSession()}
                    onRetry={retryFirstSignal}
                    onGoToTerminal={goToFirstSuccessTerminal}
                  />
                </div>
              ) : null}
            </>
          )}
        </div>
      </main>

      <ConnectionDialog />
      <ControlProfilePanel
        open={controlPanelOpen}
        onOpenChange={handleControlPanelOpenChange}
        repairRecord={controlProfileRepairRecord}
        onOpenSerialConnection={openSerialTerminal}
        onProfileOpened={rememberOpenedControlProfile}
        onRecordsChanged={() => void loadControlProfileRecords()}
      />
      <AgentIntegrationsPanel open={agentPanelOpen} onOpenChange={setAgentPanelOpen} />
      <ActivityCenterDrawer
        open={activityDrawerOpen}
        state={activityState}
        filter={activityFilter}
        onClose={closeActivityCenter}
      />
    </div>
  );
}

function serialConnectionRepairPrefill(profile: SavedConnectionSummary): NonSensitivePrefill {
  const config = profile.config;
  if (config.type !== 'serial') return { type: 'serial', label: profile.label };
  return {
    type: 'serial',
    label: profile.label,
    connectionProfileId: profile.id,
    connectionProfileUpdatedAt: profile.updatedAt,
    serialPort: config.port,
    baudRate: String(config.baudRate),
    serialMode: config.mode,
    ...(config.dataBits === undefined
      ? {}
      : { dataBits: String(config.dataBits) as '5' | '6' | '7' | '8' }),
    ...(config.stopBits === undefined
      ? {}
      : { stopBits: String(config.stopBits) as '1' | '1.5' | '2' }),
    ...(config.parity === undefined ? {} : { parity: config.parity }),
  };
}

interface JLinkRttReviewState {
  readonly draft: JLinkRttDownloadObserveDraft;
  readonly candidateLabel: string;
}

function JLinkRttReviewPanel({
  review,
  onCancel,
  onConfigure,
}: {
  readonly review: JLinkRttReviewState;
  readonly onCancel: () => void;
  readonly onConfigure: () => void;
}): React.ReactElement {
  const t = useT();
  const { draft, candidateLabel } = review;
  const sideEffects = [
    draft.sideEffects.connectProbe ? t('jlinkRtt.sideEffect.connectProbe') : null,
    draft.sideEffects.flashFirmware ? t('jlinkRtt.sideEffect.flashFirmware') : null,
    draft.sideEffects.resetTarget ? t('jlinkRtt.sideEffect.resetTarget') : null,
    draft.sideEffects.startsGdbServer ? t('jlinkRtt.sideEffect.startsGdbServer') : null,
    draft.sideEffects.connectsRtt ? t('jlinkRtt.sideEffect.connectsRtt') : null,
  ].filter((item): item is string => item !== null);

  return (
    <section
      aria-labelledby="jlink-rtt-review-title"
      className="h-full overflow-auto bg-gray-950 px-6 py-8"
    >
      <div className="mx-auto max-w-3xl rounded-xl border border-gray-800 bg-gray-900/80 p-6 shadow-xl">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-blue-300">
          {t('jlinkRtt.review.kicker')}
        </p>
        <h2 id="jlink-rtt-review-title" className="mt-2 text-2xl font-semibold text-gray-50">
          {t('jlinkRtt.review.title')}
        </h2>
        <p className="mt-3 text-sm text-gray-300">{t('jlinkRtt.review.incomplete')}</p>

        <dl className="mt-6 grid gap-3 rounded-lg border border-gray-800 bg-gray-950/70 p-4 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-xs uppercase tracking-wide text-gray-500">
              {t('jlinkRtt.review.candidate')}
            </dt>
            <dd className="mt-1 font-medium text-gray-100">{candidateLabel}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-gray-500">
              {t('readiness.param.target')}
            </dt>
            <dd className="mt-1 font-medium text-gray-100">{draft.target.targetLabel}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-gray-500">
              {t('jlinkRtt.review.interface')}
            </dt>
            <dd className="mt-1 font-medium uppercase text-gray-100">{draft.target.interface}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-gray-500">
              {t('jlinkRtt.review.speed')}
            </dt>
            <dd className="mt-1 font-medium text-gray-100">{draft.target.speedKHz} kHz</dd>
          </div>
        </dl>

        <div className="mt-5 rounded-lg border border-amber-900/70 bg-amber-950/30 p-4">
          <h3 className="text-sm font-semibold text-amber-100">
            {t('jlinkRtt.sideEffects.title')}
          </h3>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-amber-100/90">
            {sideEffects.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>

        <div className="mt-6 flex flex-wrap gap-2">
          <Button type="button" onClick={onConfigure}>
            {t('jlinkRtt.action.openProfile')}
          </Button>
          <Button type="button" variant="secondary" onClick={onCancel}>
            {t('jlinkRtt.action.back')}
          </Button>
        </div>
      </div>
    </section>
  );
}

function serialConfigFromDraft(draft: SerialConnectionDraft): SerialSessionConfig | null {
  if (draft.portLabel === undefined || draft.portLabel.trim().length === 0) return null;
  return {
    type: 'serial',
    port: draft.portLabel.trim(),
    baudRate: draft.parameters.baudRate.value,
    mode: 'terminal',
    dataBits: draft.parameters.dataBits.value as SerialSessionConfig['dataBits'],
    stopBits: draft.parameters.stopBits.value as SerialSessionConfig['stopBits'],
    parity: draft.parameters.parity.value,
  };
}

function isDraftCandidateStale(
  draft: SerialConnectionDraft,
  snapshot: RuntimeReadinessSnapshot | undefined,
): boolean {
  if (draft.candidateId === undefined) return false;
  if (snapshot === undefined) return true;
  const candidate = snapshot.deviceCandidates.find((item) => item.id === draft.candidateId);
  if (candidate?.serial === undefined) return true;
  if (
    draft.candidateFingerprint !== undefined &&
    fingerprintDeviceCandidate(candidate) !== draft.candidateFingerprint
  ) {
    return true;
  }
  if (candidateHasConflictingEvidence(candidate)) return true;
  return (
    candidate.serial.portLabel !== draft.portLabel ||
    candidate.serial.baudRate !== draft.parameters.baudRate.value ||
    candidate.serial.dataBits !== draft.parameters.dataBits.value ||
    candidate.serial.stopBits !== draft.parameters.stopBits.value ||
    candidate.serial.parity !== draft.parameters.parity.value
  );
}

function candidateHasConflictingEvidence(candidate: DeviceCandidate): boolean {
  return candidate.evidence.some((item) => isBlockingReadinessCode(item.summaryCode));
}

function isBlockingReadinessCode(code: string): boolean {
  return /(?:^|[._:-])(?:conflict|blocked|permission_blocked)(?:$|[._:-])/u.test(code);
}

function canAutoFocusFirstSuccessTerminal({
  sessionId,
  activeSessionId,
  firstSuccessDraftOpen,
  activityDrawerOpen,
  dialogOpen,
  agentPanelOpen,
  controlPanelOpen,
  activeElement,
}: {
  readonly sessionId: SessionId;
  readonly activeSessionId: SessionId | null;
  readonly firstSuccessDraftOpen: boolean;
  readonly activityDrawerOpen: boolean;
  readonly dialogOpen: boolean;
  readonly agentPanelOpen: boolean;
  readonly controlPanelOpen: boolean;
  readonly activeElement: Element | null;
}): boolean {
  if (!firstSuccessDraftOpen) return false;
  if (sessionId !== activeSessionId) return false;
  if (activityDrawerOpen || dialogOpen || agentPanelOpen || controlPanelOpen) return false;
  return !isTextEntryElement(activeElement);
}

function isTextEntryElement(element: Element | null): boolean {
  if (!(element instanceof HTMLElement)) return false;
  if (element.isContentEditable) return true;
  return element.matches('input, textarea, select, [contenteditable="true"]');
}

function createFirstSuccessClientAttemptKey(sequence: number): string {
  return `first_signal_${Date.now()}_${sequence}`;
}

function toErroredFirstSuccessState(
  state: FirstSuccessState,
  errorCode: string,
): FirstSuccessState {
  if (state.phase === 'errored') return { ...state, errorCode };
  return {
    ...state,
    errorCode,
    phase: 'errored',
    phaseHistory: [...state.phaseHistory, 'errored'],
  };
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
  chip,
  connecting,
  disconnecting,
  onConnect,
  onDisconnect,
  onConnectChip,
  onDisconnectChip,
  onDownload,
}: {
  event: ControlProfileOpenedEvent;
  download: ControlProfileDownloadState;
  chip: ControlProfileChipState;
  connecting: boolean;
  disconnecting: boolean;
  onConnect(): void;
  onDisconnect(): void;
  onConnectChip(): void;
  onDisconnectChip(): void;
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
  const chipConnected = chip.phase === 'connected';
  const chipBusy = chip.phase === 'connecting' || chip.phase === 'disconnecting';

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
        <div className="grid grid-cols-2 gap-2">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={onConnectChip}
            disabled={chipBusy || chipConnected}
          >
            {chip.phase === 'connecting'
              ? t('controlProfile.chip.connecting')
              : t('controlProfile.chip.connect')}
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={onDisconnectChip}
            disabled={chipBusy || !chipConnected}
          >
            {chip.phase === 'disconnecting'
              ? t('controlProfile.chip.disconnecting')
              : t('controlProfile.chip.disconnect')}
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

      <ChipStatusPanel chip={chip} />

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

type ControlProfileChipState =
  | { phase: 'idle' }
  | { phase: 'connecting' }
  | { phase: 'connected'; probe: ControlProfileChipProbePayload }
  | { phase: 'disconnecting'; probe: ControlProfileChipProbePayload }
  | { phase: 'disconnected' }
  | { phase: 'failed'; error: string; probe?: ControlProfileChipProbePayload };

function ChipStatusPanel({ chip }: { chip: ControlProfileChipState }): React.ReactElement {
  const t = useT();
  const probe = 'probe' in chip ? chip.probe : undefined;
  const status = describeChipPhase(chip, t);
  return (
    <div className="mt-3 rounded border border-gray-800 bg-gray-950/50 px-3 py-2 text-xs text-gray-200">
      <div className="flex items-center justify-between gap-2">
        <span className="text-gray-400">{t('controlProfile.chip.status')}</span>
        <span className="shrink-0 text-gray-100">{status}</span>
      </div>
      {probe ? (
        <div className="mt-1 min-w-0 truncate text-gray-400">
          {probe.target ? `${probe.target} / ${probe.probeId}` : probe.probeId}
        </div>
      ) : null}
      {chip.phase === 'failed' ? (
        <div className="mt-1 break-words text-red-200">{chip.error}</div>
      ) : null}
    </div>
  );
}

function describeChipPhase(chip: ControlProfileChipState, t: ReturnType<typeof useT>): string {
  switch (chip.phase) {
    case 'idle':
      return t('controlProfile.chip.idle');
    case 'connecting':
      return t('controlProfile.chip.connecting');
    case 'connected':
      return t('controlProfile.chip.connected');
    case 'disconnecting':
      return t('controlProfile.chip.disconnecting');
    case 'disconnected':
      return t('controlProfile.chip.disconnected');
    case 'failed':
      return t('controlProfile.chip.failed');
  }
}

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
          data-testid="control-profile-progress"
          className={`h-full ${barClass} motion-safe:transition-[width] motion-safe:duration-200 motion-safe:ease-out`}
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
  void download;
  return null;
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
      return download.result.summary.verified
        ? t('controlProfile.download.verifiedComplete')
        : t('controlProfile.download.unverifiedComplete');
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
  if (download.phase === 'succeeded') return 100;

  const progress = getCurrentFlashProgress(download);
  if (progress?.percent !== undefined) return clampPercent(progress.percent);
  return 0;
}

function getCurrentFlashProgress(download: ControlProfileDownloadState): FlashProgressView | null {
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
