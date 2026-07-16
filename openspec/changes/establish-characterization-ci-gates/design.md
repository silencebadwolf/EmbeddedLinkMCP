## Context

Phase 0 is a safety and reproducibility change, not a user-facing release. The current repository has 63 production `registerTool` registrations, 57 of which are listed as core runtime diagnostics; 25 registrations declare `read-only` sensitivity and 38 declare `state-affecting` sensitivity. Existing tests cover much of the registry wrapper, seven high-impact confirmation gates, and basic background-job lifecycle, but they do not explicitly freeze `session:create` returning a successful IPC envelope with an `errored` session after transport-open failure, nor the precise structural-copy boundary and cleanup triggers of `ControlWorkflowJobManager`.

The repository already exposes `lint`, `build`, `test`, and `validate:licenses` scripts but has no CI workflow or coverage command. `vitest.config.ts` names the V8 provider, while `@vitest/coverage-v8` is only an uninstalled optional peer in the lockfile. Current acknowledgement behavior spans seven low-level J-Link tools, conditional `run_control_workflow`, `restart_mcp_runtime`, and a separate Main-process direct Download compatibility path. GitNexus is indexed at the current base commit with PDG enabled; `registerTool` currently has HIGH upstream risk (11 direct dependents, 15 impacted symbols, 2 affected process groups).

The four A+D product decisions are resolved: use the Phase 0–8 order; desktop is `interactive-required`, headless is `headless-deny`, and the first release does not enable `automation-allowlisted`; durable audit defaults to 30 days with 10 MiB file rotation; manual acceptance is Windows-first while core automation remains compatible with macOS and Linux.

## Goals / Non-Goals

**Goals:**

- Freeze current shared-seam behavior with deterministic, hardware-free characterization.
- Produce a complete, reviewable, machine-checked four-level risk inventory for all 63 production MCP tools.
- Make lint, build, tests, license validation, and report-only coverage reproducible from a clean checkout.
- Exercise core automation on Windows, Linux, and macOS while keeping Windows as the first manual hardware/UI acceptance platform.
- Record the GitNexus impact, PDG/taint, and `detect_changes` evidence rules that every later phase must follow.
- Keep the A+D decision record and Phase 0 OpenSpec artifacts internally consistent.

**Non-Goals:**

- Change a production handler, session, transport, queue, manager, J-Link backend, IPC/preload boundary, Renderer DTO, UI, or user-visible behavior.
- Add Operation/CallAttempt instrumentation, Activity Center, readiness, first-signal handling, Approval Broker, J-Link/RTT journey, Pause/Take Over, or durable audit implementation.
- Turn the risk inventory into runtime authorization or infer human approval from `confirm=true`.
- Add a coverage threshold, Codecov or another telemetry/SaaS integration, cloud account, database, remote approval, or hardware rollback promise.
- Perform real serial, probe, erase, flash, reset, GDB-server, RTT, or other hardware operations.

## Decisions

### 1. Keep production source unchanged

Phase 0 will add or adjust tests, documentation, development-only dependencies, Vitest configuration, package scripts, ignore rules, and a GitHub Actions workflow. It will not edit files under `src/`. This makes the “no product behavior change” claim reviewable from the diff rather than dependent only on tests.

Alternative considered: add a runtime `RiskPolicy` map under `src/` now. Rejected because the A+D specification assigns runtime policy and authorization behavior to later reviewed phases; introducing an unused or partially enforced policy in Phase 0 would blur that boundary.

### 2. Characterize current semantics before later redesign

Focused tests will assert today’s externally observable results:

- `registerTool`: success envelope, handler-declared failure, read-only version warning, state-affecting version/stale-runtime rejection before the handler, read-only and `allowWhenRuntimeStale` exceptions, `ToolError`, unexpected throw, and real-SDK pre-handler rejection.
- Confirmation: the existing seven-tool low-level matrix, binary decode precedence, conditional workflow gate/dry run, runtime restart scheduler, and Main direct Download compatibility path; missing/false confirmation produces no guarded effect, and true confirmation is caller acknowledgement under current behavior. All three modes currently accepted by the workflow schema are already high-impact, so `debug.haltOnFailure` is characterized only as unable to bypass the existing mode gate, not as an independently isolatable cause of confirmation.
- Session entry points: Renderer `session:create` retains an `errored` session under a successful IPC envelope after open failure, while MCP `open_session` rolls its candidate back, emits no candidate lifecycle event, and returns a structured failure.
- `ControlWorkflowJobManager`: defensive copies of the explicitly cloned workflow structures (not arbitrary nested evidence), `currentStepId`, `updatedAt`, failed-step and thrown-error terminalization, queued/running/terminal cancellation, single-active-job rejection, 30-minute default TTL, completion-triggered enforcement of the 32-terminal-record cap, the current queued-cancellation over-cap limitation, active-job protection, and explicit cleanup.

