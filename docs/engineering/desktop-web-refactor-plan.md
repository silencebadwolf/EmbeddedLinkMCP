# LinkTerm pnpm monorepo 双端重构计划

日期：2026-09-21。状态：实施中；workspace 与 contracts 已迁移并通过质量检查，后续阶段持续推进。实际进度和验收记录见 [迁移状态](./desktop-web-migration-status.md)。

本版替代此前以根目录 src 分层为最终布局的方案。目标仍是：保留 Electron 桌面端，新增可独立部署的单用户 Web 端，后端可运行在本机或服务器。完整文件结构见 [monorepo 文件框架](./desktop-web-project-structure.md)。

## 1. 架构决策

采用 3 个应用入口、4 个共享包，保留现有 React、Vite、Zustand、xterm.js、TypeScript 与 pnpm 技术栈。第一阶段维持 pnpm 9.15.0 和现有 Node engines，不同时进行工具链大版本升级。

| 项目 | 包名 | 职责与运行环境 |
| --- | --- | --- |
| apps/desktop | @linkterm/desktop | Electron main、preload、桌面 renderer 入口、IPC 与桌面平台能力 |
| apps/web | @linkterm/web | 浏览器入口、WebClient、登录界面与 Vite 构建 |
| apps/server | @linkterm/server | Node 常驻服务、认证、HTTP、WebSocket、静态资源与服务端平台能力 |
| packages/contracts | @linkterm/contracts | ClientAPI、请求 / 响应 DTO、Zod schema、事件、错误码、能力与协议版本；浏览器可用 |
| packages/ui | @linkterm/ui | 两端共用的 App、业务界面、组件、hooks、store、样式与国际化 |
| packages/runtime | @linkterm/runtime | createRuntime、应用服务、core、transports、J-Link、工作流、审计与宿主接口；仅后端使用 |
| packages/mcp | @linkterm/mcp | MCP 工具注册、协议入口、结果 / 错误转换；消费 runtime 公共接口 |

每个应用和共享包都有自己的 package.json、tsconfig 和测试入口；根目录负责统一命令、锁文件、开发工具与跨包测试。所有内部包初期 private: true，不需要发布到 npm。core、transports、jlink 暂作为 runtime 内部模块。

### 依赖方向

~~~mermaid
flowchart TD
    DMain["desktop main"] --> R["@linkterm/runtime"]
    DMain --> M["@linkterm/mcp"]
    DMain --> C["@linkterm/contracts"]
    DPreload["desktop preload"] --> C
    DRenderer["desktop renderer"] --> U["@linkterm/ui"]
    DRenderer --> C
    W["apps/web"] --> U
    W --> C
    S["apps/server"] --> R
    S --> M
    S --> C
    M --> R
    M --> C
    R --> C
    U --> C
~~~

desktop 包包含不同进程入口，构建与架构检查分别约束 main、preload、renderer。renderer / web 的依赖闭包不能包含 runtime、MCP SDK、Electron 或原生模块。runtime 不反向依赖 mcp 或 apps。包间通过显式 exports 导入，不跨包引用 src 文件。

### 运行方式

- 桌面：Electron 主进程创建一次 runtime，再装配 IPC 与 MCP；renderer 使用 DesktopClient。
- Web：Node 服务创建一次 runtime，再装配 HTTP / WS / MCP，并同源提供 apps/web 的静态产物；浏览器使用 WebClient。
- Web 生产环境启动一个 Node 服务即可，无需 Electron 或 Vite；本机访问 localhost，服务器部署访问配置的 IP / 域名。
- 独立部署拥有独立 runtime。每个实例中的 UI / MCP 共用 SessionManager、SerialSessionCoordinator、ControlWorkflowJobManager、OperationLedger 和 OperationAdmissionCoordinator。
- 每个 dataDir 只允许一个 owner；第二个 owner 明确报冲突。桌面与独立服务使用分别配置的数据目录，monorepo 不意味着跨部署自动同步会话。

## 2. 功能范围

