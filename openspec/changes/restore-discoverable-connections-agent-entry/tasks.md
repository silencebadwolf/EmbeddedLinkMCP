## 1. Characterization and tests

- [x] 1.1 Add failing Start Center tests for saved-profile list, bounded rendering, and open callback.
- [x] 1.2 Add failing bilingual copy assertions for MCP/Agent injection and control-profile location.

## 2. Minimal implementation

- [x] 2.1 Load saved connection summaries through existing preload `connections.list` in App.
- [x] 2.2 Open a saved profile through existing `connections.open` and Session store boundaries.
- [x] 2.3 Render saved profiles first in Start Center without duplicating ConnectionDialog persistence.
- [x] 2.4 Clarify MCP/Agent and control-profile labels in Chinese and English.
- [x] 2.5 Remove Start Center serial candidates/manual serial form and make one `Manual open` action reveal all ConnectionDialog types.
- [x] 2.6 Put saved connections before Manual open and defer readiness/port discovery until a user opens a connection flow or Advanced devices.

## 3. Verification

- [x] 3.1 Focused renderer tests pass.
- [x] 3.2 Full lint, TypeScript, build, tests, license, OpenSpec, and GitNexus checks pass.
- [x] 3.3 Update evidence document; no commit, push, PR, or hardware operation.
