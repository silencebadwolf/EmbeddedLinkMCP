## 1. Phase 0 baseline and scope

- [x] 1.1 Record the four accepted A+D decisions consistently in the package README, design, implementation, handoff, and spec-review documents.
- [x] 1.2 Create the independent `establish-characterization-ci-gates` change with proposal, `engineering-quality-gates` delta spec, and design that exclude all Phase 1–8 product behavior.
- [x] 1.3 Recheck the current HEAD, worktree, GitNexus index commit/PDG setting, OpenSpec status, package scripts, native dependency configuration, and existing test counts immediately before implementation planning.
- [x] 1.4 Run fresh upstream impact for every existing function, class, or method that the implementation plan proposes to edit; report HIGH/CRITICAL results before editing and revise the plan if product source would change.

## 2. Current-behavior characterization

- [x] 2.1 Add focused `registerTool` characterization for successful results, handler-declared failures, read-only version warnings, state-affecting version/stale-runtime rejection, stale-runtime exceptions, `ToolError`, unexpected throw, and real-SDK pre-handler schema rejection with zero effectful fake-backend calls.
- [x] 2.2 Review and extend current acknowledgement characterization across the seven-tool low-level J-Link matrix, binary decode precedence, conditional workflow/background/dry-run paths, runtime restart scheduling, and the Main direct Download `CONTROL_PROFILE_RUN_DOWNLOAD` / `CONTROL_PROFILE_START_DOWNLOAD` channels; all true-confirm cases remain explicitly labelled caller acknowledgement.
- [x] 2.3 Add focused dual-entry characterization: Renderer `session:create` open success, retained `success: true`/`errored` state after open failure, and pre-registration `INTERNAL`; MCP `open_session` open failure returns a structured failure with no ghost session or candidate lifecycle event.
- [x] 2.4 Add focused `ControlWorkflowJobManager` characterization for the exact structural-copy boundary (without claiming deep cloning of arbitrary nested evidence), failed-step/throw terminalization, queued/running/terminal cancellation, single-active-job rejection, 30-minute default TTL, completion-triggered 32-record terminal-cap enforcement ordered by `updatedAt`, the current queued-cancellation over-cap limitation, active-job protection, and explicit cleanup.
- [x] 2.5 Run the four targeted characterization groups and confirm production files under `src/` remain unchanged.

## 3. Complete 63-tool risk inventory

- [x] 3.1 Add a failing TypeScript-AST validator test that scans every production `.ts`/`.tsx` file under `src`, rejects source symlinks, requires every original/local `registerTool` import to resolve through the unique relative central `registry.js`, recognizes supported aliases and direct namespace calls, and rejects alternate/extensionless provenance, central-entry aliasing, named/namespace binding escapes, binding/assignment SDK destructuring, computed access, non-literal definitions, named/star/namespace re-exports, direct registry dynamic imports, invalid surface locations, alternate or duplicate SDK bridges, and every direct/computed/destructured legacy `.tool` path; then extract literal production `registerTool` names and sensitivities and require exact unique inventory coverage plus distinct low-level, conditional-workflow, and runtime-restart acknowledgement policies.
- [x] 3.2 Add a versioned JSON inventory under `docs/security/` containing all 63 tools with surface, registry sensitivity, four-level risk, current acknowledgement policy, unassigned future approval policy, and consequence-based rationale.
- [x] 3.3 Add the companion risk-level and non-authority documentation, then make the validator pass without wiring the inventory into runtime authorization.
- [x] 3.4 Review all `destructive-or-unknown`, `disruptive`, and currently acknowledgement-guarded entries manually against their real handler/backend effects; confirm that any newly discovered guard outside the named 7+1+1 paths has an inventory update and an executable behavior test because the AST scan cannot infer it.

## 4. Coverage and local quality commands

- [x] 4.1 Add exact-version `@vitest/coverage-v8@4.1.8` as a development dependency, update `pnpm-lock.yaml` through pnpm, and use a failing regression test before extending license validation to its separate 29-package installed production-dependency closure and repository license records.
- [x] 4.2 Add `test:coverage` and `ci:check` scripts, align the root Node.js engine contract to `^22.13.0 || >=24.0.0`, and preserve the existing authoritative `build`, `test`, `lint`, and `validate:licenses` commands.
- [x] 4.3 Configure whole-source V8 coverage with text, JSON summary, HTML, and LCOV reporters, no thresholds, and an ignored `coverage/` output directory.
- [x] 4.4 Run coverage locally and record the honest whole-source baseline and generated report paths without treating percentages as a pass/fail threshold.

## 5. Cross-platform CI and governance documentation

- [x] 5.1 Add a least-privilege GitHub Actions quality workflow using Node.js 22.13.0, pnpm 9.15.0, reviewed full-SHA Action references, non-persisted checkout credentials, frozen installs, and a Windows/Ubuntu/macOS matrix for `ci:check`.
- [x] 5.2 Add an independent Ubuntu coverage job that performs a platform-local install, runs `test:coverage`, and uploads the finite-retention coverage artifact without a third-party coverage service.
- [x] 5.3 Document local/CI quality commands, native dependency constraints, clean-checkout expectations, and Windows-first manual versus three-platform core automation scope.
- [x] 5.4 Include the project `.gitnexusrc` with `pdg: true`, then document GitNexus index freshness, upstream-impact warning, directed PDG/taint interpretation, and pre-completion `detect_changes` evidence requirements.

## 6. Review and completion evidence

- [x] 6.1 Run targeted Phase 0 tests, then fresh full `lint`, `build`, `test`, `validate:licenses`, and `test:coverage` commands; record exit codes and report locations.
- [x] 6.2 Run strict validation for this change and all canonical OpenSpec specs, plus whitespace/link/decision-record consistency checks.
- [x] 6.3 Request an independent code review against the Phase 0 OpenSpec and resolve every valid finding without expanding into Phase 1–8.
- [x] 6.4 Run `verification-before-completion` using fresh evidence and confirm the Phase 0 diff contains no production runtime or user-visible behavior change.
- [x] 6.5 Run GitNexus `detect_changes` against `main`, review affected symbols/processes, and perform directed PDG/taint checks for the registration/confirmation trust boundary while treating zero findings as limited evidence only.
- [x] 6.6 Report Phase 0 evidence and remaining limitations to the user; do not archive, commit, push, enter Phase 1, or call the overall A+D goal complete without explicit authorization.
