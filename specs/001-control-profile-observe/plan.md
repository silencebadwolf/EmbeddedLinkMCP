# Control Profile Observe Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show opened control profile details and automatically open the configured serial or RTT observation channel.

**Architecture:** Keep the change in renderer UI and existing preload APIs. `App` owns the current opened profile summary and renders a main-screen status region; `ControlProfilePanel` opens saved records, starts the configured observation session, updates the shared session store using existing actions, and reports the opened profile summary back to `App`.

**Tech Stack:** React 19, Zustand store actions, existing `window.linkterm.session.create` and `window.linkterm.rttLog.open`, Vitest with happy-dom.

---

## Files

- Modify: `src/renderer/App.tsx`
- Modify: `src/renderer/components/ControlProfilePanel.tsx`
- Modify: `src/renderer/i18n/en.ts`
- Modify: `src/renderer/i18n/zh.ts`
- Test: `tests/unit/renderer/App.test.tsx`
- Spec artifacts: `specs/001-control-profile-observe/*`

## Tasks

### Task 1: Serial Profile Auto-Open and Detail Region

- [ ] Write a failing App-level test that opens a saved serial control profile and expects a profile detail region plus a `session.create` call.
- [ ] Run `pnpm exec vitest run tests/unit/renderer/App.test.tsx -t "opens a saved serial control profile"`.
- [ ] Implement minimal props, callback, session creation, and detail rendering for the serial path.
- [ ] Re-run the same test and keep existing App tests passing.

### Task 2: RTT Profile Auto-Open

- [ ] Write a failing App-level test that opens a saved RTT control profile and expects `rttLog.open` with root and channel.
- [ ] Run `pnpm exec vitest run tests/unit/renderer/App.test.tsx -t "opens a saved RTT control profile"`.
- [ ] Implement minimal RTT auto-open and session metadata insertion.
- [ ] Re-run the same test and existing control profile tests.

### Task 3: Status and Failure Display

- [ ] Add a failing test that updates the associated session state and expects the detail region to reflect it.
- [ ] Add a failing test for observation open failure preserving details and showing the error.
- [ ] Implement the missing rendering and error state.
- [ ] Run `pnpm exec vitest run tests/unit/renderer/App.test.tsx tests/unit/renderer/components/ControlProfilePanel.test.tsx`.

### Task 4: Verification

- [ ] Run targeted renderer tests.
- [ ] Run `pnpm run build:renderer` or the narrowest available type/build command if renderer build is enough for changed files.
- [ ] Run `mcp__gitnexus.detect_changes({scope:"all", repo:"link-mcp"})`.
