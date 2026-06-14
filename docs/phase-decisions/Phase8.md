# Phase 8 决策记录 — 工作区配置持久化

执行日期：2026-06-14
执行模式：全自动（用户预先授权一律选推荐项）

## Phase 1: Discovery（目标摘要）

**目标**：MCP 识别工作区，持久化芯片/烧录/调试/RTT/串口配置到工作区，后续复用。

### 计划交付物（DEVELOPMENT_PLAN.md §905）

| 文件/模块 | 用途 |
|---|---|
| `src/core/workspace/types.ts` | WorkspaceConfig, ChipConfig, FlashConfig 等 |
| `src/core/workspace/config-schema.ts` | Zod schema（含版本字段） |
| `src/core/workspace/workspace-config.ts` | load/save/validate/detectConflicts |
| MCP 新增工具 | `init_workspace`, `get_workspace_config`, `update_workspace_config` |

### 关键架构决策（计划层）

1. **配置文件路径**：`<workspaceRoot>/.linkterm/config.json`，含 schemaVersion
2. **敏感数据 schema 级拒绝** — Zod schema 显式拒绝 password/privateKey/token/secret 字段
3. **冲突检测** — 配置 vs 硬件证据不匹配时返回结构化冲突报告，需用户确认
4. **缺失字段返回结构化提示** — 不静默失败

### 依赖阶段：Phase 4
### 相对工作量：1.5x（轻偏中量）

## Phase 2: Exploration（代码库勘探）

2 个并行 `feature-dev:code-explorer`，要点合并：

### 现状基线（Explorer A）
- **`src/core/workspace/` 目录不存在**；代码层仅在注释/CLAUDE.md/DEVELOPMENT_PLAN.md 中提及 workspace
- **Zod 已在 `package.json` 声明（^4.4.3）**，但项目内仅 `src/mcp/surfaces/terminal/schemas.ts` 一处使用；Zod 解析由 MCP SDK 自动完成，项目代码不直接 `.parse()`，无自定义 errorMap
- **主进程当前不读写任何文件**——`fs/promises` / `writeFile` / `readFile` / `app.getPath` / `userData` 全部 0 命中。`scripts/validate-licenses.ts` 仅是构建脚本。**Phase 8 是项目首次引入运行时文件 IO**
- **MCP 工具注册**：`src/mcp/server.ts` 工厂调用 `registerTerminalTools(server, deps)`；`src/mcp/registry.ts` 提供 `ToolError` / `ToolErrorCode` / `ToolDefinition<TSchema>` / `registerTool`，统一负责 Zod 校验、版本协商、`origin:'ai'` 强制、错误归一化、`CallToolResult` 双载荷（`content[].text` JSON + `structuredContent`）
- **`EvidenceKind` 联合**（`src/shared/types.ts:33`）：`'raw_bytes' | 'terminal_output' | 'debug_output' | 'ui_screenshot'` —— 无 workspace 类，需评估是否要加

### 凭据/证据/版本（Explorer B）
- **硬件证据**：仅 `SerialDiscovery.listPorts()` → `SerialPortInfo[]`（path/manufacturer/serialNumber/pnpId/vendorId/productId/locationId）。J-Link backend 与 `src/jlink/` 目录均不存在；SSH/local-shell 无设备枚举
- **凭据过滤模式（多层）**：
  1. 类型分离：`SshSessionConfig` 主体不含凭据，credentials 走独立 `SessionCreateRequestConfig.credentials`
  2. `buildSession`（`src/core/session/factory.ts`）在 SSH 分支重组结构，credentials 仅作为 `SshSession` 构造参数传递
  3. `SshTransport.open()` 把 `this.#credentials` 拷到局部变量后**立即** null 化，再 await
  4. MCP 错误消息走 `redactSensitive`（PEM 正则 + 入参字面量 split/join）
  5. `registry.ts:48` 注释禁止 message/details 写敏感字段