New focused test files are preferred when they avoid modifying existing named helpers. If an existing function, class, or method must be edited, a fresh GitNexus upstream impact check is required first. Characterization assertions are expected to pass against the unmodified production code; new validators and scripts follow normal red-green-refactor sequencing.

Alternative considered: “fix” the unusual Renderer session IPC success envelope or unify it with MCP during Phase 0. Rejected because the current phase exists to make both compatibility contracts explicit; the guided first-success phase will later decide how the UI interprets its retained errored session without silently changing MCP rollback behavior.

### 3. Store the risk inventory as review data, not runtime policy

The authoritative Phase 0 inventory will be a versioned JSON document under `docs/security/`, accompanied by a short Markdown explanation of the four levels and field meanings. Each entry records:

- exact tool name and MCP surface;
- declared registry sensitivity;
- one of `read-only`, `state-affecting`, `disruptive`, or `destructive-or-unknown`;
- current acknowledgement policy (`none`, `client-acknowledgement-required`, or `conditional-client-acknowledgement`) and an explicitly unassigned future approval policy;
- a concise consequence-based rationale.

The inventory `surface` is a Phase 0 `ToolSurface`: the exact first directory segment below `src/mcp/surfaces/` (for example `agent-runbook`, `control-workflow`, or `rtt-log-session`). It is source-review metadata and is deliberately not reused as, or silently mapped onto, the later `OperationEvent.surface` vocabulary.

A Vitest validator will use the installed TypeScript compiler API to walk every production `.ts` and `.tsx` file under `src`, rejecting source symlinks rather than silently skipping them. It resolves every import whose original or local name is `registerTool` through a relative `registry.js` specifier to the unique `src/mcp/registry.ts` source, recognizes supported aliases and direct namespace-member calls, and requires registrations to remain direct object-literal calls inside a first-level directory under `src/mcp/surfaces` with literal `name` and `sensitivity` properties. It rejects alternate or extensionless provenance, named or namespace binding escapes, binding and assignment SDK destructuring, computed namespace/SDK access, non-literal wrappers, named/star/namespace re-exports (including extensionless central paths), direct dynamic registry imports, registrations outside a valid surface directory, direct SDK `.registerTool` access outside the single fixed-shape bridge in `src/mcp/registry.ts`, and every direct/computed/destructured legacy SDK `.tool` access. The central file must expose exactly one `registerTool` function, may not alias or forward it, and must contain exactly one fixed-shape SDK bridge. The validator compares the resulting facts with the JSON, requires 63 unique exact matches, validates enum/rationale fields, asserts the reviewed acknowledgement sets for the seven-tool low-level matrix, `run_control_workflow`, and `restart_mcp_runtime`, and documents direct Download outside the MCP inventory. Runtime acknowledgement truth for those named paths is proven by parameterized behavior tests rather than inferred from a `confirm` schema field or source text. The AST scan deliberately cannot discover a newly introduced acknowledgement guard elsewhere; such a change requires manual consequence review, an inventory update, and a new behavior test. Any unrecognized or incomplete inventory entry fails instead of being inferred from sensitivity.

Alternative considered: instantiate the complete Electron MCP runtime to enumerate tools. Rejected for Phase 0 because several registrations are conditional on injected managers/catalogs and would make the inventory test depend on broad runtime construction. A regular-expression scan was also rejected because comments, strings, formatting, and Windows paths make it ambiguous. The bounded TypeScript AST scan is deterministic and intentionally rejects the specified escape, alternate-SDK, and invalid-location forms, forcing review. It inventories static definitions; it does not prove that every definition remains wired into a running server or semantically detect arbitrarily obfuscated/computed/generated registration. Such forms are prohibited by the Phase 0 convention rather than represented as false-positive CI certainty.

### 4. Use one local aggregate command and two CI job shapes

`package.json` will gain:

- `test:coverage`: explicitly run the existing native-dependency doctor, then `vitest run --coverage`;
- `ci:check`: run lint, the authoritative `build` command, license validation, and the full test suite.

`.github/workflows/quality.yml` will use read-only repository permissions, a frozen install, Node.js 22.13.0 (the tested floor that satisfies Electron 42.4.0 and the installed development-tool graph), and pnpm 9.15.0. The root engine contract is `^22.13.0 || >=24.0.0`, which does not claim unsupported Node.js 23 compatibility. Every third-party Action is pinned to a reviewed full commit SHA, and checkout sets `persist-credentials: false`. A Windows/Ubuntu/macOS matrix runs `ci:check`. A separate Ubuntu coverage job runs `test:coverage` and uploads `coverage/` as a finite-retention Actions artifact. Only the pnpm store is cached; `node_modules` is neither cached nor shared across operating systems.

