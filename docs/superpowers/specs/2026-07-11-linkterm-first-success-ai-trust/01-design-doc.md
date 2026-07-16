# LinkTerm 首次成功与 AI 可信协作 — 产品设计文档

> **2026-07-15 产品覆盖决策**：不再提供 AI 人工批准、Pause/Take Over 或继续批准流程。
> AI 通过现有校验和执行边界后自动运行，用户只观察 Activity、Transcript 与 Audit；下文
> 早期审批/暂停设计保留为历史决策记录，当前实现以
> [`observe-only-ai-execution`](../../../../openspec/changes/observe-only-ai-execution/proposal.md) 为准。

- 状态：Reviewed — phased delivery in progress
- 范围：Epic A + Epic D
- 推荐策略：共享可信基础 + 纵向体验切片

## 一句话摘要

LinkTerm 应在不削弱终端专业性的前提下，用任务导向的首次成功流程把用户带到“首段非空设备文本已经在终端可见”，并用统一活动时间线、风险解释、人类审批和接管控制让 AI 自动化始终处于人的视野与控制中。

## 1. 背景与证据

当前工程并不缺底层能力：

- `SessionManager`、`WriteQueue` 与 transcript 已保证 AI / human / system 的单一有序事件流。
- Renderer 能水合 MCP 创建的 session，并在 AI 创建新会话时切换到对应 tab。
- MCP registry 已统一返回 `origin: 'ai'`、`correlationId`、schemaVersion 和分层 evidence。
- 7 个低层高影响 J-Link 工具、3 种 control workflow mode 和 runtime restart 已有 `confirm=true` 契约门禁，并有集成/单元测试保证缺少确认时 backend 不会执行。
- Control Profile 的 direct RUN/START_DOWNLOAD Renderer IPC 当前会把 `confirm:true` 注入 workflow；它不经过 MCP registry，必须作为独立 approval migration surface，不能把按钮点击自动视为 grant。
- 工作区、控制配置、固件、串口、J-Link、RTT、Agent integration 和运行时诊断已经存在。

体验缺口主要是这些能力尚未形成用户可以理解的连续旅程：

- `src/renderer/App.tsx` 的空状态仅显示“No active session / 点击新建”。
- `ConnectionDialog` 以 transport 类型开始，要求用户预先知道应该选择串口、RTT 还是其他连接。
- 错误通常停留在局部表单或状态卡片；系统已有诊断证据，但没有统一的“当前阻塞 → 为什么 → 下一步”。
- `OriginIndicator` 只显示三个近期活动点，无法表示 operation 的名称、阶段、目标、结果或风险。
- `confirm=true` 只表示 caller/client acknowledgement，不证明桌面用户完成了审批；任意持有本机 MCP bearer token 的客户端都可以自行填写该布尔值。
- transcript 可以复盘输入输出，却不适合承载独立的 workspace、flash、reset、UI 和运行时动作。现有 JobManager 已有 queued/running/succeeded/failed/cancelled、step progress 和 AbortSignal，但 Renderer 尚无统一 list/subscribe 入口。

GitNexus 预分析显示，未来若直接修改 `registerTool`，上游风险为 **HIGH**：11 个直接依赖、15 个受影响符号、2 组执行流程。因此新可观测性必须先以旁路、失败不阻断业务的方式接入，再单独迁移审批语义。

## 2. 产品理念

### 2.1 先解释，再执行

系统在执行任何有副作用的动作前，都应说明目标、影响和参数来源。只读检查可以自动运行，但仍应可见。

### 2.2 以真实状态驱动，不伪造向导进度

向导步骤来自 Runtime Readiness、workspace config、设备证据和 session 状态。关闭再打开后应重新推导，而不是相信一个可能过期的 `step=4`。

### 2.3 一次只解决一个阻塞

首次流程应优先显示当前最影响成功的单个问题，并提供安全的下一步；高级细节按需展开。

### 2.4 可见不等于打扰

普通只读动作进入 Activity Center，不弹模态框。只有需要人类决策或即将产生高影响时才中断用户。

### 2.5 人类始终拥有输入与停止权

AI pause 不得阻止人类写入。紧急 human high-priority 输入继续优先于 normal AI 写队列。backend 声明可停止的任务必须提供与能力一致的 stop control；无法安全停止的动作必须明确标记。

### 2.6 本地优先与最小记录

默认不上传遥测。审计只保存理解动作所需的脱敏元数据，不复制终端全文、凭据或大块二进制。

## 3. 目标用户与 Jobs to Be Done

### Persona P1：第一次使用 LinkTerm 的嵌入式开发者

当我接入一块板卡时，我希望应用告诉我当前检测到了什么、还缺什么，并带我确认首段设备数据已经在终端可见，而不是先要求我理解所有配置页面。

### Persona P2：使用 AI Agent 的日常开发者

当 AI 操作设备或会话时，我希望随时知道它正在做什么、是否成功、是否需要我决定，并能暂停或接管，不需要翻 MCP JSON 日志。

