---
spile: ticket
id: DH-0126
type: bug
status: draft
owner: stefan
resolution:
blocked_by: ["blocked on DH-0133 (UI overhaul: React/Ink migration) -- current-architecture implementation would be redone afterward"]
created: 2026-07-17
relations:
  depends_on: []
  relates_to: []
  supersedes: []
implementation:
  - repo: dark-harness
---

# DH-0126: URGENT: TUI mouse scroll wheel fills the input textbox with garbage instead of scrolling history

## Summary

Owner-flagged HUGE problem from live manual testing 2026-07-17: using the mouse scroll wheel in the TUI dumps garbage characters into the input textbox instead of scrolling the history/transcript window. The history window fills up fast during real use and currently has no way to scroll it at all. Two things needed: (1) stop scroll-wheel input from being captured/echoed into the text input, (2) implement real scroll support for the transcript/history pane. High-priority usability blocker, TUI domain (Mary).

## User Stories

### As a TODO, I want TODO

- Given TODO, when TODO, then TODO.

## Functional Requirements

- TODO

## Assumptions

## Risks

## Open Questions

## Notes
