# LinkTerm 首次成功与 AI 可信协作 — UI 设计简报

> **2026-07-15 产品覆盖决策**：UI 不显示批准/拒绝/继续批准或暂停 AI 控件；AI 状态、步骤、
> 结果和审计仍需可见。本文早期审批与接管线框仅作历史参考，当前 UI 以
> [`observe-only-ai-execution`](../../../../openspec/changes/observe-only-ai-execution/proposal.md) 为准。

- 状态：Reviewed — phased delivery in progress
- 平台：Electron desktop，Windows-first 手工验收，保持 macOS/Linux 兼容
- 视觉策略：延续现有深色专业终端，增加任务引导与可信状态，不做通用 SaaS dashboard

## 1. 目的

本简报把两个产品目标转换为可实现界面：

- **A**：没有活跃会话时，用户从“我想完成什么”开始，并在同一流程中确认首段非空设备数据已经在终端可见。
- **D**：无论用户当前是否在向导里，都能看见 AI 的当前状态、动作时间线、审批请求、结果与接管控制。

终端始终是核心工作面。新增 UI 应帮助用户开始、理解和恢复，而不是长期占据输出空间。

## 2. 产品感受

- **Calm command center**：信息密度适中，关键状态明确，不靠大量卡片营造“高级感”。
- **Professional and honest**：明确区分检测到、推断到、等待中、失败、用户批准和 caller/client acknowledgement。
- **Progressive disclosure**：默认显示任务、阻塞和下一步；VID/PID、错误码、artifact hash 和 Main 生成的 display-safe request revision 等放在详情；不暴露内部 effect fingerprint。
- **Device-aware**：动作始终关联真实 workspace、session、port 或 probe，不出现与产品无关的假指标。
- **Human in control**：暂停、拒绝、按能力请求停止和接管按钮比装饰性 AI 动画更重要。

## 3. 设计原则

1. **任务优先于 transport**：首层说“观察设备输出”，第二层才选择串口/RTT。
2. **事实优先于步骤**：完成标记来自 readiness/session/transcript 事件。
3. **风险与审批分离**：只读检查静默运行并可在时间线查询；`approvalPolicy=human-once` 才使用阻断式界面，不能只凭颜色或模糊“高风险”标签决定。
4. **结果与恢复同屏**：错误发生在哪一步，就在该处修正和重试。
5. **不自动选择低置信候选**：只有一个候选也展示选择依据；多个设备不得静默提交第一个。
6. **状态不能只靠颜色**：图标、文字、aria label 和时间同时表达。
7. **不展示模型思维链**：只展示可核验的动作、目标、输入摘要、结果和后果。
8. **不虚构可逆性**：当前不承诺 checkpoint；若宿主/未来版本提供文件/config checkpoint，必须与硬件 `OperationReceipt` 分开，后者只是证据。

## 4. 主要界面

### 4.1 Start Center

当没有活跃 session 时替换当前简单空状态。它不是永久首页，也不是强制 modal wizard。

```text
┌──────────────────────────────── LinkTerm ────────────────────────────────┐
│ Profiles       │  Start                                                 │
│                │                                                        │
│ Recent         │  What do you want to do?                              │
│ • board-a      │  ┌ Observe device output ───────────────────────────┐  │
│ • lab-shell    │  │ Scan serial/RTT and reach the first signal       │  │
│                │  └──────────────────────────────────────────────────┘  │
│                │  ┌ Open a terminal ┐  ┌ Flash and observe ┐           │
│                │                                                        │
│                │  Readiness                                             │
│                │  ✓ Runtime   ○ Device   ! Workspace (optional)         │
│                │                                                        │
│                │  [Advanced connection…]                                │
└─────────────────────────────────────────────────────────────────────────┘
```

要求：

- 首屏一个主动作，次动作不超过三个。
- readiness 未完成时使用 skeleton/“正在检查”，不得闪烁“未发现设备”。
- 有最近 profile 时，显示“继续上次配置”，但仍展示将使用的设备参数。
- 已有活动 session 时默认不占据主画布；从侧栏或命令入口重新打开。
- “Advanced connection” 打开现有 ConnectionDialog，而不是删除专业入口。

### 4.2 First Success Flow

推荐使用主画布内的可续跑步骤，而不是狭窄 modal：