### Persona P3：需要复盘问题的维护者

当自动化失败时，我希望获得按时间和 correlationId 组织的脱敏证据，可以安全复制给同事，而不暴露凭据或巨大 transcript。

## 4. 范围方案与决策

| 方案 | 优点 | 缺点 | 结论 |
| --- | --- | --- | --- |
| 统一 Command Center 大改版 | 视觉和交互一次成型 | 同时触碰 Renderer、IPC、MCP、安全门禁；难回滚 | 不采用 |
| A 完成后再做 D | 用户很快看到向导 | A 会重复造进度/事件模型，后续需返工 | 不采用 |
| 共享可信基础 + 纵向切片 | 每阶段可发布；A、D 共享真实事件；风险可控 | 前两阶段视觉变化较小 | **采用** |

### 推荐交付序列

0. Characterization、63-tool 风险清单与 CI 门禁，不改变产品行为。
1. Operation/CallAttempt event 合约与旁路 ledger。
2. 只读 Activity Center。
3. Runtime Readiness 与 Start Center。
4. 串口首次成功 happy path 与原地恢复。
5. 桌面人类审批 Broker，先迁移现有 MCP 与 direct Download 高影响入口。
6. workspace/profile 重用与 J-Link/RTT“下载并观察”扩展。
7. AI Pause / capability-aware Stop / Take Over。
8. 脱敏持久化、导出与产品化。

## 5. 体验架构

```text
Start Center / Existing Workspace / Agent Request
                    │
                    ▼
           Runtime Readiness Snapshot
                    │
        ┌───────────┴───────────┐
        ▼                       ▼
  Guided First Success       Activity Center
        │                       ▲
        ▼                       │
  Plan / Approval ───────► Operation Event Stream
        │                       ▲
        ▼                       │
 Session / Control Workflow / MCP / IPC
                    │
                    ▼
          Terminal / Device / J-Link
```

Start Center 负责“下一步是什么”，Activity Center 负责“发生了什么”。二者共享 Readiness 和 Operation Event，不互相复制状态。

## 6. Epic A — 首次成功旅程

### 6.1 任务入口

用户看到的第一层不是 transport 类型，而是意图：

1. **观察设备输出**（首发，串口优先）。
2. **打开本地/远程终端**（复用现有 Local Shell / SSH）。
3. **下载固件并观察**（后续，workspace + J-Link + RTT/serial）。
4. **打开已有工作区配置**（重复用户）。

Transport 细节仍然存在，但在用户选择任务后出现。

### 6.2 首发 happy path：串口第一信号

1. 应用启动，Start Center 自动执行安全的只读检查：runtime、serial discovery、已有 profile/session。
2. 用户选择“观察设备输出”。
3. 系统显示检测到的端口、稳定标识和推荐参数；没有端口时保留手动输入。
4. 用户确认计划：“打开并独占 COMx，115200 8N1，终端模式；连接阶段不主动发送 payload；DTR/RTS/control-line 行为及可能触发的板卡复位已明确展示”。
5. 系统创建并打开 session，Activity Center 显示 `requested → running → succeeded/failed`。
6. Main monitor 检测第一条非空 device event，Renderer 在对应 sequence 水合且 xterm write completion callback/等价异步 ack 成功后显示“已收到设备信号”；只有焦点仍在首次流程且无 modal/输入冲突时才转入终端。
7. 用户可保存本次成功使用的连接参数；保存不是首次成功的强制条件，也不把现有 profile 冒充为稳定设备身份。

### 6.3 First Signal 定义

- **Data received**：Main 的 ObservationMonitor 检测到第一条非空 `device` transcript event，并记录 sequence；这是机器可判定的信号。
- **Signal visible**：Renderer transcript 已成功水合，且该 sequence 的非空 device 文本得到 xterm completion callback/等价异步 ack；Epic A 的 MVP 以此作为 journey completed。同步调用 `term.write`、已 dispose/unmount 的 callback 或 state event 不算 visible。
- **Readable/expected output**：输出是否可读、是否符合固件预期是更高层判断，可由用户确认或后续启发式提供；不得把任意噪声/乱码自动称为“有效输出”。
- Local Shell / SSH 后续使用同样的 detected/visible 分层；prompt 识别不是串口 MVP 的前置条件。
- 超过建议等待时间不等于 connection failed：进入“已连接但无输出”状态，并给出可执行诊断。

### 6.4 失败与原地恢复