- **MCP 命名约定**：工具名 snake_case；input schema 字段 camelCase；公共字段 `correlationId?` + `clientSchemaVersion?` 必 spread；返回 `{ success, sessionId?, state?, evidence?, error?, correlationId?, origin:'ai', schemaVersion }`；错误用 `ToolError(ERROR_CODES.X)` + `instanceof` 翻译
- **版本字段**：`LINKTERM_MCP_SCHEMA_VERSION = 'linkterm-mcp/1.0.0'`（`<namespace>/<semver>`）；read-only 工具 mismatch 仅警告，state-affecting 拒绝。**项目内尚无持久化用 schemaVersion 字段**——Phase 8 需自定义
- **workspaceRoot 解析**：源码内**无** `process.cwd()` 引用（仅 `LocalShellSessionConfig.cwd` 注释提及）；无 `app.getPath` / `userData`。需在 Phase 8 决定 workspaceRoot 来源
- **IPC handler 标准模式**（`src/main/ipc/session-ipc.ts:304-324` `wrap(fn)`）：try/catch 按命名错误 `instanceof` 翻译为 `ERROR_CODES.X`；返回 `PreloadResult<T> = { success: true; data } | { success: false; error: { code; message } }`；通道常量集中在 `src/shared/ipc-protocol.ts`（`<scope>:<action>`）；多渲染窗口订阅用 `Map<wc.id, WebContents>` + 首次 subscribe 挂 `once('destroyed')`

### CLAUDE.md 硬约束摘要
- core 零 Electron 依赖；ESM `.js` 后缀；主进程禁 `@/` alias
- 凭据绝不进 transcript / 持久化配置 / IPC payload 主体
- MCP 工具固定 `origin:'ai'`；evidence kind 严格三表面隔离
- 任何新 runtime dep 同步更新 `third-party-manifest.json` + `licenses/`
- 主进程 `__dirname` 用 `fileURLToPath(import.meta.url)`
- 测试不依赖 Electron / 硬件；Vitest

## Phase 3: Clarifying（自动应答）

下表罗列识别到的歧义点、候选项与自动选中（依据：CLAUDE.md 不变量、Phase 2 现状、用户既有偏好）。

