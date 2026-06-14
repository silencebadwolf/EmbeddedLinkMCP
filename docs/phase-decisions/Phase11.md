# Phase 11 决策记录 — 许可证管理

执行日期：2026-06-14
执行模式：全自动（用户预先授权一律选推荐项）

## Phase 1: Discovery（目标摘要）

**目标**：实现第三方许可证归因、清单维护和**双向校验**。

**当前状态**（DEVELOPMENT_PLAN.md 标 🟨 部分完成）：
- ✅ `third-party-manifest.json`（19 个 entry）
- ✅ `licenses/` 目录（19 个 `.LICENSE` 文件，与 manifest 一一对应）
- ✅ `scripts/validate-licenses.ts`（已实现 manifest→license 单向校验）
- ✅ `pnpm run validate:licenses` 命令

**验收标准对比**：

| 标准 | 当前 | Gap |
|---|---|---|
| `npm run validate:licenses` 通过 | ✅ | — |
| 缺少许可证文件 → 校验失败 | ✅ | — |
| **新增依赖未更新清单 → 校验失败** | ❌ | **未实现 package.json↔manifest 双向校验** |

**核心 gap**：当前脚本仅校验"manifest 内部一致性 + 引用的 license 文件存在"。如果 `package.json.dependencies` 新增一个依赖（例如 `pnpm add some-pkg`）但忘了更新 manifest，脚本会"PASS"，违反 CLAUDE.md "Every runtime third-party dependency MUST be recorded in `third-party-manifest.json`"。

**相对工作量**：0.5x（最轻 Phase）

## Phase 2: Exploration（代码库勘探）

由于 0.5x 工作量 + 单文件改动，跳过并行 explorer，inline 探查：

### 现有 `scripts/validate-licenses.ts` 行为

```ts
// 仅做 manifest → license 单向校验
for (const dep of manifest.dependencies) {
  if (!dep.name / version / license / licenseFile) errors.push(...);
  if (!existsSync(licensePath)) errors.push(`License file missing for ${dep.name}`);
}
```

**输出**：`PASS: All N dependencies have valid license entries` 或 `FAIL: ...`。

### 与 package.json 的关系

`package.json.dependencies`（18 个）+ `electron`（technically devDep but 必须计入，因为运行时分发）= 19 个，与 manifest 19 entry 一致 —— 这是**人工同步**结果，没有自动校验。

`devDependencies`、`peerDependencies`、`optionalDependencies` 不应在 manifest 内（开发期工具不分发给最终用户）。

### 现有 `licenses/` 目录

19 个 `.LICENSE` 文件，文件名与 manifest 的 `licenseFile` 字段对应。`react.LICENSE`、`react-dom.LICENSE`、`xterm.LICENSE`（@xterm/xterm 简写）等不全是依赖原始包名，是项目自定的扁平命名。

### CLAUDE.md 相关条目

- "Every runtime third-party dependency MUST be recorded in `third-party-manifest.json` AND have its license file present at `licenses/<name>.LICENSE`. `pnpm run validate:licenses` enforces this **bidirectionally**."（"bidirectionally" 是承诺，但当前未真正双向）
- "When you add a runtime dependency, update both files in the same change — CI/validation will fail otherwise"

→ 这两条是 Phase 11 要兑现的硬承诺。

### 测试基建

`scripts/` 当前**无测试**。Phase 11 需要为 validate-licenses 增加单测（npm 脚本类工具已往例如 next-phase 自身亦无）—— 但既然 CLAUDE.md 已承诺 bidirectional，要保证回归不退化，**应当补 vitest 单测**。

## Phase 3: Clarifying（自动应答）

### Q1. 双向校验的 "package.json side" 应包含哪些字段？

**候选**：
1. 仅 `dependencies`
2. `dependencies` + `optionalDependencies`
3. `dependencies` + `optionalDependencies` + 选中的 `devDependencies`（如 electron）

**选**：方案 1 —— 仅 `dependencies`。**理由**：
- `electron` 在 package.json 实际是 `devDependencies`（启动时由 electron CLI 装），但运行时分发包含 Electron runtime → manifest 仍记录它
- 当前 CLAUDE.md "Every runtime third-party dependency" 是模糊描述
- 折中方案：脚本默认对 `package.json.dependencies` 做严格双向校验；对 `electron`（特殊 dev/runtime 边界依赖）通过显式 allowlist 处理

