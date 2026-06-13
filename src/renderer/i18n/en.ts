/**
 * 英文翻译表。
 *
 * 键值平铺，没有 nesting —— 简化 lookup 路径，IDE 可直接 ctrl-click 跳转。
 */
export const en = {
  'app.title': 'LinkTerm v2',
  'app.subtitle': 'Desktop Terminal & MCP Automation Platform',
  'header.locale.en': 'EN',
  'header.locale.zh': '中文',
  'tabs.new': 'New',
  'tabs.empty.title': 'No active session',
  'tabs.empty.subtitle': 'Click "New" to start a connection',
  'session.state.idle': 'idle',
  'session.state.opening': 'opening',
  'session.state.open': 'open',
  'session.state.closing': 'closing',
  'session.state.closed': 'closed',
  'session.state.errored': 'errored',
  'dialog.title': 'New Connection',
  'dialog.description': 'Configure a serial, SSH, or local shell session.',
  'dialog.cancel': 'Cancel',
  'dialog.create': 'Create',
  'dialog.creating': 'Creating...',
  'dialog.type.label': 'Connection Type',
  'dialog.type.serial': 'Serial',
  'dialog.type.ssh': 'SSH',
  'dialog.type.local-shell': 'Local Shell',
  'dialog.label.label': 'Label (optional)',
  'dialog.label.placeholder': 'My device',
  // Serial fields
  'dialog.serial.port': 'Port',
  'dialog.serial.baudRate': 'Baud Rate',
  'dialog.serial.mode': 'Mode',
  'dialog.serial.mode.normal': 'Normal',
  'dialog.serial.mode.terminal': 'Terminal',
  // SSH fields
  'dialog.ssh.host': 'Host',
  'dialog.ssh.port': 'Port',
  'dialog.ssh.username': 'Username',
  'dialog.ssh.auth': 'Authentication',
  'dialog.ssh.auth.password': 'Password',
  'dialog.ssh.auth.privateKey': 'Private Key',
  'dialog.ssh.password': 'Password',
  'dialog.ssh.privateKey': 'Private Key (PEM)',
  'dialog.ssh.passphrase': 'Passphrase (optional)',
  // Local shell
  'dialog.local.shell': 'Shell (optional)',
  'dialog.local.cwd': 'Working Directory (optional)',
  // Serial picker
  'serial.picker.auto': 'Auto-detected',
  'serial.picker.manual': 'Manual',
  'serial.picker.refresh': 'Refresh',
  'serial.picker.empty': 'No serial ports detected — switch to manual input.',
  'serial.picker.placeholder': '/dev/tty.usbserial-XXX',
  // Origin indicator
  'origin.label.A': 'AI',
  'origin.label.H': 'Human',
  'origin.label.S': 'System',
  // Errors
  'error.create.failed': 'Failed to create session',
} as const;

/** 翻译键的联合类型；en 与 zh 必须同构。 */
export type TranslationKey = keyof typeof en;

/** 同构表的运行时形状。 */
export type TranslationTable = Record<TranslationKey, string>;
