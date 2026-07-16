/**
 * IPC 通道名称（主进程 ↔ 渲染进程）。
 *
 * 集中定义所有 channel 字符串，避免主/渲染两端写错出现"沉默失败"。
 * - `session:*`     —— 会话生命周期与读写（Phase 5 实现）
 * - `serial:*`      —— 串口端口枚举与变更通知（Phase 2/6）
 * - `ui:*`          —— UI 配置与截图（Phase 10）
 * - `transcript:*`  —— transcript 流订阅（Phase 5）
 * - `activity:*`    —— Operation/Event Ledger 快照与增量事件（Phase 1）
 * - `readiness:*`   —— Runtime Readiness 快照与增量事件（Phase 3）
 * - `firstSignal:*` —— Serial First Signal 观察生命周期与增量事件（Phase 4）
 *
 * 命名约定：`<scope>:<action>`，全部小驼峰。
 */
export const IPC_CHANNELS = {
  SESSION_CREATE: 'session:create',
  SESSION_DESTROY: 'session:destroy',
  SESSION_WRITE: 'session:write',
  SESSION_READ: 'session:read',
  SESSION_LIST: 'session:list',
  SESSION_STATUS: 'session:status',
  SESSION_CLEAR: 'session:clear',
  SESSION_RESIZE: 'session:resize',
  SESSION_LIFECYCLE: 'session:lifecycle',
  RTT_LOG_OPEN: 'rttLog:open',
  SERIAL_LIST_PORTS: 'serial:listPorts',
  SERIAL_PORT_CHANGED: 'serial:portChanged',
  /**
   * Phase 10：MCP `ui_configure` 受理后，主进程通过此 channel 单向广播
   * 已发送的 patch 给所有渲染进程；renderer 端 `useUiPatchSubscription`
   * 负责合并到 Zustand store。fire-and-forget，无回执。
   */
  UI_STATE_PATCH: 'ui:statePatch',
  TRANSCRIPT_SUBSCRIBE: 'transcript:subscribe',
  TRANSCRIPT_EVENT: 'transcript:event',
  ACTIVITY_SUBSCRIBE: 'activity:subscribe',
  ACTIVITY_UNSUBSCRIBE: 'activity:unsubscribe',
  ACTIVITY_SNAPSHOT: 'activity:snapshot',
  ACTIVITY_EVENT: 'activity:event',
  ACTIVITY_STATUS: 'activity:status',
  ACTIVITY_EXPORT: 'activity:export',
  ACTIVITY_CLEAR: 'activity:clear',
  READINESS_GET: 'readiness:get',
  READINESS_REFRESH: 'readiness:refresh',
  READINESS_SUBSCRIBE: 'readiness:subscribe',
  READINESS_UNSUBSCRIBE: 'readiness:unsubscribe',
  READINESS_EVENT: 'readiness:event',
  FIRST_SIGNAL_START: 'firstSignal:start',
  FIRST_SIGNAL_STATUS: 'firstSignal:status',
  FIRST_SIGNAL_STOP: 'firstSignal:stop',
  FIRST_SIGNAL_SUBSCRIBE: 'firstSignal:subscribe',
  FIRST_SIGNAL_UNSUBSCRIBE: 'firstSignal:unsubscribe',
  FIRST_SIGNAL_EVENT: 'firstSignal:event',
  CONNECTIONS_LIST: 'connections:list',
  CONNECTIONS_SAVE_AND_OPEN: 'connections:saveAndOpen',
  CONNECTIONS_OPEN: 'connections:open',
  CONNECTIONS_DELETE: 'connections:delete',
  AGENT_INTEGRATIONS_LIST: 'agentIntegrations:list',
  AGENT_INTEGRATIONS_INSTALL: 'agentIntegrations:install',
  AGENT_INTEGRATIONS_UNINSTALL: 'agentIntegrations:uninstall',
  AGENT_INTEGRATIONS_DIAGNOSE: 'agentIntegrations:diagnose',
  JLINK_DEVICES_SEARCH: 'jlinkDevices:search',
  JLINK_DEVICES_GET: 'jlinkDevices:get',
  JLINK_DEVICES_REFRESH: 'jlinkDevices:refresh',
  CONTROL_PROFILE_SAVE: 'controlProfile:save',
  CONTROL_PROFILE_LOAD: 'controlProfile:load',
  CONTROL_PROFILE_RECORDS_LIST: 'controlProfileRecords:list',
  CONTROL_PROFILE_RECORDS_OPEN: 'controlProfileRecords:open',
  CONTROL_PROFILE_RECORDS_DELETE: 'controlProfileRecords:delete',
  CONTROL_PROFILE_RUN_DOWNLOAD: 'controlProfile:runDownload',
  CONTROL_PROFILE_START_DOWNLOAD: 'controlProfile:startDownload',
  CONTROL_PROFILE_START_COMPENSATION_REFLASH: 'controlProfile:startCompensationReflash',
  CONTROL_PROFILE_SAVE_PROFILE_SUGGESTION: 'controlProfile:saveProfileSuggestion',
  CONTROL_PROFILE_DOWNLOAD_STATUS: 'controlProfile:downloadStatus',
  CONTROL_PROFILE_DOWNLOAD_READ: 'controlProfile:downloadRead',
  CONTROL_PROFILE_DOWNLOAD_CANCEL: 'controlProfile:downloadCancel',
  CONTROL_PROFILE_CONNECT_CHIP: 'controlProfile:connectChip',
  CONTROL_PROFILE_DISCONNECT_CHIP: 'controlProfile:disconnectChip',
  CONTROL_PROFILE_PICK_WORKSPACE_ROOT: 'controlProfile:pickWorkspaceRoot',
  CONTROL_PROFILE_PICK_FIRMWARE_FILE: 'controlProfile:pickFirmwareFile',
} as const;

/** IPC_CHANNELS 字典中所有 value 的联合类型。 */
export type IpcChannel = (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS];