| 状态 | 用户看到 | 推荐动作 |
| --- | --- | --- |
| 未发现串口 | 未检测到设备，不把空列表当致命错误 | 刷新、手动输入、查看系统权限提示 |
| 端口打开失败 | 原始错误的用户化分类 | 关闭占用程序、刷新设备、修改端口 |
| 已打开但无输出 | 区分“连接成功”和“信号未到达” | 检查波特率、复位板卡、确认接线、继续等待 |
| 设备中途拔出 | 明确物理断连，不显示未知 INTERNAL | 重新扫描并以原参数重连 |
| workspace 缺字段 | 按阻塞字段列出，不展示完整 schema | 只询问当前动作必需字段 |
| config 与硬件冲突 | 展示保存值、当前证据和影响 | 使用一次、更新配置、取消 |
| J-Link 不可用 | 区分未安装、未注入 backend、未检测探针、target 不匹配 | 打开相应诊断或降级到串口观察 |
| Agent integration 不可用 | 不阻止手动使用 App | 提供安装/修复入口和可复制诊断 |

### 6.5 重复使用

- Start Center 优先展示最近工作区、已保存 control profile 和可重用 session。
- 不自动执行有副作用的动作；只读 readiness 可自动刷新。
- “继续上次工作”必须展示将要重用的设备、端口、固件和目标芯片。
- 若事实已变化，回到对应阻塞状态，而不是静默使用陈旧配置。

## 7. Epic D — AI 可信协作

### 7.1 Activity Center

Activity Center 是独立于 terminal transcript 和 debug evidence 的统一操作视图。每条 operation 显示：

- actor：AI / Human / System；
- action：人类可读动作名；
- target：session、workspace、probe、文件或 UI surface 的脱敏标识；
- risk：read-only / state-affecting / disruptive / destructive-or-unknown；
- phase：requested / awaiting-approval / blocked / queued / running / cancel-requested / succeeded / failed / rejected / denied / expired / superseded / cancelled / interrupted；
- time：开始、结束、耗时；
- correlation：用于把 MCP 调用、workflow steps、session 和结果分组；
- evidence summary：有限摘要和跳转，不复制大块数据；
- next action：失败或等待时的可执行建议。

所有进入 LinkTerm handler 的调用都应在保留窗口内 recorded/queryable，并用独立 `callId` 追踪；这不等于默认界面逐条铺开调用。默认视图只置顶 active、needs-attention、pending approval，以及按 AI correlation/task 聚合后的 operation。连续只读探测折叠为一个可展开组，完整调用仍可通过筛选和详情查询。

### 7.2 计划预览

对多步骤 control workflow，用户看到步骤和影响级别，而不是只看到“AI 正在工作”。需要审批的 workflow 先生成不可变 PreparedOperation / plan manifest，冻结真实目标、解析后的路径、artifact 内容 hash/size、control-profile revision、关键默认值与精确 steps；一次批准覆盖这个实际效果指纹。执行必须使用同一准备结果，或在 backend 前原子复验；新增步骤、改参、文件内容替换、symlink/target/probe/profile 变化都必须重新审批。运行时可以补充只读诊断说明，但不能在原 grant 下扩大副作用范围。

### 7.3 风险分级

| 等级 | 例子 | UI 行为 |
| --- | --- | --- |
| Read-only | list/status/read/search/screenshot | 不打断；记录并按 operation 聚合 |
| State-affecting | open/close session、UI configure、profile mutation、terminal write | 可见、可 pause；不声称任意 command 已被内容安全分类 |
| Disruptive | reset/reboot/halt/run、启动 GDB server、改变调试态 | 执行前审批；解释会中断或丢失当前状态，但不泛称不可逆 |
| Destructive-or-unknown | erase/flash、memory write、Commander script、未分类的新写操作 | 执行前审批；展示无法自动恢复的后果或未知边界 |

风险等级与 `approvalPolicy` 分离并集中定义，不能依赖各组件自行选择颜色或文案。未知 state-affecting tool 默认从严；`write_to_session` 作为交互式通道标记 state-affecting、始终可见和可 pause，但第一版不使用脆弱命令解析器假装识别所有危险命令。

### 7.4 人类审批

桌面交互模式采用非阻塞两阶段协议：

1. MCP approval-required 调用已经带 `confirm=true`，但没有匹配的人类 grant；Main 为本次调用生成 `callId`，并创建或找回一个跨重试稳定的逻辑 `operationId`。
2. Main 只做无副作用的 prepare，生成不可变 PreparedOperation；backend 不执行，operation 进入 `awaiting-approval`，本次 CallAttempt 以 `approval-required` 终结并返回结构化 `HUMAN_APPROVAL_REQUIRED`。
3. UI 展示动作、真实目标、关键参数及来源、完整计划、artifact hash/size、预期影响和过期时间。
4. 用户选择“批准一次”或“拒绝”。第一版不提供“始终允许”。
5. 批准产生一次性 grant，绑定 PreparedOperation 的 `effectFingerprint`/plan manifest、Main-assigned caller principal、continuation kind/surface/execution mode、runtime 和 expiry。
6. Caller 携带 `approvalId` continuation；Broker 在服务端找回原 `operationId`，为本次 invocation 生成新 `callId`，原子复验 subject/continuation/effect、消费 grant 并取得 execution admission 后才允许执行。
7. 参数、默认值、realpath、artifact 内容、profile revision、目标 probe、firmware hash 或 steps 改变，或 grant 过期、已经消费、runtime 重启，都返回 mismatch/终态错误且 backend 调用为 0。

