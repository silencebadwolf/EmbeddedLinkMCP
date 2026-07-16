# Windows-first 手工验收清单

用途：为 A+D 项目级最终门禁提供可复现的 Windows 证据。此清单不能由自动化单测替代；每项需要记录日期、LinkTerm 版本、Windows 版本、Locale、证据文件名和验收人。

## 0. 安全前置

- 使用模拟串口、回环端口或明确授权的测试设备；不要向未知设备发送 payload。
- J-Link/RTT 只做已知目标的 attach、status、RTT observe；不得执行 flash、erase、reset、halt、run、GDB server 或真实 Commander script。
- 不把密码、私钥、token、固件、完整 transcript 或绝对路径复制到证据截图/导出文件中。

## 1. UI 与可访问性矩阵

| 场景 | 操作 | 期望结果 | 证据 |
| --- | --- | --- | --- |
| EN | 切换英文并打开 Start Center/Activity Center | 标签、状态、按钮可理解，无占位符 | 截图 |
| ZH | 切换中文并重复 | 中文标签完整，无英文漏译（技术名除外） | 截图 |
| 键盘 | 仅用 Tab/Shift+Tab/Enter/Escape 完成打开、导出、删除二步确认 | 焦点可见且不逃逸，删除需显式确认 | 短视频/截图 |
| screen reader | 用 Narrator 检查状态、按钮和删除确认 | accessible name 区分导出、删除、确认和取消 | 读屏记录 |
| reduced motion | 启用系统 reduced motion | 无关键状态仅依赖动画 | 截图/记录 |
| 小窗口 | 缩放到项目定义的最小窗口 | 主要操作仍可访问，无横向遮挡 | 截图 |
| 非颜色状态 | 检查 loading/ready/error/paused/audit warning | 文本或图标同时表达状态 | 截图 |

## 2. Serial First Signal（模拟或回环）

1. 从 Start Center 选择唯一候选；多候选不得静默选择。
2. 建立会话后分别记录 `open`、`data received`、`signal detected`、`signal visible`。
3. 发送非空 device 文本，确认只有 xterm 异步 completion ack 后才显示 First Success。
4. 发送 silent 流程，确认 Keep waiting 可继续监听；late signal 不抢夺其他 surface 焦点。
5. 在 create response、Terminal mount、retry、Disconnect and edit、Back to session 竞态下确认只渲染一次且无残留 monitor/端口。
6. 让会话进入 errored，确认不显示 journey success，并可原地修改后重试。

## 3. Activity durable audit

1. 通过测试 fixture 或只读操作生成活动事件，检查 Activity Center 的 enabled/disabled、event count、warning count。
2. 导出 JSON 和 JSONL；确认 UI 只显示文件名、格式、数量和 redacted 标记，不显示绝对路径。
3. 打开导出文件，确认无 credential、token、完整 transcript、脚本正文、二进制内容、绝对路径或 Main-only authority 对象。
4. 执行删除：第一次点击只进入确认态，第二次显式确认后文件清除；取消不删除；重复清除幂等。
5. 重启应用，确认近期记录恢复；人为制造破损尾行时只出现 warning，不改变 operation terminal state。

## 4. J-Link/RTT 只读观察（可选，需明确授权）

- readiness 能区分 probe/target/firmware/RTT 缺失原因。
- 通过审批后的 observe 入口 attach 并读取 RTT；Activity Center 能显示 job/progress/result。
- 验收过程中 backend 调用清单不得出现 flash、erase、reset、halt、run、GDB 或 script。
- 记录 probe 型号、target 标识摘要和 RTT 观察结果；不要记录固件内容或敏感路径。

## 5. 通过标准与归档

- 第 1–3 节全部通过；第 4 节在有设备且获得授权时通过。
- 每个失败项记录复现步骤、日志/截图和是否阻塞发布；修复后必须增加自动化回归测试。
- 将证据放入受控目录，并在 [project-completion-audit.md](./project-completion-audit.md) 更新状态；完成前再次运行全量测试、构建、许可证、OpenSpec 和 GitNexus 范围检查。

## 当前只读现场记录（2026-07-15）

- 已运行窗口：`LinkTerm v2`。
- UI Automation 已确认中文 Start Center 与 Activity Center 可见；关键按钮可聚焦且未发现
  审批、暂停或接管文案。
- 已确认 COM1、COM10 和 J-Link 目标证据可显示；没有打开串口、连接目标或写入 payload。
- EN 切换、Narrator、reduced-motion、小窗口、真实 first-signal 和 RTT 观察仍待人工执行，
  因此本记录不能单独作为项目级通过证明。
