## Tasks

- [x] Capture the Windows Electron `ERR_MODULE_NOT_FOUND` launch failure and identify the
      preserved `@/...` Main/Core aliases.
- [x] Run GitNexus upstream impact for the startup boundary before editing.
- [x] Add a failing Main runtime import regression test and verify the expected failure.
- [x] Convert Main/Core runtime aliases to relative `.js` imports.
- [x] Verify the regression test, build, and normal Electron launch.
- [x] Run final OpenSpec/GitNexus/diff evidence; the cumulative compare currently reports 58
      files / 264 changed symbols / 0 affected processes / low risk because this change only
      rewrites executable import specifiers.

## Evidence

- RED: `main-runtime-imports.test.ts` found 13 emitted JS files with unresolved aliases.
- GREEN: the same test passed after the relative-import conversion.
- Windows launch after rebuild: LinkTerm v2 Start Center displayed normally; readiness refresh
  found COM1 and COM10 (JLink CDC UART Port). The saved COM10/115200 profile then opened
  `serial:c526`; the terminal remained silent for 5 seconds and no bytes were written.
