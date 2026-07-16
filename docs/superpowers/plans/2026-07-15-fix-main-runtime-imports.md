# Fix Main runtime import aliases

## Context

Launching the rebuilt app on Windows produced `ERR_MODULE_NOT_FOUND` for `@/shared` from
`dist/main/core/compensation/compensation-candidate-service.js`.

## Plan and evidence

1. Reproduce the error through the Electron window and UI Automation error text.
2. Run GitNexus upstream impact on `CompensationCandidateService`, `registerIpcHandlers`, and
   `MainProcessContext` before touching runtime code.
3. Add `tests/integration/main-runtime-imports.test.ts`; confirm RED.
4. Replace only Main/Core runtime aliases with relative ESM imports; keep renderer Vite aliases.
5. Confirm GREEN, rebuild, launch the app, refresh readiness, and stop before selecting a port or
   causing any serial/hardware side effect.