```text
Observe device output

1  Check environment     ✓
2  Choose device         ●
3  Review connection     ○
4  Wait for first signal ○

Detected devices
┌ COM7  USB Serial Device ───────────────────────────────────────────────┐
│ VID:PID 0483:5740 · detected now · recommended from saved profile     │
│ [Use this device] [Details]                                           │
└───────────────────────────────────────────────────────────────────────┘

[Enter a port manually]                                      [Cancel]
```

要求：

- 步骤可回退，已经执行的有副作用动作不因回退而假装撤销。
- 每步完成由真实事件自动判定；用户仍可重新检查。
- 非敏感输入在切换高级表单或暂时离开时保留。
- 多候选显示证据与置信度，不默认连接列表第一项。
- 串口空列表必须同时提供 Refresh、Manual entry 和 Diagnose。

### 4.3 Connection Plan Review

执行前显示紧凑计划：

```text
Ready to connect

Device       COM7 — USB Serial Device
Settings     115200 · 8N1 · terminal mode
Control      DTR/RTS behavior shown explicitly
Workspace    D:\fw\board-a (optional)
Impact       Reserves COM7; sends no payload during connect; control-line changes may reset some boards
Source       Detected now + saved profile

[Connect and wait for output]   [Edit]
```

串口观察不等于“完全无副作用”：打开端口会独占资源，DTR/RTS/control-line 变化可能复位某些板卡。连接计划必须展示这些设置；连接阶段 write 调用为 0。若向导会主动发送换行、探测命令或 reset，则必须作为后续动作单独显示并按风险策略处理。

### 4.4 Waiting for First Signal

Terminal 立即可见，状态条位于终端上方或空白区域内：

- `Opening COM7…`
- `Connected. Waiting for device output… 00:08`
- `Received device output in 3.2s`
- `Connected, but no output yet`：向导创建的 session 显示 Diagnostics/Keep waiting/Disconnect and edit/Disconnect；重用既有 session 隐藏 Disconnect and edit，改为 Diagnostics/Keep waiting/Back to session/Disconnect。

不得用无限 spinner 表示静默设备。静默是独立状态，不等于连接失败。

动作语义必须明确：Keep waiting 保持 monitor；Disconnect and edit 只在 `ownsSession=true` 时可见，停止 monitor、关闭本次向导创建的 session 并释放端口后返回 draft；`ownsSession=false` 只显示 Back to session（停止 observation、保留 session）和显式 Disconnect（关闭 session）。用户主动关闭显示 `Disconnected by you`，不得冒充物理断连。所有路径都要幂等清理 timer/listener，旧 attempt 不能推进后续流程；同一 ownership × action 矩阵也适用于 data-received-but-display-unavailable。

### 4.5 AI Status Capsule

Header 中常驻、宽度受控：

```text
[AI: Idle]
[AI: Running · Open serial session]
[AI: Waiting for approval · 1]
[AI changes: Paused] [Approval: 1]
[AI changes: Paused] [Approved: 1]
[AI: Needs attention]
[AI: Paused by you]
```

点击打开 Activity Center。Pause 是不可被其他状态覆盖的独立 latch：一旦用户暂停，capsule 始终显示 `AI changes: Paused`，同时用并列 badge 表达 pending approval、approved 或 needs attention。非暂停时主状态优先级为 pending approval > failed needs attention > running > idle。不能因某个低价值 read-only 调用持续闪烁。

### 4.6 Activity Center

右侧 drawer，默认覆盖主画布而不是永久压缩 terminal：

```text
┌ Activity · Active & attention ───────────────┐
│ [Active & attention] [History ▾] [Filters ▾] │
│                                              │
│ ● Running  Download firmware                 │
│   board-a · step 2/4 · 18s                   │
│   [Stop at safe point]                       │
│   ├ Connect probe                    ✓       │
│   ├ Flash firmware                   ● 61%   │
│   ├ Verify                           ○       │
│   └ Observe RTT                      ○       │
│                                              │
│ ! Approval denied  Reset CPU                 │
│   AI · probe jlink-2 · 14:22:08      [View]  │
│                                              │
│ ▸ Recent history · 7 operations       [View] │
│   Includes 5 folded read-only checks          │
└──────────────────────────────────────────────┘
```

要求：

