---
spile: ticket
id: DH-0184
type: feature
status: ready
owner: stefan
resolution:
blocked_by: []
created: 2026-07-18
relations:
  depends_on: [DH-0183]
  relates_to: [DH-0170]
  supersedes: []
implementation:
  - repo: dark-harness
---

# DH-0184: Extract the shared SSE transport (frame parser + full-jitter backoff + Last-Event-ID reconnect + payload validation) into src/client-core/, resolving the validation-strictness divergence

## Summary

Build one shared SSE-client transport module in src/client-core/ replacing the duplicated logic in src/tui/{sse-parser,sse-client}.ts and src/web/client/sse.ts: incremental SSE field parser, full-jitter exponential backoff (the byte-equivalent 1000/30000 constants), and the Last-Event-ID reconnect driver. ARCHITECT DECISION on the DH-0170 item-1 validation divergence: the canonical payload validator is the PERMISSIVE shape-check (version/id/timestamp/type present and correctly typed), NOT a hardcoded event-type allowlist. The TUI's strict KNOWN_TYPES set is a confirmed latent BUG: it omits model_switched, resync, and agent_thinking (all in the contracts ServerSentEvent union, all handled by the TUI reducer), so those events are silently dropped at the parser before reaching the reducer. Unknown/future event types are tolerated by the reducer's exhaustiveness default, not filtered by the parser. Module ships fully unit-tested but does not itself migrate either client (see the two migration sub-tickets).

## User Stories

### As a TODO, I want TODO

- Given TODO, when TODO, then TODO.

## Functional Requirements

- TODO

## Assumptions

## Risks

## Open Questions

## Notes
