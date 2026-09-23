import type { ClientServiceHost } from './ports.js';
import { z } from 'zod';
import { CLIENT_CHANNELS as IPC_CHANNELS } from '@linkterm/contracts/client-protocol';
import {
  READINESS_SCHEMA_VERSION,
  ReadinessEventSchema,
  RuntimeReadinessSnapshotSchema,
  SafeReadinessCodeSchema,
  type RuntimeReadinessSnapshot,
} from '@linkterm/contracts/readiness-contract';
import type { PreloadResult } from '@linkterm/contracts/preload-api';

const ReadinessRequestSchema = z.object({}).strict().readonly();
const ReadinessCursorSchema = z
  .object({
    snapshotId: SafeReadinessCodeSchema,
    generation: z.number().int().nonnegative(),
  })
  .strict()
  .readonly();
const ReadinessCursorRequestSchema = z
  .object({
    cursor: ReadinessCursorSchema.optional(),
  })
  .strict()
  .readonly();

export interface ReadinessSnapshotService {
  getCurrent(): RuntimeReadinessSnapshot;
  refresh(): Promise<RuntimeReadinessSnapshot>;
}

interface ReadinessSubscriber {
  readonly sender: {
    readonly id: number;
    isDestroyed(): boolean;
    send(channel: string, payload: unknown): void;
  };
  readonly cleanup: () => void;
}

const invalidReadinessRequest = (): PreloadResult<never> => ({
  success: false,
  error: { code: 'INVALID_READINESS_REQUEST', message: 'Invalid readiness request' },
});

const invalidReadinessCursor = (): PreloadResult<never> => ({
  success: false,
  error: { code: 'INVALID_READINESS_CURSOR', message: 'Invalid readiness cursor' },
});

const invalidReadinessPayload = (): PreloadResult<never> => ({
  success: false,
  error: { code: 'INVALID_READINESS_PAYLOAD', message: 'Invalid readiness payload' },
});

const staleReadinessGeneration = (): PreloadResult<never> => ({
  success: false,
  error: { code: 'STALE_READINESS_GENERATION', message: 'Invalid readiness cursor' },
});

export function registerReadinessIpc(
  host: ClientServiceHost,
  service: ReadinessSnapshotService,
): () => void {
  const ipcMain = host.requests;

  const subscribers = new Map<number, ReadinessSubscriber>();
  let latestRefreshRequest = 0;

  const remove = (id: number): void => {
    const entry = subscribers.get(id);
    if (entry === undefined) return;
    subscribers.delete(id);
    entry.cleanup();
  };

  ipcMain.handle(
    IPC_CHANNELS.READINESS_GET,
    (_event, raw: unknown): PreloadResult<RuntimeReadinessSnapshot> => {
      if (!ReadinessRequestSchema.safeParse(raw === undefined ? {} : raw).success) {
        return invalidReadinessRequest();
      }
      const snapshot = safeCurrentSnapshot(service);
      return snapshot === null ? invalidReadinessPayload() : { success: true, data: snapshot };
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.READINESS_REFRESH,
    async (_event, raw: unknown): Promise<PreloadResult<RuntimeReadinessSnapshot>> => {
      if (!ReadinessRequestSchema.safeParse(raw === undefined ? {} : raw).success) {
        return invalidReadinessRequest();
      }

      const refreshRequest = latestRefreshRequest + 1;
      latestRefreshRequest = refreshRequest;
      let snapshot: RuntimeReadinessSnapshot;
      try {
        snapshot = RuntimeReadinessSnapshotSchema.parse(await service.refresh());
      } catch {
        return invalidReadinessPayload();
      }

      const current = safeCurrentSnapshot(service);
      if (current === null) return invalidReadinessPayload();
      if (
        refreshRequest !== latestRefreshRequest ||
        snapshot.generation < current.generation ||
        snapshot.snapshotId !== current.snapshotId
      ) {
        return staleReadinessGeneration();
      }

      broadcastSnapshot(subscribers, remove, snapshot);
      return { success: true, data: snapshot };
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.READINESS_SUBSCRIBE,
    (event, raw: unknown): PreloadResult<RuntimeReadinessSnapshot> => {
      const normalized = raw === undefined ? {} : raw;
      const parsed = ReadinessCursorRequestSchema.safeParse(normalized);
      if (!parsed.success) {
        return hasCursorField(normalized) ? invalidReadinessCursor() : invalidReadinessRequest();
      }
      if (parsed.data.cursor !== undefined) {
        const cursorSnapshot = safeCurrentSnapshot(service);
        if (cursorSnapshot === null) return invalidReadinessPayload();
        if (!isValidCursor(parsed.data.cursor, cursorSnapshot)) {
          return invalidReadinessCursor();
        }
      }

      const sender = event.sender;
      remove(sender.id);
      const onDestroyed = (): void => remove(sender.id);
      sender.once('destroyed', onDestroyed);
      subscribers.set(sender.id, {
        sender,
        cleanup: () => sender.removeListener('destroyed', onDestroyed),
      });

      const snapshot = safeCurrentSnapshot(service);
      if (snapshot === null) {
        remove(sender.id);
        return invalidReadinessPayload();
      }
      return { success: true, data: snapshot };
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.READINESS_UNSUBSCRIBE,
    (event, raw: unknown): PreloadResult<{ unsubscribed: true }> => {
      if (!ReadinessRequestSchema.safeParse(raw === undefined ? {} : raw).success) {
        return invalidReadinessRequest();
      }
      remove(event.sender.id);
      return { success: true, data: { unsubscribed: true } };
    },
  );

  return () => {
    ipcMain.removeHandler(IPC_CHANNELS.READINESS_GET);
    ipcMain.removeHandler(IPC_CHANNELS.READINESS_REFRESH);
    ipcMain.removeHandler(IPC_CHANNELS.READINESS_SUBSCRIBE);
    ipcMain.removeHandler(IPC_CHANNELS.READINESS_UNSUBSCRIBE);
    for (const id of [...subscribers.keys()]) remove(id);
  };
}

function safeCurrentSnapshot(service: ReadinessSnapshotService): RuntimeReadinessSnapshot | null {
  try {
    return RuntimeReadinessSnapshotSchema.parse(service.getCurrent());
  } catch {
    return null;
  }
}

function isValidCursor(
  cursor: z.infer<typeof ReadinessCursorSchema> | undefined,
  snapshot: RuntimeReadinessSnapshot,
): boolean {
  if (cursor === undefined) return true;
  if (cursor.generation > snapshot.generation) return false;
  if (cursor.generation === snapshot.generation) {
    return cursor.snapshotId === snapshot.snapshotId;
  }
  return true;
}

function hasCursorField(raw: unknown): boolean {
  return typeof raw === 'object' && raw !== null && 'cursor' in raw;
}

function broadcastSnapshot(
  subscribers: Map<number, ReadinessSubscriber>,
  remove: (id: number) => void,
  snapshot: RuntimeReadinessSnapshot,
): void {
  const event = ReadinessEventSchema.parse({
    schemaVersion: READINESS_SCHEMA_VERSION,
    snapshot,
  });
  for (const [id] of subscribers) {
    const entry = subscribers.get(id);
    if (entry === undefined) continue;
    const sender = entry.sender;
    if (sender.isDestroyed()) {
      remove(id);
      continue;
    }
    try {
      sender.send(IPC_CHANNELS.READINESS_EVENT, event);
    } catch {
      remove(id);
    }
  }
}
