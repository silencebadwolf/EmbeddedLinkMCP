# Tasks

- [x] 1. Add failing tests for RTT transcript classification, including SEGGER-banner-only and firmware-output cases.
- [x] 2. Add failing MCP coverage for `diagnose_rtt_log_session` on an App-visible RTT session and on a non-RTT session.
- [x] 3. Add failing runbook/tool-set coverage so agents discover and use the diagnostic before flash/reset paths.
- [x] 4. Implement shared RTT transcript diagnostic helper.
- [x] 5. Append one App-visible system hint when an RTT session receives only SEGGER transport banner bytes.
- [x] 6. Register `diagnose_rtt_log_session`, add its schema, and include it in core tool diagnostics.
- [x] 7. Update runbook guidance and OpenSpec delta specs.
- [x] 8. Validate with OpenSpec, targeted tests, lint/build/full test, GitNexus detect_changes, then commit and push.