Alternative considered: replace Linux’s normal test run with coverage to save time. Rejected because keeping the aggregate quality command identical on all three platforms makes the gate and local reproduction clearer. The separate coverage job is intentionally redundant but independent.

### 5. Report whole-source coverage without thresholds

The V8 provider version will exactly match Vitest (`4.1.8`). Coverage includes `src/**/*.{ts,tsx}` and excludes declaration files, with `text`, `json-summary`, `html`, and `lcov` reporters under `coverage/`. The directory is ignored by Git. Phase 0 records the baseline and artifact but defines no numeric threshold.

`@vitest/coverage-v8` is development tooling, not a product runtime dependency. `third-party-manifest.json` therefore keeps its existing runtime `dependencies` collection and adds a separate audited-dev-tooling collection. The validator requires the coverage root when it is declared in `package.json` devDependencies, resolves the installed root, walks only package `dependencies` edges, and compares the exact resolved name/version/license closure with the audited records and repository license files. Peer dependencies, development dependencies of packages, and uninstalled optional peers are outside this production-closure claim. The initial reviewed closure contains 29 packages including the root; it is not described as an audit of every repository devDependency.

Alternative considered: retain the existing `core`/`transports`/`mcp` include subset. Rejected because a percentage that silently excludes Main, Renderer, shared, and J-Link areas would be easy to overstate. A low whole-source baseline is more honest and useful for later reviewed thresholds.

Alternative considered: add the coverage provider to the runtime dependency allowlist. Rejected because it would make a passing gate misrepresent build-only tooling as shipped product runtime. Walking pnpm snapshot edges directly was also rejected because peer-injected snapshot edges can introduce a coverage-provider/Vitest cycle and overstate the package closure.

### 6. Keep OpenSpec and GitNexus evidence outside product execution

The change must pass strict OpenSpec validation before implementation and again before phase completion. The currently untracked `.gitnexusrc` with `pdg: true` is an explicit Phase 0 deliverable so a clean checkout inherits the directed-analysis setting. A development guide will record:

- index freshness checks and upstream impact before existing-symbol edits;
- mandatory user warning for HIGH/CRITICAL results;
- directed PDG/taint review as supporting evidence, with zero findings explicitly not treated as proof;
- `detect_changes` against `main` before Phase 0 completion;
- fresh lint/build/test/license/coverage evidence requirements.

OpenSpec is not added as a runtime dependency and GitNexus is not called by LinkTerm product code or CI. These are engineering governance tools, not authorization authorities.

## Risks / Trade-offs

- **Static registration scanning is deliberately coupled to source form** → Keep the parser narrow, emit file/name diagnostics, and treat a registration-form change as a required inventory review rather than silently accepting it.
- **Three-platform CI may expose native dependency or lockfile gaps** → Use frozen per-platform installs, no shared `node_modules`, the existing doctor on the Linux path, and fix only reproducibility defects without weakening the matrix.
- **Pinned Action commits require deliberate maintenance** → Record the release tag beside each full SHA and update it only through reviewed dependency maintenance; do not fall back to mutable major tags.
- **Whole-source coverage may initially look low** → Label it as a baseline, publish all configured reporters, and do not add or imply a threshold in Phase 0.
- **Characterization can preserve surprising behavior** → Name tests as current-contract characterizations and defer behavioral redesign to the phase that owns the user-facing change.
- **Risk labels could be mistaken for authorization** → Keep the inventory under documentation, include an explicit non-authoritative statement, and test only completeness/shape in Phase 0.
- **GitHub-hosted CI cannot prove every local hardware environment** → Treat it as deterministic core automation; Windows-first manual acceptance remains separate and later hardware phases require explicit evidence.

## Migration Plan

1. Record the four resolved product decisions and complete/validate this OpenSpec change.
2. Add focused characterization tests and prove they pass without editing production source.
3. Add the structured 63-tool inventory and its failing-then-passing completeness validator.
4. Add the exact coverage provider, scripts, reporters, and ignore rule; capture a local baseline.
5. Add the cross-platform quality workflow and governance documentation.
6. Run targeted tests, full tests, lint, build, license validation, coverage, strict OpenSpec validation, review, completion verification, and GitNexus `detect_changes`.
7. Archive the OpenSpec change only after all tasks and evidence are complete and the user accepts Phase 0 completion.

Rollback is limited to removing the Phase 0 tests/data/configuration/development dependency/workflow/documentation changes. No runtime data or hardware state migration exists.

## Open Questions

None. The four product decisions and Phase 0 scope are confirmed. Any new runtime behavior or authorization decision requires a later independent OpenSpec change.
