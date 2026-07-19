---
spile: ticket
id: DH-0185
type: feature
status: ready
owner: stefan
resolution:
blocked_by: []
created: 2026-07-18
relations:
  depends_on: [DH-0184]
  relates_to: [DH-0170]
  supersedes: []
implementation:
  - repo: dark-harness
---

# DH-0185: Migrate the TUI SSE client onto the shared src/client-core/ transport

## Summary

Swap src/tui/sse-client.ts onto the shared client-core SSE transport and delete src/tui/sse-parser.ts plus the now-duplicated backoff/reconnect logic. Preserve the TUI's existing onConnectionChange / onEvent / onReconnected / onParseError callback surface and its connecting-vs-reconnecting semantics. Net behavior change: model_switched / resync / agent_thinking events stop being dropped by the removed KNOWN_TYPES allowlist (see DH-0184). Owned by Mary (TUI). Independent of the Web migration sibling.

## User Stories

### As a TODO, I want TODO

- Given TODO, when TODO, then TODO.

## Functional Requirements

- TODO

## Assumptions

## Risks

## Open Questions

## Notes
