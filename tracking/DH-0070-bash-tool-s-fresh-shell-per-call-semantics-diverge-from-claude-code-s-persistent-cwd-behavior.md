---
spile: ticket
id: DH-0070
type: bug
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

# DH-0070: Bash tool's fresh-shell-per-call semantics diverge from Claude Code's persistent-cwd behavior

## Summary

dh's Bash tool documents each call as a fresh shell invocation with no cd persistence across calls, but real Claude Code's Bash tool persists the working directory across calls within a session (only shell state/env does not persist). This is a behavioral-semantics mismatch from the mirroring requirement in HANDOFF.md, found via a schema/behavior comparison against real Claude Code's Bash tool (the same comparison exercise that produced DH-0069).

## User Stories

### As an agent running a multi-step Bash workflow, I want `cd` to persist across calls the way it does in real Claude Code

- Given a call to Bash with `command: "cd src/agent"`, when a later Bash call in the same
  session runs `pwd` with no `cd`, then it reports `src/agent`, not the original cwd.
- Given a sub-agent whose Bash calls change directory, when a sibling or parent agent later
  runs Bash, then that agent's own cwd tracking is unaffected (persistence is per-agent, not
  global).
- Given the harness restarts or a session resumes (crash recovery, DH-0038), when Bash is
  next called, then cwd tracking degrades gracefully back to the configured default rather
  than erroring.

## Functional Requirements

- `src/agent/tools/bash.ts`: track a per-agent (not global) "current working directory"
  that starts at `ctx.cwd` and updates when a command's net effect is a directory change.
  The real mechanism (per Claude Code's own documented behavior) is: the harness runs each
  command in a wrapper that captures the shell's final cwd after execution (e.g. appending
  a sentinel `pwd` after the user command, or using `Bun.spawn`'s `cwd` option updated from
  the prior call's captured result) and threads that into the next `Bun.spawn` call's `cwd`.
- Only the working directory persists -- env vars, shell functions, and aliases set within
  one call must NOT leak into the next (matches real Claude Code: "the working directory
  persists between commands, but shell state does not").
- Update the Bash tool's description string (and any `src/prompt/` doc referencing it) to
  state the corrected behavior once implemented, and audit for any prompt guidance written
  around the current fresh-shell assumption.
- Existing tests in this area (if any assert fresh-shell/no-persistence today) need updating.

## Assumptions

- Tracking cwd per spawned agent (keyed by `ctx.agentId` or similar), not globally per
  process, matches the multi-agent nature of dh (concurrent sub-agents must not clobber
  each other's cwd).
- This does not require any `src/contracts/` change -- it's purely internal to
  `src/agent/tools/bash.ts` and whatever agent-context object threads cwd through.

## Risks

- Capturing "the shell's final cwd" robustly (surviving `cd` inside subshells, `&&` chains,
  backgrounded commands, command failure mid-chain) requires care; a naive implementation
  could silently report the wrong directory after a failed `cd`.
- Background (`run_in_background: true`) commands complicate this -- a cwd change made by a
  command still running in the background at the time the next Bash call fires is
  ambiguous; needs an explicit design decision (likely: background commands never affect
  the tracked cwd, only foreground ones do, matching intuitive operator expectation).

## Open Questions

- ~~Should cwd persistence be scoped per-agent or per-session?~~ **Resolved: per-agent**,
  inherited from the parent's cwd at spawn time (see owner decision below).
- Does this need a `dh.json` opt-out for harness operators who rely on the current
  fresh-shell isolation as a feature (e.g. sandboxing intent)? Still open — implementer's
  call, default to no opt-out unless a real need surfaces.

## Notes

> [!NOTE]
> Found 2026-07-16 during the systematic tool-schema/behavior comparison against real
> Claude Code requested by the owner following DH-0069 (see that ticket's Notes for the
> original framing: "this feels like a gap. we need a tool gap/comparison analysis").

> [!NOTE]
> Owner decision (2026-07-16): confirmed and queued as written. Clarification on scope: a
> prior round (docs/handoffs/core.md Round 13, "per Fable's adopted recommendation")
> deliberately chose fresh-shell/no-cd-persistence — that was a real recommendation, not
> invented, but it only addressed *whether* `cd` persists at all, never *how it should be
> scoped if it did*. The current single shared `AgentRuntime.cwd` field (one value for the
> whole process, root and every sub-agent alike — confirmed in code: `spawnAgent()` never
> gives a sub-agent its own cwd) is simply how the code happened to be written, not a
> separate deliberate decision. The owner is explicitly overriding Round 13's choice:
> **`cd` should persist, and each agent should have its own cwd, inherited from its parent's
> cwd at the moment it's spawned** — a Bash call's `cd` changes the cwd for the agent that
> issued it (and that agent's future sub-agents, via inheritance-at-spawn), not for its
> parent or siblings. Ready for implementation as specified in Functional Requirements.
