---
spile: ticket
id: DH-0122
type: feature
status: implementing
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

# DH-0122: Every dh run should print an application header (name, logo, version/build, config status)

## Summary

Owner request 2026-07-17: every invocation of dh (TUI, --web, doctor, init, etc.) should print a consistent application header -- name, logo (see the sibling logo ticket), version/build identity, and a summary of dh.json's status: whether it exists, model count, and any settings relevant to an operator trying to connect from another process/machine (bind address, security.token presence, etc.). dh doctor 'looks good but would look better with the app header' per the owner -- this ticket covers doctor too, not just interactive start. Needs a design pass (what exactly the header contains, how it degrades for --json/non-TTY output) before implementation; likely spans Prompt (shared header-building logic) + TUI + Web + Core (doctor/init call sites).

## User Stories

### As a TODO, I want TODO

- Given TODO, when TODO, then TODO.

## Functional Requirements

- TODO

## Assumptions

## Risks

## Open Questions

## Notes