相同 `runtimeId + approvalMode + authorizedPrincipalId + continuation kind/surface/executionMode + effectFingerprint` 的 pending request 合并为同一 ApprovalRequest；UI 一次只展示一个 sheet，其余进入队列和 badge，避免 Agent 重试造成 modal storm。排队项若在展示前过期，移除并记录 `Expired · not reviewed · effectful backend not executed`，不弹迟到 sheet。Direct erase 的 grant 只批准 erase；只有明确列出 erase→flash→verify manifest 时，才可一次批准整个计划。

首版 shared Bearer 下，所有 HTTP/stdio/reconnect 映射为一个 Main-assigned local-MCP principal；trusted Renderer 映射为独立 desktop principal。授权与 rate limit 不使用 per-request connection id。Control Profile direct Download 采用两次 invocation：首次 prepare，`approval:resolve` 只记决定；批准后同一 RUN/START channel 用 approvalId continuation，分别绑定 sync/background。Renderer reload 后显示 Ready to continue，不能自动执行。

MCP 侧不得暴露“批准”工具，防止 Agent 自己完成审批。

### 7.5 不可降级的审批模式

Main 在启动时从可信启动入口/本地配置冻结 `ApprovalMode`，请求参数、HTTP header、窗口可见性和 Renderer 状态都不能修改：

- `interactive-required`：桌面安装默认值。即使窗口最小化、关闭、Renderer crash/reload 或暂时没有活动窗口，approval-required operation 也只能保持 pending 或被拒绝，绝不降级为仅有 caller/client acknowledgement。
- `headless-deny`：真正 headless 的安全默认值；approval-required operation 返回稳定错误且 backend 为 0。
- `automation-allowlisted`：仅通过独立显式启动入口启用，按 tool/action、target 和约束 allowlist；启动来源及命中规则必须写 Broker `AuthorizationRecord`。它不是人类批准，也不提供隐式长期授权。

现有 `confirm=true` 仅代表 caller 已明确请求高影响动作，不构成人类授权。旧 client 若不支持 approval retry/capability negotiation，应收到可理解的升级提示并 fail closed。`get_app_status`/runbook 暴露当前模式和 capability，但不得暴露可由请求篡改的切换面。

### 7.6 暂停、停止与接管

- **Pause AI changes**：在 epoch 更新处线性化，按 session 或全局阻止尚未 admission 的 AI state-affecting/disruptive/destructive-or-unknown operation 和 AI 写入；awaiting-approval、approved 或 queued 任务保持 blocked，human/system 不受影响，read-only AI 可继续。
- **Resume**：显式恢复，不因重启或新 Agent 连接偷偷恢复。
- **Stop operation**：`AbortSignal` 本身不足以证明安全停止。backend/job 声明 `safe-point` 时显示 `Stop at safe point`；仅 best-effort 时显示 `Request stop (best effort)`；`none` 时不显示按钮。内部状态仍可使用 `cancel-requested/cancelled`。
- **Emergency input**：human high priority 写入继续走现有 WriteQueue 高优先级通道。
- **Take over**：聚焦关联 session、暂停该 session 的新 AI changes，并展示当前 operation 的已执行/未执行步骤。

已经 admission/running 的 operation 持有 execution lease，Pause 不把它伪装成 cancelled，也不承诺阻止其后续已批准步骤；UI 明示“正在运行的任务可能继续”，用户需要另行使用 backend capability 对应的 stop control。Resume 后，blocked operation 仍须复验 approval、effect fingerprint、目标事实和 expiry。

全局与 session pause 使用 OR 语义：`effectivePaused = global.paused || session.paused`。Global Resume 只清除 global latch，Session Resume 只清除该 session latch；任何局部 Resume 都不能越过另一层仍生效的 Pause。

### 7.7 审计与导出

- 当前计划不实现 checkpoint。若宿主或未来版本提供 file/config checkpoint，UI 必须标明覆盖范围；`OperationReceipt` 只证明发生了什么，不是恢复点。
- 只有 Main 持有来自同一 target binding 上一次已知成功且 verified 部署的 `CompensationCandidate`，并且 artifact source/hash 在显示与点击时仍可复验，才可建议 reflash；失败 OperationReceipt 或当前文件不能被猜成“previous firmware”。补偿动作必须重新获批，且不得承诺恢复擦除/复位前的完整设备状态。
- 默认只记录脱敏 metadata；terminal 正文只以 cursor 范围引用。
- SSH credentials、private key、passphrase、token、环境秘密、固件字节、内存写入内容不落盘。
- Commander script 默认记录 hash、行数和风险摘要，不记录全文。
- 导出前再次运行 redaction，并显示将包含的字段。
- 导出格式为版本化 JSON + 人类可读 Markdown 摘要；第一版不做云上传。