最终采用：**严格校验 `package.json.dependencies`**，并把 `electron` 加入 `EXTRA_RUNTIME_DEPS` 显式 allowlist（写在脚本顶部常量），保证脚本能识别"在 devDeps 但需进 manifest"的特殊情况。

### Q2. 校验方向：缺失检测 vs 多余检测

**候选**：
1. 仅检测 "package.json 有但 manifest 缺"（缺失）
2. 仅检测 "manifest 有但 package.json 缺"（多余 / stale）
3. 同时检测两个方向

**选**：方案 3 —— 双向。**理由**：
- 缺失 = 新增依赖未补 manifest（验收标准明文）
- 多余 = 删除依赖后忘删 manifest entry（同样应失败，否则 manifest 会随时间漂移）
- 对称设计（mirrors `WORKSPACE_*` error codes 的 4 方向）

### Q3. 版本号校验严格度

**候选**：
1. 完全不校验版本（manifest version 仅作记录）
2. 严格相等（manifest "^1.2.3" 必须与 package.json "^1.2.3" 完全一致）
3. 仅校验存在（manifest 必须有 version 字段，但内容不与 package.json 比对）

**选**：方案 2 —— 严格相等。**理由**：
- 防止依赖被 bump 后忘了更新 manifest（虽然 license 通常不随小版本变，但 major/license 变更需要重新审核）
- 严格相等最简单，无 semver 解析负担
- 如果未来需要松一点，再降级到方案 3

实现：直接字符串比较 `manifest.dependencies[i].version === pkg.dependencies[name]`。

### Q4. `EXTRA_RUNTIME_DEPS` allowlist 是否要校验"它确实在 package.json 某处"

**候选**：
1. allowlist 项必须存在于 package.json 任一 dep 字段（dep / devDep / opt）
2. allowlist 项无需存在（纯白名单）

**选**：方案 1。**理由**：避免"已删除依赖留在 allowlist"导致 stale。

### Q5. 输出格式

**候选**：
1. 现有 `PASS: ... / FAIL: ...` 格式延用（追加新错误类型）
2. 改成结构化 JSON 输出
3. 结构化 + 人类可读双输出

**选**：方案 1。**理由**：保持与现有 CI 兼容，避免改动 `pnpm run validate:licenses` 调用方（无 CI 解析输出）。新错误类型沿用 `errors.push(...)` 模式即可。

### Q6. 是否给脚本补单测

**候选**：
1. 仅依赖"脚本本身能跑过"作为回归（现状）
2. 用 vitest 补单测（fixtures 模拟不同 manifest / package.json 组合）

**选**：方案 2。**理由**：
- 既然 CLAUDE.md 承诺 bidirectional，没单测一旦回归会 silent
- vitest 已是项目标配
- 测试写起来不复杂（mock fs 或写 fixture 目录）

### Q7. 单测组织位置

**候选**：
1. `tests/unit/scripts/validate-licenses.test.ts`
2. `tests/integration/validate-licenses.test.ts`（执行真 `tsx scripts/validate-licenses.ts`）
3. 把校验逻辑抽成纯函数 + 单测纯函数

**选**：方案 3。**理由**：
- 抽出 `validateLicenses(opts: { manifestPath, packageJsonPath, licensesDir }): { errors: string[]; ok: boolean }` 纯函数
- 单测注入临时目录的 fixtures，覆盖：missing-in-manifest / extra-in-manifest / version-mismatch / missing-license-file / electron-allowlist-pass / 全部正确 6 种 case
- 脚本入口仅做 path 拼装 + process.exit
- 与项目其它 testable / DI 风格一致

### Q8. fixture 文件组织

**候选**：
1. `tests/fixtures/license-validation/{ok,missing,extra,version-mismatch}/`（多目录 fixture）
2. 测试代码内 inline 写 manifest+package.json+license 文件到 `tmpdir()`

