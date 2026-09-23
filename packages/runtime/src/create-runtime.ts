import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { ActivityHealthMonitor } from './core/activity/activity-health.js';
import { OperationLedger } from './core/activity/operation-ledger.js';
import { AuditStore } from './core/activity/audit-store.js';
import {
  OperationRecorder,
  type OperationRecorderProvider,
} from './core/activity/operation-recorder.js';
import {
  CompensationCandidateService,
  type VerifiedDeploymentEvidence,
} from './core/compensation/index.js';
import { ControlWorkflowJobManager } from './core/control-workflow/job-manager.js';
import { OperationAdmissionCoordinator } from './core/operation-admission/operation-admission-coordinator.js';
import { JLinkVcomRecoveryService } from './core/recovery/jlink-vcom-recovery-service.js';
import { SessionManager } from './core/session/session-manager.js';
import { SerialSessionCoordinator } from './core/session/serial-session-coordinator.js';
import { buildSession } from './core/session/factory.js';
import {
  FirstSignalObservationService,
  type FirstSignalObservableSession,
} from './core/session/first-signal-observation/first-signal-observation-service.js';
import {
  ControlProfileManager,
  ControlProfileRecordManager,
  WorkspaceConfigManager,
} from './core/workspace/index.js';
import { ConnectionProfileManager } from './core/connections/index.js';
import { JLinkAdapter, createJLinkDeviceCatalog } from './jlink/index.js';
import { SerialDiscovery } from './transports/serial/serial-discovery.js';
import { createAndOpenSession } from './services/session-open.js';
import { createRuntimeReadinessService } from './services/readiness.js';
import type { RuntimeOptions } from './ports.js';
import { acquireRuntimeOwnership } from './services/ownership.js';

/** One host-owned application runtime, shared by every UI and MCP adapter. */
export async function createRuntime(options: RuntimeOptions) {
  const ownership = await acquireRuntimeOwnership(options.dataDir);
  try {
    const runtime = await createOwnedRuntime(options);
    let disposing: Promise<void> | undefined;
    return { ...runtime, dispose: () => disposing ??= (async () => {
      await runtime.dispose();
      await ownership.release();
    })() };
  } catch (error) { await ownership.release(); throw error; }
}

