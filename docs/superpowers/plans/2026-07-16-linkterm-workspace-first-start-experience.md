# LinkTerm Workspace-First Start Experience Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Each task is a vertical slice and must be checked off only after its focused tests and impact evidence pass.

**Goal:** Rework the no-session Start Center so saved device workspaces appear first, new-device configuration is one clear entry, and a serial-only connection can be temporary or saved without treating MCP/Agent configuration as device data.

**Architecture:** Keep the existing Main/preload, ConnectionDialog, SessionManager, WriteQueue, Transport, and ControlProfile IPC boundaries. Add a renderer-only workspace summary adapter that presents saved control profiles and serial connection profiles as typed cards. StartCenter renders those cards and a single “new device workspace” entry; ControlProfilePanel chooses between a serial-only flow that delegates to ConnectionDialog and the existing full device profile form. MCP/Agent remains a system-level panel opened from the application chrome.

**Tech Stack:** React 19, TypeScript, Tailwind utility classes, Zustand app store, Vitest + Testing Library (happy-dom), existing Electron preload APIs.

---

## Constraints and execution gates

- Preserve all existing user changes; do not reset, checkout, clean, commit, push, or create a PR.
- Before modifying an existing function, class, or method, run GitNexus `impact({target, direction: "upstream"})`; report HIGH/CRITICAL risk and wait for authorization before editing.
- Use TDD for every vertical slice: write the failing test, run it and capture the failure, implement the smallest change, then rerun the focused test.
- Do not change SessionManager, WriteQueue, Transport, IJLinkBackend, MCP execution, approval, pause, takeover, or hardware behavior.
- Do not execute real serial, J-Link, RTT, flash, erase, reset, or debug operations during automated or manual validation.
- Run `gitnexus detect_changes()` before claiming completion and record the affected symbols/processes.

## Task 1: Create the independent OpenSpec change

**Files:**
- Create: `openspec/changes/reframe-start-center-workspace-model/proposal.md`
- Create: `openspec/changes/reframe-start-center-workspace-model/design.md`
- Create: `openspec/changes/reframe-start-center-workspace-model/tasks.md`
- Create: `openspec/changes/reframe-start-center-workspace-model/specs/start-center-workspace-model/spec.md`

- [ ] **Step 1: Write the proposal and design delta**

Record the approved model exactly: system configuration contains MCP/Agent; a device workspace contains device/link/firmware facts; a session is runtime state; a serial-only connection can be temporary or saved; the home page contains saved workspaces first and one new-workspace entry. State non-goals and the no-hardware-side-effect boundary.

- [ ] **Step 2: Write executable task and requirement scenarios**

Add scenarios for saved full workspace ordering, serial-only temporary mode, serial-only saved mode, system-level MCP/Agent separation, no COM list on the home page, existing ConnectionDialog reuse, and shared human/AI terminal input.

- [ ] **Step 3: Validate the OpenSpec change**

Run:

```powershell
npx openspec validate openspec/changes/reframe-start-center-workspace-model --strict
```

Expected: the new change validates without schema or scenario errors. If the local CLI exposes a different command, use the repository’s documented strict-validation command and record it in the evidence log.

## Task 2: Add a renderer workspace-summary adapter

**Files:**
- Create: `src/renderer/features/workspaces/workspace-model.ts`
- Create: `tests/unit/renderer/workspaces/workspace-model.test.ts`
- Modify: `src/shared/preload-api.ts` only if an existing public payload type is missing a non-sensitive field needed by the adapter (no new IPC method)

The adapter must not persist data or expose MCP/Agent fields. Use existing payloads:

```ts
export type WorkspaceKind = 'full' | 'serial-only';

export interface WorkspaceSummary {
  readonly id: string;
  readonly label: string;
  readonly kind: WorkspaceKind;
  readonly source: 'control-profile' | 'connection-profile';
  readonly details: readonly string[];
  readonly updatedAt: string;
  readonly controlProfileRecordId?: string;
  readonly connectionProfileId?: string;
}

export function summarizeControlProfileRecord(
  record: SavedControlProfileRecordPayload,
): WorkspaceSummary;

export function summarizeSerialConnection(
  profile: SavedConnectionSummary,
): WorkspaceSummary | null;
```

- [ ] **Step 1: Write failing adapter tests**

Add tests with one full `SavedControlProfileRecordPayload` and one serial `SavedConnectionSummary`. Assert that full summaries include the device/transport/firmware facts, serial summaries include port and baud rate, non-serial connections return `null`, and `JSON.stringify(summary)` contains no `agent`, `mcp`, `token`, or credential fields.