| # | 歧义点 | 候选 | 选中 | 理由 |
|---|---|---|---|---|
| Q1 | `workspaceRoot` 来源 | (a) `init_workspace(root)` MCP 显式参数 / (b) Electron CLI flag / (c) `process.cwd()` | **(a) `init_workspace(root)` 显式入参；之后由 `WorkspaceConfigManager` 内部维持当前 root** | MCP 是主要消费者，工作目录由调用方知晓最准确；避免 Electron 与 MCP 启动姿态耦合；`process.cwd()` 在 Electron 主进程是 `/`，不可靠 |
| Q2 | 配置文件 `schemaVersion` 命名风格 | (a) `linkterm-workspace/1.0.0`（仿 MCP）/ (b) 纯 semver `1.0.0` | **(a) `linkterm-workspace/1.0.0`** | 项目已有 `linkterm-mcp/1.0.0` 范式；带 namespace 便于未来多种持久化文件共存；CLAUDE.md 未明示反对 |
| Q3 | `EvidenceKind` 是否新增 | (a) 新增 `'workspace_config'` / (b) 复用 `'terminal_output'` | **(a) 新增 `workspace_config`** | Phase 2 调研：三表面 evidence kind 严格隔离；workspace 工具语义上既不属于 terminal 也不属于 debug/ui，理应自有 kind。同步更新 `src/shared/types.ts` |
| Q4 | MCP surface 归属 | (a) 新建 `src/mcp/surfaces/workspace/` 独立表面 / (b) 加到 terminal surface | **(a) 独立 workspace surface** | DEVELOPMENT_PLAN.md §49 说"三表面严格隔离"；workspace 配置不是终端 IO，强行塞入 terminal 会污染语义；workflow 工作量评估 1.5x 也支持新建 |
| Q5 | 冲突检测时机 | (a) 被动：caller 调 `update_workspace_config` 时显式 dryRun 检测 / (b) 主动：每次 `load` 自动比对硬件证据 | **(a) 被动 + 显式 `validateOnly` 入参 / 独立 `detectConflicts` 内部 helper** | 硬件枚举（如 `SerialDiscovery.listPorts`）有副作用 + 时延；自动检测会让无关读操作变慢；DEVELOPMENT_PLAN.md §922 用词"返回结构化冲突报告"暗示同步返回，不强制阻塞 |
| Q6 | 缺失字段处理 | (a) `success:true` 携带 `missingFields[]` 警告 / (b) `INVALID_ARGUMENT` 错误 / (c) Zod default | **(a) `success:true` + `evidence.meta.missingFields[]`** | DEVELOPMENT_PLAN.md §923 明示"缺失字段返回结构化提示，不静默失败" + "不返回硬错误"两层语义；调用方自决是否补全 |
| Q7 | 文件并发写保护 | (a) 无锁，atomic temp+rename / (b) 进程级 mutex / (c) 文件 advisory lock | **(a) atomic write（写到 `<root>/.linkterm/config.json.tmp`，`fs.rename` 替换）** | 单进程 LinkTerm 实例下不存在跨进程并发；renderer 不直接写 config（只走 IPC）；rename 在 POSIX 与 Win32 上均原子；不引入 native 依赖 |
| Q8 | `init_workspace` 已存在时行为 | (a) 报错 `ALREADY_INITIALIZED` / (b) merge 现有 / (c) overwrite | **(a) 默认报错；通过 `force: true` 显式覆盖** | 安全优先；与 git init 风格一致；force 留作显式逃生口 |
| Q9 | Zod schema 拒绝敏感字段 | (a) `.strict()` + 显式排除字段 / (b) `.refine` 自定义校验 / (c) 文档约束 | **(a) `.strict()` + 在每个嵌套对象层 `.strict()`** | Zod v4 `strict()` 自然拒绝 unknown keys；显式 + 类型安全；CLAUDE.md 凭据红线要 schema 级而非运行时检查 |
| Q10 | 是否 IPC 暴露给 renderer | (a) MCP-only / (b) 同时暴露 IPC | **(a) MCP-only（Phase 8 仅）** | Phase 8 验收只要求 MCP 工具；renderer UI 集成是 Phase 12 范畴。避免本期范围蔓延 |
| Q11 | 配置 `chip/flash/debug/rtt/serial` 5 类的字段细节 | 详尽建模 vs 最小可行 | **最小可行：`chip:{family,part}` / `flash:{tool,binary?,baseAddress?}` / `debug:{tool,connection?}` / `rtt:{enabled,channels?}` / `serial:{port,baudRate,mode}`** | 当前无 J-Link/烧录实现（Phase 9）；过早建模会被 Phase 9 推翻；Zod schema 用 `.partial()` + 必填字段集小；后续阶段扩展为 `.merge`/`.extend` |
| Q12 | 工作区状态如何在主进程持有 | (a) 模块级单例 / (b) 注入到 `MainProcessContext` / (c) 每次 MCP 工具内部 new | **(b) `MainProcessContext.workspaceConfigManager`** | 与 sessionManager / serialDiscovery 一致；可测；析构钩子统一 |
| Q13 | 测试是否需要写真实文件 | (a) 全部 mock fs / (b) 用 `os.tmpdir()` 真写真读 / (c) memfs | **(b) `os.tmpdir()` + per-test 子目录 + afterEach 清理** | 已被 Phase 0-7 选用过；fs/promises 行为细节（atomic rename / mtime）值得真测；`memfs` 引入新 dep；mock 易遗漏边界 |

不向用户反问。所有选择已记录。

## Phase 4: Architecture（候选 + 选中）

3 个并行 `feature-dev:code-architect`。

### 方案 A — Minimal Changes
- 6 个新文件（含测试）；`WorkspaceConfigManager` 单类承担 IO + 校验 + 冲突 + 内存态；`fs/promises` 直用，无注入
- 利：心智一致、PR 小、零新抽象层；schema `.strict()` + `z.never()` 双保险拒敏
- 弊：单类四职容易膨胀；冲突检测 IO 错误路径难单测；patch schema 双写漏改风险

### 方案 B — Clean Architecture
- ~10 个新文件；`IConfigStore` / `IEvidenceProvider` / `IConfigValidator` 接口隔离；组合根 `main/workspace-bootstrap.ts` 装配；冲突检测纯函数；etag 乐观锁
- 利：测试零 fs 零硬件；Phase 9 J-Link 直接 push provider；schema 拒敏+持久化隔离双重防线
- 弊：PR 体积大；接口契约（atomic/etag/权限）需写细，否则 fake 与真实漂移；YAGNI 风险

