# LinkTerm 首次成功与 AI 可信协作 — 想法捕获

> **2026-07-15 产品覆盖决策**：AI 操作全部自动执行，Activity/Transcript/Audit 仅用于观察。
> 本文早期关于人类审批、Pause/Take Over 的描述保留为历史设计背景，运行时以
> [`observe-only-ai-execution`](../../../../openspec/changes/observe-only-ai-execution/proposal.md)
> 为准。

- 模式：Full
- 来源：用户选择方向 A 与 D，并要求形成详细完成文档。
- 临时产品名：First Success & AI Trust Program

## 原始目标

继续完成 LinkTerm，使用户体验明显优于“功能都在，但需要自己理解每个面板、MCP 工具和硬件前置条件”的当前状态。

两个优先方向：

- **A — 首次成功旅程**：从打开应用开始，帮助用户识别环境和工作区、连接目标设备，并确认首段非空设备数据已经在终端可见。
- **D — AI 可信协作**：让用户随时知道 AI 正在做什么、为什么做、结果如何；高影响操作有明确审批；用户可以暂停、拒绝、按 backend 能力请求停止或接管。

## 当前问题陈述

LinkTerm 的底层能力已经较完整，但体验仍以“能力入口”而不是“用户任务”组织：

1. 空状态只提示点击“新建”，随后直接进入串口、SSH、本地 Shell、RTT 等 transport-first 表单。
2. 工作区、控制配置、串口发现、J-Link、固件、RTT 和 Agent 集成分别存在，用户仍需理解正确顺序。
3. 失败结果大多显示错误消息，但不总能把错误转换成当前上下文中的下一步动作。
4. UI 能用三个 origin 点表示近期 AI / human / system 活动，但不能回答“AI 做了什么、是否仍在运行、影响了什么”。
5. MCP 工具已经统一返回 `origin`、`correlationId` 和 evidence，也有 `confirm=true` 门禁；但 `confirm=true` 是调用方声明，不等于桌面用户完成了审批。
6. 人和 AI 可以共享同一会话，却缺少面向用户的暂停 AI 写入、拒绝高影响动作和结构化复盘界面。

## 产品信念

- 第一次使用不应要求用户先读完架构文档。
- 每个自动化动作都应能被人类理解，而不是只在日志中可追踪。
- 安全不仅是“拒绝危险调用”，还包括在正确时机解释影响、提供可恢复路径和明确控制权。
- 向导应该展示真实系统状态，不维护一套容易漂移的“步骤完成”假状态。
- 终端仍然是主工作面；体验增强不能遮挡输出、降低输入响应或把产品变成通用 dashboard。

## 目标用户

### 主要用户

使用 Windows/Linux/macOS 进行 MCU/RTOS 开发的工程师，能够理解串口、J-Link、RTT、固件等概念，但不应被要求理解 LinkTerm 的内部 session、surface、backend 和 runtime 拓扑。

### 次要用户

- 使用 VS Code GitHub Copilot、Claude Code、Codex 或其他 MCP Host 的开发者。
- 需要复盘 AI 与人工共同操作过程的项目维护者。
- 已经有工作区配置，希望重复打开时快速恢复上下文的高频用户。

## 最小成功定义

### A 的最小成功会话

用户在干净或半配置环境中打开 LinkTerm，选择“观察串口输出”，系统识别或允许手填端口，展示连接对端口占用和控制线的影响，成功打开会话，并明确确认首段非空设备数据已经在终端渲染；失败时无需离开应用即可知道最可能原因和下一步。

### D 的最小成功会话

AI 通过 MCP 创建会话、写入命令或发起 approval-required operation 时，桌面 UI 能实时显示动作名称、目标、阶段、结果和来源；interactive-required 模式必须经过一次性人类批准；用户可以 Pause AI changes，并对支持的后台任务执行 Stop at safe point。

## 核心范围

- 任务导向 Start Center 和可恢复的首次成功向导。
- 统一 Runtime Readiness 模型与可执行修复建议。
- 统一 Operation/Action Event 模型和 Activity Center。
- 风险分级、计划预览、审批请求、拒绝、过期和一次性授权。
- AI pause / resume、按 backend 声明能力请求停止、紧急人工输入优先级。
- 本地脱敏审计、筛选、复制诊断摘要与有限导出。
- 中英文、键盘操作、无障碍状态和完整错误/空/加载/成功态。

## 明确不做

- 通用聊天 UI、Agent 规划器、模型选择器。
- 云端审计、团队 RBAC、远程手机审批。
- 对硬件写操作承诺通用 rollback。
- 默认上传使用指标或终端内容。
- 一次覆盖所有 transport 和全部 J-Link 工具的巨型向导。

## 范围策略候选

### 方案 1：统一 Command Center 大改版

一次重构主界面、首次向导和 AI 活动系统。视觉一致性最好，但会同时触碰 `App`、ConnectionDialog、MCP registry、IPC 和高影响工具，回归面过大。

### 方案 2：A 完成后再做 D

先独立做首次向导，再增加 AI 可见性与审批。短期交付直观，但向导执行动作时仍缺少可信事件基础，之后容易重做状态与进度模型。

### 方案 3：共享可信基础 + 纵向切片（推荐）

先用 Phase 0 固化现有行为，再建立旁路 Operation Event 与只读 Activity Center；随后完成 Readiness/串口首次成功，接入真实人类审批，再扩展 J-Link/RTT，最后交付 Pause/Take Over 与持久审计。这样不会在 Approval Broker 之前扩大“下载并观察”的高影响入口，每一步也可独立验证。

## 默认技术方向

- 保持 Electron main-owned runtime 和 thin renderer。
- 核心状态使用纯 TypeScript schema / service，主进程通过 IPC/MCP 适配。
- 不使用数据库；第一版内存环形缓冲，稳定后增加脱敏 JSONL 轮转。
- 使用 server-generated `operationId` 表示跨审批重试的逻辑目标，使用 `callId` 表示每次 MCP 调用；既有 `correlationId` 只作不可信的外部关联。
- 使用一次性、短时、实际效果指纹绑定的 approval grant；指纹覆盖已解析目标、artifact 内容 hash、profile revision、关键默认值和精确步骤，MCP 无权创建或批准 grant。
- 在观测稳定前，不让 Activity Ledger 进入 transport 写入关键路径。

## 成功衡量

- 首次串口成功率和 Time to First Signal 可在本机诊断摘要中计算。
- 100% 进入 LinkTerm handler 的 MCP 调用产生可查询的 CallAttempt 记录或明确的采集失败诊断；默认 UI 按任务聚合，不要求每次调用都成为顶层卡片。
- 100% `interactive-required` operation 需要匹配 PreparedOperation effect fingerprint 的人类审批 grant。
- 用户暂停 AI 后，尚未获得 execution lease 的新 AI changes 被稳定阻止，human/system 路径不受影响；已运行任务是否继续及 Stop 边界对用户明确。
- 审计样本不含凭据、私钥、token、完整二进制或未脱敏脚本。

## 已知开放问题

- 是否接受 desktop `interactive-required`、headless `headless-deny` 的默认组合，以及首版是否提供显式 allowlisted automation 启动模式。
- 审计记录默认仅内存，还是默认落盘并轮转。
- 首发是否只手工验收 Windows，还是三平台同时做安装级验收。
- 用户是否希望后续再做视觉 mockup；本包当前以文字 UI brief 为真源。
