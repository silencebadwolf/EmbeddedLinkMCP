# LinkTerm 人机共用控制：删除 AI 暂停/接管机制

## 目标

LinkTerm 的终端、串口、J-Link、RTT 和工作流入口不再提供“暂停 AI / 恢复 AI / 接管”控制面。人类和 AI 始终共享同一条 Main-owned WriteQueue，按到达顺序执行；transcript 与 durable audit 继续记录 `human`、`ai`、`device` 和 `system` 来源，但来源只用于观察与追溯，不用于互斥抢占。

## 保留与删除边界

保留：

- SessionManager、WriteQueue、Transport、IJLinkBackend 和 Main trust boundary；
- MCP 的人类审批、一次性 grant、PreparedOperation、AuthorizationRecord 与审计；
- AI/人类写入的顺序化、队列容量限制、错误语义和 transcript；
- Activity Center 对操作进度、风险、审批来源和失败原因的展示。

删除：

- `AiControlService`、`AiControlState`、`AiControlStore` 的运行时实例、文件持久化和恢复逻辑；
- global/session pause latch、pause epoch、take-over 语义和对应的 admission 拒绝分支；
- `aiControl` IPC/preload namespace、Renderer hook/reducer、顶部和标签栏暂停/接管按钮及状态徽章；
- `AI_CONTROL_PAUSED` MCP/IPC 错误码、活动中心“blocked by pause”分支及中英文文案；
- 旧 `ai-control-state.json` 不再读取或写入。已有文件不在本次代码变更中主动删除，避免未经授权的文件擦除。

## 执行与并发模型

1. 人类键盘输入仍由 Renderer `session:write` 进入 Main，并固定 `origin=human`。
2. AI MCP 写入、J-Link、RTT 和工作流操作仍由 Main admission coordinator 串行化；coordinator 只负责重新校验、审批 continuation 和内部 lease 生命周期，不再查询暂停状态。
3. 同一会话的人类和 AI 请求都进入同一个 WriteQueue；先入队者先写入 Transport，写入成功后按原顺序追加 transcript。
4. AI 的 state-affecting/disruptive/destructive 操作仍需现有 `confirm`/Human Approval 门禁；删除 pause 不会降低审批要求。
5. 不新增抢占、焦点锁、自动 take-over 或默认遥测。Renderer 终端始终可输入，Activity Center、审批面板打开时也不能改变终端写入权限。

## 迁移策略

- 从 Main context、MCP registry、control-profile IPC 和 preload 中移除 pause 依赖；删除后续无调用方的模块与测试夹具。
- 将 admission coordinator 的公开类型改为不含 `AiControlScope`、pause epoch 或 `AI_CONTROL_PAUSED` 的版本；保留主进程内部 lease，不跨 preload 或 Renderer。
- 删除 App/SessionTabBar 对 pause 状态的订阅和按钮；不再在启动时读取旧 pause 文件，因此旧文件不会让当前运行时进入暂停状态。
- 保留现有审批与活动记录测试，新增“global/session pause 不存在、AI 与 human 共用队列且不互相阻塞”的回归测试。

## 错误与兼容性

- 已有客户端若发送旧 pause IPC channel，将收到 Electron 默认的“handler 不存在”行为；新 preload 类型不再暴露这些方法。
- MCP 工具不再返回 `AI_CONTROL_PAUSED`；如果审批未完成，仍返回 `APPROVAL_REQUIRED`；如果会话/传输不可用，仍返回现有 `NOT_OPEN`、`SESSION_CLOSED` 或 transport 错误。
- 旧活动日志中的 `AI_CONTROL_PAUSED` 记录保留为历史证据，Activity Center 只按历史普通失败显示，不再把它渲染成暂停状态。

## 验收标准

- UI 中不存在“暂停 AI”“恢复 AI”“暂停会话 AI”“接管”等按钮、徽章或状态文案。
- `ai-control-state.json` 不再被读取或写入；新启动即使文件内容为 paused，AI MCP 写入也不会被 `AI_CONTROL_PAUSED` 拒绝。
- 人类键盘输入与 AI MCP 写入可同时提交，均经过同一个 WriteQueue；测试能证明顺序稳定且没有互斥门禁。
- 现有人类审批、WriteQueue、SessionManager、Transport、J-Link/RTT 路径的相关测试、构建、lint 和许可证检查通过。
- GitNexus impact、PDG/taint 定向复核、detect_changes 与 verification-before-completion 均有新鲜证据。
