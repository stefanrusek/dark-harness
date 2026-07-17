---
spile: ticket
id: DH-0135
type: feature
status: draft
owner: stefan
resolution:
blocked_by: ["blocked on DH-0133a (Core toolchain) landing first"]
created: 2026-07-17
relations:
  depends_on: []
  relates_to: [DH-0133]
  supersedes: []
implementation:
  - repo: dark-harness
---

# DH-0135: UI overhaul phase 2: migrate Web client to React

## Summary

Per Fable's DH-0133 design (2026-07-17): migrate src/web/client/render.ts's manual DOM manipulation to React components, section by section (composer first -- the proven DH-0117 bug site -- then sidebar, transcript, header, model picker), each migrated section independently gate-able. state.ts and all non-DOM-mounting modules (sse.ts, commands.ts, download.ts, slash-commands.ts, format.ts, markdown-dom.ts) reused as-is, unmodified. Subsumes DH-0127 (Web flicker/no-vdom) and DH-0129 (auto-scroll-only-when-at-bottom, whose trigger point moves to React's effect model) and DH-0130's Web-side render addition (per-agent terminal-status transcript marker; DH-0130's reducer-side logic is unblocked and can be written first within this ticket). Web domain (Susan).

## User Stories

### As a TODO, I want TODO

- Given TODO, when TODO, then TODO.

## Functional Requirements

- TODO

## Assumptions

## Risks

## Open Questions

## Notes
