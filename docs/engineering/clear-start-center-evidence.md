# Clear Start Center Evidence

日期：2026-07-16

## 产品变化

- 空状态首页先显示已保存连接；没有可复用连接时仍明确显示空状态。
- 已保存连接提供直接“打开已保存连接”动作，优先级高于新建连接。
- 首页只保留一个“手动打开”入口；串口、RTT、SSH、本地终端均在该入口打开的现有 `ConnectionDialog` 中选择。
- 首页不显示当前 COM 列表、不显示独立手动串口/波特率表单。
- 串口发现只在连接对话框的串口流程中显示；普通首页启动不订阅 readiness。
- 保存的连接配置继续由现有 `ConnectionDialog` 和 `connections.list/open` 承载，不复制或迁移保存文件。
- J-Link、RTT、Agent、控制配置和诊断收进默认折叠的“高级设备”。
- 无会话时隐藏控制配置侧栏和 SessionTabBar 的 `+ New`，避免与主流程重复。
- 有会话时保留控制配置侧栏和 `+ New`，不影响已有高级工作流。
- Activity Center 默认关闭，只通过顶部 AI 状态入口打开观察抽屉。
- 高级设备折叠摘要明确写出 MCP / Agent 注入和控制配置；Agent 面板继续显示实际目标配置路径与备份路径。
- 高级设备区仍保留 J-Link/RTT readiness、诊断和首次成功向导，但不抢占主连接入口。
- 人工终端和 AI 继续共用现有 Session/WriteQueue 输入边界；未引入批准、暂停、接管或互斥抢占。

## 自动化验证

- `pnpm exec vitest run`：160 个测试文件，1904 passed，17 skipped。
- Coverage：Statements 81.84%，Branches 73.45%，Functions 84.14%，Lines 84.42%（9847/12031 statements，9183/10877 lines）。
- `pnpm lint`：通过。
- `pnpm exec tsc -b --pretty false`：通过。
- `pnpm build`：通过，Vite 产物生成成功。
- `pnpm validate:licenses`：19 个运行时依赖和 29 个 dev-tooling 闭包条目通过。
- `pnpm exec openspec validate clarify-start-center-terminal-first --strict`：通过。
- `pnpm exec vitest run tests/integration/ai-human-coop.test.ts tests/integration/serial-manual-entry.test.ts`：16 passed；覆盖人工写入对 AI 可见、AI 写入对人工事件流可见、并发 AI/人工写入经过同一有序 WriteQueue，以及 FakeSerialPort 手动串口写入链路。
- 本次入口修复 focused renderer tests：`start-center-components`、`App.start-center`、`ConnectionDialog`、readiness 全部通过；完整 `pnpm ci:check`：160 个测试文件，1904 passed，17 skipped。
- 新 OpenSpec change `restore-discoverable-connections-agent-entry` 已通过 strict validation；原 `clarify-start-center-terminal-first` 也重新通过 strict validation。

## GitNexus

- 编辑前的 upstream impact：`StartCenter`、`App`、`ControlProfileSidebar`、`SessionTabBar`、`AiStatusCapsule` 均为 LOW；主要直接调用者是 `App`，Renderer 流程受影响。
- 最终 `detect_changes --scope all`：累计 dirty worktree 为 63 files / 444 symbols / 82 affected processes / critical。
- 该 critical 结果包含用户此前 Phase 0–8 的累计 dirty worktree，不能作为本次 UI change 的独立风险证明；本次实际修改文件集中在 renderer、renderer tests、i18n、OpenSpec 和设计/计划文档。
- GitNexus status：索引 up-to-date（索引基于当前 commit，未把 dirty diff 当作新 commit 索引）。
- PDG upstream：`StartCenter` 与 `useRuntimeReadinessState` 已执行定向 `pdg_query`，返回控制依赖；当前索引基于旧 commit，未包含 dirty worktree，因此结果可能保留旧回调行号，不能反推当前源码仍暴露这些回调。
- Taint：GitNexus MCP `explain` 已针对 `App` 与 `StartCenter` 执行，均返回 0 findings；工具仍明确提示 closure/property/implicit flow 未建模，因此 0 findings 不作为安全证明。

## 代码审查

- 复核范围：`StartCenter`、`App`、`SessionTabBar`、`ActivityCenterDrawer`、中英文文案及对应 renderer 测试。
- 首轮审查发现 Activity Center 暴露“Go to session”和“Request stop”动作；已按 HIGH 影响报告并移除。
- 修正后 Activity Center 只保留活动筛选/历史、详情、摘要复制、导出脱敏活动和显式删除本地审计；不再接收会话切换、诊断或停止任务回调，也不引入批准、暂停、接管或恢复入口。
- 修正后的 focused Activity/App tests：39 passed；完整 renderer tests：276 passed；之前 Phase 0–8 的非 UI 审查意见未在本 change 中扩展处理。
- 追加文案复核：Activity Center 标题和默认视图统一为“观察与审计 / Observation & audit”，避免“需处理”被误读为批准或人工接管入口；对应中英文组件断言已更新。

## Windows-first 人工观察

