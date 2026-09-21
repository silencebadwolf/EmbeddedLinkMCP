import { electron } from '../../platform/electron-runtime.js';
import { IPC_CHANNELS } from '../../ipc/channels.js';
import {
  ActivityCursorRequestSchema,
  ActivityUnsubscribeRequestSchema,
  type ActivitySnapshotView,
} from '@linkterm/contracts/activity-contract';
import type {
  OperationLedger,
  ValidatedActivityCursor,
} from '@linkterm/runtime/core/activity/operation-ledger';
import type { PreloadResult } from '@linkterm/contracts/preload-api';

const { ipcMain } = electron;

interface ActivitySubscriber {
  readonly offLedger: () => void;
  readonly cleanup: () => void;
}

const invalidActivityRequest = (): PreloadResult<never> => ({
  success: false,
  error: { code: 'INVALID_ARGUMENT', message: 'Invalid activity request' },
});

const invalidActivityCursor = (): PreloadResult<never> => ({
  success: false,
  error: { code: 'INVALID_ARGUMENT', message: 'Invalid activity cursor' },
});

export function registerActivityIpc(ledger: OperationLedger): () => void {
  const subscribers = new Map<number, ActivitySubscriber>();
  const remove = (id: number): void => {
    const entry = subscribers.get(id);
    if (entry === undefined) return;
    subscribers.delete(id);
    entry.offLedger();
    entry.cleanup();
  };

  ipcMain.handle(
    IPC_CHANNELS.ACTIVITY_SUBSCRIBE,
    (event, raw: unknown): PreloadResult<ActivitySnapshotView> => {
      const parsed = ActivityCursorRequestSchema.safeParse(raw === undefined ? {} : raw);
      if (!parsed.success) return invalidActivityRequest();

      let validated: ValidatedActivityCursor;
      try {
        validated = ledger.validateCursor(parsed.data.cursor);
      } catch {
        return invalidActivityCursor();
      }

      const sender = event.sender;
      remove(sender.id);
      const onDestroyed = (): void => remove(sender.id);
      sender.once('destroyed', onDestroyed);
      const offLedger = ledger.subscribe((activityEvent) => {
        if (sender.isDestroyed()) {
          remove(sender.id);
          return;
        }
        try {
          sender.send(IPC_CHANNELS.ACTIVITY_EVENT, activityEvent);
        } catch {
          remove(sender.id);
        }
      });
      subscribers.set(sender.id, {
        offLedger,
        cleanup: () => sender.removeListener('destroyed', onDestroyed),
      });

      return { success: true, data: ledger.snapshotFromValidatedCursor(validated) };
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.ACTIVITY_SNAPSHOT,
    (_event, raw: unknown): PreloadResult<ActivitySnapshotView> => {
      const parsed = ActivityCursorRequestSchema.safeParse(raw === undefined ? {} : raw);
      if (!parsed.success) return invalidActivityRequest();

      try {
        return { success: true, data: ledger.snapshot(parsed.data.cursor) };
      } catch {
        return invalidActivityCursor();
      }
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.ACTIVITY_UNSUBSCRIBE,
    (event, raw: unknown): PreloadResult<{ unsubscribed: true }> => {
      if (!ActivityUnsubscribeRequestSchema.safeParse(raw === undefined ? {} : raw).success) {
        return invalidActivityRequest();
      }
      remove(event.sender.id);
      return { success: true, data: { unsubscribed: true } };
    },
  );

  return () => {
    ipcMain.removeHandler(IPC_CHANNELS.ACTIVITY_SUBSCRIBE);
    ipcMain.removeHandler(IPC_CHANNELS.ACTIVITY_SNAPSHOT);
    ipcMain.removeHandler(IPC_CHANNELS.ACTIVITY_UNSUBSCRIBE);
    for (const id of [...subscribers.keys()]) remove(id);
  };
}
