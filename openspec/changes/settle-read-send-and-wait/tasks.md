## Tasks

- [x] Add core and MCP regression tests for settle-read behavior.
- [x] Add `settleMs` configuration and result fields while preserving the
      `timeoutMs` compatibility alias.
- [x] Make marker detection observational only and remove automatic
      `markAiUnresponsive` from `send_and_wait`.
- [x] Keep the returned observation buffer independent from completion marker
      eviction and expose truncation metadata.
- [x] Update MCP description/evidence and agent runbook guidance so callers
      inspect returned output instead of treating marker timeout as a retry
      signal.
- [x] Run focused tests, full CI, OpenSpec validation, and GitNexus scope
      verification.