- 大窗口（1920×1080）中文首屏：`C:\Users\Admin\AppData\Local\Temp\linkterm-home-final.png`。
- 小窗口（900×650）中文首屏：`C:\Users\Admin\AppData\Local\Temp\linkterm-home-small-zh-final.png`。
- 小窗口（900×650）英文首屏：`C:\Users\Admin\AppData\Local\Temp\linkterm-home-small-final.png`。
- 旧版小窗口串口候选截图：`C:\Users\Admin\AppData\Local\Temp\linkterm-start-center-com-candidates.png`（已过时，不代表当前首页布局）。
- 最终清理后的中文首页（仍无活动 Session）：`C:\Users\Admin\AppData\Local\Temp\linkterm-final-clean.png`。
- 旧版 COM1 候选预填对话框：`C:\Users\Admin\AppData\Local\Temp\linkterm-candidate-prefill-dialog.png`（已过时，不代表当前入口）。
- 英文 Activity Center 观察态：`C:\Users\Admin\AppData\Local\Temp\linkterm-activity-en-final.png`。
- 安全本地 Shell 会话中的人工输入：`C:\Users\Admin\AppData\Local\Temp\linkterm-local-shell-human-input-ok.png`。
- 本地 Shell 会话 + AI 只读活动观察抽屉：`C:\Users\Admin\AppData\Local\Temp\linkterm-local-shell-activity-open.png`。
- 当前自动化确认：已保存连接区域位于 Manual open 之前；小窗口布局使用可换行容器；首页不显示 COM 列表或独立手动串口区域；高级设备默认折叠；无活动 Session 时无控制配置侧栏和 `+ New`；Activity Center 默认关闭，打开后只显示活动/审计、导出和本地删除入口，不显示批准、暂停、接管或恢复控件。
- Activity Center 打开后未创建 Session，也未改变 Start Center 的输入字段；自动化焦点测试进一步确认关闭抽屉会把焦点还给打开入口。
- 使用本地 Shell 做了安全边界验证：人工命令能在 LinkTerm 会话内回显，打开 Activity Center 后仍能看到同一终端和 AI 只读活动；这证明共享 Renderer/Session 输入边界的可用性，但不等价于串口设备验收。
- 自动化 `ai-human-coop` 与 `serial-manual-entry` 使用 FakeTransport/FakeSerialPort 验证同一 SessionManager/WriteQueue 边界，但不替代 Windows 上真实 COM 终端的人工验收。
- 本轮没有连接 MCU、打开真实 COM 终端、发送串口 payload、烧录、擦除、复位或建立调试连接。因此“人工串口输入与 AI 同时操作”的真实设备证据仍待用户明确提供安全设备窗口后补做；此项不能以本地 Shell 截图或 0 findings 代替。
- Windows 本机事实核对：全局连接文件存在于 `C:\Users\Admin\AppData\Roaming\linkterm-v2\connections.json`，当前包含 COM6/115200 与 RTT 配置；VS Code MCP 注入位于 `C:\Users\Admin\AppData\Roaming\Code\User\mcp.json`，Codex 注入位于 `C:\Users\Admin\.codex\config.toml`。本次没有读取或改写这些用户配置。
- 入口修复后的 GitNexus upstream impact：`App`、`StartCenter`、`ConnectionProfileManager` 均 LOW；taint `explain` 对 App/StartCenter 返回 0 findings（工具 caveat 仍适用）。PDG 对 StartCenter返回控制依赖；App 的 PDG 查询因当前 dirty worktree 索引数据库未初始化而阻塞，未伪造结果。
- 追加验证（2026-07-16 02:24）：`pnpm ci:check` 通过，160 个测试文件、1902 passed、17 skipped；lint、TypeScript/build、license 检查均通过。`openspec validate --strict` 和 GitNexus `detect_changes --scope all` 也已重新运行；detect_changes 仍报告累计 dirty worktree 的 63 files / 437 symbols / 74 processes / critical，不能单独归因于本次 UI change。
- 追加验证（2026-07-16 15:40–15:42）：定向 renderer/串口协作测试 11 个文件、82 passed；`pnpm ci:check` 通过，160 个测试文件、1908 passed、17 skipped，lint、TypeScript/build、license 检查均通过；两个首页 OpenSpec change 均通过 strict validation。只读枚举发现 Windows `COM1` 与 `COM10 (JLink CDC UART Port)`，本轮未打开端口、未发送数据、未执行任何硬件副作用，因此真实 COM 人工输入 + AI 同时操作验收仍未完成。
- 追加配置核对（2026-07-16）：`%APPDATA%\\linkterm-v2\\connections.json` 仍包含 2 条保存连接（serial、rtt-log）；VS Code `mcp.json` 与 Codex `config.toml` 均存在。本轮只核对存在性和连接类型，未读取或修改敏感配置内容。
- 响应式宽度修复（2026-07-16 16:45–16:52）：`StartCenter` 移除 `max-w-5xl` 和描述区域 `max-w-2xl` 的硬宽度上限，增加 `w-full/min-w-0`，使窗口拉宽后首页内容继续回收换行；先新增失败测试再实现，定向 Start Center/App 测试 9 个文件、68 passed，lint、TypeScript 和 build 通过。`detect_changes` 仍包含此前累计 dirty worktree，不能将其 critical 汇总归因于本次两行布局修复。
- 高级设备滚动修复（2026-07-16 17:23–17:26）：`StartCenter` 增加 `min-h-0 overflow-y-auto overscroll-contain`，展开高级设备后内容在首页内部滚动，不再被 App 外层 `overflow-hidden` 裁剪；renderer 全量 31 个文件、279 passed，lint、TypeScript 和 build 通过。
- 就绪清单 UI 移除（2026-07-16）：高级设备不再展示无动作价值的 Readiness checklist；底层 readiness 快照仍保留给设备候选、诊断、补偿候选和首次成功向导使用。对应 renderer 全量 31 个文件、279 passed，lint、TypeScript 和 build 通过。
- 本轮 GitNexus `detect_changes --scope all` 重新运行，结果仍为累计 dirty worktree 的 71 files / 475 symbols / 82 affected processes / critical；该汇总包含既有 Phase 0–8 改动，不能归因于本轮 UI 移除。