| 能力 | 桌面端 | Web 端首期 |
| --- | --- | --- |
| 终端界面、国际化、保存连接 | 保留 | 复用共享 UI，调用 Web 后端 |
| SSH / Shell | 由桌面 runtime 执行 | 由服务端 runtime 执行；显示执行主机 |
| 串口 / J-Link / RTT | 操作桌面机器上的设备 | 操作后端机器可访问的设备 |
| 工作区 / 控制配置 / 固件 | 保留原生文件选择 | 后端工作区选择、受控上传和资源 ID |
| Activity / readiness / first-signal | 保留现有行为 | HTTP 快照与 WS 增量，支持重连 |
| 控制工作流 | 保留 | 后台 job 独立于页面生命周期 |
| MCP Agent 集成 | 保留本机 / WSL 集成 | 提供服务端集成与远程连接配置 |
| UI 配置 / 截图 | 保留 Electron 能力 | UI patch 选择浏览器目标；截图返回 UI_NOT_AVAILABLE |
| 凭据存储 | 保留 safeStorage 兼容 | 服务端密钥保护的存储，支持配置迁移 |

远程服务器不会自动获得浏览器所在电脑的串口、USB 或文件路径。用户电脑硬件代理、多用户 SaaS、跨设备自动同步、浏览器截图服务和新的 AI 产品功能不计入首期交付。

## 3. workspace 与构建约定

workspace 的目标配置：

~~~yaml
packages:
  - 'apps/*'
  - 'packages/*'
~~~

现有原生依赖平台配置在 pnpm 9.15.0 的有效配置位置保留并验证。迁移期间根应用可继续存在，最终根 package.json 收敛为 private 的命令与工具管理入口。

