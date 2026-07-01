import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  appMock,
  buildTargetsMock,
  startHttpMock,
  readOrCreateSettingsMock,
  agentManagerCtorMock,
  tokenEnvWriterMock,
  safeStorageMock,
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
  agentManagerCtorMock: vi.fn(),
  tokenEnvWriterMock: { writeTokenEnv: vi.fn() },
  safeStorageMock: {
    isEncryptionAvailable: vi.fn(() => false),
    encryptString: vi.fn((value: string) => Buffer.from(value, 'utf-8')),
    decryptString: vi.fn((value: Buffer) => value.toString('utf-8')),
  },
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

vi.mock('../../../../src/mcp/http-runtime-server.js', () => ({
  startMcpHttpRuntimeServer: startHttpMock,
}));

vi.mock('../../../../src/mcp/runtime-metadata.js', async () => {
  const actual = await vi.importActual<typeof import('../../../../src/mcp/runtime-metadata.js')>(
    '../../../../src/mcp/runtime-metadata.js',
  );
  return {
    ...actual,
    readOrCreateRuntimeHttpSettings: readOrCreateSettingsMock,
  };
});

vi.mock('../../../../src/core/agent-integrations/index.js', async () => {
  const actual = await vi.importActual<typeof import('../../../../src/core/agent-integrations/index.js')>(
    '../../../../src/core/agent-integrations/index.js',
  );
  return {
    ...actual,
    AgentIntegrationManager: vi.fn(function AgentIntegrationManager(options) {
      agentManagerCtorMock(options);
      return { listStatuses: vi.fn(), install: vi.fn() };
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

describe('registerIpcHandlers HTTP MCP wiring', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uses stable HTTP settings for the runtime and Codex targets', async () => {
    const { registerIpcHandlers } = await import('../../../../src/main/ipc/index.js');

    const context = await registerIpcHandlers({ autoStartMcp: false });

    expect(readOrCreateSettingsMock).toHaveBeenCalledWith(
      'C:\\Users\\A\\AppData\\Roaming\\linkterm-v2\\mcp-http-settings.json',
    );
    expect(startHttpMock).toHaveBeenCalledWith(expect.objectContaining({
      metadataPath: 'C:\\Users\\A\\AppData\\Roaming\\linkterm-v2\\mcp-runtime.json',
      port: 57371,
      token: 'abcdefghijklmnopqrstuvwxyz1234567890_stable',
    }));
    expect(buildTargetsMock).toHaveBeenCalledWith(expect.objectContaining({
      httpTransport: {
        url: 'http://localhost:57371/mcp',
        bearerTokenEnvVar: 'LINKTERM_MCP_TOKEN',
      },
    }));
    expect(agentManagerCtorMock).toHaveBeenCalledWith(expect.objectContaining({
      tokenEnvWriter: tokenEnvWriterMock,
    }));

    await context.dispose();
  });

  it('watches all compiled main runtime JavaScript artifacts in development', async () => {
    const { runtimeFreshnessArtifactPathsForApp } = await import('../../../../src/main/ipc/index.js');

    const artifacts = runtimeFreshnessArtifactPathsForApp({
      appPath: 'C:\\Users\\Admin\\Desktop\\Code\\link-terminal',
      isPackaged: false,
      relativeFiles: [
        'dist/main/main/index.js',
        'dist/main/jlink/jlink-adapter.js',
        'dist/main/mcp/surfaces/debug/tools-binary.js',
        'dist/renderer/assets/index.js',
        'src/jlink/jlink-adapter.ts',
      ],
    });

    expect(artifacts).toContain('C:\\Users\\Admin\\Desktop\\Code\\link-terminal\\dist\\main\\main\\index.js');
    expect(artifacts).toContain('C:\\Users\\Admin\\Desktop\\Code\\link-terminal\\dist\\main\\jlink\\jlink-adapter.js');
    expect(artifacts).toContain('C:\\Users\\Admin\\Desktop\\Code\\link-terminal\\dist\\main\\mcp\\surfaces\\debug\\tools-binary.js');
    expect(artifacts).not.toContain('C:\\Users\\Admin\\Desktop\\Code\\link-terminal\\dist\\renderer\\assets\\index.js');
    expect(artifacts).not.toContain('C:\\Users\\Admin\\Desktop\\Code\\link-terminal\\src\\jlink\\jlink-adapter.ts');
  });
});
