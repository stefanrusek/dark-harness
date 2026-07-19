---
spile: ticket
id: DH-0187
type: feature
status: draft
owner: stefan
resolution:
blocked_by: []
created: 2026-07-18
relations:
  depends_on: []
  relates_to: []
  supersedes: []
implementation:
  - repo: dark-harness
---

# DH-0187: --import: import a Claude Code session directory into dh

## Summary

New CLI flag/mode: 'dh --import <directory>' takes a directory containing a Claude Code (claude.ai/code CLI) session and imports it into dh, producing a dh-native session the user can view/resume/continue via the normal dh session machinery (JSONL-per-agent logging, ADR 0004). Raised by the owner mid-session (2026-07-19) with minimal spec so far — needs a scoping pass before implementation starts. Likely Core domain (src/cli.ts, src/config/) since it's a new top-level mode alongside --web/--server/--connect/--job, but may also touch Server (src/server/, session logging format) depending on how deep the import needs to go (transcript-only vs full resumable session state).

## User Stories

### As a TODO, I want TODO

- Given TODO, when TODO, then TODO.

## Functional Requirements

- TODO

## Assumptions

## Risks

## Open Questions

## Notes