## 8. 共享产品模型

### 8.1 ReadinessCheck

每个检查拥有稳定 id、scope、status、severity、summary、evidence、recommendedActions 和 `checkedAt`。状态限定为：

`unknown | checking | ready | action-required | blocked | unavailable`

检查是事实，不是向导页码。例：serial-discovery-ready、workspace-selected、control-profile-valid、probe-detected、firmware-resolved、agent-integration-ready。

### 8.2 Operation

Operation 表示用户可理解的一次逻辑目标，例如“打开串口会话”或“下载固件并校验”。它可以包含多个 ActionEvent，并使用跨审批重试稳定的 server `operationId`。每次 MCP invocation 另有唯一 `callId` 与独立 CallAttempt 终态，避免把“本次调用等待审批”误写成“整个 operation 已失败/完成”。

### 8.3 ActionEvent

ActionEvent 是 append-only 状态变化。事件不可在原地改写；Renderer 用 reducer 得到当前 OperationView。这样可以处理乱序推送、重连水合和复盘。

### 8.4 PreparedOperation / ApprovalRequest / Grant

PreparedOperation 是 Main 在无副作用 prepare 阶段冻结的真实效果快照；ApprovalRequest 是等待人类决定的可展示对象；Grant 是短时、一次性、effect-fingerprint-bound 的执行能力。UI 只显示脱敏摘要，prepared bytes/内部目标绑定不进入 Activity 或导出。

PreparedOperation、Grant、AuthorizationRecord、CallerPrincipalId、ExecutionAdmissionLease 与完整 CompensationCandidate 都是 Main-only；Renderer 只接收 ApprovalRequestView、AuthorizationDisplay、ApprovalDecisionRecord/OperationReceipt 和 CompensationCandidateSummary 等 allowlisted 投影。

## 9. 功能需求

### 9.1 Shared

| ID | 需求 |
| --- | --- |
| S-FR-001 | 所有新增状态使用版本化 schema，并在 main / preload / renderer 边界校验。 |
| S-FR-002 | 普通 OperationLedger event 发送失败不得改变原业务调用结果，但必须产生 health diagnostic；ApprovalBroker mandatory `AuthorizationRecord` 失败必须 fail closed。 |
| S-FR-003 | 每个 operation 必须有 actor、risk、phase、target summary 和时间信息。 |
| S-FR-004 | 事件和 readiness 文案必须支持中英文，并且不只用颜色表达状态。 |
| S-FR-005 | 所有敏感字段在进入 ledger 前即被删除或摘要化，而不是只在 UI 隐藏。 |
| S-FR-006 | 新功能不得让 terminal transcript、debug evidence 与 activity evidence 混为同一 kind。 |

### 9.2 Epic A

| ID | 需求 |
| --- | --- |
| A-FR-001 | 无活跃 session 时展示任务导向 Start Center。 |
| A-FR-002 | Start Center 自动运行只读 readiness 检查，并允许手动刷新。 |
| A-FR-003 | 首发支持串口观察 happy path，包括自动发现和手动端口。 |
| A-FR-004 | 执行前展示参数、参数来源和是否会写入设备。 |
| A-FR-005 | 区分 session open、data received、signal visible 和“已连接但无输出”。 |
| A-FR-006 | 每个 blocked/failed 状态至少提供一个安全的下一步或明确说明无法自动修复。 |
| A-FR-007 | 用户可退出向导回到专业连接表单，已输入的非敏感值不丢失。 |
| A-FR-008 | 成功后可选择保存 profile，但不能用强制保存阻塞 first success。 |
| A-FR-009 | 重复进入时从真实 runtime/workspace 状态推导，而非重放旧步骤。 |
| A-FR-010 | 后续在同一模型下扩展 J-Link/RTT，不新增第二套向导状态机。 |
| A-FR-011 | 连接计划明确显示端口占用、DTR/RTS/control-line 设置及可能的复位副作用；连接阶段不主动发送 payload。 |
| A-FR-012 | silent 是非终态；main-owned monitor 在超时提示后仍监听 late signal，并用 attempt revision 支持 reload/status-event 竞态。 |
| A-FR-013 | `signal visible` 只在对应非空 device 文本得到 xterm completion callback/等价异步 ack 后成立；state/error、不完整 UTF-8 chunk、delayed callback 前或 dispose/unmount 后不得推进。 |
| A-FR-014 | Serial ConnectionDraft 在候选、plan、advanced form 和 session create 间无损 round-trip，并保留参数来源与连接副作用 metadata。 |
| A-FR-015 | silent/display-unavailable 的 Keep waiting、Disconnect and edit、Back to session、Disconnect 和 replay 对 `ownsSession` 有明确关闭/保留与幂等 cleanup 规则；user/transport/session-closed 原因不混淆，late signal 不无条件抢焦点。 |

### 9.3 Epic D

