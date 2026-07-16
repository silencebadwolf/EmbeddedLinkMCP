# Design

The Main TypeScript project is emitted by `tsc` as native ESM. `tsc` type-checks `paths` aliases
but does not rewrite runtime specifiers, so Main/Core files must use relative `.js` imports. Renderer
files continue to use the Vite `@` alias.

The regression test compiles `tsconfig.main.json`, scans every emitted `dist/main/**/*.js`, and
fails if a runtime import still starts with `@/`. It does not open a device or start Electron.
