/**
 * 跨进程共享常量。
 *
 * 用法：主进程、渲染进程、测试都可以从此处导入；任何"魔法数字"应集中在这里，避免散落各模块。
 */

/** 应用显示名称（窗口标题、关于对话框等使用）。 */
export const APP_NAME = 'LinkTerm v2';

/**
 * 默认操作超时（毫秒）。
 * 用于 sendAndWait、open/close 兜底、IPC 请求等需要超时保护的场景。
 */
export const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * TranscriptBuffer 默认环形容量上限（事件条数）。
 * 超过此上限时，最旧的事件会被丢弃，后续 readSince 会通过 ReadResult.truncated 标志通知调用方。
 */
export const MAX_TRANSCRIPT_EVENTS = 100_000;

/**
 * 单个事件 data 字段大小上限（字节）。超过此大小的写入会被拆分。
 * Phase 1 仅作为常量预留，分片在 transport 层按需实现。
 */
export const MAX_EVENT_DATA_BYTES = 64 * 1024;

/** 串口默认波特率（嵌入式开发常用 115200）。 */
export const DEFAULT_SERIAL_BAUD_RATE = 115200;

/** 串口默认数据位。 */
export const DEFAULT_SERIAL_DATA_BITS = 8;

/** 串口默认停止位。 */
export const DEFAULT_SERIAL_STOP_BITS = 1;

/** 串口默认校验位。 */
export const DEFAULT_SERIAL_PARITY = 'none';

/**
 * SerialDiscovery 轮询间隔（毫秒）。
 * `serialport` 不提供 hot-plug 通知，需要轮询 list 检测增删；
 * 仅当存在订阅者时启动定时器，无订阅时停止以避免常驻消耗。
 */
export const SERIAL_DISCOVERY_POLL_INTERVAL_MS = 2000;

/** SSH 默认监听端口。 */
export const DEFAULT_SSH_PORT = 22;

/** SSH ready 握手超时默认值（毫秒）。 */
export const DEFAULT_SSH_READY_TIMEOUT_MS = 30_000;

/**
 * SSH keepalive 默认间隔（毫秒）。
 * 0 = 关闭。ssh2 在此为 0 时不发送心跳；用户可在 SshSessionConfig 中覆盖。
 */
export const DEFAULT_SSH_KEEPALIVE_INTERVAL_MS = 0;

/** SSH/PTY 默认 TERM 类型。xterm-256color 与 xterm.js 渲染器配套良好。 */
export const DEFAULT_TERM_TYPE = 'xterm-256color';

/** PTY/SSH shell 默认窗口高（行）。 */
export const DEFAULT_PTY_ROWS = 24;

/** PTY/SSH shell 默认窗口宽（列）。 */
export const DEFAULT_PTY_COLS = 80;

/**
 * 终端规则（Phase 7）默认 sendAndWait 超时（毫秒）。
 *
 * 嵌入式命令通常在亚秒内返回；调用方可通过 MCP 入参覆盖。
 * 与 `DEFAULT_TIMEOUT_MS` 区分 —— 后者是 IPC/会话级兜底；这里专门服务终端交互。
 */
export const TERMINAL_RULES_DEFAULT_TIMEOUT_MS = 5_000;

/**
 * send_and_wait 默认 settle 窗口（毫秒）。
 *
 * 这是发送后的观察窗口，不是完成标记超时；窗口结束后调用方拿到已收集
 * 的设备输出，自行决定是否继续读取或发送下一步命令。
 */
export const TERMINAL_RULES_DEFAULT_SETTLE_MS = 500;

/**
 * send_and_wait 返回的设备观察缓冲上限（字节）。
 *
 * 与 completion detector 的匹配窗口分离；超过上限时结果会带
 * `receivedTruncated=true` 与完整累计字节数，避免 marker 规则改变可见输出。
 */
export const TERMINAL_OBSERVATION_MAX_BYTES = 1024 * 1024;

/**
 * CompletionDetector 累计 buffer 上限（字节）。
 *
 * RegExp 完成标记需要在累计 buffer 上重复 test()，长跑命令（如 `dmesg`）下
 * buffer 会膨胀。命中此上限后 detector 丢弃 buffer 头部、保留尾部，
 * 既保留正则可能跨 chunk 命中的窗口，又限制内存占用。
 */
export const COMPLETION_BUFFER_MAX_BYTES = 64 * 1024;

/**
 * 终端规则默认行尾字符序列。
 *
 * 嵌入式 RTOS / Zephyr / U-Boot 等约定 CRLF；PTY 也兼容。
 * MCP 客户端可通过 `lineEnding` 入参覆盖（如 `"\n"`）。
 */
export const DEFAULT_LINE_ENDING = '\r\n';