- [ ] **Step 2: Run the focused test and capture the failure**

Run:

```powershell
pnpm vitest run tests/unit/renderer/workspaces/workspace-model.test.ts
```

Expected: FAIL because `workspace-model.ts` and its exported functions do not yet exist.

- [ ] **Step 3: Run GitNexus impact for any existing type/function edited**

If `src/shared/preload-api.ts` must change, run upstream impact for the exact type or method before editing and report its callers and risk. New renderer-only adapter symbols do not replace any existing symbol.

- [ ] **Step 4: Implement the smallest pure adapter**

Use deterministic summaries such as `COM6 · 115200`, `J-Link · target`, `RTT · ch0`, and the firmware basename. Do not read the filesystem, call preload, or mutate Zustand state.

- [ ] **Step 5: Rerun the focused test**

Expected: PASS for all adapter tests.

## Task 3: Make StartCenter workspace-first

**Files:**
- Modify: `src/renderer/features/readiness/StartCenter.tsx`
- Modify: `tests/unit/renderer/readiness/start-center-components.test.tsx`
- Modify: `tests/unit/renderer/readiness/start-center-a11y.test.tsx`
- Modify: `tests/unit/renderer/readiness/start-center-bounded-render.test.tsx`
- Modify: `tests/unit/renderer/readiness/start-center-no-side-effects.test.tsx`

Change the public props from a primary manual-open action plus saved connections to a saved-workspace list plus one new-workspace callback. The product workspace mode must not render the advanced-device disclosure, a COM candidate list, a manual serial form, MCP/Agent configuration fields, readiness diagnostics, or a first-success button.

- [ ] **Step 1: Add failing component tests**

Add assertions equivalent to:

```tsx
expect(screen.getByRole('region', { name: 'Saved workspaces' })).toBeInTheDocument();
expect(screen.getByRole('button', { name: 'New device workspace' })).toBeInTheDocument();
expect(screen.queryByRole('region', { name: 'Manual open' })).toBeNull();
expect(screen.queryByText('COM10 · USB Serial Device')).toBeNull();
```

Also test that a full workspace and a serial-only workspace render their type labels, that clicking a card calls the correct callback with its summary, and that advanced devices are absent.

- [ ] **Step 2: Run the focused StartCenter tests and capture failures**

Run:

```powershell
pnpm vitest run tests/unit/renderer/readiness/start-center-components.test.tsx tests/unit/renderer/readiness/start-center-a11y.test.tsx tests/unit/renderer/readiness/start-center-bounded-render.test.tsx tests/unit/renderer/readiness/start-center-no-side-effects.test.tsx
```

Expected: FAIL on the new region/button labels and workspace-card assertions while the old manual-open expectations remain.

- [ ] **Step 3: Run upstream impact before editing StartCenter symbols**

Run GitNexus impact for `StartCenter`, `SavedConnectionList`, and any helper that is renamed or removed. Report direct callers (`App`, renderer tests), affected Start Center processes, and risk before editing.

- [ ] **Step 4: Implement the minimal workspace-first layout**

Render in this order: saved workspaces, empty state when none exist, then one “New device workspace” entry. Keep `min-h-0`, `overflow-y-auto`, bounded lists, and keyboard-operable buttons. Do not call preload or transport APIs from StartCenter.

- [ ] **Step 5: Rerun focused StartCenter tests**

Expected: PASS, including no-side-effect assertions and narrow-layout bounded rendering.

## Task 4: Add serial-only/full workspace choice without duplicating connection logic

**Files:**
- Modify: `src/renderer/components/ControlProfilePanel.tsx`
- Modify: `tests/unit/renderer/components/ControlProfilePanel.test.tsx`
- Modify: `src/renderer/store/app-store.ts` only if a missing existing action prevents opening the shared ConnectionDialog

Introduce a local setup mode in the panel:

```ts
type WorkspaceSetupMode = 'choose' | 'serial-only' | 'full';
```

The `choose` view presents two actions: “Serial-only connection” and “Full device workspace”. The serial-only action closes the panel and invokes an `onOpenSerialConnection` callback supplied by `App`; that callback opens the existing ConnectionDialog. It must not duplicate port discovery, baud validation, saved-profile loading, or session creation. The full action reveals the existing device workspace fields and retains current save/open behavior.

- [ ] **Step 1: Add failing panel tests**

