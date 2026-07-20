---
spile: ticket
id: DH-0194
type: feature
status: closed
owner: stefan
resolution: done
blocked_by: []
created: 2026-07-19
relations:
  depends_on: []
  relates_to: [DH-0148, DH-0147]
  supersedes: []
implementation:
  - repo: dark-harness
---

# DH-0194: Agent should know when running non-interactively (--job) and adjust behavior accordingly

## Summary

Owner observation (2026-07-19), surfaced while scoping DH-0148's interactive-vs-headless distinction: today the model has no way to know whether it's running in --job (headless, no human present) vs an interactive TUI/Web session with a real operator who can answer clarifying questions. The system prompt should tell the agent explicitly when it's in --job mode and instruct it to adjust behavior accordingly -- e.g. never ask a clarifying question and wait for a reply that will never come, make reasonable autonomous judgment calls instead, and generally behave as an unattended batch process rather than an interactive assistant. Likely a Prompt-domain (Iris) change to src/prompt/system-prompt.ts, informed by whether --job's own invocation state is even threaded down to prompt construction today (needs verification during scoping -- may need new plumbing from src/cli.ts to pass an isJob/interactive flag into the prompt builder).

## User Stories

### As an agent running under `--job`, I want to know no operator is watching, so that I make an autonomous judgment call instead of asking a question and hanging forever waiting for a reply

- Given a root agent (or any sub-agent it spawns) running under a non-interactive `AgentRuntime`
  (`interactive: false`/unset, matching the standalone `--instructions`/`--job` path), when its
  system prompt is assembled, then the prompt contains an explicit "You are running unattended
  (--job mode)" section instructing it never to ask a clarifying question and wait for a reply,
  and to make a reasonable autonomous judgment call instead.
  Proven by: `src/agent/runtime.test.ts` — "DH-0194: a non-interactive runtime (the default,
  matching --job) includes the job-mode section in the system prompt".
- Given `renderJobModeSection()` in isolation, when called, then it returns text naming
  `--job` mode explicitly, instructing the agent never to wait on a reply, and referencing the
  existing `TASK_FAILED` convention as the fallback when no reasonable path forward exists.
  Proven by: `src/prompt/system-prompt.test.ts` — "renderJobModeSection: names --job mode
  explicitly and instructs the agent not to wait on a reply".

### As an operator running an interactive TUI/Web/server session, I want the agent's prompt to say nothing about unattended-batch behavior, so that it still asks me clarifying questions when appropriate

- Given a root agent (or sub-agent) running under an interactive `AgentRuntime`
  (`interactive: true`, the four interactive run modes: `--server`, local TUI, `--connect`,
  `--web`), when its system prompt is assembled, then the job-mode section is absent.
  Proven by: `src/agent/runtime.test.ts` — "DH-0194: an interactive runtime does not include
  the job-mode section in the system prompt".

## Functional Requirements

- The system prompt sent to the model MUST include an explicit, mandatory-tone job-mode
  instruction block whenever the enclosing `AgentRuntime` is non-interactive (`--job`/
  `--instructions` path), matching the tone/format of the existing `REQUIRED_CONTRACT`/
  `DISCIPLINE_PROMPT` sections in `src/prompt/system-prompt.ts`.
- That block MUST instruct the agent to (a) never ask a clarifying question and wait for a
  reply, (b) make the single most reasonable, defensible judgment call instead and state the
  assumption in its final output, and (c) fall back to the existing `TASK_FAILED` convention
  only when no reasonable path forward exists at all.
- The system prompt MUST NOT include that block when the runtime is interactive
  (`interactive: true`).
- Sub-agents inherit the same job-mode signal as the runtime they are spawned under (one
  `AgentRuntime` instance is either entirely job-mode or entirely interactive for its whole
  process lifetime — see `AgentRuntimeOptions.interactive`'s doc comment); no additional
  plumbing is needed per sub-agent.

## Assumptions

- The `interactive: boolean` field already on `AgentRuntimeOptions`/`AgentRuntime` (added for
  Round 5's pause-vs-end turn semantics) is the correct, sufficient signal for this ticket too:
  it is `false` only for the standalone `--instructions`/`--job` path and `true` only for the
  four interactive run modes (`src/cli.ts`'s `AgentRuntimeLoopAdapter` always constructs with
  `interactive: true`). Reusing it (rather than adding a parallel `mode`/`isJob` field) avoids
  a second source of truth for the same operator-presence question.

## Risks

- None identified — this is additive prompt text gated on an existing, already-correct signal;
  no wire-format, contract, or invariant changes.

## Open Questions

(none — resolved during scoping)

## Notes

### 2026-07-19 — scoping + implementation

Scoping finding: `--job`'s invocation state was **already threaded down to prompt
construction** via `AgentRuntimeOptions.interactive` (`src/agent/runtime.ts`), added in an
earlier round for the "pause instead of end on a non-tool-use turn" semantics (see that
field's doc comment). `src/cli.ts`'s `AgentRuntimeLoopAdapter` (used by all four interactive
run modes: `--server`, local TUI, `--connect`, `--web`) always constructs its `AgentRuntime`
with `interactive: true`; the standalone `--instructions`/`--job` path
(`defaultDeps().createRuntime`) never sets it, defaulting to `false`. This is exactly the
"is there a live operator" signal this ticket needs, so **no new plumbing was required** —
scoped down from the ticket's anticipated "needs new isJob/interactive flag threading from
cli.ts" to "reuse the existing field."

Implemented:
- `src/prompt/system-prompt.ts`: new exported `renderJobModeSection()`, matching the
  mandatory-tone/format of `REQUIRED_CONTRACT` — instructs the agent it is running unattended,
  never to ask-and-wait, to state assumptions instead, and to fall back to `TASK_FAILED` only
  when truly stuck.
- `src/agent/runtime.ts`: `AgentRuntime.buildAgentSystemPrompt()` now appends
  `renderJobModeSection()` after the per-agent self-info section whenever `!this.interactive`,
  reusing the existing per-runtime field.
- Tests added in `src/prompt/system-prompt.test.ts` (unit) and `src/agent/runtime.test.ts`
  (integration, asserting on the actual system prompt sent to the mock provider for both a
  non-interactive root and an interactive-runtime sub-agent) — see User Stories above.

All four quality gates (`bun run typecheck`, `bun run lint`, `bun run test:coverage`,
`bun run e2e`) passed locally in this worktree. `test:coverage` shows 100.00% lines for both
changed files (`src/prompt/system-prompt.ts`, `src/agent/runtime.ts`); the repo-wide total
(99.82% lines) is unchanged from the pre-change baseline, confirming no coverage regression
elsewhere.
