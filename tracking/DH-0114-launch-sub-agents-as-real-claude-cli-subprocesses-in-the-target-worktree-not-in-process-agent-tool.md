---
spile: ticket
id: DH-0114
type: feature
status: closed
owner: stefan
resolution: done
blocked_by: []
created: 2026-07-16
relations:
  depends_on: []
  relates_to: [DH-0113]
  supersedes: []
implementation:
  - repo: dark-harness
---

# DH-0114: Launch sub-agents as real claude CLI subprocesses in the target worktree, not in-process Agent tool

## Summary

Owner idea (2026-07-16, Slack): the current Agent tool dispatches sub-agents in-process against a shared checkout, relying on directory-ownership convention (CLAUDE.md sec 3) rather than hard isolation -- a confused implementer can write outside its assigned scope. Owner's proposed fix: launch Claude as a real shell subprocess (the claude CLI) with its cwd set to the target work tree directory, so the sub-agent's default workspace is genuinely scoped by the filesystem rather than by convention. Needs design: how this composes with existing worktree tooling (git worktree add), how results/logs get collected back, whether this replaces or supplements the in-process Agent tool for implementation-style dispatches specifically (vs read-only/research dispatches where shared-checkout access may still be fine).

## User Stories

### As the coordinator, I want to dispatch an implementation sub-agent into a real, isolated worktree via a subprocess, not the shared in-process Agent tool

- Given a ticket assigned to one domain's directory ownership, when I dispatch its
  implementer, then a real OS process (`claude` CLI) is launched with `cwd` set to a
  dedicated `git worktree` for that ticket, so any file the sub-agent writes is physically
  confined to that worktree regardless of what the sub-agent's prompt says or gets confused
  about — no reliance on directory-ownership convention alone.
- Given that subprocess-dispatched sub-agent finishes, when I check on it, then its final
  report/output is collected back into the coordinator's session the same way an in-process
  `Agent` tool call's result is today (no manual log-tailing required to learn the outcome).
- Given the sub-agent's worktree branch is ready, when the coordinator merges it, then the
  worktree is cleaned up (or left for inspection on failure) following the same discipline
  already used for `Workflow`'s `isolation: "worktree"` mode.

### As any Claude Code user (not just this project's coordinator), I want a reusable "forked sub-agent" skill

- Given this subprocess-dispatch mechanism is genuinely useful beyond Dark Harness's own
  coordinator loop, when it's built, then it ships as a checked-in Claude Code skill (not
  bespoke one-off harness code) — invocable the same way the `spile-ops` and future skills
  are, with its own README/usage doc, so any future session (this project or another) can
  reuse "launch a real forked `claude` subprocess scoped to a directory" without
  re-deriving the mechanism from scratch.
- Given the skill is invoked with a target directory and a prompt, when the subprocess
  completes, then the skill returns the sub-agent's final output in a form the invoking
  session can consume directly (matching the existing `Agent` tool's contract as closely as
  practical, so switching between in-process and forked dispatch is a low-friction choice,
  not a rewrite).

## Functional Requirements

- A script/module that: creates (or reuses) a `git worktree` for a given ticket/branch,
  launches `claude` as a real child process with `cwd` set to that worktree and a supplied
  prompt, waits for completion (or supports background/poll semantics matching how `Agent`
  results are already surfaced), and returns the final output plus exit status.
- Package the above as a Claude Code skill (README + any helper scripts), matching the
  conventions already established by `.claude/skills/spile-ops/` in this repo, so it is
  reusable outside Dark Harness specifically.
- Document in `docs/roster/` or wherever coordinator process conventions live: when to use
  forked-subprocess dispatch (implementation work with real file-write risk) vs. the
  existing in-process `Agent` tool (read-only research, quick lookups) — this is not meant
  to fully replace `Agent`, per the Summary's open question, which this ticket should settle.

## Assumptions

## Risks

## Open Questions

