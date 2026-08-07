import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { appMock, createMainWindowMock, registerIpcHandlersMock } = vi.hoisted(() => ({
  appMock: {
    requestSingleInstanceLock: vi.fn(() => true),
    whenReady: vi.fn(() => Promise.resolve()),
    on: vi.fn(),
    quit: vi.fn(),
    exit: vi.fn(),
  },
  createMainWindowMock: vi.fn(),
  registerIpcHandlersMock: vi.fn(),
}));

vi.mock('../../../src/main/electron-runtime.js', () => ({
  electron: { app: appMock },
}));

vi.mock('../../../src/main/app-lifecycle.js', () => ({
  createMainWindow: createMainWindowMock,
  handleWindowClose: vi.fn(),
}));

vi.mock('../../../src/main/ipc/index.js', () => ({
  registerIpcHandlers: registerIpcHandlersMock,
}));

vi.mock('../../../src/main/startup-mode.js', () => ({
  isMcpStdioMode: vi.fn(() => false),
  shouldCreateMainWindow: vi.fn(() => true),
  shouldQuitForMissingSingleInstanceLock: vi.fn(() => false),
}));

vi.mock('../../../src/mcp/runtime-metadata.js', () => ({
  runtimeMetadataPath: vi.fn(() => 'C:\\mock\\mcp-runtime.json'),
}));

vi.mock('../../../src/mcp/stdio-proxy.js', () => ({
  startMcpStdioProxy: vi.fn(),
}));

vi.mock('../../../src/mcp/electron-runtime-launcher-core.js', () => ({
  waitForHealthyRuntimeMetadata: vi.fn(),
}));

describe('Electron main startup', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    appMock.requestSingleInstanceLock.mockReturnValue(true);
    appMock.whenReady.mockReturnValue(Promise.resolve());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('reports a fatal initialization error and exits instead of leaving a headless process', async () => {
    const startupError = new Error('runtime port unavailable');
    registerIpcHandlersMock.mockRejectedValueOnce(startupError);
    const stderrWrite = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    await import('../../../src/main/index.js');

    await vi.waitFor(() => {
      expect(appMock.exit).toHaveBeenCalledWith(1);
    });
    expect(createMainWindowMock).not.toHaveBeenCalled();
    expect(stderrWrite).toHaveBeenCalledWith(expect.stringContaining('runtime port unavailable'));
  });
});
