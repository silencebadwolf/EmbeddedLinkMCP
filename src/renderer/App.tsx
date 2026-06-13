import React from 'react';

const CONNECTION_TYPES = [
  {
    id: 'serial',
    label: 'Serial',
    description: 'Connect to embedded devices via serial port',
    icon: '🔌',
    details: ['UART / RS-232', 'Normal & Terminal mode', 'Auto port discovery'],
  },
  {
    id: 'ssh',
    label: 'SSH',
    description: 'Connect to remote hosts via SSH',
    icon: '🔐',
    details: ['Password & Key auth', 'Port forwarding', 'Full PTY support'],
  },
  {
    id: 'local-shell',
    label: 'Local Shell',
    description: 'Open a local terminal session',
    icon: '💻',
    details: ['bash / zsh / fish', 'Full PTY emulation', 'Resize support'],
  },
] as const;

export function App(): React.ReactElement {
  return (
    <div className="flex h-screen flex-col bg-gray-950 text-gray-100">
      <header className="border-b border-gray-800 px-8 py-6">
        <div className="flex items-center gap-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-600 text-xl font-bold">
            LT
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">LinkTerm v2</h1>
            <p className="text-sm text-gray-400">Desktop Terminal &amp; MCP Automation Platform</p>
          </div>
        </div>
      </header>

      <main className="flex flex-1 flex-col items-center justify-center px-8">
        <h2 className="mb-2 text-lg font-medium text-gray-300">Start a New Connection</h2>
        <p className="mb-8 text-sm text-gray-500">Choose a connection type to get started</p>

        <div className="grid grid-cols-3 gap-6" style={{ width: '720px' }}>
          {CONNECTION_TYPES.map((type) => (
            <button
              key={type.id}
              className="group rounded-xl border border-gray-800 bg-gray-900 p-6 text-left transition-all hover:border-blue-600 hover:bg-gray-800"
            >
              <span className="text-3xl">{type.icon}</span>
              <h3 className="mt-3 text-lg font-semibold group-hover:text-blue-400">{type.label}</h3>
              <p className="mt-1 text-sm text-gray-400">{type.description}</p>
              <ul className="mt-3 space-y-1">
                {type.details.map((detail) => (
                  <li key={detail} className="text-xs text-gray-500">
                    {detail}
                  </li>
                ))}
              </ul>
            </button>
          ))}
        </div>
      </main>

      <footer className="border-t border-gray-800 px-8 py-3 text-center text-xs text-gray-600">
        Powered by Electron + React &middot; xterm.js &middot; MCP
      </footer>
    </div>
  );
}
