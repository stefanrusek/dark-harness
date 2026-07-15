---
spile: ticket
id: DH-0054
type: feature
status: closed
owner: stefan
resolution: done
blocked_by: []
created: 2026-07-15
relations:
  depends_on: []
  relates_to: []
  supersedes: []
implementation:
  - repo: dark-harness
---

# DH-0054: No first-class Grep/Glob tools — all search is delegated informally to Bash

## Summary

`ALL_TOOLS` (Bash, Read, Edit, Write, Agent, ToolSearch, Skill, TaskOutput, SendMessage, Monitor,
TaskStop, McpAuth) has no dedicated Grep or Glob tool; search is entirely delegated to shelling out
via Bash, referenced only informally in the `cli-tools` skill's "generic POSIX tools" note. This is
workable but weaker than Claude Code's purpose-built search tools (structured output, no
shell-quoting footguns, consistent across OS) — flagged since dh otherwise explicitly mirrors
Claude Code's tool set, and this may be a deliberate-looking but unstated scope cut rather than a
considered one.

## User Stories

### As an agent, I want structured, fast search tools rather than only ad-hoc `grep`/`find` via Bash

- Given a need to search the repo, when a Grep/Glob-equivalent tool exists, then results come back
  structured (file:line matches, glob-matched paths) without shell-quoting risk, consistent across
  platforms.

## Assumptions

- This may be an intentional scope cut (Bash's `grep`/`find` are "generic POSIX tools" per
  HANDOFF's own Appendix A framing) — worth an owner/architect call on whether it's worth adding,
  not necessarily an oversight.

## Notes

> [!NOTE]
> Source: Competitive-differentiation sweep finding #11 (explicitly flagged by the sweep as
> "if intentional-looking, still worth naming since the task says check even candidate areas that
> might be fine via Bash").
