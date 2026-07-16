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

# DH-0070: Bash tool should give each agent its own persistent cwd, inherited from its parent at spawn

## Summary

dh's Bash tool runs every call as a fresh shell at a single, process-wide `cwd` shared by the
root agent and every sub-agent — `cd` never persists across calls, and there's no per-agent
cwd concept at all. Originally filed as a Claude-Code-mirroring mismatch; an empirical test
(see Notes) showed real Claude Code's own Bash tool does NOT actually persist `cd` across
calls either, so this is now a deliberate dh-specific product improvement the owner wants on
its own merits, not a conformance fix: each agent should get its own cwd, inherited from its
parent's cwd at spawn time, and a `cd` within one agent's Bash calls should persist for that
agent (and its future sub-agents) going forward, without affecting siblings or the parent.

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
> Empirical test (2026-07-16, owner-directed): actually tested real Claude Code's own Bash
> tool live — a parent agent ran `pwd`, spawned a child agent that ran `cd /tmp && pwd`, and
> the parent ran `pwd` again after the child finished (unchanged, confirming child cds never
> affect a parent — supports per-agent isolation). Separately, the parent ran `cd /var && pwd`
> in one Bash call, then a fresh `pwd`-only Bash call immediately after (reverted to the
> original directory, NOT `/var`). **Conclusion: real Claude Code's Bash tool does not
> actually persist `cd` across calls even within the same agent's own session** — this
> ticket's original premise ("real Claude Code's Bash tool persists the working directory
> across calls") was incorrect, likely inferred from the tool's description text rather than
> verified behavior. The per-agent-isolation half of this ticket (a child's cd never affects
> its parent) IS confirmed real Claude Code behavior. The cross-call persistence half is a
> **deliberate dh-specific product decision** the owner is making anyway (see below), not a
> Claude-Code-mirroring requirement — HANDOFF.md's mirroring goal doesn't apply to this part.

> [!NOTE]
> Owner decision (2026-07-16): confirmed and queued as written, despite the above finding that
> real Claude Code doesn't actually do this — the owner wants dh's Bash to behave this way on
> its own merits, not because of the mirroring requirement. Clarification on scope: a
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