Test that the initial panel exposes both setup choices; clicking serial-only calls `onOpenSerialConnection` and does not render a second serial form; clicking full renders the existing workspace fields; and reopening the panel resets the chooser without changing saved records.

- [ ] **Step 2: Run the focused panel tests and capture failures**

Run:

```powershell
pnpm vitest run tests/unit/renderer/components/ControlProfilePanel.test.tsx
```

Expected: FAIL because the setup-mode controls and callback prop do not exist.

- [ ] **Step 3: Run GitNexus upstream impact before editing panel symbols**

Run impact for `ControlProfilePanel`, `save`, `openControlProfileRecord` callback seams used by the panel, and any store method edited. Report direct callers (`App`, panel tests) and risk.

- [ ] **Step 4: Implement the mode chooser and callback delegation**

Keep the current full-profile validation and preload calls unchanged. Only add mode state, the two chooser buttons, and the serial-only delegation callback. Reset `WorkspaceSetupMode` to `choose` whenever the dialog closes.

- [ ] **Step 5: Rerun panel tests and existing connection-dialog regression tests**

Run:

```powershell
pnpm vitest run tests/unit/renderer/components/ControlProfilePanel.test.tsx tests/unit/renderer/components/ConnectionDialog.test.tsx tests/integration/connection-dialog-type-switch.test.tsx
```

Expected: PASS with no duplicate serial form and no changed ConnectionDialog session behavior.

## Task 5: Wire saved workspaces, temporary serial sessions, and system-level Agent settings in App

**Files:**
- Modify: `src/renderer/App.tsx`
- Modify: `tests/unit/renderer/App.start-center.test.tsx`
- Modify: `tests/unit/renderer/App.test.tsx`
- Modify: `tests/unit/renderer/components/AgentIntegrationsPanel.test.tsx` only for system-level entry assertions

Build `WorkspaceSummary[]` with `useMemo` from the already-loaded control-profile records and serial saved connections. Full records open through the existing `openControlProfileRecord`; serial cards open through `openSavedConnection`. Pass a single `onNewWorkspace` callback to StartCenter that opens ControlProfilePanel. Pass `onOpenSerialConnection={openSerialTerminal}` to ControlProfilePanel so its serial-only branch delegates to ConnectionDialog. Keep `AgentIntegrationsPanel` mounted from the header/system entry, not from StartCenter’s primary or advanced workspace actions.

- [ ] **Step 1: Add failing App tests**

Cover these cases:

```tsx
expect(screen.getByText('FNA test bench')).toBeInTheDocument();
fireEvent.click(screen.getByRole('button', { name: 'Open workspace' }));
expect(mockOpenControlProfileRecord).toHaveBeenCalledWith({ recordId: 'record_fna' });

fireEvent.click(screen.getByRole('button', { name: 'New device workspace' }));
expect(screen.getByRole('dialog', { name: 'Device workspace' })).toBeInTheDocument();
```

Assert that no-session StartCenter does not render the control-profile sidebar, that an active session still does, and that MCP/Agent settings remain reachable from the header without appearing as a workspace card field.

- [ ] **Step 2: Run the focused App tests and capture failures**

Run:

```powershell
pnpm vitest run tests/unit/renderer/App.start-center.test.tsx tests/unit/renderer/App.test.tsx tests/unit/renderer/components/AgentIntegrationsPanel.test.tsx
```

Expected: FAIL on workspace-card data and the new callback wiring before implementation.

- [ ] **Step 3: Run GitNexus upstream impact before editing App symbols**

Run impact for `App`, `openSavedConnection`, `openControlProfileRecord`, `loadControlProfileRecords`, `loadSavedConnections`, and the no-session render branch. Report affected processes and risk before edits.

- [ ] **Step 4: Implement the renderer wiring**

Reuse existing load/open callbacks and preload namespaces. Do not add IPC channels, alter session creation, or move AgentIntegrationsPanel state into workspace data. Keep the existing sidebar condition for active sessions and control-profile workflows.

- [ ] **Step 5: Rerun the focused App tests**

Expected: PASS for saved full workspace opening, serial-only saved opening, new-workspace routing, sidebar visibility, and global Agent entry.

## Task 6: Align Chinese/English copy and accessibility behavior

**Files:**
- Modify: `src/renderer/i18n/zh.ts`
- Modify: `src/renderer/i18n/en.ts`
- Modify: `tests/unit/renderer/readiness/readiness-i18n.test.ts`
- Modify: `tests/unit/renderer/readiness/start-center-a11y.test.tsx`
- Modify: `tests/unit/renderer/components/ControlProfilePanel.test.tsx`

