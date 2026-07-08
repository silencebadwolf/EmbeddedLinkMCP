## Design

Add an RTT observation branch to the existing control workflow state machine. The branch is selected when the profile has `rtt.enabled=true`, the workflow mode is `flash-observe` or `flash-observe-diagnose`, and the request did not explicitly force `observe.serial=true`.

RTT observation uses the existing `IJLinkBackend` contract:

1. connect the probe from the control profile;
2. flash if requested;
3. start the LinkTerm-managed GDB server, because the production J-Link RTT backend requires an RTT telnet endpoint;
4. call `rttConnect`, select the configured up-channel when available, and optionally drain it;
5. reset the CPU;
6. poll `rttRead` until markers are found or the observe timeout expires.

This stays inside `run_control_workflow` and does not ask agents to invoke low-level RTT tools after a high-level workflow. The existing debug RTT read path remains available for diagnostic capture.

Download-only callers can pass `observe.enabled=false`; the workflow still performs flash, verify, and reset, but skips serial/RTT observation and therefore does not start a managed GDB server. When the workflow does start a managed GDB server for RTT or debug evidence, it stops that server before returning final evidence so repeated workflows do not inherit a stale target owner.

## Non-Goals

- Do not change the persisted control-profile schema.
- Do not introduce serial fallback for RTT profiles.
- Do not redesign continuous RTT log terminal sessions; this change covers bounded workflow observation evidence.
