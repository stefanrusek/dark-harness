---
spile: ticket
id: DH-0206
type: feature
status: draft
owner: stefan
resolution:
blocked_by: []
created: 2026-07-19
relations:
  depends_on: []
  relates_to: []
  supersedes: []
implementation:
  - repo: dark-harness
---

# DH-0206: Markdown: no inline HTML support -- consider basic <span style=color> as a safe subset

## Summary

Manual testing finding (2026-07-19): <span style="color: red;">text</span> doesn't render at all today. Owner-adjacent suggestion from the testing pass: full inline HTML is out of scope/unsafe, but a narrow allowlisted subset (just <span style="color: ...">) could enable simple inline coloring in both Web and TUI without a full HTML-support surface. Needs a security-conscious scoping pass (allowlist approach, not general HTML passthrough) before implementation -- flag for architect review given this touches untrusted-content rendering.

## User Stories

### As a TODO, I want TODO

- Given TODO, when TODO, then TODO.

## Functional Requirements

- TODO

## Assumptions

## Risks

## Open Questions

## Notes