| ID | 需求 |
| --- | --- |
| D-FR-001 | 每个通过 SDK schema 校验并进入 LinkTerm handler 的 MCP 调用获得唯一 server `callId` 和 CallAttempt 终态；logical `operationId` 可跨 approval retry 稳定，长期任务产生中间进度。 |
| D-FR-002 | UI 能按 operation、actor、risk、phase 和 session/workspace 过滤。 |
| D-FR-003 | Activity Center 与 terminal 渲染解耦，关闭面板不影响事件采集。 |
| D-FR-004 | `interactive-required` operation 必须使用一次性人类 grant；`confirm=true` 本身不算授权，窗口/Renderer/transport/client 状态不得降级 ApprovalMode。 |
| D-FR-005 | Approval UI 显示动作、真实目标、关键参数及来源、artifact hash/size、完整 plan、影响和过期时间。 |
| D-FR-006 | 拒绝、超时、effect input 变化、grant 重用都必须保证 effectful/execution backend 未执行；覆盖 path content、symlink、profile/default、probe/target TOCTOU。 |
| D-FR-007 | 用户可暂停/恢复 AI changes；Pause commit 后尚未 admission 的 changes 被阻止，running lease、read-only AI 与 human/system 路径按策略保持可用。 |
| D-FR-008 | Stop control 由 backend 声明的 cancellation capability 决定：safe-point、best-effort 或 none；UI 按钮不得暗示不存在的立即/安全中断。 |
| D-FR-009 | 审计落盘与导出必须经过字段级 redaction 测试。 |
| D-FR-010 | UI 必须区分 caller acknowledgement、human approval 与 automation-policy authorization。 |
| D-FR-011 | 相同 runtime + approval mode + Main-assigned principal + continuation kind/surface/execution mode + effect fingerprint 必须去重；一次只展示一个 approval sheet，其余排队，过期未审项不迟到弹窗。 |
| D-FR-012 | 多步骤 grant 必须绑定精确 plan manifest；新增步骤，或参数/default/path content/profile/probe/target/artifact hash 变化必须重新审批。 |
| D-FR-013 | 所有保留期内 operation/call 可查询；默认 UI 只突出 active/attention/pending/task groups，read-only burst 折叠，并提供 Go to session、Diagnose、Copy summary。 |
| D-FR-014 | Broker `AuthorizationRecord` 是授权 authority；ApprovalDecisionRecord、OperationReceipt、Activity Ledger 与 durable store 是不同投影/证据，故障协议必须经 fault injection 验证。 |
| D-FR-015 | MCP 与 Control Profile direct RUN/START_DOWNLOAD IPC 必须共用 PreparedOperation/Broker；按钮点击或硬编码 `confirm:true` 不构成 grant，grant 绑定 principal/continuation kind/surface/mode，错误 consumer 不得消费或作废。 |
| D-FR-016 | Broker 对 pending 数、artifact/总 prepared bytes、per-principal 与 global prepare rate 有上限；重连不能绕过，超限 effectful backend=0，不淘汰 approved-unconsumed grant。 |
| D-FR-017 | Approval plan 每步使用 Main 生成的 display-safe effect/parameter/target summary；UI 不从 fingerprint 推断地址范围，也不把 artifact hash 冒充设备 verify 方法。 |
| D-FR-018 | Shared-token HTTP/stdio/reconnect 映射同一 Main-assigned local-MCP principal，Renderer 使用独立 desktop principal；dedupe/rate/grant 不依赖 per-request connection。 |
| D-FR-019 | `approval:resolve` 只记录决定；direct RUN/START_DOWNLOAD 以绑定 approvalId 的第二次 invocation 执行，sync/background 不可互换，duplicate 不重执行。 |
| D-FR-020 | PreparedOperation、Grant、AuthorizationRecord、CallerPrincipalId、Lease 与 CompensationCandidate 保持 Main-only；Renderer 只接收 allowlisted display-safe projections。 |
| D-FR-021 | Broker 先校验 principal/continuation kind/surface/mode；错误 consumer reject 且保留 grant。只有正确 consumer 的 effect/new-intent mismatch 才 supersede。 |
| D-FR-022 | global/session Pause 使用 OR；各自 Resume 只清自身 latch，session lease 同时绑定并复验两层 epoch。 |

## 10. 信息架构

现有 terminal 为主画布，不新增独立首页路由体系：

- 无 session：主画布显示 Start Center。
- 有 session：继续显示 terminal；Start Center 可从侧栏/命令入口打开。
- Header：显示紧凑 AI 状态与待审批数量。
- 右侧抽屉：Activity Center，可覆盖但不挤压 terminal 的最小宽度。
- 模态/非模态审批层：仅处理当前 ApprovalRequest。
- ConnectionDialog：保留为“高级/直接连接”路径，并逐步复用向导的字段组件。
- ControlProfilePanel：继续处理已保存配置；向导只链接/预填，不复制 manager 逻辑。

## 11. 错误处理原则

