# LinkTerm Clear Start Experience Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: use the repository's executing-plans workflow to run this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Make the no-session LinkTerm home screen terminal-first so a user can select a serial device, open the existing connection flow, and keep human and AI interaction visible without competing entry points.

**Architecture:** Keep all connection and write behavior behind the existing `ConnectionDialog`, `SessionManager`, `Transport`, and `WriteQueue`. Rework only the renderer information architecture: `StartCenter` owns the serial-first presentation, `App` owns callback routing and empty-state shell visibility, and Activity Center remains a closed-by-default observation drawer. Saved connection profiles stay in `ConnectionDialog`; no new readiness/preload DTO is introduced.

**Tech Stack:** Electron renderer, React, TypeScript, Tailwind utility classes, Zustand app store, Vitest, Testing Library, OpenSpec, GitNexus.

---

## File inventory and boundaries

- Modify `src/renderer/features/readiness/StartCenter.tsx`: serial-first layout, primary/secondary actions, manual port + baud validation, advanced disclosure, serial-only candidate filtering.
- Modify `src/renderer/App.tsx`: route primary/manual/candidate actions to existing `ConnectionDialog` prefill, keep First Success as a separate guide, hide the control-profile sidebar only in the no-session Start Center branch.
- Modify `src/renderer/i18n/en.ts` and `src/renderer/i18n/zh.ts`: new action, section, validation, disclosure, and observation copy.
- Modify `src/renderer/features/activity/AiStatusCapsule.tsx` only if the final copy needs an explicit accessible “view AI activity” label; do not alter activity state or audit behavior.
- Modify `tests/unit/renderer/readiness/start-center-components.test.tsx`: serial-first component behavior and manual validation.
- Modify `tests/unit/renderer/readiness/start-center-a11y.test.tsx`: roles, names, disclosure state, keyboard path, and error announcements.
- Modify `tests/unit/renderer/readiness/start-center-bounded-render.test.tsx`: bounded serial and advanced candidate rendering.
- Modify `tests/unit/renderer/readiness/start-center-no-side-effects.test.tsx`: readiness/UI actions do not create sessions or write transports.
- Modify `tests/unit/renderer/readiness/readiness-i18n.test.ts`: bilingual key coverage.
- Modify `tests/unit/renderer/App.start-center.test.tsx`: App routing, prefill, sidebar suppression, Activity Center default state, and preserved First Success guide.
- Modify `tests/unit/renderer/App.test.tsx`: preserve active-session/control-profile sidebar behavior.
- Modify `tests/unit/renderer/components/ConnectionDialog.test.tsx` only for regression coverage of readiness serial prefill; no connection implementation changes are planned.

## Shared test fixtures and names

Use the existing `snapshot()` helper in `start-center-components.test.tsx` and `MockPreloadAPI` in `App.start-center.test.tsx`. The following names are introduced once and reused consistently:

- `onOpenSerialTerminal(): void` — opens `ConnectionDialog` without a prefill.
- `onOpenFirstSuccessGuide(): void` — preserves the existing First Success review path as a secondary action.
- `onUseCandidate(candidate: DeviceCandidate): void` — serial candidates prefill `ConnectionDialog`; J-Link candidates retain the existing review panel.
- `onUseManualPort(portLabel: string, baudRate: number): void` — creates a manual draft and pre-fills `ConnectionDialog`.
- `start-center-primary-action` — the sole primary action test id.
- `start-center-first-success-action` — secondary guided-flow test id.
- `advanced-devices` — disclosure test id.

### Task 1: Characterize current behavior and run symbol impact

**Files:**
- Read: `src/renderer/features/readiness/StartCenter.tsx`
- Read: `src/renderer/App.tsx`
- Read: `src/renderer/features/activity/AiStatusCapsule.tsx`
- Read: `tests/unit/renderer/readiness/start-center-components.test.tsx`
- Read: `tests/unit/renderer/App.start-center.test.tsx`

- [ ] **Step 1: Run the current focused renderer characterization tests**

Run:

