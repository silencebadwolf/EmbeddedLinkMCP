## Phase 8 implementation tasks

- [x] 1. Freeze the Phase 8 OpenSpec, plan, retention/export privacy policy, and test matrix.
- [x] 2. Run GitNexus upstream impact for every existing symbol that will be changed before
      touching code; report HIGH/CRITICAL findings first.
- [x] 3. Add shared audit schemas for records, status, export, clear, and bounded diagnostics.
- [x] 4. Add failing core tests for redaction boundary, serial queue, 10 MiB rotation,
      retention, disabled mode, torn-line recovery, complete-line rejection, clear idempotence,
      export privacy, and 10k-event performance.
- [x] 5. Implement Main-owned `AuditStore` with injectable filesystem/clock seams, 0600 POSIX
      permissions, bounded startup read, retention, rotation, export, clear, and health hooks.
- [x] 6. Wire the ledger listener and Main lifecycle without blocking existing operation paths;
      verify shutdown flush and failure isolation.
- [x] 7. Add `activity:status`, `activity:export`, and `activity:clear` through shared IPC,
      Main sender validation, preload schema parsing, and mock preload fixtures.
- [x] 8. Add Activity Center audit status/export/delete controls and EN/ZH/a11y tests. Keep
      full filesystem paths and Main-only objects out of Renderer.
- [x] 9. Run focused tests after each slice, then OpenSpec validation, full tests/coverage,
      lint, build, license validation, production dependency audit, and diff checks.
- [x] 10. Request code/security/accessibility review; fix valid findings with regression tests.
- [x] 11. Run verification-before-completion, directed PDG/taint review (0 findings is not a
       safety proof), `detect_changes` compare against `main`, update this task evidence, and
       stop without claiming A+D completion unless all project-level gates are fresh.

## Evidence (to be filled only after fresh verification)

- OpenSpec validation: `add-durable-audit --strict` PASS; `--all --strict` 43/43 PASS.
- Focused Phase 8 tests: 7 files / 55 tests PASS.
- Full tests/coverage: 188 files / 2,069 tests PASS; 82.49% statements, 73.97% branches,
  85.15% functions, 84.96% lines.
- Lint/build/licenses/audit: all PASS; production audit reports no known vulnerabilities.
- GitNexus impact/detect_changes/PDG-taint: HIGH/CRITICAL pre-edit impacts reported; regular
  analyze refreshed (42,886 nodes / 78,666 edges / 300 flows) and explicit `--pdg` index
  rebuilt; cumulative compare 58 files / 528 symbols / 51 processes / critical; directed
  taint 0 findings with caveat; PDG controls 164/19 bounded results.
- Review findings and fixes: clear confirmation, newest recovery, byte budget, and retention
  pruning fixed with regression coverage.
