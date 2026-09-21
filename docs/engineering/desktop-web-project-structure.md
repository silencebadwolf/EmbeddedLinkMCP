# LinkTerm pnpm monorepo 目标文件结构

日期：2026-09-21。本文与 [monorepo 重构计划](./desktop-web-refactor-plan.md) 配套，替代此前以根 src 为最终目录的框架。以下为待实施结构；当前仅更新文档。

## 1. 仓库结构

~~~text
link-mcp/
├── apps/
│   ├── desktop/                           # @linkterm/desktop
│   │   ├── src/
│   │   │   ├── main/
│   │   │   │   ├── index.ts                # 创建 runtime，注册 IPC / MCP
│   │   │   │   ├── app-lifecycle.ts
│   │   │   │   ├── startup-mode.ts
│   │   │   │   ├── ipc/                    # 现有 IPC 转为薄适配器
│   │   │   │   │   ├── index.ts
│   │   │   │   │   ├── session-ipc.ts
│   │   │   │   │   ├── control-profile-ipc.ts
│   │   │   │   │   ├── activity-ipc.ts
│   │   │   │   │   └── ...
│   │   │   │   └── platform/
│   │   │   │       ├── desktop-paths.ts
│   │   │   │       ├── native-bindings.ts  # 从桌面隔离依赖目录加载原生绑定
│   │   │   │       ├── safe-storage-secret-codec.ts
│   │   │   │       ├── native-file-dialog.ts
│   │   │   │       ├── electron-ui-bridge.ts
│   │   │   │       ├── electron-restart.ts
│   │   │   │       └── agent-launcher.ts
│   │   │   ├── preload/
│   │   │   │   ├── index.ts
│   │   │   │   └── ipc-channels.ts        # 与 main 共用，保持桌面协议局部化
│   │   │   └── renderer/
│   │   │       ├── index.html
│   │   │       ├── main.tsx               # 注入 DesktopClient，挂载共享 App
│   │   │       ├── desktop-client.ts
│   │   │       └── desktop-env.d.ts       # Window.linkterm 声明
│   │   ├── resources/                     # 桌面图标和安装器资源
│   │   ├── tests/
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── tsconfig.main.json
│   │   ├── tsconfig.renderer.json
│   │   ├── vite.config.ts
│   │   └── electron-builder.yml
│   │
│   ├── web/                               # @linkterm/web
│   │   ├── index.html
│   │   ├── src/
│   │   │   ├── main.tsx                    # 注入 WebClient，挂载共享 App
│   │   │   ├── auth/                       # Web 登录视图与认证状态
│   │   │   └── platform/
│   │   │       ├── web-client.ts
│   │   │       ├── http-client.ts
│   │   │       ├── ws-client.ts            # 握手、重连、续传
│   │   │       └── file-transfer.ts        # 上传与下载适配
│   │   ├── tests/
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── vite.config.ts
│   │
│   └── server/                            # @linkterm/server
│       ├── src/
│       │   ├── index.ts                    # 独立 Node 入口
│       │   ├── bootstrap.ts                # runtime + HTTP / WS / MCP 装配
│       │   ├── config.ts
│       │   ├── shutdown.ts
│       │   ├── auth/
│       │   │   ├── auth-service.ts
│       │   │   ├── session-store.ts
│       │   │   └── request-guard.ts
│       │   ├── http/
│       │   │   ├── create-http-server.ts
│       │   │   ├── static-assets.ts        # 加载发布目录内的 Web 产物
│       │   │   ├── error-mapper.ts
│       │   │   └── routes/                 # session / files / workflow / MCP 等
│       │   ├── ws/
│       │   │   ├── create-ws-server.ts
│       │   │   ├── connection-registry.ts
│       │   │   ├── command-dispatcher.ts
│       │   │   ├── event-forwarder.ts
│       │   │   └── outbound-buffer.ts
│       │   └── platform/
│       │       ├── server-paths.ts
│       │       ├── native-bindings.ts      # 从 Node 隔离依赖目录加载原生绑定
│       │       ├── server-secret-codec.ts
│       │       ├── web-ui-bridge.ts
│       │       ├── server-restart.ts
│       │       └── agent-launcher.ts
│       ├── tests/
│       ├── package.json
│       └── tsconfig.json
│
├── packages/
│   ├── contracts/                         # @linkterm/contracts；浏览器安全
│   │   ├── src/
│   │   │   ├── index.ts
│   │   │   ├── client-api.ts               # 平台无关 ClientAPI
│   │   │   ├── common.ts                   # 结果壳、requestId、协议版本
│   │   │   ├── capabilities.ts
│   │   │   ├── error-codes.ts
│   │   │   ├── session.ts
│   │   │   ├── transcript.ts
│   │   │   ├── connections.ts
│   │   │   ├── workspace.ts
│   │   │   ├── control-profile.ts
│   │   │   ├── control-workflow.ts
│   │   │   ├── devices.ts
│   │   │   ├── activity.ts
│   │   │   ├── readiness.ts
│   │   │   ├── first-signal.ts
│   │   │   ├── agent-integrations.ts
│   │   │   ├── ui.ts
│   │   │   ├── files.ts
│   │   │   └── protocol/
│   │   │       ├── http.ts
│   │   │       └── websocket.ts
│   │   ├── tests/
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   ├── ui/                                # @linkterm/ui；两端共享界面
│   │   ├── src/
│   │   │   ├── index.ts
│   │   │   ├── App.tsx
│   │   │   ├── client/
│   │   │   │   ├── client-provider.tsx
│   │   │   │   └── use-client.ts
│   │   │   ├── features/
│   │   │   │   ├── terminal/
│   │   │   │   ├── connections/
│   │   │   │   ├── workspaces/
│   │   │   │   ├── control-profile/
│   │   │   │   ├── agent-integrations/
│   │   │   │   ├── activity/
│   │   │   │   ├── readiness/
│   │   │   │   └── first-success/
│   │   │   ├── components/
│   │   │   ├── hooks/
│   │   │   ├── store/
│   │   │   ├── lib/
│   │   │   ├── i18n/
│   │   │   └── styles/
│   │   ├── tests/
│   │   ├── package.json                   # React / ReactDOM peerDependencies
│   │   └── tsconfig.json
│   │
│   ├── runtime/                           # @linkterm/runtime；后端共享实现
│   │   ├── src/
│   │   │   ├── index.ts                    # 公共 exports
│   │   │   ├── create-runtime.ts           # 每宿主实例创建一次
│   │   │   ├── runtime-context.ts
│   │   │   ├── lifecycle.ts
│   │   │   ├── runtime-lock.ts
│   │   │   ├── ports/                     # 注入接口，无 Electron 类型
│   │   │   │   ├── host-paths.ts
│   │   │   │   ├── native-bindings.ts
│   │   │   │   ├── secret-codec.ts
│   │   │   │   ├── file-picker.ts
│   │   │   │   ├── ui-bridge.ts
│   │   │   │   ├── restart-scheduler.ts
│   │   │   │   └── agent-launch-config.ts
│   │   │   ├── services/                  # 按 session / debug / files 等领域划分
│   │   │   ├── factories/
│   │   │   │   ├── session-factory.ts
│   │   │   │   └── backend-factory.ts
│   │   │   ├── workflows/
│   │   │   │   └── control-workflow-runner.ts
│   │   │   ├── events/
│   │   │   │   ├── event-hub.ts
│   │   │   │   └── subscription-manager.ts
│   │   │   ├── core/
│   │   │   │   ├── session/
│   │   │   │   ├── transcript/
│   │   │   │   ├── write-queue/
│   │   │   │   ├── terminal-rules/
│   │   │   │   ├── workspace/
│   │   │   │   ├── connections/
│   │   │   │   ├── control-workflow/       # job-manager / 内部状态 / 观测类型
│   │   │   │   ├── activity/
│   │   │   │   ├── readiness/
│   │   │   │   ├── operation-admission/
│   │   │   │   ├── compensation/
│   │   │   │   ├── recovery/
│   │   │   │   └── agent-integrations/
│   │   │   ├── transports/
│   │   │   │   ├── serial/
│   │   │   │   ├── ssh/
│   │   │   │   └── local-shell/
│   │   │   └── jlink/
│   │   ├── tests/
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   └── mcp/                               # @linkterm/mcp；Agent 协议适配
│       ├── src/
│       │   ├── index.ts
│       │   ├── server.ts
│       │   ├── registry.ts
│       │   ├── http-runtime-server.ts
│       │   ├── stdio-proxy.ts
│       │   ├── error-mapper.ts
│       │   ├── runtime-diagnostics.ts
│       │   ├── runtime-metadata.ts
│       │   ├── versioning/
│       │   └── surfaces/                  # 保留工具名、schema 和结果包装
│       │       ├── terminal/
│       │       ├── workspace/
│       │       ├── control-profile/
│       │       ├── control-workflow/      # 无业务执行器与任务 manager
│       │       ├── debug/
│       │       ├── rtt-log-session/
│       │       ├── jlink-device-catalog/
│       │       ├── ui/
│       │       ├── runtime-control/
│       │       └── agent-runbook/
│       ├── tests/
│       ├── package.json
│       └── tsconfig.json
│
├── tests/                                 # 仅跨包和产物级测试
│   ├── fixtures/
│   ├── contract/
│   ├── integration/
│   ├── architecture/
│   └── e2e/
│       ├── desktop/
│       └── web/
├── tooling/                               # 配置文件，不额外创建业务包
│   ├── typescript/
│   │   ├── base.json
│   │   ├── node.json
│   │   └── browser.json
│   ├── vite.shared.ts
│   └── vitest.shared.ts
├── scripts/
│   ├── dev.mjs                            # 初始构建、watch 编排、子进程回收
│   ├── prepare-desktop.mjs                 # Electron 隔离依赖与产物装配
│   ├── prepare-server.mjs                  # Node 生产依赖与 Web 产物装配
│   ├── migrate-data.ts
│   ├── start-electron.mjs
│   ├── validate-licenses.ts                # 改为 workspace 范围校验
│   ├── generate-sbom.mjs                   # 按实际发布目标生成
│   └── ...                                # 现有 doctor / checksum 等脚本
├── deploy/
│   ├── Dockerfile
│   ├── compose.yaml
│   ├── reverse-proxy.conf.example
│   └── server.env.example
├── docs/
│   ├── engineering/
│   ├── deployment/
│   └── migration/
├── licenses/
├── openspec/
├── .github/workflows/
├── package.json                           # 根命令与共享开发工具
├── pnpm-workspace.yaml
├── pnpm-lock.yaml                          # 唯一根锁文件
├── tsconfig.json                           # project references 总入口
├── eslint.config.js
├── vitest.config.ts                        # 汇总各包测试，避免重复收集
├── playwright.config.ts
├── third-party-manifest.json
├── LICENSE
├── NOTICE
└── README.md
~~~

