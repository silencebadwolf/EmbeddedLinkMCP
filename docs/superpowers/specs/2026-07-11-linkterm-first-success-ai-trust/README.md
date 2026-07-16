# LinkTerm 首次成功与 AI 可信协作计划

- 状态：Reviewed — Phase 8 implementation complete; observe-only override recorded; project-level final audit pending
- 模式：Full
- 当前结论：PASS
- 最后更新：2026-07-15

## 一句话摘要

把 LinkTerm 从“能力完整但需要用户自己拼接流程”的工具，推进为能够引导用户让首段非空设备文本真正出现在终端，并让每一次 AI 操作都可见、可解释、自动执行的嵌入式终端工作台。

## 当前下一步

Phase 0–8 的独立 OpenSpec、实现计划和工程证据已建立；Phase 8 Durable Audit 的 closeout
见 [`docs/engineering/phase-8-durable-audit-evidence.md`](../../../engineering/phase-8-durable-audit-evidence.md)。
产品负责人随后明确选择“AI 自动执行、Activity/Transcript/Audit 仅观察”，该覆盖变更记录在
[`observe-only-ai-execution`](../../../../openspec/changes/observe-only-ai-execution/proposal.md)
及 [`observe-only-ai-execution-evidence.md`](../../../engineering/observe-only-ai-execution-evidence.md)
中；原 Phase 5 的人类批准和 Phase 7 的暂停/接管机制不再是运行时要求。
当前只剩项目级完成定义的最终人工/发布审计：既有 worktree 仍未提交，不能把阶段证据误写成
A+D 整体完成。

## 产物地图

- [00-idea-capture.md](./00-idea-capture.md) — 原始目标、问题、范围与默认假设。
- [01-design-doc.md](./01-design-doc.md) — 产品方向、用户旅程、需求编号、成功指标和范围策略。
- [02-ui-design-brief.md](./02-ui-design-brief.md) — Start Center、Activity Center、审批与接管界面的逐屏设计要求。
- [03-implementation-spec.md](./03-implementation-spec.md) — 架构、数据模型、API、阶段、任务、测试与迁移策略。
- [04-agent-build-handoff.md](./04-agent-build-handoff.md) — 可交给编码 Agent / Superpowers 的单文件构建真源。
- [05-spec-review.md](./05-spec-review.md) — 一致性、可测试性和执行准备度评审。

## 构建交接文件

后续实现以 [04-agent-build-handoff.md](./04-agent-build-handoff.md) 为入口，并以其他文档补充产品与 UI 细节。不得跳过 [05-spec-review.md](./05-spec-review.md) 中的构建前修改。

## 分阶段完成路线

| Phase | 可独立验收的结果 |
| --- | --- |
| 0 | Characterization、63-tool 风险清单和 CI 门禁；无产品行为变化 |
| 1 | Operation/CallAttempt ledger；进入 handler 的调用可查询 |
| 2 | Activity Center；AI 动作、步骤和结果重点可见 |
| 3 | Runtime Readiness + Start Center；从任务而非 transport 开始 |
| 4 | Serial First Signal；非空 device 文本经 xterm 异步确认后可见 |
| 5 | （历史规格）Human Approval Broker；已被 observe-only 决策覆盖，运行时不再请求批准 |
| 6 | Workspace + J-Link/RTT；下载并观察自动执行，Activity/Audit 仅作观察 |
| 7 | （历史规格）Pause / capability-aware Stop / Take Over；已被 observe-only 决策覆盖 |
| 8 | Durable Audit、导出、隐私、性能、a11y 与发布闭环 |

各阶段证据索引：Phase 1–6 见 `docs/engineering/phase-1..phase-6-*-evidence.md`，Phase 7
见 [`phase-7-ai-pause-takeover-evidence.md`](../../../engineering/phase-7-ai-pause-takeover-evidence.md)，
Phase 8 见 [`phase-8-durable-audit-evidence.md`](../../../engineering/phase-8-durable-audit-evidence.md)。

## 推荐决策

1. 采用“共享可信基础 + 两条纵向体验切片”，不做一次性大改版。
2. 第一条用户可见切片是只读 Activity Center，让 AI 行为先变得可见；此前的 Phase 0/1 是安全与可观测底座。
3. A 的第一个 happy path 聚焦“串口设备 → 会话打开 → 非空 device 文本经 xterm 确认后可见”。
4. 串口切片之后先交付 Human Approval Broker，再扩展 J-Link/RTT 的“下载并观察”，避免先扩大高影响入口再迁移审批语义。
5. 桌面安装默认使用 `interactive-required`：approval-required 操作采用一次性人类授权，窗口隐藏、关闭或 Renderer 重载都不得降级为仅有 caller/client acknowledgement；真正 headless 默认拒绝。首版不启用 `automation-allowlisted`，未来若引入必须另立 change 和显式可信启动入口。
6. 全部数据默认留在本机；不引入云端账号、远程审批或遥测服务。

## 已确认决策

- [x] 接受 Phase 0 → Ledger → Activity → Readiness → Serial → Human Approval → J-Link/RTT → Pause/Take Over → Audit 的交付顺序。
- [x] 接受 desktop=`interactive-required`、headless=`headless-deny`；首版不启用 `automation-allowlisted`。
- [x] 接受脱敏 durable audit 默认开启，保留 30 天，单文件达到 10 MiB 时轮转。
- [x] 接受 Windows-first 手工验收，同时保持 macOS/Linux 类型、构建和核心逻辑自动化兼容。

## 默认假设

- 第一真实用户是会使用串口/J-Link，但不熟悉 LinkTerm 内部模型的嵌入式开发者。
- 产品继续是 local-first、single-user、cross-platform Electron 应用。
- 现有 React、Zustand、xterm.js、Radix、IPC、MCP、SessionManager 和 manager 注入模式继续使用。
- 不新增数据库；工作区事实继续保存在 `.linkterm/`，全局 UX 偏好和脱敏审计记录放在 Electron `userData`。
- UI 延续现有深色开发工具风格，中英文同时交付，不引入新的重型设计系统。
- GitNexus 已通过 `.gitnexusrc` 启用 PDG/taint；分析结果只能作为证据补充，`0 findings` 不是安全证明。
- 本包已通过产品级评审；每个 Phase 仍须由独立 OpenSpec、精确计划和阶段门禁授权，不授权一次性实现全部 A+D。

## 非目标

- 不把 LinkTerm 变成完整 IDE、Agent 聊天客户端或云端设备平台。
- 不在本轮实现远程多人审批、组织策略中心、账号系统或跨设备同步。
- 不声称能够撤销已经发生的复位、擦除、烧录等物理操作。
- 不保存 SSH 密码、私钥、token、完整终端内容、固件二进制或原始 Commander 脚本到审计记录。
- 不为追求“智能”而自动执行高影响修复；向导只自动执行只读检查和明确授权的动作。

## Superpowers 准备度

- [x] 产品目标清楚。
- [x] A、D 已拆成可独立验收的需求组。
- [x] 推荐架构、数据位置和技术默认值已记录。
- [x] 测试、验证命令和完成定义已包含。
- [x] 非目标可约束范围漂移。
- [x] 用户已审阅并接受关键默认决策。
- [x] Spec review 结论已升级为 PASS。
