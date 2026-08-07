# 贡献指南

感谢你改进 LinkTerm。提交前请先阅读 [行为准则](CODE_OF_CONDUCT.md)、[安全策略](SECURITY.md) 和 [贡献者许可协议](CLA.md)。

## 开始之前

- Bug、兼容性问题和小型改进可以直接创建 Issue。
- 较大的功能、公共 API 变化、数据格式变化或架构调整，应先创建 Issue 说明目标、使用场景和备选方案，等待维护者确认方向。
- 安全漏洞不要创建公开 Issue，请按 [SECURITY.md](SECURITY.md) 报告。
- 不要提交密码、Token、私钥、设备序列号、客户数据、绝对个人路径或受限制的厂商文件。

## 开发环境

需要 Node.js `^22.13.0 || >=24.0.0`、pnpm `9.15.0`，且不能混用 npm/yarn：

```bash
corepack enable
corepack prepare pnpm@9.15.0 --activate
pnpm install --frozen-lockfile
pnpm run ci:check
```

本地没有串口设备、SSH 服务或 J-Link 探针也应能运行绝大多数测试。涉及真实硬件的变更，请在 PR 中明确硬件型号、测试范围和无法自动化的验证项，但不要公开设备秘密或客户固件。

## 变更原则

- 保持改动聚焦，一个 PR 解决一个问题。
- 遵守 `AGENTS.md` 与现有模块边界；不要绕过 `SessionManager.write` / `WriteQueue` 写入 transport。
- 主进程、core、J-Link 与 MCP 代码使用相对 ESM import 并带 `.js` 后缀；`@/` 仅用于 renderer 和测试。
- 新增运行时依赖时，同步更新 `third-party-manifest.json` 和 `licenses/`，并运行 `pnpm run validate:licenses`。
- 为行为变更添加或更新测试；不要只更新生成产物。
- 不要提交 `dist/`、`release/`、覆盖率、日志、本地配置或 IDE 用户状态。

## 提交与 Pull Request

提交信息使用 Conventional Commits，例如：

```text
fix: 处理 MCP 端口冲突
feat: 添加新的终端会话能力
docs: 完善开源贡献说明
```

PR 应包含：问题与目标、实现摘要、风险/兼容性说明、验证命令及结果、相关截图或日志（如适用）。提交 PR 即表示你已阅读并同意 [CLA.md](CLA.md)；模板中必须勾选对应确认项。

维护者会按正确性、安全性、兼容性、可维护性、测试和许可证合规性审查。合并、版本计划和发布时间由维护者根据项目整体情况决定。
