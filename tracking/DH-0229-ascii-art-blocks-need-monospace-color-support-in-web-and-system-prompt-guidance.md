---
spile: ticket
id: DH-0229
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

# DH-0229: ASCII art blocks need monospace + color support in web and system prompt guidance

## Summary

ASCII art (balloon, header glyphs, diagrams) rendered with colored HTML spans needs proper styling in web UI. Solution: wrap in <pre style="font-family: monospace; white-space: pre;"> to preserve monospace layout while allowing inline color spans to render. TUI already handles this correctly (no changes needed, just ignore the pre/span tags). System prompt needs guidance clause so agents know to use this pattern for any ASCII art output.

## User Stories

### As a TODO, I want TODO

- Given TODO, when TODO, then TODO.

## Functional Requirements

- TODO

## Assumptions

## Risks

## Open Questions

## Notes