- 默认只置顶 active、pending approval、needs-attention 和 AI correlation/task groups；普通历史与 read-only burst 默认折叠，可用筛选展开。
- 100% 进入 handler 的 operation/call attempt 在保留窗口内可查询，但不把每个 MCP call 都做成顶层卡片。
- 一条 operation 展开后显示 events，不把每个 event 都做成顶层噪声。
- 默认不显示完整命令/脚本/路径；点击 Reveal 时仍服从 redaction policy。
- 支持按 actor、risk、phase、session/workspace 过滤。
- 从 session tab 的 OriginIndicator 点击时，打开已过滤的时间线。
- renderer reload 后先 snapshot 再订阅增量，避免事件间隙。
- 大量事件使用虚拟列表或有界渲染，不影响 xterm 输入和滚动。
- M2 至少提供 `Go to session`、`Diagnose` 和 `Copy summary` 三类上下文动作；不可用时说明原因。
- Approval/authorization label 按下表映射；automation 不得使用 human-approved 图标/文案，各状态 screen-reader 文本不同。

| approvalPolicy | clientAcknowledged | authorizationSource | 标签 |
| --- | --- | --- | --- |
| `none` / `notify` | 任意 | `none` | `Approval not required` 或不显示 |
| `human-once` | `false` | `none` | `Client acknowledgement required` |
| `human-once` | `true` | `none` | `Client acknowledged · not authorized` |
| `human-once` | `true` | `human-grant` | `Approved once by you` |
| 任意允许 automation 的策略 | 任意 | `automation-policy` | `Authorized by local automation rule <ruleDisplayId>` |

`ruleDisplayId` 是 Main 生成的 display-safe、非敏感投影；Renderer 不接收内部 allowlist 配置、原始 rule id/path 或 `AuthorizationRecord`。

### 4.7 Approval Sheet

approval-required operation 使用由 main process 驱动的 sheet/modal；`ui_configure` 不能触发批准按钮。

```text
AI requests approval for a firmware update plan

Target       J-Link probe …A42 / STM32H743
Workspace    D:\fw\board-a
Prepared     profile rev 8f31 · target defaults expanded
Artifact     app.hex · SHA-256 91…2c · 482 KiB
Plan         1. Erase 0x08000000–0x081FFFFF (2 MiB)
             2. Flash the exact prepared app.hex bytes
             3. Verify flashed address segments against the prepared image
Impact       Existing firmware will be replaced. No automatic rollback exists.
Expires      01:42

[Deny]                     [Approve this plan once]
```

要求：

- 默认焦点在标题或 Deny，不默认聚焦 Approve。
- Approve 必须精确匹配 scope：完整 plan 使用 `Approve this plan once`；单动作 erase 才使用 `Approve erase once`，不能只写 OK。
- 不提供首版 Always Allow。
- 参数、默认值、realpath、artifact 内容、profile revision、probe/target 或步骤改变后旧审批不能复用；UI 显示“Request changed, review again”。
- 每步 range/参数/target 文案来自 Main 生成的 display-safe `effectSummaryCode + parameterSummary + targetRefs`，不能从 hash/fingerprint 猜。Artifact SHA-256 只标识获批输入；只有 backend 确实对设备计算同算法 hash 时才能写“verify against SHA-256”。长参数可展开。
- 拒绝后 Activity Center 保留 `ApprovalDecisionRecord`，requested effect 未执行；它不是 `OperationReceipt` 或 Broker 内部 `AuthorizationRecord`。
- ApprovalDecisionRecord 表示“决定本身不执行 backend”，不是对未来是否执行的永久断言；最终执行状态只看 Operation lifecycle / OperationReceipt。
- 超时后界面不可继续点击旧请求。
- 无法恢复的硬件后果使用清晰文案；不借用文件 checkpoint 的 undo 表达。
- Main 以内部 `runtimeId + approvalMode + authorizedPrincipalId + continuation kind/surface/executionMode + effectFingerprint` 去重，但该 key 不进入 Renderer DTO；同一请求只显示一次并更新 badge，不同请求在单一 sheet 后排队，不能堆叠 modal 或重复 assertive notification。
- 排队项在展示前过期时，从 queue 移除并留下 `Expired · not reviewed · requested effect not executed` ApprovalDecisionRecord；不得弹出迟到 sheet/notification。
- 达到 quota 时分别显示 `Approval queue is full`、`Prepared artifact is too large` 或 `Too many preparation requests · retry in <retryAfter>`，提供 Retry later / Copy summary；不自动淘汰已批准未消费项。
- 用户批准时若 AI changes 已暂停，显示 `Approved · paused`；不得执行，Resume 后仍需复验指纹、目标与有效期。若暂停期间过期，转为 `Expired · not executed`。
- Direct Download 的 Approve 在当前 Renderer 存活时可紧接着发起绑定 continuation；`approval:resolve` 自身不执行。若批准后 Renderer reload，显示 `Approved · ready to continue` 和显式 Continue，不自动运行。

