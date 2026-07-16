# MCP Tool Risk Inventory

This Phase 0 inventory is review data and a test fixture. It is not runtime authorization, an Approval Broker, a human grant, or proof that `confirm:true` came from a human.

The four consequence levels are `read-only`, `state-affecting`, `disruptive`, and `destructive-or-unknown`. `surface` is the source directory below `src/mcp/surfaces/`; it is a `ToolSurface`, not the future `OperationEvent.surface` enum.

Current execution policy is `observe-only`: validated AI operations execute automatically and the
inventory is not an approval gate. `futureApprovalPolicy: unassigned` is retained as historical
Phase 0 schema metadata; it does not authorize or block runtime calls. Any legacy `confirm` value
is caller metadata only. High-risk entries such as `memory_write` and `register_write` retain their
consequence classification and remain visible in Activity/Audit.

`CONTROL_PROFILE_RUN_DOWNLOAD` and `CONTROL_PROFILE_START_DOWNLOAD` are Main-process IPC paths, not MCP tools, so they are documented here but excluded from the 63-entry count. Any legacy `confirm` field on those paths is ignored for authorization; execution remains automatic after validation/admission.

The AST validator scans production `.ts` and `.tsx` files under `src`, rejecting source symlinks rather than silently skipping them, and inventories static definitions that use the central `registerTool` convention. Every import whose original or local name is `registerTool` must use a relative `registry.js` specifier that resolves lexically to the unique `src/mcp/registry.ts` source. Registrations must be direct object-literal calls inside a first-level `src/mcp/surfaces/<surface>/` directory. The guard rejects alternate or extensionless provenance, supported-binding and central-entry aliases, named/star/namespace registry re-exports and direct dynamic imports, binding/assignment SDK destructuring, computed access, invalid locations, duplicate or alternate direct SDK bridges, and direct/computed/destructured legacy SDK `.tool` calls. The central file must expose exactly one `registerTool` function; the only direct SDK seam allowed is its single fixed-shape `server.registerTool(def.name, ...)` bridge.

This is a static-definition inventory, not runtime enumeration. It does not prove that every definition remains wired into a running server or semantically recognize arbitrarily obfuscated, computed, or generated registration; those forms are prohibited and require a reviewed change to the evidence model. Exact behavior tests cover the named seven low-level paths, runtime restart, and conditional workflow. A newly introduced acknowledgement guard elsewhere requires manual review, an inventory update, and a new behavior test because the AST scan cannot infer it from schemas or handler text.
