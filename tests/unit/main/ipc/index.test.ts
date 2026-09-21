import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const {
  appMock,
  buildTargetsMock,
  startHttpMock,
  readOrCreateSettingsMock,
  writeSettingsMock,
  agentManagerCtorMock,
  tokenEnvWriterMock,
  safeStorageMock,
  createMcpServerMock,
  jlinkProbeDetectMock,
  jlinkCatalogHasMock,
  createJLinkDeviceCatalogMock,
  unregisterActivityIpcMock,
  registerActivityIpcMock,
  unregisterAuditIpcMock,
  registerAuditIpcMock,
  unregisterReadinessIpcMock,
  registerReadinessIpcMock,
  unregisterFirstSignalIpcMock,
  registerFirstSignalIpcMock,
} = vi.hoisted(() => ({
  appMock: {
    getPath: vi.fn((name: string) => {
      const paths: Record<string, string> = {
        appData: 'C:\\Users\\A\\AppData\\Roaming',
        home: 'C:\\Users\\A',
        userData: 'C:\\Users\\A\\AppData\\Roaming\\linkterm-v2',
      };
      return paths[name] ?? `C:\\mock\\${name}`;
    }),
    getAppPath: vi.fn(() => 'C:\\Users\\Admin\\Desktop\\Code\\link-terminal'),
    isPackaged: false,
  },
  buildTargetsMock: vi.fn(async () => []),
  startHttpMock: vi.fn(async () => ({
    url: 'http://127.0.0.1:57371/mcp',
    token: 'stable-token',
    port: 57371,
    close: vi.fn(async () => undefined),
  })),
  readOrCreateSettingsMock: vi.fn(async () => ({
    schemaVersion: 'linkterm-mcp-http-settings/1.0.0',
    host: '127.0.0.1',
    port: 57371,
    token: 'abcdefghijklmnopqrstuvwxyz1234567890_stable',
  })),
  writeSettingsMock: vi.fn(async () => undefined),
  agentManagerCtorMock: vi.fn(),
  tokenEnvWriterMock: { writeTokenEnv: vi.fn() },
  safeStorageMock: {
    isEncryptionAvailable: vi.fn(() => false),
    encryptString: vi.fn((value: string) => Buffer.from(value, 'utf-8')),
    decryptString: vi.fn((value: Buffer) => value.toString('utf-8')),
  },
  createMcpServerMock: vi.fn(() => ({
    start: vi.fn(async () => undefined),
    stop: vi.fn(async () => undefined),
  })),
  jlinkProbeDetectMock: vi.fn(async () => []),
  jlinkCatalogHasMock: vi.fn(async () => true),
  createJLinkDeviceCatalogMock: vi.fn(() => ({
    search: vi.fn(async () => ({ available: true, devices: [], sourceFiles: [] })),
    get: vi.fn(async () => undefined),
    has: jlinkCatalogHasMock,
    refresh: vi.fn(async () => undefined),
  })),
  unregisterActivityIpcMock: vi.fn(),
  registerActivityIpcMock: vi.fn(() => unregisterActivityIpcMock),
  unregisterAuditIpcMock: vi.fn(),
  registerAuditIpcMock: vi.fn(() => unregisterAuditIpcMock),
  unregisterReadinessIpcMock: vi.fn(),
  registerReadinessIpcMock: vi.fn(() => unregisterReadinessIpcMock),
  unregisterFirstSignalIpcMock: vi.fn(),
  registerFirstSignalIpcMock: vi.fn(() => unregisterFirstSignalIpcMock),
}));

const electronMock = {
  app: appMock,
  BrowserWindow: { getAllWindows: vi.fn(() => []) },
  safeStorage: safeStorageMock,
};

globalThis.__linktermElectronMock = electronMock;

vi.mock('electron', () => ({
  default: electronMock,
  ...electronMock,
}));

vi.mock('../../../../src/main/ipc/agent-integration-targets.js', () => ({
  buildDefaultAgentIntegrationTargets: buildTargetsMock,
}));