1. **内部依赖。** 使用 workspace:*，每个包声明自己实际使用的依赖；保留单一根 pnpm-lock.yaml。workspace 协议明确要求解析到本地工作区包。[pnpm workspace](https://pnpm.io/workspaces)
2. **包边界。** contracts 导出浏览器安全的 API / DTO / schema；runtime 只导出宿主和 MCP 所需的公共服务、接口及类型。通过架构测试和 ESLint 限制跨层导入与循环依赖。
3. **TypeScript。** 共享包使用 project references 与 composite，产出 ESM JS、声明和 sourcemap。后端配置采用与实际 Node ESM 一致的解析规则，保持相对 import 的 .js 后缀；前端使用 Vite 对应的 bundler 配置。根构建图由 tsc -b 管理。[TypeScript project references](https://www.typescriptlang.org/docs/handbook/project-references.html)
4. **依赖编译。** contracts 先编译，ui 与 runtime 随后编译，mcp 依赖 runtime，然后构建应用。exports 指向实际产物；干净 checkout 的首次启动必须先完成依赖构建。
5. **共享 UI。** UI 包通过注入 ClientAPI 工作；React / ReactDOM 由两个前端宿主提供并使用兼容的统一版本，UI 声明 peerDependencies。样式与资源显式导出，配置 Tailwind 扫描共享包并验证生产样式。
6. **开发监听。** 根 dev 脚本先进行共享包初始构建，再启动包 watch 与所需宿主，并统一退出子进程。修改共享 UI / contracts / runtime 后，两端应能热更新或受控重启。
7. **发布装配。** apps/server 不把 apps/web 声明为运行时包依赖。release 脚本将 web 静态产物复制进服务端发布目录，分别生成桌面包与 server + web 包。
8. **按包命令。** 使用 pnpm --filter 选择应用、依赖或受影响的消费方；完整 CI 仍执行全仓必要门禁。[pnpm filtering](https://pnpm.io/filtering)
9. **原生模块。** 使用现有 transport 可注入能力，把原生绑定加载集中到宿主提供的工厂；桌面与 Node 的依赖安装 / 重建目录物理隔离，开发环境也遵守。仅拆成多个 package.json 不能隔离 ABI。[Electron native modules](https://www.electronjs.org/docs/latest/tutorial/using-native-node-modules)
10. **根工具。** 调整 lint、测试、覆盖率、license、SBOM、doctor 和发布脚本，使其覆盖 apps / packages。保持现有质量与归因要求，防止拆包后因根 dependencies 变空而漏检。

## 4. 迁移阶段

采用逐阶段可运行、可验收、可回退的迁移。下表保留完整实施范围，完成情况以迁移状态记录为准。

| 阶段 | 主要任务 | 验收门槛 | 粗估 |
| --- | --- | --- | --- |
| P0：基线与影响分析 | 恢复 GitNexus；记录现有构建、测试、桌面数据路径、Agent 配置和性能基线；确认包依赖清单 | 明确既有失败、待改符号与受影响流程；保留可运行桌面基线 | 1–2 天 |
| P1：workspace 与 contracts | 建立 apps / packages 约定、共享 TS 配置；提取契约包、ClientAPI 和显式 exports；迁移期保留旧导入兼容 | 干净安装可编译 contracts；现有桌面仍能构建 / 启动；契约不加载 Node / Electron | 2–3 天 |
| P2：runtime 与 MCP 解耦 | 抽出 createRuntime、services、ports；迁移 core / transports / jlink；移出 MCP 中的业务执行器和任务管理；建立 mcp 包 | Node 环境可创建 / 释放完整 runtime；无 runtime → mcp 循环；IPC / MCP 仍使用同一会话和任务实例 | 4–6 天 |
| P3：共享 UI 与桌面宿主 | 提取 ui 包；建立 apps/desktop；注入 DesktopClient；迁移 preload / IPC / 平台能力；更新桌面启动与打包路径 | 完整桌面在 monorepo 中可用；原生绑定可加载；UI 无后端依赖；原配置与数据路径兼容 | 3–5 天 |
| P4：独立 Web 最小闭环 | 建立 apps/server 和 apps/web；认证、HTTP、WS、WebClient；贯通会话创建、输入输出、resize、关闭和基础恢复 | 无 Electron / 无 GUI 时可启动；浏览器终端与 MCP 共享 runtime；刷新不创建重复会话 | 4–6 天 |
| P5：功能与数据迁移 | 接入连接、工作区、固件、J-Link / RTT、工作流、Activity / readiness / first-signal；增加服务端 codec 与数据迁移；适配 Agent 启动 / 诊断 / 重启 | 首期能力矩阵逐项通过；旧配置可读；不兼容凭据可重新录入；后台任务可重新订阅 | 4–6 天 |
| P6：网络、资源与边界 | 完善断线续传、快照竞态、请求去重、多标签页、背压、认证 / 路径校验、owner 锁与异常清理 | 故障注入通过；不重复执行不确定写入；慢客户端不拖垮 runtime；未认证请求不能调用业务 | 3–5 天 |
| P7：产物与发布 | 完成双目标隔离打包、CI、SBOM / license、部署示例、迁移恢复文档、干净机器和真实硬件验收 | 桌面安装包与独立 Web 服务包均可交付，产物不依赖源码仓库或构建机路径 | 3–5 天 |

单名熟悉仓库的开发者初步估算 24–38 个工作日，约 5–8 周。P3 是 monorepo 桌面可用里程碑；P4 是 Web 终端原型；完整双端交付以 P7 为准。P0 后按实际基线修正估算，硬件 / 平台问题与范围变更另计。

### P2 需要真正解耦的现有代码

- src/main/ipc/index.ts：将 manager 创建、readiness 装配、审计初始化和资源释放迁入 runtime；IPC 注册留在桌面宿主。
- src/main/ipc/*-ipc.ts：业务编排迁到 runtime/services，协议 handler 保留参数转换、身份校验与结果映射。
- src/shared/preload-api.ts：分离平台无关 ClientAPI、领域 DTO 和桌面 Window 类型声明。
- src/mcp/surfaces/control-workflow/job-manager.ts：迁到 runtime/core/control-workflow，去掉 MCP ToolError 与协议 schema 依赖。
- src/mcp/surfaces/control-workflow/workflow-runner.ts：迁到 runtime/workflows，使用领域错误和公共业务输入。
- src/core/activity/operation-recorder.ts、risk-policy.ts：去除对 MCP 目录的类型引用，将任务观测和风险类型放回 runtime 领域层。
- src/core/session/factory.ts：具体 transport 装配迁到 runtime/factories；原生绑定由宿主适配器提供。
- src/mcp/electron-runtime-launcher*：Electron 启动逻辑归 desktop，通用 owner 探测归共享后端模块，Node 服务提供自身启动与重启适配。

### P3 的兼容要求

记录并保留既有 app 身份、appId、productName、实际 userData 路径和 saved workspace 行为。将 package.name 改为 @linkterm/desktop 时，不能顺带改变既有用户的数据定位。

桌面入口由现有 dist/main/main/index.js 迁往 apps/desktop 的产物时，同步更新 package main、electron-builder、preload 路径、静态资源路径、Agent launcher、stdio proxy 与相关测试。迁移期间旧 pnpm start / build / pack / dist 命令由根脚本转发；最后统一移除过渡导出。

## 5. 协议与运行时行为

**生命周期。** 由 desktop / server 宿主创建 runtime，再注册协议适配器。runtime 包不启动 IPC / HTTP / MCP。退出时先停止新请求和订阅，处理在途操作，再释放业务资源；部分启动失败必须回滚。页面断开只清理客户端资源，不销毁后台会话或 job。

**单一执行路径。** UI、WS 和 MCP 写入共用同一 session 的 WriteQueue，保留现有 Ctrl-C 优先级、设备锁、操作准入和审计语义。human / ai 来源由入口确定，客户端不能伪造身份或执行 lease。

**请求与事件。** contracts 保留现有错误码、序列号、字节编码与证据语义，新增协议版本、capabilities 和 requestId。HTTP 管理资源，WS 传输输入输出和事件；通过明确方法白名单派发。每个连接有独立 clientId / subscriberId，订阅在快照期间缓冲增量，然后按 cursor 接续并去重。

**恢复。** 刷新或断网后恢复已有会话与订阅；超出历史窗口时返回 truncated 和 oldestAvailableSequence 并显示缺口。runtimeId 改变时旧游标失效；首期不恢复已终止的 PTY / SSH 进程。多标签页分别订阅，PTY 尺寸由明确的活动客户端策略决定。

**重试。** 读取可重试。可去重命令使用 requestId 与结果查询；终端写入、烧录、脚本响应不确定时不能自动重发。断线期间停止发送输入并显示连接状态；工作流由 job manager 管理，重连查询原 job。

**网络边界。** 最小认证与限额在 P4 引入。默认监听 loopback，远程部署显式配置监听地址与 HTTPS 反向代理；浏览器使用 HttpOnly / SameSite 会话，校验 Origin、CSRF 和 WS 握手。MCP Bearer token 独立管理，长期秘密不进入前端 bundle、URL 或 localStorage。

**文件与设备。** 显示后端主机与设备归属。文件操作使用工作区 ID、相对路径或上传资源 ID，检查 realpath / 符号链接边界。上传验证大小、格式与哈希，并规定临时文件清理。Shell 使用服务进程的 OS 权限，部署采用专用普通用户；文件 API 的根目录约束不冒充 Shell 隔离。

**数据与凭据。** 保留单用户 JSON / JSONL 存储，统一全局 dataDir；工作区下的 .linkterm 继续随工作区保存。凭据格式增加 provider / version / keyId；桌面继续识别 safeStorage，服务端使用独立部署密钥。没有加密能力时允许临时提交凭据但不保存。旧密文无法解密时迁移非敏感配置并要求重新录入；升级先备份、原子写入，回退恢复旧版本和备份。SSH 凭据只在必要请求中瞬时传输，不进入活动事件、持久 UI 状态或日志。

**能力差异。** 文件选择、审计导出、UI bridge 和 Agent 安装明确区分宿主。Web 不宣称能直接修改浏览器电脑的 Agent 配置；无截图后端时保留明确 UI_NOT_AVAILABLE。现有 MCP 工具名及已声明协议行为保持兼容，版本升级另行定义迁移。

## 6. 原生依赖与发布

Electron 与 Node 的原生 ABI 可能不同，使用分别装配的开发 / 发布目录。原生绑定在所属宿主的依赖目录解析；共享源码和 JS 产物可以复用，原生重建不能写入另一宿主正在使用的 node_modules。检查并重新验证现有 electron-builder 的 npmRebuild: false。[Electron 官方说明](https://www.electronjs.org/docs/latest/tutorial/using-native-node-modules)

发布准备脚本将 workspace 包的编译产物和正确的生产依赖物化到独立 staging，不能留下指向源码目录的 workspace symlink。pnpm 9.15.0 的部署命令 / 打包行为以实际 smoke test 验证，不依赖新版专有参数。

- 桌面产物：Electron、desktop main / preload / renderer、runtime / MCP 与匹配的原生依赖。
- Web 产物：Node 服务、runtime / MCP、web 静态资源与 Node 原生依赖；无需 Electron。
- server 生产依赖闭包不包含 UI 构建工具或 Electron；Web bundle 不含原生模块或服务端秘密。
- 为两种产物分别生成校验和、SBOM 与归因文件；根许可证脚本按 workspace 中实际分发的依赖检查，保留现有开发工具审计。
- 容器先覆盖 SSH / 无硬件运行；USB、串口、SEGGER 运行环境和权限通过具体部署环境验证。

## 7. 测试、CI 与回退

| 层级 | 验证内容 |
| --- | --- |
| 包单测 | 各包自有 tests；迁移既有用例，逐步去掉根 src 路径与旧别名假设 |
| 架构门禁 | workspace 依赖无环；前端无后端闭包；runtime 不依赖 mcp / apps；禁止跨包 src 导入 |
| 协议契约 | IPC、HTTP、WS 采用一致的 session / workflow / 错误 / 字节语义；MCP 保留既有入口语义 |
| 集成 | UI 与 MCP 同会话、同 job / ledger；快照竞态、断线、重连、截断、背压、写入响应丢失和资源回收 |
| E2E | 桌面与浏览器的连接、输入、刷新、工作区、凭据提示、上传、导出和后台任务恢复 |
| 部署 smoke | 干净环境运行实际产物；断开源码仓库路径后仍可启动；Electron 与 Node 各自加载原生依赖 |
| 人工硬件 | 按现有政策验证串口、J-Link、RTT、烧录与 GDB；CI 继续使用 fake / mock / null backend |

现有 Windows / Ubuntu / macOS 自动化基线继续保留。扩展 lint / build / tests / coverage / license / SBOM 的路径与范围，根 ci:check 覆盖所有已迁移部分。测试文件随所属包迁移，根 tests 保留跨包契约、集成和 E2E，避免重复收集。

每阶段独立提交或 PR，阶段完成必须保持桌面可用。数据格式变化单独实施并先备份；发布后的回退针对兼容的应用版本和数据备份一起执行。性能门槛以 P0 实测为准，比较终端输入延迟、吞吐、WS 缓冲和长时间内存使用。

## 8. 计划中的根命令

以下是迁移后的目标命令，目前尚未实现：

~~~text
pnpm install
pnpm dev:desktop        # 共享包构建 / watch + 桌面开发
pnpm dev:web            # 共享包构建 / watch + Node 服务 + Vite
pnpm dev:server         # 后端单独开发
pnpm build:desktop      # 桌面及依赖构建
pnpm build:web          # Web 前端及依赖构建
pnpm build:server       # Node 后端及依赖构建
pnpm build              # 全仓构建
pnpm start:server       # 启动已构建服务，提供已装配的网页
pnpm pack:server        # 装配 server + web + 生产依赖
pnpm dist:desktop      # 桌面安装包
pnpm ci:check           # 完整质量门禁
~~~

首次生产启动前构建并装配 server + web；启动只需 Node 服务。开发脚本应能跨 Windows / Linux / macOS 统一清理 watch 子进程。根命令可通过 pnpm --filter 转发，但应用内部脚本不能反向调用根聚合命令形成递归。

## 9. 当前分析限制与扩展

本计划根据已有源码静态检查制定。当前会话仍无可调用的 GitNexus MCP 工具；仓库缺少此前 AGENTS.md 指定的本地 runner / 技能文件，未获得符号影响分析结果。实施前恢复并更新索引，按 AGENTS.md 在编辑符号前执行 upstream impact，报告直接调用方、影响流程和风险；HIGH / CRITICAL 先明确告知。重命名使用 GitNexus rename；提交前 detect_changes，并与 main 比较回归范围。本次仅更新规划文档，不涉及符号编辑或提交。

此前用户指定的 TypeSafe AI 技能继续用于后续可选诊断 / 推荐能力设计。未来可在 packages/runtime/src/advisors 中提供 SemanticAdvisor，密钥留后端，样本验证后再决定阈值与数据范围。双端基础改造由类型契约、schema 与确定性业务代码完成，不把模型调用放入终端写入、身份认证或烧录路径。

## 10. 完成判据

1. 根 workspace 管理 3 个应用与 4 个共享包，内部依赖和构建图清晰、无循环。
2. 干净安装后可构建桌面安装包与独立 Web 服务包。
3. 桌面保留原有数据、工作区和关键功能，Web 能完成首期能力矩阵。
4. Web 可在无 Electron / 无 GUI 环境运行，通过 localhost 或服务器地址访问。
5. 同一实例内 UI 与 MCP 共用会话、写队列、后台任务和活动记录。
6. 网络恢复、凭据迁移、文件归属和设备边界有明确且经过验证的行为。
7. 两种原生依赖产物隔离，CI、部署 smoke、许可证 / SBOM 和人工硬件验收完成。