每个错误展示四层信息：

1. **发生了什么**：用户可理解的摘要。
2. **影响是什么**：是否未执行、部分完成、仍在运行或设备状态未知。
3. **证据是什么**：错误码、脱敏目标、相关 operation/correlation。
4. **下一步是什么**：Retry、Edit、Diagnose、Open Session、Copy Summary、Stop at safe point 或 Request stop (best effort)。

禁止将 `INTERNAL`、stack trace 或原始 CLI 大段输出直接作为主文案；允许在展开详情中提供脱敏技术信息。

## 12. 同类模式研究

| 参考 | 可借鉴模式 | LinkTerm 的转化 |
| --- | --- | --- |
| VS Code Workspace Trust | 在执行代码前解释信任边界；Restricted Mode 允许安全浏览 | readiness 可只读运行，高影响动作单独授权 |
| VS Code Walkthroughs | 每步对应真实 command/event，并按环境条件出现；可续跑而非一次性导览 | Start Center 从真实 readiness/session/transcript 自动完成步骤 |
| PlatformIO Home / device list | 先枚举带 port、VID:PID、serial、description 的设备，再围绕 project/upload/monitor 组织任务 | 任务优先于 transport；候选展示身份依据，不静默选择 |
| Arduino device troubleshooting | 失败按 USB/供电/权限/bootloader/驱动分支，每步可验证 | readiness issue 给原地诊断，不只显示“连接失败” |
| Warp quickstart / tab configs | 尽快完成首个真实动作；成功后再保存配置和恢复现场 | 扫描→连接→信号可见→可选保存成功使用的连接参数 |
| VS Code Agent approvals / Cursor security | 分层授权、细粒度规则、sandbox 不是绝对安全边界 | 集中硬件后果分级；首版只对 approval-required operation 做 human grant |
| Cursor review / terminal agent | 运行中展示实时动作与结果，并可 Stop/redirect | Activity Center 展示 step/progress；按 backend 声明显示 Stop at safe point、Request stop (best effort) 或不显示 |
| VS Code / Claude checkpoints | 宿主支持时，文件变化可 checkpoint/rewind | 若宿主或未来版本提供文件/config checkpoint，必须与硬件 OperationReceipt 分开；后者只是证据，不是恢复点 |
| GitHub Copilot Agents | 明确 Agent 能力、限制和人类复核责任 | 展示计划、影响和结果，不暗示 AI 自主可信 |
| Claude Code permissions/security | 最小权限、显式授权、命令边界 | 一次性 effect-fingerprint-bound grant；不给 MCP 自批准入口 |

来源：

- <https://code.visualstudio.com/docs/editing/workspaces/workspace-trust>
- <https://code.visualstudio.com/api/references/contribution-points#contributeswalkthroughs>
- <https://code.visualstudio.com/docs/agents/approvals>
- <https://code.visualstudio.com/docs/chat/chat-checkpoints>
- <https://docs.platformio.org/en/stable/integration/ide/vscode.html>
- <https://docs.platformio.org/en/stable/core/userguide/device/cmd_list.html>
- <https://docs.platformio.org/en/stable/home/index.html>
- <https://support.arduino.cc/hc/en-us/articles/4412955149586-If-your-board-is-not-detected-by-Arduino-IDE>
- <https://docs.warp.dev/quickstart/>
- <https://docs.warp.dev/terminal/windows/tab-configs/>
- <https://docs.warp.dev/terminal/sessions/session-restoration/>
- <https://cursor.com/docs/agent/security>
- <https://cursor.com/learn/reviewing-testing>
- <https://cursor.com/docs/agent/tools/terminal>
- <https://docs.github.com/en/copilot/responsible-use/agents>
- <https://code.claude.com/docs/en/security>
- <https://code.claude.com/docs/en/permissions>
- <https://code.claude.com/docs/en/checkpointing>

这些参考只用于交互原则，不复制专有 UI 或源码。

## 13. 成功指标

指标默认只在本地计算，不上传：

### Epic A

- `first_success_started / first_success_completed`。
- Time to Session Open。
- Time to First Signal。
- 无需离开应用完成恢复的比例。
- 每个 readiness blocker 的出现与解决次数。
- 成功后保存 profile 的比例（不作为完成门槛）。

### Epic D

- CallAttempt received 与 terminal 配对完整率；approval retry 的 logical operation 关联完整率。
- approval-required operation 的 risk/approval policy/authorization source 分布。
- 人类批准、拒绝、超时的比例和耗时。
- effect mismatch/TOCTOU 拒绝次数和 effectful-backend=0 断言结果。
- Pause 后被 blocked 的 pre-admission AI changes，以及误拒绝 human/system 的数量（目标为 0）。
- Activity Center event drop / reducer error 数量（目标为 0）。
- Broker AuthorizationRecord/consume failure 数量（目标为 0）；ledger/store failure 单独统计。
- redaction 测试和导出扫描发现敏感字段的数量（目标为 0）。

