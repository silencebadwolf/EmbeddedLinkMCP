---
description: 自动推进 DEVELOPMENT_PLAN.md 中的下一个未完成 Phase（仿 /feature-dev 7 阶段，全自动）
---

# /next-phase — 自动推进下一个 Phase（仿 feature-dev 7 阶段工作流）

本命令为 LinkTerm v2 项目执行**全自动 Phase 推进**。结构对齐官方 `feature-dev` 插件的 7 阶段工作流（Discovery → Exploration → Clarifying → Architecture → Implementation → Review → Summary），但所有"等用户答"的决策点改成"自动选推荐项 + 决策记录"，使其可在 `/loop` 下无人值守循环。

## 全自动授权（在执行本命令期间生效）

用户已预先授权以下行为，无需再次询问：

1. 调用 `feature-dev:code-explorer` / `feature-dev:code-architect` / `feature-dev:code-reviewer` 子代理及实施类子代理（`backend-developer` / `frontend-developer` / `fullstack-developer` / `general-purpose`，按 Phase 性质择优）
2. 创建/修改源代码、测试、配置文件
3. 运行 `pnpm install`、`pnpm test`、`pnpm run lint`、`pnpm run build`、`pnpm run validate:licenses`
4. 修改 `DEVELOPMENT_PLAN.md`、`CLAUDE.md`、`third-party-manifest.json`、`licenses/`
5. 创建 `docs/phase-decisions/Phase{N}.md` 决策记录
6. 执行 `git add`、`git commit`（**不要 push**，push 仍需用户授权）

凡是子代理或后续步骤要做选择，**一律选推荐项**（架构推荐选项默认为 "Pragmatic Balance"），把候选项与所选记入 `docs/phase-decisions/Phase{N}.md`。

---

## Step 1 — Discovery：定位下一个 Phase

读 `DEVELOPMENT_PLAN.md`「阶段进度总览」表，找第一个状态为 ⬜（或 🟨 部分完成）的 Phase。记 Phase 号 `N`、标题 `TITLE`、章节内的目标/交付物/关键设计/测试要求。

如果**全部 ✅**：输出 `🎉 所有 Phase 已完成` 并停止（**不要** ScheduleWakeup）。

为该 Phase 创建决策记录骨架 `docs/phase-decisions/Phase{N}.md`：

```markdown
# Phase {N} 决策记录 — {TITLE}

执行日期：{YYYY-MM-DD}
执行模式：全自动（用户预先授权一律选推荐项）

## Phase 1: Discovery（目标摘要）

（粘贴 DEVELOPMENT_PLAN.md 该 Phase 的目标 + 交付物清单）

## Phase 2: Exploration（代码库勘探）

（code-explorer 摘要）

## Phase 3: Clarifying（自动应答）

（每个被识别的歧义点 + 自动选择 + 理由）

## Phase 4: Architecture（候选 + 选中）

（code-architect 三方案对比 + 选中项 + 理由）

## Phase 5: Implementation（实施摘要）

（实施子代理产出文件清单）

## Phase 6: Review（三视角评审）

（Simplicity/Bugs/Conventions 三路报告 + 处置）

## Phase 7: Summary（验收）

（lint/test/build/validate:licenses 输出摘要）
```

## Step 2 — Exploration：并行 code-explorer

**单次消息内**派 **2 个并行** `feature-dev:code-explorer` 子代理（多到 3 个会浪费 token，本项目模块清晰，2 个足够）：

- Explorer A：探索本 Phase 触及的现有模块（参考 DEVELOPMENT_PLAN.md 该 Phase 的"交付物"列表中已存在的文件 + 同层兄弟模块）
- Explorer B：探索本 Phase 的依赖前置 Phase 的实现模式（如 Phase 6 探 Phase 5 的 IPC 模式 + Phase 1-3 的 transport 模式）

每个 explorer 的 prompt 必须含：项目根目录绝对路径、本 Phase 目标、要勘探的具体范围、CLAUDE.md 中的核心约束、要求输出"关键文件列表 + 调用链 + 现有模式"。