### 4.8 Pause / Stop / Take Over

- Header capsule 菜单提供 `Pause AI changes` / `Resume AI changes`；辅助文案说明 read-only checks 仍可继续。
- `AbortSignal` 本身不证明可安全停止。backend/job 必须声明 cancellation capability：`safe-point` 才显示 `Stop at safe point`；`best-effort` 显示 `Request stop (best effort)`；`none` 不显示按钮。
- Session 级 `Take over`：暂停该 session 尚未 admission 的 AI changes、聚焦 terminal、展示 human high-priority 输入提示。
- 内部 `cancel-requested` 与 `cancelled` 是两个状态；用户文案显示 `Stop requested`，硬件已进入不可中断区时显示“Stopping at the next safe point”。
- Pause 不应关闭 session 或隐藏 AI 已执行结果；已经 running/持有 execution lease 的计划可能继续，必须在 capsule 和 operation 上明确提示，用户另行使用相应 stop control。

## 5. 逐屏状态矩阵

### 5.1 Start Center

| 状态 | 主文案 | 主要动作 | 次要动作 |
| --- | --- | --- | --- |
| Loading | 正在检查本机环境 | 无 | Advanced connection 可选 |
| Ready, no history | 连接设备并查看首个信号 | Observe device output | Open terminal |
| Recent profile | 继续 board-a | Continue | Review details |
| No device | 未检测到串口或探针 | Refresh | Manual entry / Diagnose |
| Discovery failed | 无法扫描本机设备 | Retry | Copy diagnostics |
| Runtime stale | LinkTerm runtime 需要更新/重启 | Repair/Restart | View details |

### 5.2 First Signal

| 状态 | 表达 | 禁止行为 |
| --- | --- | --- |
| Opening | 明确目标和已耗时 | 不提前显示成功 |
| Open, silent | “已连接，等待输出” | 不自动断开、不宣告设备故障 |
| Data received, not visible | 检测到设备信号，但终端显示通道不可用 | 不宣称首次成功；修复订阅后 replay，并等 xterm completion ack |
| Signal visible | 若焦点仍在 first-success flow 且没有 modal/输入冲突，则聚焦 terminal；否则只更新状态并提供 Go to terminal | 不弹全屏庆祝，也不因 late signal 抢走 Activity、审批或表单焦点 |
| Subscribe failed | UI 数据通道失败 | 不伪装为设备静默或 journey completed |
| Transport error | 分类错误与原地修复 | 不关闭表单只留下 errored tab |
| Disconnected · transport | 物理断连 + Reconnect | 不显示未知 INTERNAL |
| Disconnected by you | 明确是用户操作；Edit connection / Done | 不冒充物理故障或自动重连 |

### 5.3 AI Operation

| 状态 | UI |
| --- | --- |
| Requested | 时间线轻量条目 |
| Awaiting approval | Header badge + Approval Sheet |
| Approved · paused | grant 尚有效但 admission 被 Pause 阻止；Resume 后复验 |
| Approved · ready to continue | direct IPC 批准后 Renderer reload；显式 Continue，不自动执行 |
| Queued | 显示队列原因/位置（可用时） |
| Queue full / Prepare too large / Rate limited | requested effect 未执行；分别显示容量、大小或 retryAfter，提供 Retry later、Copy summary |
| Running | 当前 step、进度、耗时；按 capability 显示 Stop at safe point / Request stop (best effort) / 无按钮 |
| Succeeded | 结果摘要、evidence 跳转 |
| Failed | 影响、错误码、下一步 |
| Denied/Expired | 明确 requested effect 未执行 |
| Stop requested | 内部为 cancel-requested；等待安全停止，不等同 cancelled |
| Interrupted/Unknown | 应用重启后诚实表示结果未知 |

## 6. 组件清单

### Shared

