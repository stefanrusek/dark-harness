---
spile: ticket
id: DH-0204
type: bug
status: ready
owner: stefan
resolution:
blocked_by: []
created: 2026-07-19
relations:
  depends_on: []
  relates_to: [DH-0109]
  supersedes: []
implementation:
  - repo: dark-harness
---

# DH-0204: Markdown: link title attribute leaks into the href

## Summary

Manual testing finding (2026-07-19): [text](url "title") syntax puts the title text into the rendered href attribute instead of using it as a tooltip (or dropping it gracefully). Real parsing/rendering bug in the markdown pipeline. Related to DH-0109's reference-link work. Domain: wherever src/markdown/ is owned (check current ownership post-refactor).

## User Stories

### As a TODO, I want TODO

- Given TODO, when TODO, then TODO.

## Functional Requirements

- TODO

## Assumptions

## Risks

## Open Questions

## Notes
