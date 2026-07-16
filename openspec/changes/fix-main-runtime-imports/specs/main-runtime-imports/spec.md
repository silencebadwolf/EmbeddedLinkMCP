## ADDED Requirements

### Requirement: Electron Main output has resolvable imports

The Main build SHALL emit Node-resolvable relative ESM specifiers for Main/Core/MCP runtime
imports; renderer-only aliases MUST NOT appear in executable `dist/main/**/*.js`.

#### Scenario: production launch loads the Main graph

- **WHEN** `tsconfig.main.json` is compiled and the Electron entrypoint starts
- **THEN** Node resolves the complete Main dependency graph without `ERR_MODULE_NOT_FOUND`
  caused by an `@/...` alias.

#### Scenario: regression guard

- **WHEN** the Main runtime import integration test scans emitted JavaScript
- **THEN** it fails if any executable Main file contains a runtime `@/` import.

### Requirement: no hardware side effects

The import fix and its verification MUST NOT open serial sessions, write payloads, reset targets,
flash, erase, halt, run, start GDB, or connect RTT.

#### Scenario: build-only verification

- **WHEN** the regression test and production build are run
- **THEN** they inspect emitted files only and leave serial sessions and hardware state untouched.
