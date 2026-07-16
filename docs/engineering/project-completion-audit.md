# LinkTerm A+D 项目级完成审计

日期：2026-07-15（observe-only 覆盖后复核）

本审计记录 Phase 0–8 的当前证据状态。Phase 8 `add-durable-audit` 的实现范围已关闭；本文件不把单个 Phase 或自动化门禁等同于 A+D 整体完成。

## Phase 证据矩阵

| Phase | OpenSpec / 证据 | 当前判定 |
| --- | --- | --- |
| 0 | `establish-characterization-ci-gates` / CI、63-tool inventory | 已完成，自动化证据新鲜 |
| 1 | `add-operation-event-ledger` / ledger 与 call-attempt 测试 | 已完成，自动化证据新鲜 |
| 2 | `add-ai-activity-center` / Activity Center 测试 | 已完成；审批字段仅作历史兼容 |
| 3 | `add-runtime-readiness-start-center` / readiness 与 Start Center 测试 | 已完成，人工 UI 仍待验收 |
| 4 | `add-serial-first-signal` / first-signal 与 xterm ack 测试 | 自动化完成；真实设备 first signal 待验收 |
| 5 | `add-human-approval` / 历史证据 | 历史路线，已由 observe-only 覆盖 |
| 6 | `extend-first-success-jlink-rtt` / 历史证据与 fake backend 测试 | 自动化完成；真实只读观察待验收 |
| 7 | `add-ai-pause-takeover` / 历史证据 | 历史路线，暂停/接管已删除 |
| 8 | `add-durable-audit` / durable audit、导出、保留策略测试 | 已完成，自动化证据新鲜 |

该矩阵区分“代码/自动化完成”和“需要 Windows/设备现场证据”的项目级门禁；后者未满足前不
得将 Goal 标记为完成。

## 已有证据

- Phase 0–8 均有独立 OpenSpec change、实现计划和阶段证据文档；另有
  `observe-only-ai-execution` 产品覆盖 change。
- `pnpm exec openspec validate --all --strict`：45/45 通过。
- Phase 8 聚焦测试：7 个文件、55 个测试通过。
- 全量测试：160 个文件、1,901 个测试通过，17 个 skipped。
- 覆盖率：Statements 81.86%、Branches 73.45%、Functions 84.22%、Lines 84.42%。
- lint、build、许可证校验、生产依赖审计和 `git diff --check` 通过；build 仅保留既有 chunk-size warning。
- `pnpm run ci:check` 聚合门禁通过（lint、build、188 files / 2,069 tests、license）。
- GitNexus 索引已刷新并显式重建 PDG：38,295 nodes、70,272 edges、300 flows，状态 up-to-date。
- `detect_changes(all)`：累计 dirty Phase 0–8 与 observe-only 工作树 63 files、435 symbols、74 affected、`critical`；这是累计范围警告，不是本轮小范围 UI 变更的独立风险证明。
- Activity Center 定向 taint 当前因 LadybugDB 未初始化无法复核；此前 0 findings 仍不构成安全证明。
- 定向 PDG controls：`authorizationDisplay` 2 条结果，入口分支有界。
- Windows 启动实测曾发现 Main `@/...` runtime alias 崩溃；已由独立
  `fix-main-runtime-imports` change 修复。重建后 Electron 窗口标题为 `LinkTerm v2`，启动中心
  正常显示；只读刷新发现 `COM1` 与 `COM10 (JLink CDC UART Port)`，未打开会话、未写入字节。
- 在复用已保存配置后已创建 `serial:c526` 的 `COM10 / 115200` 会话；连续观察 5 秒终端仍为空，
  当前只能证明 transport open + silent，尚未证明 first signal 或 journey success。
- 本轮只读 `pnpm doctor:jlink` 发现 `SAM-ICE via USB`；工具明确未连接目标 MCU，不能把探针枚举
  当成 J-Link/RTT first-signal 证据。
- 2026-07-15 23:36（Windows UI Automation，只读）读取已运行窗口 `LinkTerm v2`：中文 Start
  Center、AI 状态、Activity/就绪入口、COM1/COM10 候选和 J-Link 目标证据均可见；控件树中未发现
  `批准/审批/approval/approve/deny/暂停/接管/pause/take over/resume` 文案。该证据未点击按钮、未
  打开串口、未连接目标 MCU。
- 同次 UI Automation 检查显示 `EN`、`中文`、`+ 新建`、`观察设备输出`、`刷新就绪状态`、
  `高级连接…`、`复制诊断` 均 `Enabled=True`、`KeyboardFocusable=True`、`Offscreen=False`；
  这补充了可访问名称/键盘可聚焦证据，但仍不替代完整 Narrator、reduced-motion 和小窗口人工矩阵。
- 只读打开并随后关闭 Activity Center 后，窗口树显示 `活动中心`、`导出脱敏活动`、`历史`、
  `关闭活动中心`，以及 `执行：自动进行，仅用于观察` / `自动执行 · 仅观察`；审批/暂停关键词仍为
  0。该操作没有触发任何执行动作。
- 现场通过 UI Automation 临时切换 `EN` 后读取到 `Start Center`、`Observe device output`，
  20 个 enabled button 可键盘聚焦，英文审批/暂停关键词为 0；随后已切回中文并复核
  `启动中心`、`观察设备输出` 存在，中文审批/暂停关键词仍为 0。未打开会话或执行硬件动作。
- 只读调用 `观察设备输出` 后，UI 停留在“新建连接”对话框，显示 `打开` 与 `取消`，未自动
  打开串口；随后已调用 `取消` 关闭对话框。这证明向导入口不会隐式产生硬件连接副作用。

## 仍未满足的项目级门禁

- Windows-first 手工 UI/可访问性验收尚未形成新鲜实机证据：中英文、键盘、screen reader、reduced motion、小窗口。
- 真实串口 first-signal/J-Link/RTT 的完整安装级或硬件演示尚未完成；当前串口会话为 silent，
  尚未获得非空 device 文本及 xterm completion ack，也未执行 J-Link/RTT 操作。
- 未提交、未 push、未创建 PR；当前 worktree 保留 Phase 0–8 累计改动。空的未跟踪文件 `()` 也未擅自删除，需在提交前由维护者确认。
- observe-only 覆盖已通过独立回归：AI/agent 活动统一显示自动执行，历史审批形状记录不再显示批准状态；`confirm` 仅保留兼容解析，不参与授权。

## 结论

Phase 8 可作为本阶段交付物移交，但 A+D 项目级 Goal 仍保持未完成，直到上述人工/发布门禁获得证据并完成最终审查。没有执行真实硬件副作用的限制继续有效。
