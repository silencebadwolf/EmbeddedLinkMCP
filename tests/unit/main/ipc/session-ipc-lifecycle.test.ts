/** Session IPC lifecycle broadcast tests. */

import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ISession, SessionWriteOptions } from '../../../../src/core/session/types.js';
import { SessionManager } from '../../../../src/core/session/session-manager.js';
import type { ReadResult, SequenceCursor, TranscriptEvent } from '../../../../src/core/transcript/types.js';
import { IPC_CHANNELS } from '../../../../src/shared/ipc-protocol.js';
import type { Origin, SessionId, SessionState } from '../../../../src/shared/types.js';

const { handlers, ipcMainMock, browserWindowMock, windows } = vi.hoisted(() => {
  const map = new Map<string, (event: unknown, payload: unknown) => unknown>();
  const windowList: Array<{ webContents: unknown }> = [];
  return {
    handlers: map,
    windows: windowList,
    ipcMainMock: {
      handle: vi.fn((channel: string, fn: (event: unknown, payload: unknown) => unknown) => {
        map.set(channel, fn);
      }),
      removeHandler: vi.fn((channel: string) => {
        map.delete(channel);
      }),
    },
    browserWindowMock: {
      getAllWindows: vi.fn(() => windowList),
    },
  };
});

const electronMock = { app: {}, BrowserWindow: browserWindowMock, ipcMain: ipcMainMock };
globalThis.__linktermElectronMock = electronMock;

vi.mock('electron', () => ({ default: electronMock, ...electronMock }));

interface WebContentsMock {
  id: number;
  isDestroyed: ReturnType<typeof vi.fn>;
  send: ReturnType<typeof vi.fn>;
  once: ReturnType<typeof vi.fn>;
}

class StateOnlySession extends EventEmitter implements ISession {
  readonly id: SessionId;
  #state: SessionState = 'idle';

  constructor(id: SessionId) {
    super();
    this.id = id;
  }

  get state(): SessionState {
    return this.#state;
  }

  async open(): Promise<void> {
    this.setState('open');
  }

  async close(): Promise<void> {
    this.setState('closed');
  }

  async write(_data: Uint8Array, _options: SessionWriteOptions): Promise<void> {
    return;
  }

  read(cursor: SequenceCursor): ReadResult {
    return { events: [], cursor, truncated: false, oldestAvailableSequence: 0 };
  }

  clear(_origin: Origin): TranscriptEvent {
    throw new Error('clear is not used by this test');
  }

  setState(next: SessionState): void {
    if (this.#state === next) return;
    this.#state = next;
    this.emit('state', next);
  }
}

let registerSessionIpc: typeof import('../../../../src/main/ipc/session-ipc.js').registerSessionIpc;

describe('registerSessionIpc lifecycle broadcasts', () => {
  beforeEach(async () => {
    vi.resetModules();
    ({ registerSessionIpc } = await import('../../../../src/main/ipc/session-ipc.js'));
    handlers.clear();
    ipcMainMock.handle.mockClear();
    ipcMainMock.removeHandler.mockClear();
    browserWindowMock.getAllWindows.mockClear();
    windows.length = 0;
  });

  it('broadcasts stateChanged when SessionManager emits session:state without a transcript state event', () => {
    const sessionManager = new SessionManager();
    const dispose = registerSessionIpc(sessionManager);
    const webContents: WebContentsMock = {
      id: 7,
      isDestroyed: vi.fn(() => false),
      send: vi.fn(),
      once: vi.fn(),
    };
    windows.push({ webContents });

    const session = sessionManager.create((id) => new StateOnlySession(id), {
      connectionType: 'rtt-log',
      label: 'RTT ch0',
      createdBy: 'ai',
      rttLog: { probeId: 'probe-1', channelIndex: 0 },
    }) as StateOnlySession;
    webContents.send.mockClear();

    session.setState('open');

    expect(webContents.send).toHaveBeenCalledWith(
      IPC_CHANNELS.SESSION_LIFECYCLE,
      {
        type: 'stateChanged',
        session: expect.objectContaining({
          sessionId: session.id,
          state: 'open',
          connectionType: 'rtt-log',
          label: 'RTT ch0',
          createdBy: 'ai',
          rttLog: { probeId: 'probe-1', channelIndex: 0 },
        }),
      },
    );

    dispose();
  });
});