## 2. 依赖和公共 API

| 包 / 入口 | 允许的内部依赖 | 主要公共接口 |
| --- | --- | --- |
| contracts | 无 | ClientAPI、领域 DTO / schema、事件与 capabilities |
| ui | contracts | App、ClientProvider、共享样式与必要组件 |
| runtime | contracts | createRuntime、Runtime、应用服务接口、宿主 ports、必要领域类型 |
| mcp | runtime、contracts | MCP server / HTTP adapter / stdio proxy 创建入口 |
| desktop main | runtime、mcp、contracts | 桌面入口，不供共享包反向依赖 |
| desktop preload | contracts、桌面 IPC 通道契约 | 受限 window.linkterm |
| desktop renderer | ui、contracts | 注入 DesktopClient |
| web | ui、contracts | 注入 WebClient |
| server | runtime、mcp、contracts | HTTP / WS / MCP / 静态资源服务 |

依赖通过 workspace:* 声明。跨包只能使用显式公共 exports，不能引用 ../other-package/src 或通过根 @ 别名穿越边界。JS 与声明产物位于各包 dist；包内保持 ESM 相对 import 规则。contracts 不携带 Node / Electron 或 native 模块的运行时依赖。

runtime 是共享后端代码，不是额外启动的第三个服务。desktop 与 server 各自拥有一次 createRuntime 的结果；每个实例内部由 UI、MCP 共享状态。ui 不直接调用 runtime，由宿主注入 ClientAPI。

