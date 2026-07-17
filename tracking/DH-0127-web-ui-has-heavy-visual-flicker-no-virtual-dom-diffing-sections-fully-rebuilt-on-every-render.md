---
spile: ticket
id: DH-0127
type: feature
status: closed
owner: stefan
resolution: superseded
blocked_by: []
created: 2026-07-17
relations:
  depends_on: []
  relates_to: [DH-0133, DH-0135]
  supersedes: []
implementation:
  - repo: dark-harness
---

# DH-0127: Web UI has heavy visual flicker -- no virtual-DOM diffing, sections fully rebuilt on every render

## Summary

Owner observation from live manual testing 2026-07-17, confirmed by code inspection: the Web client uses plain DOM manipulation (createElement/textContent rebuilds per section) with no React/virtual-DOM diffing, so any section re-rendered on a SSE event or the liveness tick causes a visible repaint/flash even when content is unchanged -- the same underlying pattern that caused DH-0117's composer-focus bug, just without a focus-loss symptom to make it obvious elsewhere. Needs a real diffing/patching pass across the render functions (sidebar, transcript, header, etc.), not a one-off fix like DH-0117's idempotency guard. Web domain (Susan), likely a substantial ticket -- may want a design pass on approach (hand-rolled diffing vs. a lightweight library) given CLAUDE.md's no-framework-dependency history to date.

## User Stories

### As a TODO, I want TODO

- Given TODO, when TODO, then TODO.

## Functional Requirements

- TODO

## Assumptions

## Risks

## Open Questions

## Notes

> [!NOTE]
> Closed by supersession per Fable's DH-0133 design (2026-07-17): this ticket's entire ask
> ("add diffing so unchanged sections don't repaint") *is* the React migration -- its
> acceptance criteria have been folded into DH-0135 (UI overhaul phase 2: Web/React) as one
> of that ticket's own User Stories verbatim, rather than tracked as a separate effort.
