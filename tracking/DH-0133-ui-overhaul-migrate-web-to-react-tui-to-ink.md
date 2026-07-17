---
spile: ticket
id: DH-0133
type: feature
status: draft
owner: stefan
resolution:
blocked_by: []
created: 2026-07-17
relations:
  depends_on: []
  relates_to: []
  supersedes: []
implementation:
  - repo: dark-harness
---

# DH-0133: UI overhaul: migrate Web to React, TUI to Ink

## Summary

Owner decision 2026-07-17, HIGH PRIORITY: migrate both UIs onto a real rendering framework instead of the current hand-rolled approach (Web: plain DOM manipulation, no vdom, causing real bugs like DH-0117/DH-0127; TUI: raw ANSI string building). Web -> React. TUI -> a React-for-terminal renderer (Ink, unless investigation surfaces a better fit -- needs confirming). Rationale: makes the design crew's (Muriel's) job easier, and makes future UI work (the header/status-row/logo tickets in this same triage batch) easier and better organized once it lands. This is a genuine architecture-level decision affecting both domains simultaneously in a codebase that's been deliberately framework-free to date -- routes through Fable per CLAUDE.md 6 before implementation, not straight to TUI/Web domain leads. Needs a real design pass: feasibility (does Ink actually fit this project's TUI needs -- alt-screen, live-updating agent tree, etc.), migration strategy (big-bang vs incremental, how the SSE-event-to-render-state pipeline changes), scope (does this touch src/contracts/ at all), and an effort estimate. Several other tickets from this triage batch (DH-0122, DH-0124, DH-0125, DH-0126, DH-0127, DH-0129, DH-0130) are intentionally blocked on this landing first since their current-architecture implementation would just be redone afterward -- not worth the throwaway work.

## User Stories

### As a TODO, I want TODO

- Given TODO, when TODO, then TODO.

## Functional Requirements

- TODO

## Assumptions

## Risks

## Open Questions

## Notes
