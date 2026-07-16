# Observe-only AI execution evidence

日期：2026-07-15

这是对产品负责人“AI 全部自动执行、Activity/Transcript/Audit 仅用于观察”决策的独立变更
记录。它覆盖审批机制的运行时删除，不等同于 A+D 项目级 Goal 完成。

## 已落实的使用行为

- AI 调用烧录、复位、控制工作流等高影响入口时，不再弹出批准、继续或拒绝流程。
- `confirm` 仅作为旧客户端兼容字段，不改变执行结果。
- Activity Center、终端 transcript 和 durable audit 继续记录执行进度、结果和错误。
- Activity Center 对历史上带有批准字段的记录也统一显示“自动执行 · 仅观察”。
- 现有 SessionManager、WriteQueue、Transport、IJLinkBackend 和工作流管理器仍是执行边界。

## 新鲜验证

- `pnpm vitest run tests/unit/renderer/activity/activity-components.test.tsx -t "renders every execution as automatic observation"`
  - RED：旧实现只显示 1 个 observation badge，历史记录仍显示批准相关状态。
  - GREEN：4 个记录全部显示 `Execution: automatic, observation only`。
- `pnpm vitest run tests/unit/main/preload-observe-only.test.ts tests/unit/mcp/registry.test.ts tests/unit/mcp/control-workflow-tools.test.ts tests/unit/main/ipc/control-profile-ipc.test.ts tests/unit/renderer/activity tests/unit/renderer/components`
  - 14 个文件、209 个测试通过，17 个跳过。

## 当前项目级门禁状态

- 完整测试、覆盖率、构建、TypeScript、lint、许可证和 OpenSpec 已在本轮重新运行并通过。
- GitNexus 已重新索引并保持 up-to-date；累计 dirty worktree 的 `detect_changes` 仍为
  critical，不能把累计范围误读为本 change 的独立风险。
- Windows-first 手工 UI/可访问性与真实设备 first-signal 仍缺新鲜人工证据；本证据不授权
  真实烧录、擦除、复位或其他硬件副作用。
