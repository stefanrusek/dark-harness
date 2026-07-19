---
spile: ticket
id: DH-0186
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

# DH-0186: Migrate the Web SSE client onto the shared src/client-core/ transport

## Summary

Swap src/web/client/sse.ts onto the shared client-core SSE transport, deleting the duplicated SseStreamParser / nextReconnectDelayMs / reconnect driver while keeping Web's connectEvents()/SseConnection.close() API, bearer-token header, and CRLF tolerance. Web already uses the permissive payload validator, so no behavior change for Web on that axis. Owned by Susan (Web). Independent of the TUI migration sibling.

## User Stories

### As a TODO, I want TODO

- Given TODO, when TODO, then TODO.

## Functional Requirements

- TODO

## Assumptions

## Risks

## Open Questions

## Notes