## 14. 技术形态与平台默认值

| 领域 | 推荐默认值 | 理由 |
| --- | --- | --- |
| 平台 | 继续 Electron cross-platform；Windows 首个人工验收 | 复用现有架构与主要硬件环境 |
| UI | React + 现有 Radix/Tailwind primitives | 避免引入第二套组件体系 |
| Runtime | Electron main 持有 readiness、Broker/ApprovalMode 和 activity ledger | 不能把安全决策交给可被页面控制的 renderer；ledger 不是授权 authority |
| 状态 | 纯 TS schema + append-only events + renderer reducer | 可测试、可水合、可复盘 |
| 存储 | workspace 事实留在 `.linkterm/`；UX/审计在 `userData` | 不污染项目配置且保持本地 |
| Database | 不引入 | JSON/JSONL 与有界 ring buffer 足够 |
| Realtime | 复用 IPC event push；snapshot + cursor 恢复 | 与 transcript/session 现有模式一致 |
| Auth | 本地单用户，无账号 | 当前产品拓扑不需要云认证 |
| Secrets | 继续 main-owned safe storage/瞬时载荷；ledger 只收脱敏摘要 | 保护 SSH 和 token 边界 |
| Observability | 本地结构化诊断和可选导出 | 满足复盘且不引入遥测服务 |
| Testing | Vitest unit/integration + happy-dom UI +有限 Electron 手工验收 | 复用当前 1000+ 测试体系 |

## 15. 非目标与边界

- 不自动修复驱动、安装系统包或修改用户 shell 配置，除非另立规格。
- 不为所有 MCP 工具逐个设计独特 UI；统一 operation 模型，approval-required operation 补充后果摘要器。
- 不把 terminal output 全量镜像到 Activity Center。
- 不提供永久“始终允许此 Agent”按钮。
- 不创建云端用户、组织、RBAC、远程审批或共享链接。
- 不在同一实现 change 中拆分所有大型历史文件；只做支撑当前边界所需的定向提取。

## 16. 项目级完成定义

项目只有在以下条件全部满足时，才能宣称 A + D 完成：

- 首次串口 happy path、无设备、端口占用、无输出和物理断连均有自动化或明确手工验收。
- silent→late signal、firstSignal reload/status-event race、不完整 UTF-8、delayed xterm ack、dispose/unmount 与 ownsSession recovery 均有自动化验收；只有真实 device 文本的 xterm completion ack 才完成，late signal 不无条件抢焦点。
- J-Link/RTT 使用同一 readiness 和 operation 模型，没有平行状态系统。
- 所有 63 个生产 MCP 工具在进入 handler 后都产生可查询 CallAttempt lifecycle；每次调用有唯一 `callId` 与终态，approval retry 复用服务端逻辑 `operationId`，SDK pre-handler validation 单独记录 diagnostic。
- `interactive-required` operation 无法仅凭 `confirm=true` 绕过人类 approval grant，且窗口/Renderer/transport/legacy client 不能降级 ApprovalMode。
- MCP 与 Control Profile direct download IPC 均不能绕过 PreparedOperation/Broker；stable principal、kind/surface/mode continuation、resolve-does-not-execute、wrong-consumer effectful-backend=0/preserve-grant、duplicate no-reexecute、prepare quota/backpressure 与资源释放均有测试。
- AI pause 对尚未 admission 的 AI changes 生效，允许 read-only AI，并且不阻止 human/system 和紧急 high-priority 输入；已持有 execution lease 的 operation 与三档 stop control 有明确 UI 和竞态测试。
- activity snapshot/cursor 可在 renderer 重载后恢复；达到容量上限时行为可预测。
- redaction 测试覆盖凭据、token、脚本、路径、firmware 和 binary payload。
- 中英文、键盘、screen reader、reduced motion 和非颜色状态表达通过检查。
- lint、build、全量 test、license validation、生产依赖 audit 和相关 PDG/taint 检查有新鲜证据。
- 文档、OpenSpec、MCP 工具数/错误码和用户帮助同步更新。

## 17. 已确认决策

项目负责人已在 2026-07-11 确认以下产品决策：

1. 采用 Phase 0 → Ledger → Activity → Readiness → Serial → Human Approval → J-Link/RTT → Pause/Take Over → Audit 的交付顺序。
2. desktop=`interactive-required`、headless=`headless-deny`；首版不启用 `automation-allowlisted`。
3. 脱敏 durable audit 默认开启，保留 30 天，单文件 10 MiB 轮转。
4. Windows-first 手工验收，同时保持 macOS/Linux 类型、构建和核心逻辑自动化兼容。

高保真 UI mockup 与失焦时 OS notification 仍是可选改进，不影响以上已确认决策。

## 18. 下一步

完成并审阅 `establish-characterization-ci-gates` Phase 0 OpenSpec 和精确实现计划；不要跳到 Operation Event，也不要把整个计划作为一个 change 实现。
