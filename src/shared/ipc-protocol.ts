// IPC channel names and message types — will be expanded in Phase 5

export const IPC_CHANNELS = {
  SESSION_CREATE: 'session:create',
  SESSION_DESTROY: 'session:destroy',
  SESSION_WRITE: 'session:write',
  SESSION_READ: 'session:read',
  SESSION_LIST: 'session:list',
  SESSION_STATUS: 'session:status',
  SESSION_CLEAR: 'session:clear',
  SESSION_RESIZE: 'session:resize',
  SERIAL_LIST_PORTS: 'serial:listPorts',
  SERIAL_PORT_CHANGED: 'serial:portChanged',
  UI_CONFIGURE: 'ui:configure',
  UI_SCREENSHOT: 'ui:screenshot',
  TRANSCRIPT_SUBSCRIBE: 'transcript:subscribe',
  TRANSCRIPT_EVENT: 'transcript:event',
} as const;

export type IpcChannel = (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS];