Add paired keys for `Saved workspaces`, `Full device workspace`, `Serial-only connection`, `New device workspace`, temporary-use/save choices, and system-level MCP/Agent settings. Remove the old primary-path wording that presents “Manual open” or “Observe device output” as a competing task; preserve compatibility aliases only where existing non-start-center surfaces still need them.

- [ ] **Step 1: Add failing bilingual and accessibility assertions**

Assert every new key exists in both tables, the English and Chinese labels describe the same action, the two setup buttons are keyboard reachable, and the advanced disclosure exposes `aria-expanded` with a stable label.

- [ ] **Step 2: Run the focused copy/a11y tests and capture failures**

Run:

```powershell
pnpm vitest run tests/unit/renderer/readiness/readiness-i18n.test.ts tests/unit/renderer/readiness/start-center-a11y.test.tsx tests/unit/renderer/components/ControlProfilePanel.test.tsx
```

Expected: FAIL for missing keys or old labels before the translation changes.

- [ ] **Step 3: Run GitNexus impact before editing translation consumers**

Run impact for `StartCenter` and `ControlProfilePanel` translation call sites if labels are renamed in code; translation-table-only additions do not alter execution flows.

- [ ] **Step 4: Implement paired translations and focus-safe labels**

Use action verbs that match behavior. Opening/closing the workspace chooser, system Agent panel, and Activity Center must not focus or blur a terminal session unexpectedly.

- [ ] **Step 5: Rerun focused tests**

Expected: PASS for both locales, keyboard access, and focus-preserving disclosure behavior.

## Task 7: Full verification, review, and evidence

**Files:**
- No planned product-file additions; update only the OpenSpec task checklist and evidence notes created in Task 1.

- [ ] **Step 1: Run the complete renderer and integration test set**

```powershell
pnpm vitest run tests/unit/renderer tests/integration
```

Expected: all renderer and connection-dialog integration tests pass.

- [ ] **Step 2: Run project quality gates**

```powershell
pnpm lint
pnpm exec tsc -b --pretty false
pnpm build
pnpm validate:licenses
```

Expected: lint, TypeScript, build, and license validation exit successfully.

- [ ] **Step 3: Request code review**

Use the requesting-code-review skill with the focused diff. Address only valid findings within this approved scope, rerun the affected tests, and do not commit.

- [ ] **Step 4: Run completion verification**

Use verification-before-completion and record fresh command output for tests, build, lint, license validation, and OpenSpec strict validation.

- [ ] **Step 5: Run GitNexus scope checks**

Run `gitnexus detect_changes()` and confirm only the expected renderer symbols, translation keys, workspace adapter, tests, and OpenSpec files changed. Run directed PDG/taint review for the modified renderer boundaries; if the PDG layer is unavailable, record the tool-blocked evidence instead of claiming a clean security proof.

- [ ] **Step 6: Windows-first manual acceptance**

With no hardware side effects, verify at large and narrow window sizes in both locales:

1. saved workspaces appear first;
2. full workspace opens once;
3. serial-only setup delegates to the single ConnectionDialog;
4. a serial-only session can be temporary or saved;
5. COM discovery is absent from the home page and appears only in the connection flow;
6. MCP/Agent settings are reachable globally and absent from workspace cards;
7. Activity Center is observation-only and does not steal terminal focus;
8. artificial test output and human typing remain in the same session boundary.

Record screenshots and test evidence. Do not connect to, reset, flash, erase, or debug a real device.

## Plan self-review

- **Specification coverage:** domain boundaries are Task 2/4/5; saved workspace priority is Task 3/5; serial-only temporary/saved flow is Task 4/5; system-level MCP/Agent is Task 5/6; advanced/Activity/focus behavior is Task 3/6/7; compatibility and no data deletion are Task 2/5; bilingual, responsive, and accessibility requirements are Task 6/7.
- **Unspecified-marker scan:** every implementation slice names exact files, tests, commands, and expected outcomes; no task relies on deferred or unspecified work.
- **Type consistency:** `WorkspaceKind`, `WorkspaceSummary`, and `WorkspaceSetupMode` are introduced before their consumers; App callbacks use existing `SavedControlProfileRecordPayload` and `SavedConnectionSummary` IDs; no new IPC contract is assumed.
- **Scope check:** all planned product edits stay within renderer, i18n, tests, and the independent OpenSpec change. Session, transport, MCP execution, authorization, and hardware layers remain out of scope.