```powershell
pnpm vitest run tests/unit/renderer/readiness/start-center-components.test.tsx tests/unit/renderer/readiness/start-center-a11y.test.tsx tests/unit/renderer/App.start-center.test.tsx
```

Expected: current baseline tests pass before the UI change; any pre-existing failure is recorded and not attributed to this plan.

- [ ] **Step 2: Run GitNexus upstream impact before editing existing symbols**

Run the repository's GitNexus impact command for these targets, one at a time:

```text
StartCenter
App
openAdvancedConnection
openManualSerialConnection
openCandidateSerialConnection
ControlProfileSidebar
AiStatusCapsule
```

Record direct callers, affected processes, and risk. If any result is HIGH or CRITICAL, report it before proceeding with the corresponding edit.

- [ ] **Step 3: Record the current callback and layout contract**

Capture the current facts in the change evidence: manual/candidate callbacks enter `FirstSuccessFlow`, `ConnectionDialog` already consumes `draftToNonSensitivePrefill`, `reusableProfiles` contains only IDs/labels, and the sidebar is currently rendered before the no-session branch.

### Task 2: Add failing serial-first Start Center tests

**Files:**
- Modify: `tests/unit/renderer/readiness/start-center-components.test.tsx`
- Modify: `tests/unit/renderer/readiness/start-center-a11y.test.tsx`
- Modify: `tests/unit/renderer/readiness/start-center-bounded-render.test.tsx`
- Modify: `tests/unit/renderer/readiness/start-center-no-side-effects.test.tsx`

- [ ] **Step 1: Replace the old primary-action expectation with the terminal-first contract**

Add this test shape to `start-center-components.test.tsx`:

```tsx
it('uses one primary serial-terminal action and keeps the first-success guide secondary', () => {
  const onOpenSerialTerminal = vi.fn();
  const onOpenFirstSuccessGuide = vi.fn();

  render(
    <StartCenter
      state={{ phase: 'ready', refreshing: false, snapshot: snapshot(), diagnostics: [] }}
      onRefresh={vi.fn()}
      onAdvancedConnection={vi.fn()}
      onOpenSerialTerminal={onOpenSerialTerminal}
      onOpenFirstSuccessGuide={onOpenFirstSuccessGuide}
      onUseCandidate={vi.fn()}
      onUseManualPort={vi.fn()}
      onCopyDiagnostics={vi.fn()}
    />,
  );

  fireEvent.click(screen.getByTestId('start-center-primary-action'));
  fireEvent.click(screen.getByTestId('start-center-first-success-action'));

  expect(onOpenSerialTerminal).toHaveBeenCalledOnce();
  expect(onOpenFirstSuccessGuide).toHaveBeenCalledOnce();
  expect(screen.getByRole('button', { name: 'Open serial terminal' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'First-success guide' })).toBeInTheDocument();
});
```

- [ ] **Step 2: Add serial filtering and consistent candidate action assertions**

Extend the snapshot fixture with one serial and one J-Link candidate. Assert that the serial section contains only the serial row, the J-Link row appears only after expanding `advanced-devices`, and serial rows use `Open terminal` rather than `Review this port`.

- [ ] **Step 3: Add manual port and baud validation tests**

Add a test that fills `COM10` and `115200`, calls `onUseManualPort('COM10', 115200)`, and rejects an empty port, `0`, decimal, and non-numeric baud value with an accessible local validation message.

- [ ] **Step 4: Add disclosure and responsive semantics tests**

Assert `details[data-testid="advanced-devices"]` starts closed, exposes a `summary`, sets `aria-expanded` through the native details state, and uses a stacked responsive class such as `flex-col`/`grid` without a horizontal overflow class.

- [ ] **Step 5: Run the new tests to confirm they fail for the old implementation**

Run:

```powershell
pnpm vitest run tests/unit/renderer/readiness/start-center-components.test.tsx tests/unit/renderer/readiness/start-center-a11y.test.tsx tests/unit/renderer/readiness/start-center-bounded-render.test.tsx tests/unit/renderer/readiness/start-center-no-side-effects.test.tsx
```

