---
spile: ticket
id: DH-0144
type: feature
status: draft
owner: stefan
resolution:
blocked_by: []
created: 2026-07-17
relations:
  depends_on: []
  relates_to: [DH-0142, DH-0143]
  supersedes: []
implementation:
  - repo: dark-harness
---

# DH-0144: All recognized skills should be accessible as / commands

## Summary

Owner request 2026-07-17: every skill dh discovers (via skillPaths in dh.json, per src/prompt/'s skill enumeration) should be reachable as a / slash command in both TUI and Web, not just the small set of built-in slash commands that exist today (src/web/client/slash-commands.ts). Likely needs a list-skills tool call / capability the agent loop or UI layer can query at composer-render time, distinct from a UI's own hardcoded slash-command list. If a dedicated list-skills tool is the right shape, that is a separate user story from the UI-wiring work -- keep them as distinct User Stories in this one ticket rather than splitting into more tickets, since they are tightly coupled (the UI wiring has nothing to autocomplete against until the listing mechanism exists). Relates to the autocomplete tickets (DH-0142 TUI, DH-0143 Web) -- skills-as-commands and command-autocomplete are complementary but distinct: autocomplete works for any recognized command including skills once this lands.

## User Stories

### As a TODO, I want TODO

- Given TODO, when TODO, then TODO.

## Functional Requirements

- TODO

## Assumptions

## Risks

## Open Questions

## Notes