## 3. 现有代码迁移映射

| 当前位置 | 目标位置与处理 |
| --- | --- |
| src/main/index.ts、app-lifecycle.ts | apps/desktop/src/main/ |
| src/main/preload.ts | apps/desktop/src/preload/index.ts；验证输出格式与现有安全设置兼容 |
| src/main/ipc/ | 协议适配 → desktop/main/ipc；业务动作 → runtime/services |
| src/main/ipc/index.ts | 实例装配 → runtime/create-runtime；Electron 平台能力 → desktop/main/platform |
| src/main/connections/safe-storage-secret-codec.ts | desktop/main/platform；SecretCodec 接口归 runtime/ports |
| src/shared/preload-api.ts | 中立接口 / DTO → contracts；Window 声明 → desktop renderer；迁移期间保留兼容导出 |
| src/shared/ipc-protocol.ts | desktop preload/ipc-channels.ts，main 仅复用通道契约 |
| src/shared/*-contract.ts、transcript-ipc-types.ts | contracts 按领域分类；保留现有字段与序列化语义 |
| src/renderer/App.tsx、components、hooks、store、i18n | packages/ui/src/；应用启动和平台客户端留各 apps |
| src/renderer/lib/linkterm-bridge.ts | desktop-client 负责 preload 获取；共享 UI 改用 ClientProvider |
| src/core/ | packages/runtime/src/core/，清理协议层反向依赖 |
| src/transports/、src/jlink/ | packages/runtime/src/，原生加载通过宿主 factories 注入 |
| src/core/session/factory.ts | runtime/factories/session-factory.ts |
| src/mcp/surfaces/control-workflow/job-manager.ts | runtime/core/control-workflow/job-manager.ts |
| src/mcp/surfaces/control-workflow/workflow-runner.ts | runtime/workflows/control-workflow-runner.ts |
| src/mcp/surfaces/debug/firmware-sanity.ts | runtime/core/workspace/firmware-validation.ts |
| src/mcp/ 其余协议代码 | packages/mcp/src/；工具通过 runtime 公共服务访问业务 |
| src/mcp/electron-runtime-launcher* | Electron 专属部分 → desktop platform；共享 owner 探测保留后端共享模块 |
| tests/unit/ | 跟随所属 apps / packages 迁移；跨包集成、契约与 E2E 留根 tests |
| 根 electron-builder.yml、resources/ | apps/desktop/，同时调整 LICENSE / NOTICE 等根资源路径 |
| 根 vite.config.ts、tsconfig.* | 各应用 / 包配置与 tooling 共享基础配置 |
| 根 package.json 业务依赖 | 分配给直接使用它的应用 / 包；根保留编排与开发工具 |
| scripts/validate-licenses.ts、generate-sbom.mjs | 扫描 workspace 与发布目标，保留既有归因门禁 |

迁移不是单纯搬文件：特别需要先去除 core/activity 对 MCP 类型的引用，以及工作流 manager / runner 对 ToolError、MCP schema 和工具函数的引用。领域错误留 runtime，MCP 自行转换协议错误。

## 4. 配置与构建约定

- 根固定当前 pnpm 9.15.0，保留现有 Node engines；工具链升级独立进行。
- 七个项目均为 private 包，使用 workspace:*。UI 的 React / ReactDOM 使用 peerDependencies，由 desktop 与 web 提供一致版本。
- node-pty / serialport 原生加载由宿主绑定工厂负责；具体依赖从该宿主的隔离目录解析。物理隔离由 prepare 脚本和部署 smoke test 保证，不能仅依赖 workspace 链接。
- packages/runtime 和 packages/mcp 使用后端 TS 配置；packages/ui、web 和 desktop renderer 使用前端配置；contracts 只包含跨运行时安全代码。
- 根 project references 构建共享包与应用 TS 目标，Vite 分别生成两个 renderer 产物。CSS 和资源显式导出并验证 Tailwind 的共享包扫描。
- 开发脚本先构建公共 exports 指向的产物，再启动 watch、Electron 或 Node / Vite。无需手工发布共享包。
- server 通过 release 装配获得 web 静态资源，不对 apps/web 建立 Node 运行时包依赖。
- 依赖闭包、原生库、静态资源、Agent launcher、preload 和打包 main 路径在实际产物中验证。

## 5. 产物与数据目录

以下为构建 / 发布目录约定，加入 gitignore：

~~~text
apps/desktop/dist/             # main / preload / renderer 编译产物
apps/web/dist/                 # 浏览器静态资源
apps/server/dist/              # Node 服务入口与宿主实现
packages/*/dist/               # 共享包 ESM / d.ts / 资源
.artifacts/desktop/            # 物化共享包与 Electron 原生依赖的隔离装配目录
.artifacts/server/             # 物化共享包、Node 原生依赖和 public/ 的装配目录
release/                       # 安装包、服务归档、校验和、SBOM
~~~

.artifacts 中的程序不能依赖指向源码仓库的 workspace symlink。运行时 dataDir 位于用户指定的可写位置；桌面保持既有数据定位，服务器使用部署配置。全局连接 / 控制配置记录、活动 JSONL、临时上传和 owner metadata 放在 dataDir，工作区下的 .linkterm 继续随工作区保存。加密密钥与数据目录分开管理。

Web 生产运行：启动已构建的 Node 服务，同源提供网页、API、WS 和 MCP；本机可访问 localhost。Electron 仅用于桌面应用。

后续 TypeSafe AI 可选能力可放入 packages/runtime/src/advisors；本地设备代理可作为独立 apps/agent 另行立项。本次首期仍是 3 个应用入口与 4 个共享包。
