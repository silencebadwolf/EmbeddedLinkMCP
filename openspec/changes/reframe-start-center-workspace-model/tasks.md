## 1. Specification and characterization

- [x] 1.1 Record the existing StartCenter, App, ControlProfilePanel, ConnectionDialog, and AgentIntegrationsPanel boundaries.
- [x] 1.2 Run GitNexus upstream impact before editing every existing symbol selected for this change.
- [x] 1.3 Add characterization coverage for existing full-profile opening, saved serial opening, ConnectionDialog delegation, and system-level Agent entry.

## 2. Workspace summaries and Start Center

- [x] 2.1 Add failing pure adapter tests for full and serial-only summaries and sensitive-field exclusion.
- [x] 2.2 Implement the renderer-only workspace summary adapter.
- [x] 2.3 Add failing StartCenter tests for saved-workspace ordering, type badges, empty state, one creation entry, no COM list, and no advanced-device region.
- [x] 2.4 Implement the workspace-first StartCenter layout without transport or preload side effects.
- [x] 2.5 Add confirmed deletion for both saved workspace sources, including cancellation, failure, and no-session-destroy coverage.

## 3. Creation scopes and App wiring

- [x] 3.1 Add failing ControlProfilePanel tests for serial-only/full chooser and ConnectionDialog delegation.
- [x] 3.2 Implement the chooser while preserving the existing full-profile form and callbacks.
- [x] 3.3 Add failing App tests for opening full/serial-only cards, new-workspace routing, hidden no-session sidebar, global Agent entry, and source-specific deletion.
- [x] 3.4 Wire App state and callbacks using existing preload/session boundaries.

## 4. Copy, accessibility, and verification

- [x] 4.1 Add paired Chinese/English keys for workspace types, creation scopes, deletion, loading, and system-level AI settings.
- [x] 4.2 Verify keyboard access, focus preservation, and narrow-window layout; the removed advanced disclosure is asserted absent.
- [x] 4.3 Run focused and full tests, lint, TypeScript, build, license validation, and strict OpenSpec validation.
- [x] 4.4 Request review, run verification-before-completion, `detect_changes`, and directed PDG/taint review.
- [x] 4.5 Perform Windows-first manual acceptance without hardware side effects.

  Windows evidence captured on 2026-07-17 against runtime
  `ed24334b-0832-4a04-9117-a791cfc2a926` (PID `50816`):

  - Chinese and English large-window home views showed saved full and serial-only workspaces
    first, each with open/delete actions, followed by the single new-workspace entry.
  - Chinese and English `804 x 575` content views had no horizontal overflow or overlap;
    long English workspace details wrapped while the primary entry remained visible.
  - The new-workspace chooser exposed only the paired serial-only and full-device scopes in
    both locales (`windows-new-workspace-chooser-post-click-check-20260717` and
    `windows-new-workspace-chooser-zh-settled-20260717`).
  - The home view contained no COM candidate list, advanced-device disclosure, readiness
    checklist, first-success shortcut, or empty-state control-profile sidebar. MCP / Agent
    remained a system-level header entry and Activity Center remained closed by default.
  - Final `get_app_status` evidence (`windows-acceptance-final-health-20260717`) reported a
    fresh 63-tool runtime, zero sessions, and a visible but disconnected J-Link probe. No
    serial session, flash, erase, reset, halt, GDB, RTT, or debug operation was invoked.
  - The Electron window was restored to its original Chinese locale, `1440 x 900` normal
    placement at `(240, 66)`, and minimized state after the reversible narrow-window check.
