## 1. Characterization and impact

- [x] Trace saved full-workspace opening from Start Center through renderer, preload, Main IPC, and control-profile persistence.
- [x] Run GitNexus upstream impact for the selected Main IPC and shared load boundary.
- [x] Add a failing IPC regression proving open currently reaches the force-initialize path.

## 2. Read-only Main open

- [x] Replace force initialization with workspace-local profile loading.
- [x] Return the fresh profile through the existing stable record payload without persisting it.
- [x] Cover missing/invalid workspace files and assert no record save occurs.

## 3. Recoverable Start Center failure

- [x] Add card-local opening and error state for full and serial-only workspaces.
- [x] Add a bilingual recovery action that opens the affected full-workspace profile or serial connection as a prefilled configuration surface.
- [x] Assert failed opens create no renderer session and leave other cards usable.
- [x] Serialize pending saved-workspace activation so another card cannot race an open or delete request.

## 4. Verification

- [x] Run focused Main IPC and renderer tests.
- [x] Run lint, TypeScript/build, full tests, and license validation.
- [x] Run OpenSpec strict validation, code review, verification-before-completion, and GitNexus detect_changes.
