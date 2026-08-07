# 发布指南

本文件描述可审计的发布顺序。当前仓库的 CI 只生成未签名候选产物；没有配置并验证代码签名、macOS notarization、官方更新源和发布凭据前，不得把它们称为官方发行版。

## 发布前门禁

1. 确认版本号、变更日志、路线图和已知限制已更新，并在 `main` 上创建候选 tag。
2. 在干净工作区运行：

   ```bash
   pnpm install --frozen-lockfile
   pnpm run ci:check
   pnpm audit --prod --audit-level=moderate
   pnpm run validate:licenses
   ```

3. 运行 `pnpm run dist -- --publish never` 生成当前平台产物。
4. 运行 `pnpm run sbom -- release/sbom.cdx.json` 和 `pnpm run release:checksums -- release`。
5. 检查安装包中包含 `LICENSE`、`NOTICE`、`third-party-manifest.json` 和 `licenses/`，并保存构建日志、SBOM、校验和与依赖锁文件。

## 签名与平台验收

- Windows：使用受保护的代码签名证书，对安装器、便携包和所有需要签名的原生可执行文件签名，并验证 Authenticode 链和时间戳。
- macOS：使用 Developer ID 对应用/DMG 签名并完成 notarization、stapling 和 Gatekeeper 验证。
- Linux：明确 AppImage/deb 的信任和校验方式，至少发布 SHA-256；不要暗示它们具有 Windows/macOS 代码签名。
- 在 Windows 上完成安装、升级、卸载、首次启动、重复启动、MCP 端口冲突恢复和无硬件启动冒烟；在有安全测试设备后再做串口、SSH、J-Link/RTT 验收。

签名证书、notarization 凭据、更新服务器和发布 token 不得提交到仓库，也不得写入 Issue、日志或安装包。CI 中缺少这些秘密时，应明确产物为 unsigned development artifact。

## 更新源与命名

当前远端是 Gitee `wake_micro/link-mcp`，而历史配置曾指向其他 GitHub owner/repository。启用自动更新前，维护者必须选定一个 canonical 发布源、签名公钥/信任根、版本频道和回滚策略，并先审查历史安装包中的 updater 配置；在此之前保持更新功能关闭或仅用于本地测试。

## 产物归档

每个官方版本至少归档：源代码 tag、`pnpm-lock.yaml`、平台/架构、构建 Node/pnpm/Electron 版本、构建日志、签名验证结果、SBOM、第三方归因、SHA-256 清单和发布说明。历史 `release/` 目录中的旧产物不得直接重新发布。