Expected: failures identify the old `Observe device output` primary action, missing new callbacks, missing disclosure, and missing baud validation.

### Task 3: Implement the serial-first Start Center presentation

**Files:**
- Modify: `src/renderer/features/readiness/StartCenter.tsx`
- Modify: `src/renderer/i18n/en.ts`
- Modify: `src/renderer/i18n/zh.ts`

- [ ] **Step 1: Extend `StartCenterProps` with explicit primary and guide callbacks**

Use this type shape:

```ts
readonly onOpenSerialTerminal: () => void;
readonly onOpenFirstSuccessGuide: () => void;
readonly onUseManualPort: (portLabel: string, baudRate: number) => void;
```

Keep `onAdvancedConnection` for the explicit advanced connection entry and keep all existing candidate/reflash/profile callback types unchanged.

- [ ] **Step 2: Replace the old observe-device primary action**

Render exactly one primary button:

```tsx
<button
  type="button"
  data-testid="start-center-primary-action"
  className="rounded bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-500"
  onClick={onOpenSerialTerminal}
>
  {t('readiness.action.openTerminal')}
</button>
```

Add a secondary guide button with `data-testid="start-center-first-success-action"` that calls `onOpenFirstSuccessGuide`. Keep refresh and advanced connection visually secondary.

- [ ] **Step 3: Render a serial-only device area before advanced content**

Split candidates once in `StartCenter`:

```ts
const candidates = snapshot?.deviceCandidates ?? [];
const serialCandidates = candidates.filter((candidate) => candidate.serial !== undefined);
const advancedCandidates = candidates.filter((candidate) => candidate.serial === undefined);
```

Render `ManualPortEntry` and the serial candidate list in the first content block. Render `advancedCandidates`, `ReadinessChecklist`, compensation candidates, profile suggestions, and diagnostics inside a closed native `<details data-testid="advanced-devices">` block. Do not render `RecentProfiles` on Start Center; saved profiles remain in `ConnectionDialog`.

- [ ] **Step 4: Add manual baud input and local validation**

Use the existing `BaudRateInput` component with a string state, parse only positive integers, and call the callback only for valid values:

```ts
const baudNumber = Number.parseInt(baudRate, 10);
const validBaud = /^\d+$/u.test(baudRate.trim()) && baudNumber > 0;
const canOpen = trimmed.length > 0 && validBaud;

if (canOpen) onUseManualPort(trimmed, baudNumber);
```

Expose separate accessible descriptions for missing port and invalid baud. Keep readiness rendering side-effect free.

- [ ] **Step 5: Rename candidate actions and update bilingual copy**

Add matching keys in `en.ts` and `zh.ts` for `openTerminal`, `firstSuccessGuide`, `serial.title`, `serial.manualPort`, `serial.baudRate`, `serial.openDisabled`, `serial.baudInvalid`, `advanced.title`, and `advanced.summary`. Change serial candidate action text to `Open terminal` / `打开终端`; keep J-Link action text specific to reviewing a target.

- [ ] **Step 6: Run the Start Center tests**

Run the focused command from Task 2 Step 5.

Expected: all Start Center component, a11y, bounded-render, and no-side-effect tests pass.

### Task 4: Route serial actions through ConnectionDialog and preserve First Success as a guide

**Files:**
- Modify: `src/renderer/App.tsx`
- Modify: `tests/unit/renderer/App.start-center.test.tsx`
- Modify: `tests/unit/renderer/App.test.tsx`
- Modify: `tests/unit/renderer/components/ConnectionDialog.test.tsx`

- [ ] **Step 1: Add a shared App callback for an unfilled serial-terminal dialog**

Add a callback next to `openAdvancedConnection`:

```ts
const openSerialTerminal = React.useCallback(() => {
  setFirstSuccessDraft(null);
  setJLinkRttReview(null);
  setConnectionDialogPrefill(null);
  openDialog();
}, [openDialog, setConnectionDialogPrefill]);
```

This opens the existing dialog and does not create a session by itself.

