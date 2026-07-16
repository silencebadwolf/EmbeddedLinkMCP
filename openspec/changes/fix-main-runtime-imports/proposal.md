# Fix Electron Main runtime import aliases

## Why

Windows-first launch exposed a production-only failure: the TypeScript Main build preserved
`@/...` path aliases in `dist/main`, while Node/Electron cannot resolve that renderer alias.
The app showed an `ERR_MODULE_NOT_FOUND` dialog before the Start Center loaded.

## What changes

- Make Main/Core runtime imports Node-resolvable relative ESM specifiers.
- Add a regression test that rebuilds Main and rejects unresolved `@/` imports in emitted JS.
- Preserve renderer-only `@` aliases and all product behavior outside module loading.

## Scope

In scope: `src/core/**` imports consumed by Main/MCP, Main build output, and regression evidence.
Out of scope: serial payloads, control-profile changes, J-Link operations, renderer behavior,
hardware side effects, and dependency/toolchain changes.
