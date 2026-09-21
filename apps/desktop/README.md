# Desktop host

`pnpm dev:desktop` builds the workspace, starts Vite, watches TypeScript and restarts
Electron after successful backend builds. UI and CSS edits update through Vite.
`pnpm build:desktop` builds the app; `pnpm start` launches the built renderer.

The private workspace name is `@linkterm/desktop`. Its `productName` intentionally
remains `linkterm-v2`, matching the old application's package name and Electron
user-data directory. The installer/display name remains `LinkTerm v2` in the
packaging configuration. Do not change this metadata as a cosmetic rename: it
would change the default credentials, profiles and Chromium storage location.

Electron owns IPC channels, preload, windows, safeStorage and native factories.
Shared UI consumes an injected `ClientAPI`; runtime and MCP resolve compiled
workspace exports. Native dependency staging for distributable artifacts is
tracked in the migration status document.