### 方案 C — Pragmatic Balance ⭐ 选中
- ~8 个新文件；具体类 `WorkspaceConfigManager`，**只在 fs primitives 与 evidenceFn 两点注入**（5 方法 + 1 函数），不抽象 IConfigStore 大接口
- `detectConflicts` 是纯函数，便于单测且 Phase 9 J-Link 加冲突维度只动一个文件
- schema 5 类 `.strict()` 拒敏 + root `.strict()`；`update` 浅 merge 5 类整体替换
- 错误码新增：`WORKSPACE_NOT_FOUND` / `WORKSPACE_ALREADY_INITIALIZED` / `WORKSPACE_CONFLICT`

### 选中理由
1. **未违反 CLAUDE.md 不变量**：`node:fs/promises` 是 Node 内置，core 零 Electron 依赖红线不触；ESM `.js` 后缀；新增错误码同步 `ERROR_CODES` + `ToolErrorCode` 双向；`origin:'ai'` 由 registry 强制
2. **工作量匹配**：DEVELOPMENT_PLAN.md 标记 1.5x（轻偏中），按 next-phase.md 规则 1x < 1.5x < 3x 默认选 Pragmatic
3. **拒方案 A**：单类四职会在 Phase 9 加 J-Link 时被迫拆分；冲突检测无法纯函数单测
4. **拒方案 B**：1.5x 工作量不需要四接口隔离；`IConfigStore` 接口契约（atomic/etag）成本＞当前期望收益；`IEvidenceProvider` 数组在 Phase 8 仅一种实现，纯 YAGNI

## Phase 5: Implementation（实施摘要）

执行模式：全自动 implementor。按 Phase 4 选定的 Pragmatic Balance 方案落地，无重大偏差。

### 实施清单（done | location | what changed）

- done | `src/core/workspace/types.ts` | 5 类配置 TS 接口 + WORKSPACE_SCHEMA_VERSION 常量 + REQUIRED_FIELDS
- done | `src/core/workspace/config-schema.ts` | Zod schema 5 类各 `.strict()` + 根 `.strict()` + `workspaceConfigPatchSchema`（patch 不允许 schemaVersion）
- done | `src/core/workspace/conflict-detect.ts` | 纯函数 detectConflicts；Phase 8 仅 serial.port 维度，全 warn
- done | `src/core/workspace/fs-primitives.ts` | FsPrimitives 接口 + defaultFsPrimitives（node:fs/promises 包装）
- done | `src/core/workspace/workspace-config-manager.ts` | init/load/update/getCurrent；atomic temp+rename；浅合并整体替换；error 类 3 种
- done | `src/core/workspace/index.ts` | barrel
- done | `src/mcp/surfaces/workspace/schemas.ts` | 3 工具入参 schema，patch 复用 core schema 单源
- done | `src/mcp/surfaces/workspace/tools.ts` | init/get/update 3 工具；ZodError → INVALID_ARGUMENT 仅 path/message/code（不回显 value）
- done | `src/shared/types.ts` | EvidenceKind 联合追加 `'workspace_config'`
- done | `src/shared/error-codes.ts` | 追加 WORKSPACE_NOT_FOUND / WORKSPACE_ALREADY_INITIALIZED / WORKSPACE_CONFLICT
- done | `src/mcp/registry.ts` | ToolErrorCode union 同步追加 3 项
- done | `src/mcp/server.ts` | CreateMcpServerOptions 增 workspaceConfigManager + workspaceEvidenceFn；可选注册
- done | `src/main/ipc/index.ts` | MainProcessContext 增 workspaceConfigManager；构造时注入 evidenceFn
- done | `src/core/index.ts` | barrel re-export workspace
- done | `tests/unit/core/workspace/config-schema.test.ts` | 23 cases（schemaVersion literal、5 类 strict 拒未知键 / 拒非法值）
- done | `tests/unit/core/workspace/conflict-detect.test.ts` | 7 cases（缺失/串口冲突/severity 全 warn）
- done | `tests/unit/core/workspace/workspace-config-manager.test.ts` | 16 cases（os.tmpdir 真写真读 + 注入 fs 模拟 ENOSPC / 损坏 JSON / bad schemaVersion / atomic 旧值保留）
- done | `tests/unit/mcp/workspace-tools.test.ts` | 15 cases（3 工具 success/error path + 凭据不回显 + SDK schema 层拦截 unknown keys）

### 被迫做的实施决策

