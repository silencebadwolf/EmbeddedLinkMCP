## Design

### Root cause

The terminal MCP surface already registers command-send tools, but the durable AI-facing startup contract emphasizes health, profile, and high-level hardware workflows more than terminal command capability. A client or agent that sees a partial wrapper can incorrectly conclude that only transcript reads are available.

### Approach

1. Keep the existing terminal tools as the single source of execution:
   - `list_sessions`
   - `open_session`
   - `get_session_status`
   - `write_to_session`
   - `send_and_wait`
   - `read_from_session`
2. Add a structured `terminalCommandTools` block to `get_app_status`:
   - `available`: true only when all canonical terminal command tools are present in the registered core tool set.
   - `listSessions`, `openSession`, `status`, `write`, `sendAndWait`, `readTranscript`: stable tool names.
   - `commandPath`: short invariant text explaining `SessionManager.write -> WriteQueue -> transport`.
   - `missing`: any missing canonical tools.
3. Update runbook and initialize instructions with explicit “do not say there is no send interface” wording.
4. Verify with unit tests that both human-readable and machine-readable contracts include the canonical send tools.

### Safety

- `get_app_status` remains read-only. It only derives data from registered tool names and existing status builders.
- No transport writes, session creation, UI mutation, J-Link calls beyond existing `probeDetect`, or filesystem writes are introduced.
- The implementation does not add external serial CLI fallback.

### Compatibility

The new status field is additive and does not change existing tool result semantics. Clients that ignore `terminalCommandTools` continue to work.