- [ ] **Step 2: Add a draft-to-dialog callback for serial candidates and manual input**

Import `draftToNonSensitivePrefill` and route serial drafts through the existing store bridge:

```ts
const openSerialDraftInDialog = React.useCallback(
  (draft: SerialConnectionDraft): void => {
    setFirstSuccessDraft(null);
    setFirstSuccessErrorMessage(null);
    setJLinkRttReview(null);
    setConnectionDialogPrefill(draftToNonSensitivePrefill(draft));
    openDialog();
  },
  [openDialog, setConnectionDialogPrefill],
);
```

Change `openManualSerialConnection` to accept `(portLabel, baudRate)`, call `createManualSerialDraft({ draftId: 'readiness_manual', portLabel, baudRate })`, and pass the draft to `openSerialDraftInDialog`. Change the serial branch of `openCandidateSerialConnection` to use `createDraftFromCandidate` plus the same callback. Leave the J-Link branch unchanged.

- [ ] **Step 3: Move the old single-candidate behavior behind `openFirstSuccessGuide`**

Add an App callback that reads the current readiness snapshot, selects a single serial candidate only for the explicit guide action, and otherwise opens the advanced connection dialog. This preserves the First Success review without making it the manual terminal path:

```ts
const openFirstSuccessGuide = React.useCallback(() => {
  const serialCandidates = readinessState.snapshot?.deviceCandidates.filter(
    (candidate) => candidate.serial !== undefined,
  ) ?? [];
  if (serialCandidates.length === 1) {
    openFirstSuccessReview(createDraftFromCandidate(serialCandidates[0], { draftId: serialCandidates[0].id }));
    return;
  }
  openAdvancedConnection();
}, [openAdvancedConnection, openFirstSuccessReview, readinessState.snapshot]);
```

- [ ] **Step 4: Wire the new callbacks into `StartCenter`**

Pass `onOpenSerialTerminal={openSerialTerminal}`, `onOpenFirstSuccessGuide={openFirstSuccessGuide}`, and the updated manual callback from the no-session branch. Keep `onAdvancedConnection={openAdvancedConnection}` for the secondary advanced entry.

- [ ] **Step 5: Hide the control-profile sidebar only for the Start Center empty state**

Derive the display condition before the main return:

```ts
const showControlProfileSidebar =
  sessionList.length > 0 || firstSuccessDraft !== null || jlinkRttReview !== null || visibleControlProfile !== null;
```

Render `ControlProfileSidebar` only when `showControlProfileSidebar` is true. Keep `ControlProfileStatusPanel` and all active-session branches unchanged.

- [ ] **Step 6: Update App regression tests**

Change manual and serial-candidate tests to assert `dialogOpen === true`, the expected `connectionDialogPrefill`, and no session creation before the user submits `ConnectionDialog`. Add a guide test that still reaches `Review serial first signal`. Add a no-session test asserting `control-profile-sidebar` is absent, and retain an active-session test asserting it remains present.

- [ ] **Step 7: Run App and ConnectionDialog tests**

Run:

```powershell
pnpm vitest run tests/unit/renderer/App.start-center.test.tsx tests/unit/renderer/App.test.tsx tests/unit/renderer/components/ConnectionDialog.test.tsx
```

Expected: serial actions prefill/open the dialog without creating a session; the explicit guide still uses First Success; active-session/control-profile behavior remains green.

### Task 5: Make Activity Center and language behavior explicit

**Files:**
- Modify: `src/renderer/features/activity/AiStatusCapsule.tsx` only if needed for the final accessible label.
- Modify: `src/renderer/i18n/en.ts`
- Modify: `src/renderer/i18n/zh.ts`
- Modify: `tests/unit/renderer/activity/activity-components.test.tsx`
- Modify: `tests/unit/renderer/readiness/readiness-i18n.test.ts`
- Modify: `tests/unit/renderer/App.start-center.test.tsx`

- [ ] **Step 1: Add a default-closed Activity Center assertion**

Render `App` in the no-session state and assert the Activity Center dialog is absent until the header capsule is activated. Do not persist or reset activity data.