**选**：方案 2。**理由**：fixtures 太多目录会成为长尾负担；inline 更紧凑且自动清理（`afterEach` rm -rf）。

## Phase 4: Architecture（候选 + 选中）

由于 0.5x 工作量、单一明确实现路径，**跳过并行 3-architect**，inline 选定 **Minimal Changes** 风格（与 `/next-phase` 规则一致："工作量 ≤1x → 优先 Minimal Changes"）。

### 选中方案：Minimal Changes

**改动文件清单**：
1. `scripts/validate-licenses.ts` — 重构：
   - 抽出 `validateLicenses(opts)` 纯函数（导出）
   - 入口 `main()` 仅拼路径 + 调函数 + 打印 + exit
   - 新增双向 + 版本严格 + electron allowlist 逻辑
2. `tests/unit/scripts/validate-licenses.test.ts` — **新增**单测：
   - happy path
   - missing-in-manifest（package.json 多了一个）
   - extra-in-manifest（manifest 多了一个非 allowlist）
   - version-mismatch
   - missing-license-file
   - electron-in-allowlist-passes（在 devDeps 而非 deps）

**数据流**：

```
package.json.dependencies + EXTRA_RUNTIME_DEPS allowlist
  ↓
计算 expectedSet
  ↓
manifest.dependencies → manifestSet
  ↓
diff(expected, manifest) → missing[]
diff(manifest, expected) → extra[]
对每个交集项校验 version 严格相等
对每个 manifest 项校验 license 文件存在
  ↓
errors[] → exit code
```

**实施顺序**：
1. 抽 `validateLicenses` 纯函数 + 入口
2. 加双向校验逻辑 + EXTRA_RUNTIME_DEPS（含 `electron`）
3. 加版本字符串严格校验
4. 写单测 6 个 case
5. `pnpm run validate:licenses` 验证现状 19 deps 全过

**为什么选 Minimal 没选 Clean / Pragmatic**：
- 0.5x 工作量按规则 → Minimal
- 单文件单职责，无跨模块抽象需求
- Clean Architecture（分层 / Strategy）会引入 LicenseChecker / ManifestParser 等 4 个类，对 50 行逻辑过度
- Pragmatic 在 Minimal 之上没什么可加的

## Phase 5: Implementation（实施摘要）

由主流程直接实施（0.5x 工作量、单文件改动 + 测试）。

**改动文件清单**：
- `scripts/validate-licenses.ts`（重构 + 双向校验）
- `tests/unit/scripts/validate-licenses.test.ts`（新增 9 个测试用例）

**关键实现**：
1. 抽出 `validateLicenses(opts)` 纯函数（导出供测试），入口 `main()` 仅做 path 拼装 + exit
2. 新增 `EXTRA_RUNTIME_DEPS = ['electron']` 显式 allowlist
3. 4 类校验：manifest 内部一致性 / 缺失检测 / 多余检测 / 版本严格相等 / stale allowlist 检测
4. 测试 fixture 用 `mkdtempSync` + `afterEach rm -rf` 完全隔离

**Implementation 决策追加**：

- **Q-I1：`isDirectExecution` 判断如何兼容 tsx**
  - 候选：(a) `import.meta.url === `file://${argv[1]}`` (b) 检查 `argv[1]?.endsWith('validate-licenses.ts')`
  - **选**：两者并用（OR）。**理由**：tsx 通过 `--import` 钩子启动时，`process.argv[1]` 可能是源文件路径而非 file://，单一比较会漏失；OR 兜底确保 npm script 调用与 import-from-test 都正确分流
- **Q-I2：fixture 是否抽公共 helper**
  - 候选：(a) inline 重复写 (b) 抽 `makeFixture(root, spec)`
  - **选**：抽 helper（9 个测试都用同一形态，DRY）
- **Q-I3：错误消息文案是否结构化**
  - 候选：(a) 自由文本 (b) `[CODE] message` 前缀
  - **选**：自由文本。**理由**：本脚本仅给开发者看，无机器解析需求；与现有 `'License file missing for ...'` 风格一致

## Phase 6: Review（三视角评审）

并行派 3 个 `feature-dev:code-reviewer`（Simplicity / Bugs / Conventions）。