vi.mock('@linkterm/mcp/http-runtime-server', () => ({
  startMcpHttpRuntimeServer: startHttpMock,
}));

vi.mock('@linkterm/mcp/index', () => ({
  createMcpServer: createMcpServerMock,
}));

vi.mock('@linkterm/runtime/jlink/index', () => ({
  JLinkAdapter: vi.fn(function JLinkAdapter() {
    return {
      probeDetect: jlinkProbeDetectMock,
      dispose: vi.fn(async () => undefined),
    };
  }),
  createJLinkDeviceCatalog: createJLinkDeviceCatalogMock,
}));

vi.mock('@linkterm/mcp/runtime-metadata', async () => {
  const actual = await vi.importActual<typeof import('@linkterm/mcp/runtime-metadata')>(
    '@linkterm/mcp/runtime-metadata',
  );
  return {
    ...actual,
    readOrCreateRuntimeHttpSettings: readOrCreateSettingsMock,
    writeRuntimeHttpSettings: writeSettingsMock,
  };
});

vi.mock('@linkterm/runtime/core/agent-integrations/index', async () => {
  const actual = await vi.importActual<
    typeof import('@linkterm/runtime/core/agent-integrations/index')
  >('@linkterm/runtime/core/agent-integrations/index');
  return {
    ...actual,
    AgentIntegrationManager: vi.fn(function AgentIntegrationManager(options) {
      agentManagerCtorMock(options);
      return { listStatuses: vi.fn(async () => []), install: vi.fn() };
    }),
  };
});

vi.mock('../../../../src/main/ipc/codex-token-env.js', () => ({
  createCodexTokenEnvWriter: vi.fn(() => tokenEnvWriterMock),
}));

vi.mock('../../../../src/main/ipc/wsl-agent-config-file-bridge.js', () => ({
  createWslAgentConfigFileBridge: vi.fn(() => ({})),
}));

vi.mock('../../../../src/main/ipc/serial-ipc.js', () => ({
  registerSerialIpc: vi.fn(() => vi.fn()),
}));
vi.mock('../../../../src/main/ipc/session-ipc.js', () => ({
  registerSessionIpc: vi.fn(() => vi.fn()),
}));
vi.mock('../../../../src/main/ipc/session-create-handler.js', () => ({
  registerSessionCreate: vi.fn(() => vi.fn()),
}));
vi.mock('../../../../src/main/ipc/rtt-log-session-ipc.js', () => ({
  registerRttLogSessionIpc: vi.fn(() => vi.fn()),
}));
vi.mock('../../../../src/main/ipc/jlink-device-catalog-ipc.js', () => ({
  registerJLinkDeviceCatalogIpc: vi.fn(() => vi.fn()),
}));
vi.mock('../../../../src/main/ipc/connection-profiles-ipc.js', () => ({
  registerConnectionProfilesIpc: vi.fn(() => vi.fn()),
}));
vi.mock('../../../../src/main/ipc/agent-integrations-ipc.js', () => ({
  registerAgentIntegrationsIpc: vi.fn(() => vi.fn()),
}));
vi.mock('../../../../src/main/ipc/control-profile-ipc.js', () => ({
  registerControlProfileIpc: vi.fn(() => vi.fn()),
}));
vi.mock('../../../../src/main/ipc/activity-ipc.js', () => ({
  registerActivityIpc: registerActivityIpcMock,
}));
vi.mock('../../../../src/main/ipc/audit-ipc.js', () => ({
  registerAuditIpc: registerAuditIpcMock,
}));
vi.mock('../../../../src/main/ipc/readiness-ipc.js', () => ({
  registerReadinessIpc: registerReadinessIpcMock,
}));
vi.mock('../../../../src/main/ipc/first-signal-ipc.js', () => ({
  registerFirstSignalIpc: registerFirstSignalIpcMock,
}));

