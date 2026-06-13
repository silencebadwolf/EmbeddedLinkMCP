/**
 * 类型化的 `window.linkterm` mock 工厂。
 *
 * 每个 renderer 测试在 beforeEach 调用 `installMockPreload()`，得到一个可观察 mock；
 * 测试用 `mock.session.create.mockResolvedValueOnce(...)` 配置预期返回值。
 */

import { vi } from 'vitest';
import type {
  PreloadAPI,
  PreloadResult,
  SessionReadSuccess,
  TranscriptSubscribeSuccess,
  Unsubscribe,
} from '../../src/shared/preload-api.js';
import type { TranscriptEventEnvelope } from '../../src/shared/transcript-ipc-types.js';
import type { SerialPortInfo } from '../../src/shared/types.js';

/** 可观测的 mock preload API；所有方法都是 vi.fn()。 */
export interface MockPreloadAPI {
  api: PreloadAPI;
  /** 测试可调用此函数模拟主进程推送 transcript 事件。 */
  emitTranscript(envelope: TranscriptEventEnvelope): void;
  /** 测试可调用此函数模拟串口插拔变化。 */
  emitPortChange(ports: ReadonlyArray<SerialPortInfo>): void;
  /** 详细的 spy 对象。 */
  spies: {
    session: {
      create: ReturnType<typeof vi.fn>;
      write: ReturnType<typeof vi.fn>;
      read: ReturnType<typeof vi.fn>;
      clear: ReturnType<typeof vi.fn>;
      list: ReturnType<typeof vi.fn>;
      status: ReturnType<typeof vi.fn>;
      resize: ReturnType<typeof vi.fn>;
      destroy: ReturnType<typeof vi.fn>;
      subscribe: ReturnType<typeof vi.fn>;
    };
    serial: {
      listPorts: ReturnType<typeof vi.fn>;
    };
  };
}

const okEmpty = <T>(data: T): PreloadResult<T> => ({ success: true, data });

/**
 * 构造 PreloadAPI mock。
 *
 * 默认所有方法返回 `{success:true, data:{}}` 占位；具体测试用 `.mockResolvedValueOnce(...)` 覆盖。
 */
export function createMockPreloadAPI(): MockPreloadAPI {
  const transcriptListeners = new Set<(env: TranscriptEventEnvelope) => void>();
  const portListeners = new Set<(p: ReadonlyArray<SerialPortInfo>) => void>();

  const session = {
    create: vi.fn(async () => okEmpty({ sessionId: 'sess_test', state: 'open' })),
    write: vi.fn(async () => okEmpty({ bytesWritten: 0 })),
    read: vi.fn(async () =>
      okEmpty<SessionReadSuccess>({
        events: [],
        cursor: 0,
        truncated: false,
        oldestAvailableSequence: 0,
      }),
    ),
    clear: vi.fn(async () => okEmpty({ sequence: 0 })),
    list: vi.fn(async () => okEmpty({ sessionIds: [] as string[] })),
    status: vi.fn(async () =>
      okEmpty({ sessionId: 'sess_test', state: 'open', latestCursor: 0 }),
    ),
    resize: vi.fn(async () => okEmpty({ resized: true })),
    destroy: vi.fn(async () => okEmpty({ destroyed: true as const })),
    subscribe: vi.fn(async () =>
      okEmpty<TranscriptSubscribeSuccess>({
        events: [],
        cursor: 0,
        truncated: false,
        oldestAvailableSequence: 0,
      }),
    ),
  };

  const serialListPorts = vi.fn(
    async (): Promise<PreloadResult<ReadonlyArray<SerialPortInfo>>> => okEmpty([]),
  );

  const api: PreloadAPI = {
    session,
    serial: {
      listPorts: serialListPorts,
      onPortChanged: (handler): Unsubscribe => {
        portListeners.add(handler);
        return () => portListeners.delete(handler);
      },
    },
    transcript: {
      onEvent: (handler): Unsubscribe => {
        transcriptListeners.add(handler);
        return () => transcriptListeners.delete(handler);
      },
    },
  };

  return {
    api,
    emitTranscript: (envelope) => {
      for (const l of transcriptListeners) l(envelope);
    },
    emitPortChange: (ports) => {
      for (const l of portListeners) l(ports);
    },
    spies: {
      session,
      serial: {
        listPorts: serialListPorts,
      },
    },
  };
}

/**
 * 注入 mock 到 `window.linkterm`，并返回控制器；clearable in afterEach。
 */
export function installMockPreload(): MockPreloadAPI {
  const mock = createMockPreloadAPI();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).window.linkterm = mock.api;
  return mock;
}