- **I1**：MCP SDK 在 `client.callTool` 调用时若 outer schema 校验失败，**不抛异常**而是返回 `{ isError: true, content: [...] }`（无 `structuredContent`）。原计划用 `expect(...).rejects.toThrow()` 验证 unknown-key 拒绝，改为 `expect(res.isError).toBe(true)`，更准确反映 SDK 行为。凭据红线本质未变：caller value 不进 handler，也不出现在 SDK 默认错误文本里（仅 path 形如 `["patch","chip"]`）。
- **I2**：`workspace-config-manager.test.ts` 中"escalates severity=error"用例无法在 Phase 8 baseline 触发（detectConflicts 当前所有冲突均 warn），改为验证 `evidenceFn` 抛错时 `update` 透传错误（保证不静默吞），并补一条单元测试直接构造 `WorkspaceConflictError` 验证错误形态契约。Phase 9 J-Link 加 error 级冲突时再补端到端用例。
- **I3**：`server.ts` 把 `workspaceConfigManager` 设计为**可选**注入而非必填，避免破坏现有 MCP 终端工具测试（终端测试不构造 manager）。当注入时才注册 3 个 workspace 工具；这与 next-phase.md "向后兼容旧测试" 取向一致。
- **I4**：`get_workspace_config` 不传 root 时回退到 `manager.getCurrent()?.root`（Phase 3 Q1 决策的延伸）。当首次启动且无任何 init/load 调用时，返回 `WORKSPACE_NOT_FOUND` 而非 `INVALID_ARGUMENT`，因为语义是"没有可用工作区"，与文件不存在同因。

### 验收命令尾部输出

```
$ pnpm run lint
> eslint src/ tests/
（无输出 = 0 error / 0 warning）

$ pnpm test
 Test Files  33 passed (33)
      Tests  356 passed (356)         # 旧 base 295 → +61 净增

$ pnpm run build
✓ 118 modules transformed.
✓ built in 461ms

$ pnpm run validate:licenses
PASS: All 19 dependencies have valid license entries
```

测试净增 61（实测 295 → 356，超过预期 25-35；主要是 Manager 测试覆盖 atomic / 损坏 JSON / bad schemaVersion / fs 注入路径较为完整，schema strict 拒敏字段也在 5 类各自列了 case）。

## Phase 6: Review（三视角评审）

3 个并行 `feature-dev:code-reviewer` 子代理（Simplicity/DRY、Bugs/Correctness、Conventions），合并后处置：

### Critical（已修 1/1）
- **C1 (Reviewer B) 并发 update lost-update**：同 manager 内并发 `update(root,A)` / `update(root,B)` 两次 `await this.load(root)` 拿到同一 `current`，后写覆盖前写。修复：以 `#inflight: Promise<unknown>` 做单 root 串行锁包住整个 read→merge→write。

### High（已修 4/4）
- **H1 (Reviewer A) 文件级长篇 docstring 违反"默认禁注释"**：所有 workspace 文件首部 5-15 行叙事 JSDoc 收敛到 1 行 Why；公共 API JSDoc 保留。
- **H2 (Reviewer A) `update` 二次 schema parse 防御性多余**：`current` 已经从 schema 读出、`patch` 已过 patch schema、merge 是浅替换 5 个独立 key —— 二次 parse 不可能产生新错误。删除二次 parse 与防御注释。
- **H (Reviewer B) `getCurrent()` 浅拷贝不防内嵌突变**：改 `structuredClone`。
- **H (Reviewer B) `init(root)` 路径未规范化**：schemas + manager 入口加 `path.isAbsolute(root)` 校验，并拒 `..` 段。

