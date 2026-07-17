---
spile: ticket
id: DH-0113
type: feature
status: closed
owner: stefan
resolution: done
blocked_by: []
created: 2026-07-16
relations:
  depends_on: []
  relates_to: []
  supersedes: []
implementation:
  - repo: dark-harness
---

# DH-0113: Coordinator gate checks should be a checked-in sub-agent prompt, not run inline

## Summary

Owner directive (2026-07-16, Slack): stop running gates inline as coordinator. Write a strict, checked-in gate-check prompt file that a dispatched sub-agent runs given a worktree path + ticket number (it fetches the ticket itself, runs the real gate commands, reports pass/fail). This never got built — coordinator has been running gates inline all session. Owner: prioritize at the same level as tests, put at the top of the queue once dispatch unfreezes.

## User Stories

### As the coordinator, I want a checked-in gate-check prompt file, not inline gate-running

- Given a worktree path and a ticket ID, when I dispatch a gate-check sub-agent with those
  two inputs, then it fetches the ticket itself (no coordinator hand-holding needed) and
  runs the real CLAUDE.md §5 gate commands (`bun run typecheck`, `bun run lint`,
  `bun run test:coverage`, `bun run e2e`) from that worktree.
- Given the gate commands and the ticket's User Story acceptance criteria, when the
  sub-agent finishes, then it reports a strict pass/fail verdict per CLAUDE.md §9 — a
  criterion with no located test is a FAIL even if every gate command passed.
- Given a completed gate-check run (pass or fail), when it finishes, then the ticket is
  transitioned to `status: verifying` with a dated `## Notes` entry recording the verdict,
  committed with an explicit pathspec.

## Functional Requirements

- Given the gate-check prompt file, when CLAUDE.md §5/§9 change, then the prompt does not
  need updating in lockstep — it instructs the sub-agent to read those sections live from
  the worktree's own `CLAUDE.md` rather than hardcoding the gate commands or verdict rules.
- Given this is coordinator/process tooling and not part of the `dh` product, when deciding
  where it lives, then it is checked in under `.claude/skills/gate-check/` (alongside
  `spile-ops` and `forked-subagent`), not under `src/`, and is not wired into `dh`'s own
  build/typecheck/test gates.

## Assumptions

## Risks

## Open Questions

## Notes

### 2026-07-16

Built `.claude/skills/gate-check/` (`SKILL.md` + `GATE-CHECK-PROMPT.md`), mirroring the
existing `spile-ops`/`forked-subagent` skill conventions per this ticket's directive — not
under `src/`, not wired into `dh`'s own gates. The prompt takes exactly two inputs
(worktree path, ticket ID); it reads `CLAUDE.md` §5/§9 live at run time rather than
hardcoding the gate commands or verdict rules, runs `bun run typecheck` / `lint` /
`test:coverage` / `e2e`, maps every User Story bullet to a located test file+case, reports
a strict pass/fail verdict (no averaging — any single gate failure or uncovered criterion
is an overall FAIL), then transitions the target ticket to `verifying` with a dated Notes
entry and commits that update with an explicit pathspec. `SKILL.md` documents dispatching
it via `forked-subagent`'s `dispatch.ts` (preferred, for the subprocess/worktree
side-effect boundary) with the in-process `Agent` tool as a fallback.

This ticket is process tooling with no `bun test` suite of its own (same as `spile-ops`
and `forked-subagent`) — verification here is a real dispatched run against a real ticket +
worktree, not a unit test. Not yet dry-run end-to-end against a live ticket; moving to
`verifying` (not `closed`) so that dry run happens before this closes.
