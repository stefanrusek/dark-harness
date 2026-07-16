---
spile: ticket
id: DH-0058
type: bug
status: ready
owner: stefan
resolution:
blocked_by: []
created: 2026-07-15
relations:
  depends_on: []
  relates_to: []
  supersedes: []
implementation:
  - repo: dark-harness
---

# DH-0058: TUI e2e tests hang on SSE-reconnect banner, never reach session-ended

## Summary

Full bun run e2e surfaced (via Hedy's DH-0056 e2e round, once tmux was actually installed in this sandbox letting e2e/tui.test.ts run to completion for possibly the first time) two scenarios in e2e/tui.test.ts hanging on a "Reconnected — history may be incomplete" banner and never reaching "session ended". Likely candidate per Hedy: the recently-merged periodic SSE keep-alive (Server round 2, DH heartbeat work) interacting with TUI's reconnect handling. Not caused by the DH-0056 diff itself — pre-existing, just newly visible. Server/TUI cross-domain, needs investigation.

## User Stories

### As a maintainer, I want `bun run e2e` to pass reliably, not hang

- Given the TUI e2e scenarios that trigger an SSE reconnect, when the harness reconnects,
  then the TUI proceeds normally to session-ended rather than hanging indefinitely on the
  reconnect banner.

## Notes

> [!NOTE]
> Source: Hedy (E2E), surfaced 2026-07-15 while validating DH-0056's e2e coverage — the first
> time `bun run e2e`'s full suite ran to completion in this sandbox (tmux was missing before).
> Pre-existing, not caused by DH-0056. Prime suspect: interaction between Server's periodic
> SSE keep-alive (Server round 2 heartbeat work) and TUI's reconnect handling. Needs a joint
> Server/TUI investigation — queued directly, not routed through further owner triage, since
> it's a confirmed gate-affecting regression, not speculative.
