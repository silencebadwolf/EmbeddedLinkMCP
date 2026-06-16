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
  'agent.entry': 'Agent Integrations',
  'agent.title': 'Agent Integrations',
  'agent.description': 'Install or repair LinkTerm MCP server configuration for local AI tools. Backups are created before writing.',
  'agent.loading': 'Detecting integrations...',
  'agent.empty': 'No supported agent integrations found.',
  'agent.install': 'Install / Repair',
  'agent.installing': 'Installing...',
  'agent.refresh': 'Refresh',
  'agent.backup': 'Backup:',
  'agent.error.unavailable': 'LinkTerm preload API is unavailable.',
  'agent.status.notFound': 'Config missing',
  'agent.status.invalidJson': 'Invalid JSON',
  'agent.status.notConfigured': 'Not configured',
  'agent.status.needsUpdate': 'Needs update',
  'agent.status.configured': 'Configured',
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
  'dialog.serial.commonBaudRates': 'Common baud rates',
  'dialog.serial.mode': 'Mode',
  'dialog.serial.mode.normal': 'Normal',
  'dialog.serial.mode.terminal': 'Terminal',
  'dialog.serial.advanced': 'Advanced serial settings',
  'dialog.serial.dataBits': 'Data Bits',
  'dialog.serial.stopBits': 'Stop Bits',
  'dialog.serial.parity': 'Parity',
  'dialog.serial.rtscts': 'RTS/CTS flow control',
  'dialog.serial.xon': 'XON flow control',
  'dialog.serial.xoff': 'XOFF flow control',
  'dialog.saveProfile': 'Save as global connection',
  'dialog.saved.title': 'Saved connections',
  'dialog.saved.open': 'Open',
  'dialog.saved.delete': 'Delete',
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
  'serial.picker.refresh': 'Refresh',
  'serial.picker.empty': 'No serial ports detected.',
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
