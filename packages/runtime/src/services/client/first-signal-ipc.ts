import type { ClientServiceHost } from './ports.js';
import { z } from 'zod';
import { CLIENT_CHANNELS as IPC_CHANNELS } from '@linkterm/contracts/client-protocol';
import type { PreloadResult } from '@linkterm/contracts/preload-api';
import {
  FIRST_SIGNAL_SCHEMA_VERSION,
  FirstSignalEventSchema,
  FirstSignalStartRequestSchema,
  FirstSignalStatusRequestSchema,
  FirstSignalStopRequestSchema,
  FirstSignalSubscribeRequestSchema,
  type FirstSignalObservation,
  type FirstSignalStartRequest,
  type FirstSignalStartResult,
  type FirstSignalStatusRequest,
  type FirstSignalStatusResult,
  type FirstSignalStopRequest,
  type FirstSignalStopResult,
} from '@linkterm/contracts/first-signal-contract';

export interface FirstSignalIpcService {
  start(req: FirstSignalStartRequest): FirstSignalStartResult;
  status(req: FirstSignalStatusRequest): FirstSignalStatusResult;
  stop(req: FirstSignalStopRequest): FirstSignalStopResult;
  onObservation(listener: (observation: FirstSignalObservation) => void): () => void;
}

interface FirstSignalSubscriber {
  readonly attemptId?: string;
  readonly sender: {
    readonly id: number;
    isDestroyed(): boolean;
    send(channel: string, payload: unknown): void;
    once(eventName: 'destroyed', listener: () => void): unknown;
    removeListener(eventName: 'destroyed', listener: () => void): unknown;
  };
  readonly cleanup: () => void;
}

const EmptyRequestSchema = z.object({}).strict().readonly();

const invalidRequest = (): PreloadResult<never> => ({
  success: false,
  error: { code: 'firstSignal.invalid_request', message: 'Invalid first-signal request' },
});

const notFound = (): PreloadResult<never> => ({
  success: false,
  error: { code: 'firstSignal.not_found', message: 'First-signal observation not found' },
});

export function registerFirstSignalIpc(
  host: ClientServiceHost,
  service: FirstSignalIpcService,
): () => void {
  const ipcMain = host.requests;

  const subscribers = new Map<number, FirstSignalSubscriber>();

  const remove = (id: number): void => {
    const entry = subscribers.get(id);
    if (entry === undefined) return;
    subscribers.delete(id);
    entry.cleanup();
  };

  const unsubscribeObservation = service.onObservation((observation) => {
    broadcastObservation(subscribers, remove, observation);
  });

  ipcMain.handle(
    IPC_CHANNELS.FIRST_SIGNAL_START,
    (_event, raw: unknown): FirstSignalStartResult => {
      const parsed = FirstSignalStartRequestSchema.safeParse(raw);
      if (!parsed.success) return invalidRequest() as FirstSignalStartResult;
      return service.start(parsed.data);
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.FIRST_SIGNAL_STATUS,
    (_event, raw: unknown): FirstSignalStatusResult => {
      const parsed = FirstSignalStatusRequestSchema.safeParse(raw);
      if (!parsed.success) return invalidRequest() as FirstSignalStatusResult;
      return service.status(parsed.data);
    },
  );

  ipcMain.handle(IPC_CHANNELS.FIRST_SIGNAL_STOP, (_event, raw: unknown): FirstSignalStopResult => {
    const parsed = FirstSignalStopRequestSchema.safeParse(raw);
    if (!parsed.success) return invalidRequest() as FirstSignalStopResult;
    return service.stop(parsed.data);
  });

  ipcMain.handle(
    IPC_CHANNELS.FIRST_SIGNAL_SUBSCRIBE,
    (event, raw: unknown): FirstSignalStatusResult => {
      const normalized = raw === undefined ? {} : raw;
      const parsed = FirstSignalSubscribeRequestSchema.safeParse(normalized);
      if (!parsed.success) return invalidRequest() as FirstSignalStatusResult;

      const sender = event.sender;
      remove(sender.id);
      const onDestroyed = (): void => remove(sender.id);
      sender.once('destroyed', onDestroyed);
      subscribers.set(sender.id, {
        attemptId: parsed.data.attemptId,
        sender,
        cleanup: () => sender.removeListener('destroyed', onDestroyed),
      });

      if (parsed.data.attemptId === undefined) {
        remove(sender.id);
        return notFound() as FirstSignalStatusResult;
      }

      const current = service.status({ attemptId: parsed.data.attemptId });
      if (!current.success) remove(sender.id);
      return current;
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.FIRST_SIGNAL_UNSUBSCRIBE,
    (event, raw: unknown): PreloadResult<{ unsubscribed: true }> => {
      if (!EmptyRequestSchema.safeParse(raw === undefined ? {} : raw).success) {
        return invalidRequest();
      }
      remove(event.sender.id);
      return { success: true, data: { unsubscribed: true } };
    },
  );

  return () => {
    ipcMain.removeHandler(IPC_CHANNELS.FIRST_SIGNAL_START);
    ipcMain.removeHandler(IPC_CHANNELS.FIRST_SIGNAL_STATUS);
    ipcMain.removeHandler(IPC_CHANNELS.FIRST_SIGNAL_STOP);
    ipcMain.removeHandler(IPC_CHANNELS.FIRST_SIGNAL_SUBSCRIBE);
    ipcMain.removeHandler(IPC_CHANNELS.FIRST_SIGNAL_UNSUBSCRIBE);
    for (const id of [...subscribers.keys()]) remove(id);
    unsubscribeObservation();
  };
}

function broadcastObservation(
  subscribers: Map<number, FirstSignalSubscriber>,
  remove: (id: number) => void,
  observation: FirstSignalObservation,
): void {
  const event = FirstSignalEventSchema.parse({
    schemaVersion: FIRST_SIGNAL_SCHEMA_VERSION,
    observation,
  });
  for (const [id] of subscribers) {
    const entry = subscribers.get(id);
    if (entry === undefined) continue;
    if (entry.attemptId !== undefined && entry.attemptId !== observation.attemptId) continue;
    const sender = entry.sender;
    if (sender.isDestroyed()) {
      remove(id);
      continue;
    }
    try {
      sender.send(IPC_CHANNELS.FIRST_SIGNAL_EVENT, event);
    } catch {
      remove(id);
    }
  }
}