### 汇总报告

#### High（必修）

- **H1：跨平台启动判定 + ESM `__dirname` 派生** —— `import.meta.dirname` 需要 Node ≥20.11，但 `package.json` `engines.node` 是 `>=20.0.0`；`isDirectExecution` 用字符串拼 `file://${argv[1]}` 在 Windows / 软链场景下失效，第二条 `endsWith('validate-licenses.ts')` 兜底过宽。
  - **处置**：`__dirname` 改 `dirname(fileURLToPath(import.meta.url))`；`isDirectExecution` 改 `pathToFileURL(argv[1]).href === import.meta.url` 单一可靠判断（删 endsWith 兜底）
- **H2：缺失检测错误消息在 allowlist 路径下措辞矛盾** —— allowlist 项被从 package.json 删除时会同时报 "allowlist contains X but not in package.json" + "X is in package.json but missing from manifest"，自相矛盾。
  - **处置**：循环里区分来源 `(from package.json)` vs `(from EXTRA_RUNTIME_DEPS allowlist)`

#### Medium（默认同期修）

- **M1：补 3 个边界测试** —— missing-package-json / manifest-corrupt-json / accumulates-multiple-errors。前两条防止 JSON.parse 路径回归，第三条防止"循环里 push 改成 return"的回归。
  - **处置**：tests 文件增加 3 个 it 用例
- **M2：删除同义反复测试** —— `it('exports EXTRA_RUNTIME_DEPS for documentation')` 不验证行为，只钉死实现细节。
  - **处置**：删除该测试用例
- **M3：补 `ValidateOptions` / `ValidateResult` 的 interface JSDoc** —— CLAUDE.md 要求 exported 接口字段有 JSDoc。
  - **处置**：补全两个 interface + 各字段的 JSDoc
- **M4：`isDirectExecution` 简化** —— 与 H1 合并处理。

#### Low（推迟到 Phase 12 backlog）

- **L1：错误消息风格不统一**（混用 "Missing X for Y" / "X is missing" 等）—— 不影响功能，留给 Phase 12 收尾。
- **L2：`scripts/**/*.ts` 未纳入 ESLint 扫描** —— eslint.config.js 配置遗漏，本期不改 lint 配置（避免影响其它 PR）；记入 backlog。
- **L3：manifest 内重复 name 不报错** —— 极端场景，非紧急。
- **L4：JSON 解析失败短路** —— 设计权衡，保留现状（一次只让用户修一处问题反而清晰）。
- **L5：`JSON.parse` 直接断言强类型** —— 与 zod 校验风格不一致；脚本内已防御性校验关键字段，runtime 风险小。
- **L6：注释流程编号 `// 1./2./3./4.` 与顶部 JSDoc 重复** —— 删除任一即可，但都是为可读性；保留现状无害。

### 修复后验收

测试数 462 → 473（+11：8 个原 license 测试 + 3 个新增 + 删 1 同义反复 = net +10 + 1 happy path 仍计 = 实际 +11）。所有 4 条命令仍全绿。

## Phase 7: Summary（验收）

修复后跑 4 条验收命令，全部绿通过：

| 命令 | 结果 |
|---|---|
| `pnpm run lint` | exit 0，0 error / 0 warning |
| `pnpm test` | exit 0，**473 个测试通过**（baseline 462 + 11 个 license 单测） |
| `pnpm run build` | exit 0，`tsc -b` + `vite build` 双侧成功 |
| `pnpm run validate:licenses` | exit 0，PASS: All 19 dependencies have valid license entries |

**Phase 11 交付完成**：双向校验 manifest ↔ package.json + 版本严格相等 + EXTRA_RUNTIME_DEPS allowlist + 11 个 vitest 单测覆盖。`__dirname` 改用 ESM 标准派生方式（与项目其它位置一致），`isDirectExecution` 用 `pathToFileURL` 跨平台可靠。脚本既能 `pnpm run validate:licenses` 调用，又能被 vitest import 不触发副作用。从此新增依赖未补 manifest / 删依赖未删 manifest / bump 依赖未重新审核 license / 删 license 文件 全部会触发校验失败。