### Medium（已修 8/9，1 项标 N/A）
- **M (A/B/C) getCurrent 浅拷贝**：与 H 合并修复。
- **M (Reviewer A) `REQUIRED_FIELDS` 三处 re-export**：保留 `types.ts` 单源，删除 schema/manager 末尾 re-export。
- **M (Reviewer A) `successOk` helper 多余**：3 调用点内联，删 helper。
- **M (Reviewer A) `as RequiredField[]` 多余**：去类型断言。
- **M (Reviewer B) `#writeAtomic` tmp 残留**：`fs-primitives` 加 `unlink`；try/finally 中 `await fs.unlink(tmp).catch(()=>{})`。
- **M (Reviewer B) load 不限文件大小**：stat 后 size > 1 MiB 抛 INVALID_ARGUMENT。
- **M (Reviewer B) `schemaVersion` mismatch 错误码模糊**：load 在 Zod parse 前显式判 `parsed.schemaVersion !== WORKSPACE_SCHEMA_VERSION` → 抛 `WorkspaceSchemaVersionMismatchError`，新增 `ERROR_CODES.WORKSPACE_SCHEMA_VERSION_MISMATCH` + `ToolErrorCode`。
- **M (Reviewer C) validateOnly 仍切换 `#current`**：在 validateOnly 路径前快照 `#current`，结束时恢复。
- **M (Reviewer C) ToolError details 含 report.configured/actual**：加 sanitizer，conflict report 仅保留 `field/severity/message`。
- **M (Reviewer B) load 失败 `#current` 不变保留旧 root**：N/A（语义可接受：失败时 caller 应处理；强制清空会引入新别 root 混淆，登记 Phase 9 backlog 跟踪）。

### Low（不修，登记 backlog）
- L (Reviewer A) `config-schema.test.ts` 5 类 strict 拒敏可改 `it.each` 表驱动：保留可读性，不动。
- L (Reviewer A) test 用例命名 `escalates severity=error...` 与断言不符 → 改名 `propagates evidenceFn errors`（顺手修）。
- L (Reviewer A) `WorkspaceConflictError` 测试纯构造检查 → 顺手删（与 conflict-detect 测试合并）。
- L (Reviewer A) `isNodeErrno` 自定义 type guard 可换 `NodeJS.ErrnoException`（顺手）。
- L (Reviewer B) `init force` 不回带 previousConfig：Phase 8 暂不做。
- L (Reviewer C) tools.ts description 引用错误码字面量：保留可读性。

## Phase 7: Summary（验收）

执行日期：2026-06-14（review 修复 + 验收同日完成）

### 验收门最终输出

```
$ pnpm run lint
> eslint src/ tests/
（无输出 = 0 error / 0 warning）

$ pnpm test
 Test Files  33 passed (33)
      Tests  363 passed (363)        # 295 base → 363（+68 净增；review 后再 +7）

$ pnpm run build
✓ 118 modules transformed.
✓ built in 2.75s

$ pnpm run validate:licenses
PASS: All 19 dependencies have valid license entries
```

### 已交付
- `src/core/workspace/{types,config-schema,conflict-detect,fs-primitives,workspace-config-manager,index}.ts`：5 类配置 / Zod 严格 schema / 纯函数冲突检测 / fs 注入 / 串行化 manager（`#inflight` 链式锁）
- `src/mcp/surfaces/workspace/{schemas,tools}.ts`：3 个 MCP 工具（init / get / update），ZodError 仅暴露 path/message/code，conflict report 在 details 里去除 configured/actual
- `src/shared/{error-codes,types}.ts`：新增 4 个错误码（WORKSPACE_NOT_FOUND / ALREADY_INITIALIZED / CONFLICT / SCHEMA_VERSION_MISMATCH），EvidenceKind +`'workspace_config'`
- `src/mcp/registry.ts`：ToolErrorCode union 同步
- `src/mcp/server.ts` / `src/main/ipc/index.ts`：可选注入 workspaceConfigManager + workspaceEvidenceFn

### 关键决策回顾
- Q1 workspaceRoot 由 caller 显式传入；manager 内部维持 currentWorkspace
- Q2 schemaVersion 用 `linkterm-workspace/1.0.0` namespace 风格
- Q4 独立 workspace MCP surface，不污染 terminal/debug/ui 三表面
- Q7 atomic temp+rename + 单进程串行 `#inflight` 锁；不引入 advisory lock
- Q9 凭据 schema 级拒绝（每层 `.strict()`），运行时无 refine
- 选 Pragmatic Balance C（fs/evidenceFn 两点注入），拒 Clean Architecture B（YAGNI）
- patch schema 不允许改 schemaVersion（避免误升级）
- C1 修复：`#inflight: Promise<unknown>` 串行 init / update，`load()` 仍允许并发（read-only + 单赋值）

### Phase 9 backlog 携入
- 失败 load 不清空 #current（语义已确认，等加 staleness 元信息）
- detectConflicts 当前 severity 全 warn；J-Link 设备级冲突再补 error 维度
- AbortSignal 透传到 SessionManager.waitFor（Phase 7 携入）