- `StatusBadge`：文字 + 图标 +颜色。
- `EvidenceDetails`：脱敏详情、复制摘要。
- `TargetSummary`：workspace/session/probe/port 的统一显示。
- `RiskBadge`：统一 risk policy 映射。
- `ElapsedTime`：节流刷新，尊重 reduced motion。

### Epic A

- `StartCenter`
- `TaskIntentCard`
- `ReadinessChecklist`
- `ReadinessIssue`
- `DeviceCandidateList` / `DeviceCandidateCard`
- `ManualPortEntry`
- `ConnectionPlanReview`
- `FirstSignalStatus`
- `RecoveryActions`
- `SaveSuccessfulConnectionPrompt`

`RecoveryActions` 仅在 Main 提供有效 `CompensationCandidateSummary` 时显示 `Prepare reflash of previous firmware…`。内部 Candidate 必须来自同一 target binding 上一次已知成功且 verified 的部署，含 sourceOperationId、Main-owned artifact ref、SHA-256/size，并在显示与点击时复验；Renderer 只接收 display-safe summary，绝不接收 source ref。不能从失败 OperationReceipt 或当前文件猜测。点击只创建新的 PreparedOperation + 完整 plan approval；绝不命名为 Undo/Restore，也不直接执行。

### Epic D

- `AiStatusCapsule`
- `ActivityCenter`
- `OperationTimelineItem`
- `OperationStepList`
- `ApprovalSheet`
- `PauseAiControl`
- `TakeOverControl`
- `AuditExportDialog`

组件必须通过 props/typed hooks 消费 DTO；不得直接调用 Electron 或 MCP。

## 7. 与现有 UI 的关系

- `App.tsx` 已接近 1000 行：只负责布局和组合，不继续加入向导 reducer 或 activity 聚合逻辑。
- `ConnectionDialog.tsx` 保留高级路径；逐步提取串口字段组件供 guided flow 复用。
- `SerialPortPicker` 当前会自动选择首个端口且空状态没有手动入口；guided flow 必须改为候选列表 + 明确选择，现有 picker 可继续用于高级表单直到迁移。
- `ControlProfilePanel` 保持 profile 编辑/保存职责；首次流程调用同一 manager/API，不复制 schema。M5 后 Download 点击只发起 PreparedOperation/plan review，必须经过同一 Approval Sheet；不得因动作来自可信 Renderer 或旧 IPC 硬编码 `confirm:true` 而跳过。
- `OriginIndicator` 从装饰性点升级为 Activity Center 入口；仍可保留紧凑 tab 提示。
- `useSessionHydration` 当前对 AI 创建 session 自动抢焦点；新行为改为 badge/toast，只有用户启用“Follow AI”或当前没有交互中的 session 时才切换。

## 8. 导航与焦点

- `Ctrl/Cmd+Shift+A`：打开/关闭 Activity Center（最终快捷键可调整）。
- `Esc`：关闭 drawer；审批 sheet 中 Esc 等同不决定，不自动 Deny/Approve。
- pending approval 到达时使用 `aria-live=assertive`，但不从正在输入的 terminal 强行抢焦点；Header badge 和系统通知可提示。
- Start Center 的主流程支持 Tab/Shift+Tab、Enter/Space 和方向键。
- modal 关闭后焦点回到发起位置。
- 终端拥有焦点时，除明确全局快捷键外不截获字符输入。

## 9. 视觉方向

### 已选默认方向：Calm Embedded Workbench

- 保持现有灰黑背景、低饱和边框和有限强调色。
- Ready/success 使用克制绿色；waiting 使用蓝色；attention 使用琥珀色；danger 使用红色。
- AI 不使用夸张紫色渐变或持续发光；actor 通过图标、文字和 badge 表示。
- 主要动作每个区域最多一个实心按钮。
- 信息密度类似成熟 IDE 侧栏/面板，而不是营销 landing page。
- 设备标识、参数和结果使用等宽字体；解释文案使用 UI 字体。
- 动画只用于短暂状态变化，支持 `prefers-reduced-motion`。

## 10. 内容与文案

文案应回答动作和后果：

- 推荐：`Connected to COM7. Waiting for device output…`
- 避免：`Loading…`
- 推荐：`No serial ports were detected. Refresh, enter a port manually, or open diagnostics.`
- 避免：`No data`
- 推荐：`AI requested a CPU reset. The target will restart and the current debug state will be lost.`
- 避免：`Confirm operation?`
- 推荐：`Approval expired. Nothing was executed.`
- 避免：`Request failed`