## Notes

> [!NOTE]
> Implemented 2026-07-16. Built `.claude/skills/forked-subagent/` (SKILL.md + `scripts/`),
> matching `spile-ops`'s convention of a top-level `SKILL.md` plus a `scripts/` subdirectory,
> but TypeScript/Bun (run directly via `bun`, no build step) since it spawns `claude` and
> parses JSON rather than doing Python-stdlib text mechanics. Three scripts:
> `scripts/dispatch.ts` (spawn `claude -p --output-format json` in a given `--dir`, parse the
> result envelope, return a JSON object with `success`/`exitCode`/`result`/`sessionId`/
> `costUsd`/`raw`), `scripts/worktree.ts` (`create`/`cleanup` subcommands: create-or-reuse a
> `git worktree`, and clean-up that removes it only when clean *and* merged into its base,
> otherwise leaves it in place for inspection — mirroring `Workflow`'s
> `isolation: "worktree"` behavior), and `scripts/run-in-worktree.ts` (composes the two:
> create worktree -> dispatch -> conditional cleanup, the full User-Story-1 flow in one
> command). Usage guidance (forked-subprocess dispatch for file-write-risk implementation
> work vs. in-process `Agent` for read-only research) added to `PLAYBOOK.md` §6 (the existing
> "per-agent worktrees" coordination-protocol section), not a new `docs/roster/` file — this
> is a cross-cutting process convention, not one persistent agent's memory.
>
> Verified against the real installed `claude --help` (not assumed) that `-p`/`--print` with
> `--output-format json` is the non-interactive contract, and confirmed the actual JSON result
> shape (`is_error`, `result`, `session_id`, `total_cost_usd`, `duration_ms`, ...) via a live
> `claude -p ... --output-format json` run before writing `dispatch.ts`'s parser against it.
>
> Test discipline (CLAUDE.md §9) — real integration tests, no mocked `child_process`/`git`
> (mocking the exact call whose entire job is spawning a process/worktree would test
> nothing):
> - User Story 1, bullet 1 (isolated worktree via subprocess) and bullet 3 (merge-then-cleanup
>   / leave-on-failure discipline): `.claude/skills/forked-subagent/scripts/run-in-worktree.test.ts`
>   — spawns a real `claude` subprocess into a real dedicated worktree, asserts the file it
>   writes exists in the worktree and *not* in the shared repo checkout, asserts the unmerged
>   worktree is left in place on cleanup, then asserts it's removed after a real `git merge`.
>   Also `.claude/skills/forked-subagent/scripts/worktree.test.ts` (7 cases) covering
>   create/reuse/dirty-left-in-place/unmerged-left-in-place/merged-removed/force-remove against
>   real scratch git repos.
> - User Story 1, bullet 2 (result collected back like an in-process `Agent` result):
>   `.claude/skills/forked-subagent/scripts/dispatch.test.ts` — asserts the parsed result shape
>   (`success`, `result` text, `sessionId`) and a real file-write round-trip.
> - User Story 2, both bullets (reusable checked-in skill; invoked with dir + prompt, returns
>   output in an `Agent`-comparable form): proven by the skill's existence at
>   `.claude/skills/forked-subagent/SKILL.md` plus the same `dispatch.test.ts`/
>   `run-in-worktree.test.ts` runs, since the scripts under test are exactly the skill's public
>   interface (`--dir`/`--prompt` in, JSON summary + exit status out).
>
> All three test files pass (`bun test ./.claude/skills/forked-subagent/scripts/*.test.ts`):
> `worktree.test.ts` 7/7, `dispatch.test.ts` 2/2, `run-in-worktree.test.ts` 1/1. Not wired into
> `dh`'s own `bun run test:coverage`/CI gates — this is coordinator/process tooling outside
> `src/`, run on demand. Left at `verifying`, not `closed`, for the owner/coordinator's
> final close-out per the ticket-authoring instructions.
