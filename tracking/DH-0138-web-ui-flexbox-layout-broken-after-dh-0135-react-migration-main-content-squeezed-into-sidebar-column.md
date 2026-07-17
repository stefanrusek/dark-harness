---
spile: ticket
id: DH-0138
type: bug
status: implementing
owner: stefan
resolution:
blocked_by: []
created: 2026-07-17
relations:
  depends_on: []
  relates_to: [DH-0135]
  supersedes: []
implementation:
  - repo: dark-harness
---

# DH-0138: Web UI flexbox layout broken after DH-0135 React migration -- main content squeezed into sidebar column

## Summary

Found live during manual testing 2026-07-17, right after DH-0135 (Web to React migration) landed: the sidebar renders correctly (narrow left column) but the main content area (agent header, transcript) is ALSO squeezed into that same narrow column instead of filling the remaining browser width -- everything right of about x=270px is empty. Likely the new appHeaderSlot mounted above the sidebar/main row broke the flex row that used to make sidebar+main-pane sit side by side with main-pane taking flex:1. Dispatched for investigation and fix, verified visually.

## User Stories

### As a TODO, I want TODO

- Given TODO, when TODO, then TODO.

## Functional Requirements

- TODO

## Assumptions

## Risks

## Open Questions

## Notes