所有新文案必须同时加入 `en.ts` 与 `zh.ts`，错误 details 不直接作为用户主文案。

## 11. 可访问性

- WCAG 2.1 AA 对比度目标。
- actor、risk、phase 均有可读文本。
- OriginIndicator 每个 actor 有独立 accessible name 和最近活动描述。
- 进度条提供 `aria-valuenow/min/max`；未知进度使用可读状态，不伪造百分比。
- timeline 新事件使用礼貌 live region；approval-required sheet 使用 assertive。
- approval 倒计时不每秒向 screen reader 广播。
- 不将 tooltip 作为唯一信息来源。
- 所有图标按钮有 label；所有错误与对应字段关联。

## 12. 响应式与窗口尺寸

- 目标最小窗口宽度建议 1024px；低于该宽度 Activity Center 全屏覆盖内容区。
- Start Center 内容最大宽度约 760–900px，避免横向拉散。
- Connection plan 在窄窗口改为单列。
- Terminal 不因 drawer 打开而缩小到不可用；优先 overlay。
- 不做 mobile/native 响应式设计，本轮仅桌面窗口。

## 13. 可选视觉概念提示词

这些提示词仅用于未来概念探索，书面 brief 才是真源。

### 保守方向

为 LinkTerm 创建高保真 desktop Electron UI concept screenshot。屏幕：无活跃终端时的 Start Center。目标用户：嵌入式开发者。产品感受：熟悉的 VS Code/terminal 工具、专业、低风险。布局：左侧已有 profiles，主区域为一个主要任务“Observe device output”、紧凑 readiness checklist 和 advanced connection 链接。必须展示串口扫描、recent profile、loading/empty state。避免 generic SaaS cards、图表、stock photo、紫色 AI 渐变和假指标。

### 最契合方向

为 LinkTerm 创建高保真 desktop product UI concept screenshot。屏幕：串口 first-success flow 与右侧 AI Activity Center 同时可见。目标用户：MCU/RTOS 工程师。产品感受：calm embedded command center。主区展示设备候选、连接计划和“waiting for first signal”；右侧时间线展示 AI requested/running/succeeded 和一个待审批动作。深色、清晰层级、适中密度。避免聊天气泡、营销面板、思维链、不可读小字和过度动画。

### 发散方向

为 LinkTerm 创建高保真 desktop UI concept screenshot。屏幕：硬件操作 consequence map。主区仍是 terminal，顶部显示 AI 状态胶囊；右侧 operation timeline 用可展开步骤表示 probe connect、flash、verify、RTT observe，并明确宿主可能提供的 file/config checkpoint 与 `OperationReceipt` 的边界。风格有辨识度但仍专业，使用工程图式细线和有限强调色。避免把 OperationReceipt 画成恢复点、避免把硬件动作显示成普通 undo，也避免 futurist HUD。

## 14. UI 验收要点

- 首次用户无需理解 `SessionManager`、MCP surface 或 control profile schema 即可让首个串口信号在终端可见。
- 已有用户可绕过向导，且终端主流程不退化。
- 0/1/多个设备、扫描失败、open 失败、silent device、subscribe 失败、断连均有不同状态。
- 连接计划准确说明端口独占、DTR/RTS 和潜在复位；连接阶段不发送 payload。
- AI 的终端与非终端操作都可在 Activity Center 查询；默认按 active/attention/task group 展示，read-only burst 可折叠。
- caller acknowledgement、人类批准和 automation rule authorization 在文案、图标与 screen-reader label 上不可混淆。
- Pause 文案为 `Pause AI changes`，且明确已运行 operation 可能继续、stop control 是独立动作并按 capability 命名。
- keyboard、screen reader、reduced motion、中英文和小窗口状态有测试或手工验收记录。
- 所有 approval-required operation 的后果卡不承诺不存在的硬件 rollback。

## 15. 开放问题

- 是否需要在实现前生成/评审高保真 mockup；默认先用本 brief 构建最小可用版本。
- 是否允许 OS notification 提醒待审批；默认仅在窗口失焦时启用，且通知不包含敏感参数。
- Activity Center 默认保留多少可见 operation；实现规格推荐内存 1000 条、落盘 30 天/10 MiB 轮转。