合并两份报告，把要点追加到 `Phase{N}.md` 的 "## Phase 2: Exploration" 小节。

## Step 3 — Clarifying：识别歧义并自动应答

阅读 `DEVELOPMENT_PLAN.md` 该 Phase 章节 + Step 2 的 explorer 输出，**自己识别**歧义点（API 命名、错误码、默认值、边界场景、新增字段位置等）。

对每个歧义点：
- 列候选项（≥2 个）
- **自动选推荐项**（依据：CLAUDE.md 不变量 / explorer 发现的现有模式 / 用户在 DEVELOPMENT_PLAN.md 提到的偏好 / 安全边界）
- 写明理由

全部追加到 `Phase{N}.md` 的 "## Phase 3: Clarifying" 小节。**不要向用户反问**。

## Step 4 — Architecture：并行 code-architect

**单次消息内**派 **3 个并行** `feature-dev:code-architect` 子代理，分别要求三种风格（对齐官方 feature-dev 插件）：

- Architect A — **Minimal Changes**：最小改动、最大复用现有代码
- Architect B — **Clean Architecture**：清晰抽象、可维护，可接受多文件改动
- Architect C — **Pragmatic Balance**：兼顾速度与质量

每个 architect 的 prompt 必须含：项目根目录、本 Phase 目标 + 交付物、Step 2 的 explorer 关键发现、Step 3 的歧义解答、CLAUDE.md 不变量、要求输出"组件设计 + 文件创建/修改清单 + 数据流 + 实施顺序"。

收齐三方案后：
- 把三方案精要 + 各自利弊填入 `Phase{N}.md` 的 "## Phase 4: Architecture"
- **默认选中 Pragmatic Balance**，除非有以下例外：
  - Pragmatic 方案违反 CLAUDE.md 不变量 → 选不违反的方案
  - 当前 Phase 工作量标记为 ≥3x（高复杂度）→ 优先 Clean Architecture（更易测试与后续迭代）
  - 当前 Phase 工作量标记为 ≤1x（轻量）→ 优先 Minimal Changes
- 记录"为什么选 X 没选 Y/Z"

## Step 5 — Implementation：派实施子代理

按 Phase 性质择 **1 个实施子代理**（可在决策文件记录"为什么选这个 agent type"）：

- Phase 涉及 main 进程 / core 模块 / IPC / 测试 → `backend-developer`
- Phase 涉及 React UI / xterm / hooks / i18n → `frontend-developer`
- Phase 跨前后端 → `fullstack-developer`
- 其他（如纯文档、工具脚本） → `general-purpose`

子代理 prompt 必须含：

- **全自动指令**："不要反问任何问题，遇到选择一律选推荐项并把'问题/候选/选中/理由'追加到 `docs/phase-decisions/Phase{N}.md` 的 '## Phase 5: Implementation' 小节"
- 项目根目录绝对路径
- 本 Phase 目标 + 完整交付物清单（从 `DEVELOPMENT_PLAN.md` 抄）
- Step 4 选中的架构方案全文
- Step 2/3 的关键发现与歧义解答
- 项目核心规则（CLAUDE.md 关键条目摘抄）
- 测试覆盖要求
- 完成判据：`pnpm run lint && pnpm test && pnpm run build && pnpm run validate:licenses` 全绿
- 不许 commit、不许改 DEVELOPMENT_PLAN.md / CLAUDE.md（由主流程负责）

## Step 6 — Review：3 路并行 code-reviewer

**单次消息内**派 **3 个并行** `feature-dev:code-reviewer` 子代理（对齐官方 feature-dev 插件）：

- Reviewer A — **Simplicity / DRY / Elegance**：可读性、复用、过度抽象/过度工程
- Reviewer B — **Bugs / Correctness**：功能正确性、并发与竞态、错误处理、资源释放、边界条件
- Reviewer C — **Conventions / Project guidelines**：CLAUDE.md 不变量、ESLint/TS strict、ESM `.js` 后缀、JSDoc、IPC 安全边界、依赖+许可证

每个 reviewer 的 prompt 必须含：