async function createOwnedRuntime(options: RuntimeOptions) {
  const dataDir = path.resolve(options.dataDir);
  const serialDiscovery = new SerialDiscovery({ listFn: options.nativeBindings.listSerialPorts });
  const sessionManager = new SessionManager({
    sessionFactory:
      options.sessionFactory ?? ((id, config) => buildSession(id, config, options.nativeBindings)),
  });
  const serialSessionCoordinator = new SerialSessionCoordinator(sessionManager);
  const workspaceEvidenceFn = async () => ({ serialPorts: await serialDiscovery.listPorts() });
  const workspaceConfigManager = new WorkspaceConfigManager({ evidenceFn: workspaceEvidenceFn });
  const controlProfileManager = new ControlProfileManager();
  const controlProfileRecordManager = new ControlProfileRecordManager({
    filePath: path.join(dataDir, 'control-profiles.json'),
  });
  const connectionProfileManager = new ConnectionProfileManager({
    filePath: path.join(dataDir, 'connections.json'),
    secretCodec: options.secretCodec,
  });
  const ownedJLinkAdapter = options.jlinkBackend === undefined ? new JLinkAdapter() : undefined;
  const jlinkBackend = options.jlinkBackend ?? ownedJLinkAdapter!;
  const vcomControl = options.vcomControl ?? ownedJLinkAdapter;
  const jlinkDeviceCatalog = options.jlinkDeviceCatalog ?? createJLinkDeviceCatalog();
  const jlinkVcomRecoveryService =
    vcomControl === undefined
      ? undefined
      : new JLinkVcomRecoveryService({
          controlProfileManager,
          recordManager: controlProfileRecordManager,
          serialDiscovery,
          jlinkBackend,
          vcomControl,
          openSerial: ({ port, baudRate, mode, label }) =>
            createAndOpenSession(
              sessionManager,
              { type: 'serial', port, baudRate, mode },
              label,
              serialSessionCoordinator,
            ),
        });
  const activityHealth = new ActivityHealthMonitor();
  const operationLedger = new OperationLedger({ health: activityHealth });
  const auditStore = new AuditStore({
    directory: path.join(dataDir, 'activity'),
    onWarning: () => activityHealth.recordCaptureFailure('provider', 'capture-failed', 0),
  });
  const operationRecorder = new OperationRecorder({
    ledger: operationLedger,
    health: activityHealth,
  });
  const compensationCandidateService = new CompensationCandidateService();
  const onVerifiedDeployment = (evidence: VerifiedDeploymentEvidence): void => {
    compensationCandidateService.recordDeployment(evidence);
  };
  const controlWorkflowJobManager = new ControlWorkflowJobManager({
    observer: (observation) => operationRecorder.observeWorkflowJob(observation),
  });
  const operationRecorderProvider: OperationRecorderProvider = (input) =>
    operationRecorder.beginMcpCall(input);
  const firstSignalObservationService = new FirstSignalObservationService({
    resolveSession: (sessionId) => {
      const session = sessionManager.get(sessionId);
      return session !== undefined &&
        typeof (session as FirstSignalObservableSession).off === 'function'
        ? (session as FirstSignalObservableSession)
        : undefined;
    },
    now: () => new Date().toISOString(),
    nowMs: () => Date.now(),
    createAttemptId: () => `attempt_${randomUUID()}`,
    terminalRetentionMs: 30_000,
  });
  const operationAdmissionCoordinator = new OperationAdmissionCoordinator({
    runtimeId: `operation_admission_runtime_${randomUUID().replaceAll('-', '')}`,
    now: () => new Date().toISOString(),
    createLeaseId: () => `lease_${randomUUID().replaceAll('-', '')}`,
  });
  const runtimeReadinessService = createRuntimeReadinessService({
    getRuntimeStatus:
      options.getRuntimeStatus ?? (async () => ({ codeFresh: true, runtimeFresh: true })),
    agentIntegrations: options.agentIntegrations ?? { listStatuses: async () => [] },
    serialDiscovery,
    sessionManager,
    controlProfileManager,
    controlProfileRecordManager,
    jlinkBackend,
    jlinkDeviceCatalog,
    compensationCandidateService,
  });
  let unsubscribeAudit: (() => void) | undefined;
  let disposePromise: Promise<void> | undefined;
  const dispose = (): Promise<void> => {
    disposePromise ??= (async () => {
      sessionManager.beginShutdown();
      firstSignalObservationService.shutdown();
      await controlWorkflowJobManager.shutdown();
      const results = await Promise.allSettled([
        sessionManager.destroyAll(),
        ownedJLinkAdapter?.dispose() ?? options.disposeJLinkBackend?.() ?? Promise.resolve(),
      ]);
      serialDiscovery.dispose();
      unsubscribeAudit?.();
      await auditStore.dispose();
      const failures = results.filter(
        (result): result is PromiseRejectedResult => result.status === 'rejected',
      );
      if (failures.length > 0)
        throw new AggregateError(
          failures.map((result) => result.reason),
          'Runtime resource disposal failed',
        );
    })();
    return disposePromise;
  };
  try {
    await auditStore.initialize();
    unsubscribeAudit = operationLedger.subscribe((event) => auditStore.enqueue(event));
  } catch (error) {
    await dispose().catch(() => undefined);
    throw error;
  }
  return {
    dataDir,
    serialDiscovery,
    sessionManager,
    serialSessionCoordinator,
    workspaceConfigManager,
    workspaceEvidenceFn,
    controlProfileManager,
    controlProfileRecordManager,
    connectionProfileManager,
    jlinkBackend,
    jlinkDeviceCatalog,
    jlinkVcomRecoveryService,
    controlWorkflowJobManager,
    operationLedger,
    auditStore,
    operationRecorderProvider,
    runtimeReadinessService,
    firstSignalObservationService,
    operationAdmissionCoordinator,
    compensationCandidateService,
    onVerifiedDeployment,
    dispose,
  };
}

export type Runtime = Awaited<ReturnType<typeof createRuntime>>;
