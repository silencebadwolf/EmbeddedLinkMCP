/**
 * IPC 通道名称（主进程 ↔ 渲染进程）。
 *
 * 集中定义所有 channel 字符串，避免主/渲染两端写错出现"沉默失败"。
 * - `session:*`     —— 会话生命周期与读写（Phase 5 实现）
 * - `serial:*`      —— 串口端口枚举与变更通知（Phase 2/6）
 * - `ui:*`          —— UI 配置与截图（Phase 10）
 * - `transcript:*`  —— transcript 流订阅（Phase 5）
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
  CONNECTIONS_LIST: 'connections:list',
  CONNECTIONS_SAVE_AND_OPEN: 'connections:saveAndOpen',
  CONNECTIONS_OPEN: 'connections:open',
  CONNECTIONS_DELETE: 'connections:delete',
  AGENT_INTEGRATIONS_LIST: 'agentIntegrations:list',
  AGENT_INTEGRATIONS_INSTALL: 'agentIntegrations:install',
} as const;

/** IPC_CHANNELS 字典中所有 value 的联合类型。 */
export type IpcChannel = (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS];