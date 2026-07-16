---
spile: ticket
id: DH-0077
type: feature
status: ready
owner: stefan
resolution:
blocked_by: []
created: 2026-07-16
relations:
  depends_on: []
  relates_to: [DH-0069]
  supersedes: []
implementation:
  - repo: dark-harness
---

# DH-0077: No EnterWorktree/ExitWorktree-equivalent for isolating a spawned sub-agent's working directory

## Summary

Real Claude Code's Agent tool supports an 'isolation' mode of 'worktree', creating a git worktree so a sub-agent works on an isolated copy of the repo (with EnterWorktree/ExitWorktree as the underlying primitives). dh's Agent tool (src/agent/tools/agent.ts) has no isolation concept -- every sub-agent shares the parent's cwd/working tree. For a coding-agent harness where sub-agents commonly make file edits, worktree isolation would let risky/experimental sub-agent work proceed without stepping on the parent's or siblings' in-progress changes.

## User Stories

### As a dispatching agent, I want to spawn a sub-agent into an isolated git worktree so risky edits don't collide with my own in-progress changes

- Given a spawned sub-agent doing exploratory or destructive work (e.g. a large refactor
  attempt), when the `Agent` tool is called with an isolation option, then that sub-agent
  operates on a separate git worktree/branch, not the parent's live working tree.
- Given the sub-agent finishes, when its worktree has no changes, then it's cleaned up
  automatically; when it has changes, then the path/branch are surfaced back to the
  dispatching agent so it can review/merge them.

## Functional Requirements

- `src/agent/tools/agent.ts`: add an `isolation` parameter (e.g. `"worktree"`), mirroring
  real Claude Code's Agent tool shape.
- Needs underlying primitives: create a worktree (`git worktree add`), track it per
  spawned-agent context, clean up on completion if unchanged, report path/branch if
  changed -- analogous to how EnterWorktree/ExitWorktree work in real Claude Code.
- Interacts with `src/agent/`'s existing agent-spawning/budget logic (maxConcurrentAgents/
  maxAgentDepth) -- worktree creation cost (disk, git overhead) may want its own budget
  consideration.

## Assumptions

- Only meaningful when dh is running against an actual git repository; needs a defined
  fallback (no-op or explicit error) when the target directory isn't a git repo.

## Risks

- Worktree lifecycle management (cleanup on crash, orphaned worktrees left behind after a
  killed sub-agent) is a real operational risk if not handled carefully -- dh already has a
  "known recurring issue" of worktrees going stale/broken (referenced directly in this very
  task's own instructions), so this needs to be designed defensively from the start.
- Concurrency: multiple sub-agents each requesting worktree isolation could create many
  parallel worktrees; needs a sane limit tied into the existing agent-budget mechanism.

## Open Questions

- Should this be opt-in per `Agent` call (a new parameter) or should the harness offer a
  `dh.json`-level default policy (e.g. "always isolate sub-agents past depth N")?
- Does this belong entirely to Core (`src/agent/`) or does it also touch CLI/config
  surfaces enough to need Core+another domain coordination?

## Notes

> [!NOTE]
> Found 2026-07-16 during the systematic tool-schema/behavior comparison against real
> Claude Code prompted by the owner following DH-0069. Relates to DH-0069 in that both
> concern the `Agent` tool's parameter surface, but this is a distinct, separate parameter
> (isolation) from that ticket's `description` finding.

> [!NOTE]
> Concrete real-world motivation (2026-07-16, owner-confirmed): during this very coordinator
> session, several dispatched sub-agents were assigned a stale/broken git worktree and fell
> back to working directly in the shared checkout — at least one caused a real collision
> (a concurrent `git reset` clobbered another agent's in-progress merge). Root cause per the
> DH-0070 cwd investigation: real Claude Code's Bash tool has no persistent cwd at all — every
> call resets to a fixed base directory, so an agent has to re-prefix `cd <intended-dir> &&`
> on every single command to reliably stay scoped to "its" directory. A confused or
> corner-cutting agent that doesn't do this will silently act on the base directory instead —
> exactly the failure mode observed. Worktree isolation (this ticket) would have prevented the
> collision structurally rather than relying on every dispatched agent perfectly discipline
> its own `cd` prefixing.
