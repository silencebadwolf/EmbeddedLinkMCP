# Verification Record

Verified on 2026-07-20 in the Windows worktree at
the repository root.

## Behavioral evidence

- `SerialSessionCoordinator` tests cover complete normalized identity, reuse of `idle`/`opening`/
  `open` sessions, exclusion of `closed`/`errored` sessions, same-port single-flight, same-port
  configuration conflict, open-failure cleanup, and parallel opens on different ports.
- Boundary tests cover direct/HTTP MCP wiring, renderer `session:create`, saved connections, full
  workspaces, control-profile activation, and control workflows using the shared coordinator.
- Renderer integration proves that opening a matching saved connection or full workspace selects the
  existing AI-created `sessionId` and does not add a duplicate terminal tab.
- The stable `SERIAL_SESSION_CONFLICT` result is preserved through terminal, control-profile, and
  control-workflow surfaces. A genuine new renderer-side transport failure still retains its
  existing errored-tab behavior; a coordinator conflict creates no errored tab.
- The agent runbook recommends `list_sessions` before `open_session`, while correctness remains
  enforced in Main and is not dependent on prompt compliance.

## Automated gates

Fresh full-suite evidence recorded during implementation:

| Gate | Result |
| --- | --- |
| `pnpm run test:coverage` | PASS — 164 files, 1979 tests, 17 existing skips |
| Coverage | 82.20% statements, 73.76% branches, 84.50% functions, 84.77% lines |
| New coordinator coverage | 100% statements, lines, and functions |
| `pnpm run lint` | PASS |
| `pnpm run build` | PASS |
| `pnpm run validate:licenses` | PASS |
| `pnpm exec openspec validate unify-serial-session-reuse --strict --json` | PASS |

The completion pass reruns the full tests, lint, build, license validation, strict OpenSpec
validation, and diff hygiene after this record is written. Its command output is the final source of
truth if it differs from the implementation-time figures above.

## Review evidence

An independent review found that `run_control_workflow` initially translated
`SerialSessionConflictError` into the generic `INVALID_STATE` code. A regression test was added and
the workflow now preserves `SERIAL_SESSION_CONFLICT`; genuine serial-open failures continue to use
`INVALID_STATE`. Two additional remote review attempts were unavailable because the external
service repeatedly returned HTTP 429; this did not replace local tests or verification.

## GitNexus scope and security evidence

- The index was refreshed twice with PDG enabled after implementation and after the workflow error
  mapping correction.
- `detect_changes` reported 36 changed symbols, 35 affected symbols, 19 indexed changed files, and
  CRITICAL aggregate risk. The rating is expected because dependency wiring touches
  `registerIpcHandlers` and the control-workflow main chain; review found no unrelated product flow.
- PDG review shows the intended `openSerialStep` branch from `SerialSessionConflictError` to
  `SERIAL_SESSION_CONFLICT`.
- Directed taint review of four changed trust-boundary entry points reported zero findings. Zero
  findings are not treated as proof of safety; ownership remains Main-only and complete serial
  identity is not exposed across preload.

## Hardware and repository safety

- No real serial port was opened during automated verification.
- No flash, erase, reset, probe connection, debug connection, or other hardware side effect was
  executed.
- No commit, push, pull request, reset, checkout, or worktree cleanup was performed for this change.
- Existing user changes and the prior local commit were preserved.