- 项目根目录、`git status` 列出的改动文件清单（先跑 `git status` 再分发）
- 项目硬约束（从 CLAUDE.md 抄相关条目）
- 本 Phase 关键设计点（让 reviewer 验证实现是否真的做到了）
- 输出格式：按 `Critical / High / Medium / Low` 分组，每条带 `文件:行号 + 问题 + 建议修复`
- 明确"不要修改任何代码，仅返回评审报告"

合并三份报告（去重、按严重度归并）追加到 `Phase{N}.md` 的 "## Phase 6: Review"。

**处置规则（自动）**：

- **Critical / High：必须修**。再调一次实施子代理（同 Step 5 同 agent type），prompt 列清每条问题（含文件路径、当前行为、期望行为、建议修法、补充测试要求），让其修复并重新跑验收命令
- **Medium：默认同期修**，除非明确判定属于后续 Phase 范畴；推迟项必须在决策文件标注"推迟到 Phase X 因 Y"
- **Low：记录即可，可推迟**

修复完成后**重新跑 `pnpm run lint && pnpm test && pnpm run build && pnpm run validate:licenses`** —— 任一失败再修，全绿才能进 Step 7。

多轮（>3 轮）修复仍卡住：按本文件末尾「异常处理」走。

## Step 7 — Summary：更新计划/规则/提交

### 7.1 主会话再跑一次验收

`pnpm run lint && pnpm test && pnpm run build && pnpm run validate:licenses` —— 信任但验证。把输出摘要追加到 `Phase{N}.md` 的 "## Phase 7: Summary"。

### 7.2 更新 DEVELOPMENT_PLAN.md

- 把"阶段进度总览"表里 Phase N 的状态改成 ✅，完成日期填今天
- 在 Phase N 章节顶部追加 ✅ 已完成（YYYY-MM-DD）小节，包含：
  - 实际交付物表
  - 关键架构决策（指向 `docs/phase-decisions/Phase{N}.md`）
  - 实施期间的需求/决策变更
  - Code review 处置摘要
  - 验收标准对勾
- 原计划文本保留为 `## Phase N（原始）` 小节作历史参考

### 7.3 必要时更新 CLAUDE.md

如果本 Phase 引入了新的不变量、新的目录、新的命令、新的依赖类别、新的错误类型、新的 IPC 通道命名规范，更新 CLAUDE.md 对应小节。**当前状态**那行务必更新（Phase 计数 + 测试总数）。

### 7.4 git 提交

按现有 commit 风格（参考 `git log --oneline -5`）：

```bash
git add -A   # 本命令授权使用 -A
git commit -m "$(cat <<'EOF'
feat: Phase N — <简短描述>

<2-4 行说明：核心交付、测试增量、关键决策出处>
EOF
)"
```

**不要 push**。

## Step 8 — 安排下一轮

输出一行总结：`✅ Phase N 完成。下一个 Phase 即将启动…`

调用 `ScheduleWakeup`：
- `delaySeconds`: `60`
- `prompt`: `/next-phase`
- `reason`: `Phase N 完成，触发下一轮 /next-phase`

如果是最后一个 Phase（执行后已无 ⬜/🟨）：**不要** ScheduleWakeup，输出 `🎉 全部 Phase 已完成` 并停止。

---

## 异常处理

- **Step 6 多轮（>3 轮）修复仍无法让验收命令通过**：在决策记录里写"## ⚠️ 阻塞"小节描述阻塞点（含尝试过的修法 + 失败输出），**不要 commit**，**不要 ScheduleWakeup**，输出 `⛔ Phase N 阻塞，需要人工介入` 并停止
- **子代理触碰 CLAUDE.md 红线**（例如 `serialport` 直接 import 到 core、跳过 WriteQueue、main 进程使用 `@/` 别名、SSH 凭据进 transcript、新依赖未更新 manifest+license）：要求子代理修复，仍不行按上一条处理
- **`feature-dev:code-explorer` / `feature-dev:code-architect` / `feature-dev:code-reviewer` 不可用**（agent 列表查不到）：降级使用 `general-purpose`，并在决策文件记录"已降级 + 原因"