- [ ] **Step 2: Add an observation-only accessible label**

If the existing status-only label is insufficient, add a localized `activity.capsule.open` label and compose it with the current status in `AiStatusCapsule` without changing `getActivityCapsuleStatus` or drawer state.

- [ ] **Step 3: Run bilingual and Activity Center tests**

Run:

```powershell
pnpm vitest run tests/unit/renderer/activity/activity-components.test.tsx tests/unit/renderer/readiness/readiness-i18n.test.ts tests/unit/renderer/App.start-center.test.tsx
```

Expected: Activity Center remains observation-only, all changed keys exist in English and Chinese, and no approval/pause/takeover/recovery controls appear.

### Task 6: Review, verify, and perform Windows-first acceptance

**Files:**
- Modify: `docs/engineering/clear-start-center-evidence.md`
- Modify: `openspec/changes/clarify-start-center-terminal-first/tasks.md`

- [ ] **Step 1: Run the complete renderer and project checks**

Run:

```powershell
pnpm vitest run tests/unit/renderer
pnpm lint
pnpm exec tsc -b --pretty false
pnpm build
pnpm validate:licenses
pnpm exec openspec validate clarify-start-center-terminal-first --strict
```

Expected: all commands exit with code 0. If an unrelated pre-existing failure occurs, record the exact command and output without changing unrelated files.

- [ ] **Step 2: Run coverage and full regression tests**

Run:

```powershell
pnpm test
pnpm test:coverage
```

Expected: the full suite passes with coverage output recorded; no hardware command is invoked.

- [ ] **Step 3: Request code review and resolve valid findings**

Review the diff for scope, accessibility, bilingual copy, focus behavior, and preservation of existing session/ConnectionDialog boundaries. For every valid finding, run a fresh GitNexus impact before editing the affected symbol, then rerun the affected test file.

- [ ] **Step 4: Run final GitNexus and verification checks**

Run `verification-before-completion`, directed PDG/taint checks for renderer-to-ConnectionDialog boundaries, and `detect_changes()` for the dirty worktree. Confirm the output identifies only the intended renderer symbols/files relative to this change; do not treat the cumulative dirty-worktree risk as a clean single-change proof.

- [ ] **Step 5: Complete Windows-first manual acceptance**

With the app running and no hardware side effect:

1. Confirm Start Center shows one obvious `打开串口终端` / `Open serial terminal` action.
2. Confirm serial candidates and manual port/baud fields are visible before advanced content.
3. Confirm clicking a candidate or manual action opens `ConnectionDialog` with serial fields prefilled and does not create a session until the user submits.
4. Confirm saved profiles remain inside `ConnectionDialog`, not duplicated on Start Center.
5. Confirm `高级设备` starts collapsed and Activity Center starts closed.
6. Confirm active sessions retain terminal input while Activity Center is open and AI activity is visible.
7. Repeat in English, at a smaller window size, and with keyboard navigation.

- [ ] **Step 6: Record evidence without committing**

Write fresh command output, screenshots, and manual observations to `docs/engineering/clear-start-center-evidence.md`. Do not commit, push, create a PR, or execute real serial/J-Link/RTT/flash/erase/reset operations.

## Plan self-review

- **Spec coverage:** Tasks 2–3 cover the serial-first Start Center and bilingual/a11y/responsive requirements; Task 4 covers existing ConnectionDialog routing and empty-state sidebar suppression; Task 5 covers observation-only Activity Center; Task 6 covers verification and Windows acceptance.
- **Scope check:** No new Main/preload contract, transport behavior, AI execution policy, approval, pause, audit, or hardware operation is planned.
- **Placeholder scan:** No task depends on an unspecified file, symbol, command, or future decision.
- **Type consistency:** `onOpenSerialTerminal`, `onOpenFirstSuccessGuide`, and `(portLabel, baudRate)` are introduced in Task 3 and wired in Task 4; all remaining tests use the same names.
- **Dirty worktree:** Existing user changes remain untouched; no commit step is included because the user explicitly prohibited commits.
