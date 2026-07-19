---
spile: ticket
id: DH-0183
type: feature
status: ready
owner: stefan
resolution:
blocked_by: []
created: 2026-07-18
relations:
  depends_on: []
  relates_to: [DH-0170]
  supersedes: []
implementation:
  - repo: dark-harness
---

# DH-0183: Establish src/client-core/ and consolidate the zero-coupling shared client primitives (slash-command parser + ConnectionStatus vocabulary)

## Summary

Create a new shared client-implementation directory src/client-core/ (architect-approved ownership decision from DH-0170) and move the two byte-identical, UI-agnostic primitives into it: the slash-command parser (src/tui/commands.ts == src/web/client/slash-commands.ts) and the ConnectionStatus vocabulary (src/tui/connection-status.constant.ts == the union in src/web/client/state.ts). These are shared CLIENT logic/vocabulary, not wire truth, so they do NOT belong in src/contracts/. Foundation for the SSE-transport extraction (sibling sub-ticket).

## User Stories

### As a TODO, I want TODO

- Given TODO, when TODO, then TODO.

## Functional Requirements

- TODO

## Assumptions

## Risks

## Open Questions

## Notes
