---
name: gate-check
description: "Dispatch a strict, checked-in gate-check sub-agent against a finished worktree — it fetches the ticket, runs the real CLAUDE.md §5 gate commands (typecheck/lint/test:coverage/e2e), verifies CLAUDE.md §9 acceptance-criteria → test coverage, reports a pass/fail verdict, and moves the ticket to verifying with a dated Notes entry. Use this instead of running gates inline as the coordinator whenever a ticket's implementation work looks done and needs verification before it can close."
---

# gate-check

A checked-in prompt (`GATE-CHECK-PROMPT.md`), not inline coordinator behavior. Built for
Dark Harness ticket `tracking/DH-0113-*.md`: the coordinator had been running gate commands
itself, inline, all session — informal, easy to skip a step under time pressure, and not
reusable as a distinct auditable artifact. This skill exists so gate-checking is always the
same strict, checked-in procedure, run by a dedicated sub-agent, independent of whichever
coordinator instance is currently active.

This is process tooling for dark-harness's own coordination (like `spile-ops` and
`forked-subagent`) — not part of the `dh` product itself, so it lives under
`.claude/skills/`, not `src/`, and is not wired into `dh`'s own build/typecheck/test gates.

## When to use

Whenever an implementer reports a ticket's work as done and it needs verification before
moving further in the lifecycle (typically `implementing` → `verifying` → `closed`). Do not
run the gate commands yourself inline — dispatch this instead, so the verdict comes from a
dedicated, auditable sub-agent run rather than the coordinator's own (unrecorded,
easy-to-shortcut) judgment.

## How to dispatch it

The prompt template (`GATE-CHECK-PROMPT.md`) takes exactly two inputs: a worktree path and
a ticket ID. Fill in its `{{WORKTREE_PATH}}` and `{{TICKET_ID}}` placeholders, then dispatch
the filled prompt to a sub-agent.

Prefer `forked-subagent` (`.claude/skills/forked-subagent/`) for the dispatch, since a
gate-check run executes real commands (`bun run e2e`, git commits) with side effects, and a
dedicated worktree/subprocess boundary means a confused gate-check run can't spill outside
the ticket's own worktree:

```
# 1. Fill in the template
sed -e "s/{{WORKTREE_PATH}}/\/path\/to\/worktree/g" \
    -e "s/{{TICKET_ID}}/DH-0113/g" \
    .claude/skills/gate-check/GATE-CHECK-PROMPT.md > /tmp/gate-check-DH-0113.md

# 2. Dispatch into the ticket's existing worktree (do not create a new one — gate-check
#    verifies work already committed there, it doesn't need isolation for writing code)
bun .claude/skills/forked-subagent/scripts/dispatch.ts \
  --dir /path/to/worktree \
  --prompt-file /tmp/gate-check-DH-0113.md
```

The in-process `Agent` tool is an acceptable substitute when you specifically want the
sub-agent to see the coordinator's own uncommitted context in a shared checkout (rare for
gate-checking, since the whole point is to verify what's actually committed) — pass the
filled-in prompt text as the agent's prompt in that case instead.

## What it does *not* do

- It does not implement fixes for gate failures — it only reports them. A FAIL verdict is a
  signal to route back to the ticket's implementer, not something this sub-agent resolves.
- It does not decide whether a ticket is ready to close — CLAUDE.md §9 requires per-story
  test evidence, which this sub-agent supplies, but closing is still a separate, explicit
  transition (`spile-ops transition.py <ID> closed --resolution done`) made after the
  verdict is reviewed, not automatically by this sub-agent.
- It does not touch source files or run gate commands anywhere but the given worktree; its
  only file-write side effect is the ticket's own `Notes` entry and status transition.

## Design notes

- Two inputs only (worktree path, ticket ID) — everything else (which commands to run, what
  "pass" means, how to report) is fixed by the checked-in prompt reading CLAUDE.md itself at
  run time, so the gate definition never drifts out of sync with CLAUDE.md §5/§9 the way a
  hardcoded copy in the prompt would.
- The prompt is deliberately strict about not averaging or rounding up a verdict (all four
  gate commands *and* full criteria coverage, or it's a FAIL) — CLAUDE.md §9's whole point is
  that "done" is a claim the test suite proves, not one an agent asserts, so the checker
  itself must not soften that bar.
