---
description: 自动推进 DEVELOPMENT_PLAN.md 中的下一个未完成 Phase（实现 → 测试 → 提交）
---

# /next-phase — 自动推进下一个 Phase

你正在为 LinkTerm v2 项目执行 **全自动 Phase 推进** 工作流。当前命令的目标：找到 `DEVELOPMENT_PLAN.md` 中第一个 ⬜ 状态的 Phase，把它做完、提交、并准备好下一轮。

## 全自动授权（重要）

执行本命令期间，以下行为**已被用户预先授权**，无需再次询问：

1. 调用 `/feature-dev:feature-dev` 子代理执行实现
2. 创建/修改源代码、测试、配置文件
3. 运行 `pnpm install`、`pnpm test`、`pnpm run lint`、`pnpm run build`、`pnpm run validate:licenses`
4. 修改 `DEVELOPMENT_PLAN.md`、`CLAUDE.md`、`third-party-manifest.json`、`licenses/`
5. 创建 `docs/phase-decisions/PhaseN.md` 决策记录
6. 执行 `git add`、`git commit`（**不要 push**，push 仍需用户授权）

凡是 feature-dev 子代理或后续步骤遇到"是否继续"、"选 A 还是 B"、"是否覆盖"等问题，**一律选推荐选项**，并把选项与所选记入 `docs/phase-decisions/Phase{N}.md`。

## 执行步骤

### Step 1 — 找到下一个 Phase

读 `DEVELOPMENT_PLAN.md` 的"阶段进度总览"表，找到第一个状态为 ⬜（或 🟨）的 Phase。把 Phase 号记作 `N`，标题记作 `TITLE`。

如果**全部 Phase 都已 ✅**：输出 `🎉 所有 Phase 已完成` 并停止（**不要**调用 ScheduleWakeup，让 /loop 自然结束）。

### Step 2 — 创建决策记录文件骨架

在 `docs/phase-decisions/Phase{N}.md` 写入初始结构：

```markdown
# Phase {N} 决策记录 — {TITLE}

执行日期：{YYYY-MM-DD}
执行模式：全自动（用户预先授权一律选推荐项）

## 子代理询问与选择

（在执行过程中追加）

## 自动执行的操作

（在执行过程中追加 —— 例如自动选择"是的覆盖"、"使用推荐版本"等）

## 验收命令输出

（在最后追加 pnpm test / lint / build 的结果摘要）
```

### Step 3 — 调用 feature-dev 子代理

用 `Agent` 工具，`subagent_type="feature-dev:feature-dev"`，prompt 必须包含：

- 当前 Phase 号、标题、目标（从 `DEVELOPMENT_PLAN.md` 该 Phase 章节抄过来）
- 交付物清单（同上）
- 关键架构决策（同上）
- 测试交付要求（同上）
- 项目根目录绝对路径
- 明确指令："**所有需要选择的地方一律选推荐项，把每个被询问的问题、候选项、选中项、选择理由写入 `docs/phase-decisions/Phase{N}.md` 的'子代理询问与选择'小节**。不要向我反问任何问题，自行决策并记录。"
- 项目核心规则（从 `CLAUDE.md` 抄关键约束：core 零 Electron 依赖、WriteQueue 单一瓶颈、ESM `.js` 后缀相对导入、新依赖必须更新 manifest + license）
- 完成后必须运行：`pnpm run lint && pnpm test && pnpm run build && pnpm run validate:licenses`，全部通过才算结束
- 把验收命令的输出摘要追加到决策记录文件

### Step 4 — 验证子代理产出

子代理返回后：

1. 自己再跑一次 `pnpm run lint && pnpm test && pnpm run build && pnpm run validate:licenses`（**信任但验证**）
2. 任一失败：在决策记录里追加失败详情，**修复**（可再次调用 feature-dev 或自行 Edit），直到全绿
3. 全绿后继续

### Step 5 — 更新 DEVELOPMENT_PLAN.md

- 把"阶段进度总览"表里 Phase N 的状态改成 ✅，完成日期填今天（2026/06/13 格式按表内现有格式）
- 在 Phase N 章节后追加"✅ 已完成（YYYY-MM-DD）"小节，包含：实际交付物表、关键架构决策、实施期间的需求/决策变更（指向决策记录文件）、验收标准对勾
- 原计划文本保留为"## Phase N（原始）"小节作历史参考（参考 Phase 0/1/2 的格式）

### Step 6 — 必要时更新 CLAUDE.md

如果本 Phase 引入了新的不变量、新的目录、新的命令、新的依赖类别，更新 `CLAUDE.md` 对应小节。**当前状态**那行务必更新（例如 `Phases 0–5 complete`，测试数也要更新）。

### Step 7 — git 提交

按现有 commit 风格（参考 `git log --oneline -5`）写消息：`feat: Phase N — {简短描述}`。

```bash
git add -A   # 本命令授权使用 -A
git commit -m "$(cat <<'EOF'
feat: Phase N — <简短描述>

<2-4 行说明：核心交付、测试增量、关键决策出处>
EOF
)"
```

**不要 push**。

### Step 8 — 安排下一轮

输出一行总结：`✅ Phase N 完成。下一个 Phase 即将启动…`

然后调用 `ScheduleWakeup`：
- `delaySeconds`: `60`（1 分钟，足够 /loop 调度器重新触发）
- `prompt`: `/next-phase`
- `reason`: `Phase N 完成，触发下一轮 /next-phase`

如果是最后一个 Phase（执行后已无 ⬜）：**不要**调用 ScheduleWakeup，输出 `🎉 全部 Phase 已完成` 并停止。

## 异常处理

- 子代理多轮仍无法让验收命令通过：在决策记录里写下"⚠️ 阻塞"小节描述阻塞点，**不要 commit**，**不要 ScheduleWakeup**，输出 `⛔ Phase N 阻塞，需要人工介入` 并停止
- 子代理触碰了违反 CLAUDE.md 的红线（例如把 `serialport` 直接 import 到 core、跳过 WriteQueue、main 进程使用 `@/` 别名）：要求子代理修复，仍不行则按上一条处理