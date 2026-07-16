---
spile: ticket
id: DH-0051
type: feature
status: draft
owner: stefan
resolution:
blocked_by: ["deferred (2026-07-15): sweep-sourced, no observed need"]
created: 2026-07-15
relations:
  depends_on: []
  relates_to: []
  supersedes: []
implementation:
  - repo: dark-harness
---

# DH-0051: No git-native session artifacts, and no evaluation/replay tooling built on the JSONL logs

## Summary

Sessions/log directories are plain files, not represented as git commits/refs/notes — there's no
"one commit per turn" or session-branch convention tying the harness's own audit trail to the
target repo's git history. Separately, no script anywhere replays a JSONL session log to
reconstruct/re-run/evaluate a past conversation — e.g. regression-testing prompt changes against
recorded transcripts, or diffing two runs' tool-call sequences. The JSONL format (ADR 0005) is
well-specified for logging but has no consumer tooling for offline analysis beyond human reading or
the live TUI/Web view.

## User Stories

### As a maintainer iterating on the system prompt, I want to replay a recorded session against a new prompt to see what changes

- Given a JSONL session log, when a replay tool is run against it, then it reconstructs the
  conversation and can re-run it (or diff tool-call sequences) against a modified harness/prompt.

## Notes

> [!NOTE]
> Source: Competitive-differentiation sweep findings #17 and #18.

> [!NOTE]
> Deferred (owner decision, 2026-07-15) — sweep-sourced, no observed need for either half yet.

> [!NOTE]
> Public GitHub issue created (2026-07-16) to gauge real demand before building this: https://github.com/stefanrusek/dark-harness/issues/4