describe('registerIpcHandlers HTTP MCP wiring', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    jlinkProbeDetectMock.mockResolvedValue([]);
    jlinkCatalogHasMock.mockResolvedValue(true);
  });

  it('uses stable HTTP settings for the runtime and Codex targets', async () => {
    const { registerIpcHandlers } = await import('../../../../src/main/ipc/index.js');
    const { registerControlProfileIpc } =
      await import('../../../../src/main/ipc/control-profile-ipc.js');

    const context = await registerIpcHandlers({ autoStartMcp: false });

    expect(readOrCreateSettingsMock).toHaveBeenCalledWith(
      'C:\\Users\\A\\AppData\\Roaming\\linkterm-v2\\mcp-http-settings.json',
    );
    expect(startHttpMock).toHaveBeenCalledWith(
      expect.objectContaining({
        metadataPath: 'C:\\Users\\A\\AppData\\Roaming\\linkterm-v2\\mcp-runtime.json',
        port: 57371,
        token: 'abcdefghijklmnopqrstuvwxyz1234567890_stable',
        controlProfileRecordManager: context.controlProfileRecordManager,
      }),
    );
    expect(registerControlProfileIpc).toHaveBeenCalledWith(
      context.controlProfileManager,
      context.controlProfileRecordManager,
      expect.objectContaining({
        sessionManager: context.sessionManager,
        jlinkBackend: context.jlinkBackend,
        jlinkDeviceCatalog: context.jlinkDeviceCatalog,
        compensationCandidateService: expect.any(Object),
      }),
    );
    expect(buildTargetsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        httpTransport: {
          url: 'http://localhost:57371/mcp',
          bearerTokenEnvVar: 'LINKTERM_MCP_TOKEN',
        },
      }),
    );
    expect(agentManagerCtorMock).toHaveBeenCalledWith(
      expect.objectContaining({
        tokenEnvWriter: tokenEnvWriterMock,
      }),
    );
    expect(writeSettingsMock).not.toHaveBeenCalled();

    await context.dispose();
  });

  it('persists a fallback port and uses it for external agent targets', async () => {
    startHttpMock.mockResolvedValueOnce({
      url: 'http://127.0.0.1:58432/mcp',
      token: 'abcdefghijklmnopqrstuvwxyz1234567890_stable',
      port: 58432,
      close: vi.fn(async () => undefined),
    });
    const { registerIpcHandlers } = await import('../../../../src/main/ipc/index.js');

    const context = await registerIpcHandlers({ autoStartMcp: false });

    expect(writeSettingsMock).toHaveBeenCalledWith(
      'C:\\Users\\A\\AppData\\Roaming\\linkterm-v2\\mcp-http-settings.json',
      {
        schemaVersion: 'linkterm-mcp-http-settings/1.0.0',
        host: '127.0.0.1',
        port: 58432,
        token: 'abcdefghijklmnopqrstuvwxyz1234567890_stable',
      },
    );
    expect(buildTargetsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        httpTransport: {
          url: 'http://localhost:58432/mcp',
          bearerTokenEnvVar: 'LINKTERM_MCP_TOKEN',
        },
      }),
    );

    await context.dispose();
  });

  it('composes one Main-owned activity runtime for direct MCP, HTTP MCP, and activity IPC', async () => {
    const { registerIpcHandlers } = await import('../../../../src/main/ipc/index.js');

    const context = await registerIpcHandlers({ autoStartMcp: false });
    const directOptions = createMcpServerMock.mock.calls[0]?.[0] as {
      operationRecorderProvider?: unknown;
      controlWorkflowJobManager?: unknown;
    };
    const httpOptions = startHttpMock.mock.calls[0]?.[0] as {
      operationRecorderProvider?: unknown;
      controlWorkflowJobManager?: unknown;
    };

    expect(context.operationLedger.snapshot()).toMatchObject({
      cursor: { runtimeId: expect.any(String), sequence: 0 },
      events: [],
      operations: [],
      calls: [],
    });
    expect(registerActivityIpcMock).toHaveBeenCalledWith(context.operationLedger);
    expect(directOptions.operationRecorderProvider).toEqual(expect.any(Function));
    expect(httpOptions.operationRecorderProvider).toBe(directOptions.operationRecorderProvider);
    expect(directOptions.controlWorkflowJobManager).toBe(context.controlWorkflowJobManager);
    expect(httpOptions.controlWorkflowJobManager).toBe(context.controlWorkflowJobManager);
    expect(context).not.toHaveProperty('operationRecorder');
    expect(context).not.toHaveProperty('activityHealth');
    expect(context).not.toHaveProperty('rawActivityEvents');

    await context.dispose();

    expect(unregisterActivityIpcMock).toHaveBeenCalledTimes(1);
  });

  it('creates a fresh in-memory activity runtime for each Main context', async () => {
    const { registerIpcHandlers } = await import('../../../../src/main/ipc/index.js');

    const first = await registerIpcHandlers({ autoStartMcp: false });
    const second = await registerIpcHandlers({ autoStartMcp: false });

    expect(first.operationLedger.snapshot().cursor).toMatchObject({ sequence: 0 });
    expect(second.operationLedger.snapshot().cursor).toMatchObject({ sequence: 0 });
    expect(first.operationLedger.snapshot().cursor.runtimeId).not.toBe(
      second.operationLedger.snapshot().cursor.runtimeId,
    );

    await first.dispose();
    await second.dispose();
  });

  it('composes one Main-owned readiness runtime for renderer startup state', async () => {
    const { registerIpcHandlers } = await import('../../../../src/main/ipc/index.js');

    jlinkProbeDetectMock.mockResolvedValue([
      {
        probeId: 'probe_a',
        label: 'J-Link probe A',
        serialNumber: '123456789',
        target: 'STM32H743',
        connected: false,
      },
    ]);
    const context = await registerIpcHandlers({ autoStartMcp: false });

    expect(registerReadinessIpcMock).toHaveBeenCalledWith(context.runtimeReadinessService);
    expect(context.runtimeReadinessService.getCurrent()).toMatchObject({
      schemaVersion: '1.0.0',
      generation: 0,
      checks: [],
    });
    const refreshed = await context.runtimeReadinessService.refresh();
    expect(refreshed.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'jlink', scope: 'jlink' }),
        expect.objectContaining({ id: 'firmware', scope: 'firmware' }),
        expect.objectContaining({ id: 'rtt', scope: 'rtt' }),
      ]),
    );
    expect(refreshed.deviceCandidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'candidate_jlink_probe_a',
          kind: 'jlink',
          label: 'J-Link probe A · STM32H743',
          requiresUserConfirmation: true,
        }),
      ]),
    );
    expect(jlinkProbeDetectMock).toHaveBeenCalledTimes(1);
    expect(createJLinkDeviceCatalogMock).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(refreshed)).not.toContain('123456789');
    expect(context).not.toHaveProperty('readinessRawProviders');
    expect(context).not.toHaveProperty('rawReadinessEvents');

    await context.dispose();

    expect(unregisterReadinessIpcMock).toHaveBeenCalledTimes(1);
  });

  it('does not report firmware ready when the saved profile points through a workspace symlink', async () => {
    const { registerIpcHandlers } = await import('../../../../src/main/ipc/index.js');
    const root = await mkdtemp(path.join(os.tmpdir(), 'linkterm-readiness-root-'));
    const outside = await mkdtemp(path.join(os.tmpdir(), 'linkterm-readiness-outside-'));
    const userData = await mkdtemp(path.join(os.tmpdir(), 'linkterm-readiness-userdata-'));

    try {
      appMock.getPath.mockImplementation((name: string) => {
        const paths: Record<string, string> = {
          appData: userData,
          home: userData,
          userData,
        };
        return paths[name] ?? path.join(userData, name);
      });
      await mkdir(path.join(root, 'build'));
      await writeFile(path.join(outside, 'app.bin'), Buffer.from([0x00, 0x20, 0x00, 0x20]));
      await symlink(outside, path.join(root, 'build', 'linked'), 'junction');

      const context = await registerIpcHandlers({ autoStartMcp: false });
      const profile = await context.controlProfileManager.init(root, {
        jlink: { enabled: true, target: 'STM32H743II', interface: 'swd' },
        flash: { binary: 'build/linked/app.bin', baseAddress: '0x08000000', verify: true },
      });
      await context.controlProfileRecordManager.save({
        root,
        source: 'manual',
        label: 'symlinked firmware',
        profile,
      });

      const refreshed = await context.runtimeReadinessService.refresh();

      expect(refreshed.checks).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: 'firmware',
            scope: 'firmware',
            status: 'action-required',
          }),
        ]),
      );
      expect(JSON.stringify(refreshed)).not.toContain('app.bin');
      expect(JSON.stringify(refreshed)).not.toContain(outside);

      await context.dispose();
    } finally {
      await rm(root, { recursive: true, force: true });
      await rm(outside, { recursive: true, force: true });
      await rm(userData, { recursive: true, force: true });
    }
  });

  it('keeps compensation candidates Main-owned while projecting readiness summaries', async () => {
    const { registerIpcHandlers } = await import('../../../../src/main/ipc/index.js');
    const { registerControlProfileIpc } =
      await import('../../../../src/main/ipc/control-profile-ipc.js');

    const context = await registerIpcHandlers({ autoStartMcp: false });
    const directOptions = createMcpServerMock.mock.calls[0]?.[0] as {
      onVerifiedDeployment?: (evidence: unknown) => void;
    };
    const httpOptions = startHttpMock.mock.calls[0]?.[0] as {
      onVerifiedDeployment?: (evidence: unknown) => void;
    };
    const controlProfileOptions = vi.mocked(registerControlProfileIpc).mock.calls[0]?.[2] as {
      onVerifiedDeployment?: (evidence: unknown) => void;
    };

    expect(directOptions.onVerifiedDeployment).toEqual(expect.any(Function));
    expect(httpOptions.onVerifiedDeployment).toBe(directOptions.onVerifiedDeployment);
    expect(controlProfileOptions.onVerifiedDeployment).toBe(directOptions.onVerifiedDeployment);

    directOptions.onVerifiedDeployment?.({
      workspace: {
        root: 'C:/repo',
        profile: {
          schemaVersion: 'linkterm-control/1.0.0',
          jlink: { enabled: true, target: 'STM32H743', interface: 'swd', speedKHz: 4000 },
          flash: { binary: 'build/rtthread.bin', baseAddress: '0x08000000', verify: true },
          rtt: { enabled: true, channels: [0], controlBlockAddress: '0x24000000' },
        },
      },
      sourceOperationId: 'operation_1',
      targetLabel: 'STM32H743',
      targetBindingDigest: 'target_digest_1',
      profileRevision: 'profile_revision_1',
      workflowMode: 'flash-observe',
      manifestDigest: 'manifest_digest_1',
      firmware: {
        mainOwnedSourceRef: String.raw`C:\Users\Admin\private\rtthread.bin`,
        displayName: 'rtthread.bin',
        contentSha256: 'a'.repeat(64),
        byteLength: 4096,
        format: 'bin',
        baseAddress: 0x08000000,
      },
      result: {
        flashed: true,
        verified: true,
        observationSucceeded: true,
      },
    });

    const refreshed = await context.runtimeReadinessService.refresh();

    expect(refreshed.compensationCandidates).toEqual([
      expect.objectContaining({
        targetLabel: 'STM32H743',
        firmware: expect.objectContaining({
          displayName: 'rtthread.bin',
          hashSha256Prefix: 'aaaaaaaaaaaaaaaa',
          byteLength: 4096,
        }),
        eligibility: {
          status: 'disabled',
          reasonCode: 'compensation.reflash.evidence_mismatch',
        },
      }),
    ]);
    expect(refreshed.compensationCandidates[0]).not.toHaveProperty('actionCode');
    expect(refreshed.profileSuggestions).toEqual([
      expect.objectContaining({
        profileLabel: 'STM32H743',
        provenance: 'verified-jlink-rtt-success',
        saveActionCode: 'profile.suggestion.save',
        skipActionCode: 'profile.suggestion.skip',
      }),
    ]);
    expect(JSON.stringify(refreshed)).not.toContain('mainOwnedSourceRef');
    expect(JSON.stringify(refreshed)).not.toContain('private');
    expect(context).not.toHaveProperty('compensationCandidates');
    expect(context).not.toHaveProperty('rawCompensationCandidate');

    await context.dispose();
  });

  it('composes one Main-owned first-signal runtime for renderer first-success state', async () => {
    const { registerIpcHandlers } = await import('../../../../src/main/ipc/index.js');

    const context = await registerIpcHandlers({ autoStartMcp: false });

    expect(registerFirstSignalIpcMock).toHaveBeenCalledWith(
      context.firstSignalObservationService,
    );
    expect(context.firstSignalObservationService).toEqual(expect.any(Object));
    expect(context).not.toHaveProperty('rawFirstSignalEvents');
    expect(context).not.toHaveProperty('firstSignalRendererState');

    await context.dispose();

    expect(unregisterFirstSignalIpcMock).toHaveBeenCalledTimes(1);
  });

  it('keeps execution directly observable without an approval IPC surface', async () => {
    const { registerIpcHandlers } = await import('../../../../src/main/ipc/index.js');
    const { registerControlProfileIpc } =
      await import('../../../../src/main/ipc/control-profile-ipc.js');

    const context = await registerIpcHandlers({ autoStartMcp: false });

    expect(registerControlProfileIpc).toHaveBeenCalledWith(
      context.controlProfileManager,
      context.controlProfileRecordManager,
      expect.not.objectContaining({ controlProfileApprovalGate: expect.anything() }),
    );
    expect(context).not.toHaveProperty('approvalIpcService');
    expect(context).not.toHaveProperty('approvalBroker');
    expect(context).not.toHaveProperty('approvalGrants');
    expect(context).not.toHaveProperty('callerPrincipalIds');

    await context.dispose();

  });

  it('watches all compiled main runtime JavaScript artifacts in development', async () => {
    const { runtimeFreshnessArtifactPathsForApp } =
      await import('../../../../src/main/ipc/index.js');

    const artifacts = runtimeFreshnessArtifactPathsForApp({
      appPath: 'C:\\Users\\Admin\\Desktop\\Code\\link-terminal',
      isPackaged: false,
      relativeFiles: [
        'dist/main/main/index.js',
        'dist/main/jlink/jlink-adapter.js',
        'dist/main/mcp/surfaces/debug/tools-binary.js',
        'dist/renderer/assets/index.js',
        'packages/runtime/src/jlink/jlink-adapter.ts',
      ],
    });

    expect(artifacts).toContain(
      'C:\\Users\\Admin\\Desktop\\Code\\link-terminal\\dist\\main\\main\\index.js',
    );
    expect(artifacts).toContain(
      'C:\\Users\\Admin\\Desktop\\Code\\link-terminal\\dist\\main\\jlink\\jlink-adapter.js',
    );
    expect(artifacts).toContain(
      'C:\\Users\\Admin\\Desktop\\Code\\link-terminal\\dist\\main\\mcp\\surfaces\\debug\\tools-binary.js',
    );
    expect(artifacts).not.toContain(
      'C:\\Users\\Admin\\Desktop\\Code\\link-terminal\\dist\\renderer\\assets\\index.js',
    );
    expect(artifacts).not.toContain(
      'C:\\Users\\Admin\\Desktop\\Code\\link-terminal\\src\\jlink\\jlink-adapter.ts',
    );
  });
});
