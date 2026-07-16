## Overview

Phase 6 extends the existing first-success and AI-trust architecture to workspace-backed
J-Link/RTT flows. The design keeps three layers separate:

1. Read-only readiness and draft building.
2. Approval-gated execution through existing workflow/J-Link boundaries.
3. Main-only known-good compensation evidence with display-safe summaries.

The split is deliberate. Readiness can explain missing facts without touching hardware;
approval can bind the exact effect before execution; compensation can remember a verified
known-good deployment without promising rollback.

## Current seams to reuse

- Runtime readiness already exposes generationed display-safe snapshots.
- Serial first success already has Start Center and first-success UI patterns.
- Phase 5 approval already provides Main-only prepared operations, one-time grants, and
  display-safe Approval Sheet projections.
- `run_control_workflow` already models high-level steps such as load profile, preflight,
  connect, flash, verify, reset, serial observe, RTT observe, GDB server, and diagnostics.
- `ControlWorkflowJobManager` already exposes background job progress.
- `IJLinkBackend` remains the only boundary for J-Link probe, CPU, flash, RTT, GDB, and
  diagnostic effects.
- RTT log sessions already provide a terminal-like surface for RTT output.

## Data model

### J-Link/RTT readiness

Phase 6 should extend existing readiness DTOs rather than invent a second readiness system.
New scopes/evidence/action codes should remain bounded and display-safe:

- scopes: `jlink`, `firmware`, `rtt`;
- evidence sources: `jlink-backend`, `probe-detect`, `device-catalog`, `firmware-metadata`,
  `control-profile`, `rtt-config`;
- action codes: refresh, choose profile, edit target, choose firmware, review download plan,
  open existing RTT session, copy diagnostics.

Readiness providers may call only read-only status/detect/catalog/profile/path/hash helpers.
They must not call `probeConnect`, `cpuReset`, `halt`, `run`, `flash*`, `memoryWrite`,
`rttConnect`, `rttRead`, `startGdbServer`, session open, or workspace/profile mutation.

### Download-and-observe draft

The draft should capture the exact source of every important value:

- workspace/profile identity and revision;
- target/interface/speed provenance;
- firmware display name, realpath-derived safe source ref, hash, size, format, base address,
  and verify flag;
- probe binding evidence without exposing physical serial numbers;
- intended execution mode and observation mode (`serial`, `rtt`, or both);
- RTT channel/index/marker/timeout provenance.

The draft is not authorization. It is a reviewable input to a Phase 5 prepared operation.

### CompensationCandidate

`CompensationCandidate` is Main-only evidence that a known-good deployment was verified. It
should bind:

- target binding;
- profile id/revision and relevant defaults;
- firmware source ref/hash/size/format/base address;
- workflow mode and verify evidence;
- creation and expiry/retention metadata;
- safe operation ids/references for audit correlation.

Renderer should receive only `CompensationCandidateSummary` with safe labels, age, target
summary, firmware basename/hash prefix/size, and eligibility/disabled reason. The summary
must not promise rollback; it can only offer a reflash CTA that prepares a new approval if
the binding still matches.

## Execution model

1. User or AI chooses a J-Link/RTT download-and-observe intent.
2. Main builds or refreshes readiness and a display-safe plan.
3. Initial CTA prepares the operation and requests human approval. No backend effect runs.
4. Approval Sheet displays exact safe consequences and plan steps.
5. Approved continuation uses the original execution surface and consumes the grant once.
6. Existing workflow/job code performs connect/flash/verify/observe through `IJLinkBackend`
   and managers.
7. Activity Center displays operation/job progress and specialized diagnostics.
8. Only verified success updates the Main-only known-good candidate.
9. Candidate summaries may unlock a reflash CTA if the current source/hash/target binding
   still matches; the reflash CTA is itself a new prepared approval.

## Failure and recovery design

Failure states must be specific and recoverable:

- no backend: explain that J-Link backend is unavailable; no fallback to external tools;
- no probe: refresh/probe guidance; no auto-select;
- target unsupported or mismatched: edit target/profile; catalog evidence if available;
- firmware path missing/outside workspace/oversized/unparseable: choose or fix firmware;
- flash failed: show failed step and safe next actions; do not update known-good candidate;
- verify failed: keep previous known-good candidate; do not show new reflash;
- RTT connect/read/search failed: show RTT-specific guidance;
- RTT silent: treat as non-terminal observation state with keep-waiting/diagnose actions, not
  as serial silent wording.

## Safety constraints

- No Phase 6 code may execute SEGGER tools outside `src/jlink/` backend/client/runner layers.
- No Phase 6 code may use VS Code tasks or direct shell commands as a fallback for J-Link,
  flash, RTT, GDB, or probe operations.
- No new high-impact entry point may execute from `confirm=true` or a Renderer click alone.
- `approval:resolve` remains decision-only.
- Wrong principal/kind/surface/mode, changed effect, replay, deny, expiry, quota, malformed
  input, and missing window paths must have effectful backend call count 0.
- Tests and validation use fake backends/spies only unless the user explicitly authorizes a
  real hardware action in a future step.

## Implementation ordering

1. Add OpenSpec/tests for contracts and read-only readiness.
2. Add J-Link/firmware/RTT readiness provider and draft helpers.
3. Add approval preparation coverage for any new guided CTA/reflash path.
4. Add workflow/job visibility and specialized diagnostics.
5. Add Main-only `CompensationCandidate` model and safe projection.
6. Add renderer Start Center / first-success / Activity / Approval UI extensions.
7. Add profile suggestion save-confirmation path.
8. Run focused tests per slice, then full quality gates and GitNexus closeout.
