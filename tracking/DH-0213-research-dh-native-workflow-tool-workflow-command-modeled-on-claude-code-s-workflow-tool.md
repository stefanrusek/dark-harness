---
spile: ticket
id: DH-0213
type: feature
status: draft
owner: stefan
resolution:
blocked_by: []
created: 2026-07-19
relations:
  depends_on: []
  relates_to: []
  supersedes: []
implementation:
  - repo: dark-harness
---

# DH-0213: Research: dh-native Workflow tool + /workflow command, modeled on Claude Code's Workflow tool

## Summary

Exploratory research into whether dh should get a Workflow-equivalent: a tool that runs a deterministic orchestration script (agent()/parallel()/pipeline() primitives) instead of leaving multi-step sub-agent orchestration to model judgment turn-by-turn. See body for findings and open design questions.

This is a **research ticket**, not an implementation plan — no User Stories/acceptance-criteria bullets are written yet because there's no agreed design to test against. It exists to hand a scoped, grounded starting point to whoever (architect or owner) decides whether/how to pursue this.

## What Claude Code's `Workflow` tool does (reference spec, owner-supplied)

A tool that executes a deterministic orchestration script (plain JS) coordinating sub-agent
calls with real control flow instead of leaving orchestration to model judgment turn-by-turn.
Primitives: `agent(prompt, opts)` (spawn one sub-agent, optional `opts.schema` forces
structured output), `parallel(thunks)` (barrier-style fan-out, failed thunks resolve to
`null` rather than rejecting), `pipeline(items, stage1, stage2, ...)` (each item flows
through stages independently, no barrier between stages — bounded by the slowest single
chain, not sum-of-slowest-per-stage), `phase(title)`/`log(message)` (progress hooks for UI),
a top-level `meta` object (name/description/phases) for discovery. Plus: concurrency
capping, a total-agent-count backstop, and resumability (re-run from a prior run's cached
agent-call results when only part of the script changed).

## What dh already has (reusable today)

- **`src/agent/tools/agent.ts`** (`agentTool`) — the existing `Agent` tool. Input:
  `prompt` (required), `model` (optional, defaults to `ctx.config.options.defaultModel`),
  `description` (required label), `run_in_background` (defaults to
  `ctx.runInBackgroundDefault`), `isolation` (`"worktree"` only). No `subagent_type`/named-
  agent concept — every spawn is ad hoc per CLAUDE.md §4 item 8. Validates via
  `validateInput`, resolves the model, calls `ctx.spawnAgent({model, prompt, background,
  description, isolation})` → returns a `taskId`; foreground calls
  `await ctx.tasks.awaitDone(taskId)` then read `ctx.tasks.snapshot(taskId)`.
- **`src/agent/tools/types.type.ts`** — `Tool.execute(input, ctx): Promise<ToolResult>`
  (`{output, isError}`). `ToolContext` exposes `cwd`, `config`, `tasks: TaskRegistry`,
  `sendMessage`, `spawnAgent`, `loadSkill`, `searchDeferredTools`, `activatedTools`, `todos`,
  and `completeWithModel(modelName, request)` — a one-off non-streaming completion call,
  the closest existing primitive to a scripted "ask a model something" call.
- **`src/agent/tools/validate-input.ts`** (DH-0172) — hand-rolled JSON-Schema-subset
  validator with a uniform error format. Usable as-is for a new tool's own input schema, but
  it's not a general-purpose schema engine, so `agent(prompt, {schema})`'s per-call
  structured-output schema would need its own validation path.
- **`src/agent/runtime.ts`** — `AgentRuntime.spawnAgent` (~line 546) checks the fan-out
  budget (`maxAgentDepth`/`maxConcurrentAgents`), resolves model/provider, and delegates to
  `TaskRegistry.start()`, which returns synchronously while the agent loop runs async.
  `TaskRegistry` (`src/agent/tasks.ts`) — `start()`, `awaitDone()`, `snapshot()`,
  `onSettled` — is the real spawn/await/observe backbone already powering
  `Monitor`/`TaskOutput`/`SendMessage`/`TaskStop`. This is directly what `agent()`,
  `parallel()`, and `pipeline()` would sit on top of: `agent()` ≈ `spawnAgent` +
  `awaitDone`; `parallel()` ≈ fan out N `spawnAgent` calls then `Promise.allSettled`-style
  awaiting all `taskId`s (mapping failures to `null` instead of rejecting); `pipeline()` ≈
  per-item chained `spawnAgent` calls with no cross-item barrier. The existing fan-out
  budget checks in `spawnAgent` already give `parallel()`/`pipeline()` concurrency capping
  and a total-agent-count backstop for free.
- **Session/resume** — DH-0038's `--resume`, `.dh-logs/<sessionId>/` JSONL logs, and
  `foldEventsToMessages` (`src/agent/resume.ts:148`) reconstruct message history from
  logged events on resume, including `reconstructSubAgentHistory` for sub-agent history.
  Real and working, but keyed to interactive session/transcript replay — not obviously the
  same shape as "re-run a script from a prior run's cached per-agent-call results," which
  is closer to memoizing individual `agent()`/`parallel()` calls by some content hash than
  to replaying a conversation.

## What's missing / would need new plumbing

- **No sandboxed (or even unsandboxed) script execution environment.** Nothing in dh today
  evaluates arbitrary deterministic script code — every existing "orchestration" is a model
  interpreting a prompt turn by turn. A Workflow tool needs *something* that runs a JS
  script body with `agent`/`parallel`/`pipeline`/`phase`/`log` injected as bindings. Given
  Bun is already the runtime and ADR 0003 already commits dh to a fully trusted execution
  posture ("everything is allowed, always," no approval prompts, air-gapping as the primary
  security boundary — see `docs/adr/0003-security-posture.md`), a real sandbox (e.g. a
  locked-down `vm`/Worker with no filesystem/network access) is probably *not* required by
  dh's own threat model — a plain `new Function(...)`/dynamic-`import()` eval in-process,
  or a Bun subprocess for isolation/crash-containment, would likely be consistent with how
  every other tool in this codebase already runs. This should be an explicit architect call
  rather than assumed, since it's the one piece of genuinely new execution surface.
- **No structured-output/forced-tool-choice support in the provider abstraction.**
  `ProviderCompletionRequest` (`src/agent/providers/types.ts:36`) has
  `model, system, messages, tools, maxTokens?, thinking?, cache?` — no `tool_choice` /
  forced-tool field in either `anthropic-type` or `bedrock-type` providers. `agent(prompt,
  {schema})`'s "force a structured-output tool call" behavior would need to be hand-rolled
  (e.g. injecting a single-tool `tools` array and a system-prompt nudge, then validating
  the result against the caller's schema with the existing `validate-input.ts` machinery)
  rather than reusing a provider-native forced-tool-choice flag, because none exists yet.
- **No persistent/named-workflow-script artifact concept at all.** No file format, no
  loader, no registry, no `/workflow` slash-command dispatch mechanism. Grepping `src/` and
  `docs/` for "Workflow"/"workflow"/"pipeline" (orchestration sense) returns nothing — this
  is genuinely greenfield, not an extension of an existing half-built feature.
- **`parallel()`/`pipeline()` composition helpers** don't exist as reusable functions
  anywhere; they'd be new code built on `TaskRegistry`, not adapted from something present.

## Biggest architectural tension

**CLAUDE.md §4 item 8** states: "Sub-agents are ad-hoc only — no named/predefined agent
definition files; `Agent` takes a model name + prompt; arbitrary nesting depth;
`run_in_background` defaults to `true` everywhere, overridable in config." A Workflow tool
modeled directly on Claude Code's own — a *persistent, checked-in* JS orchestration script
with a `meta` block for discovery — is inherently a named, predefined, reusable
orchestration artifact. That's in direct tension with the "ad-hoc only" invariant as
currently worded. Two ways this could resolve, both requiring an explicit decision rather
than silent drift:

1. Treat a Workflow *script* as categorically different from a Workflow *agent
   definition* — the invariant was written to rule out predefined *personas* (a checked-in
   "senior-reviewer-agent.md" with a baked identity/system-prompt), not deterministic
   *control-flow* scripts that still spawn fully ad-hoc, unnamed sub-agents via the same
   `spawnAgent` primitive. Under this reading, a Workflow script is closer to `scripts/
   build.ts` (checked-in automation) than to a named agent definition, and item 8 doesn't
   actually block it.
2. Treat any checked-in, invokable-by-name orchestration artifact as exactly what item 8
   was written to prevent, in which case adding Workflow requires actually amending the
   invariant (an ADR, per CLAUDE.md §6 item 1) — not something a single ticket can decide
   for itself.

This ambiguity should be flagged to Fable (architect-on-call) before any implementation
ticket is written, per CLAUDE.md §6 items 1 and 3 (invariant-bending, ownership-map
ambiguity — a Workflow tool would presumably live in Core per §3's existing `src/agent/`
line, but its script format/execution model has contracts-adjacent implications for
whether/how the server and TUI need to render its progress).

## Recommended MVP scope (if greenlit)

Smallest genuinely useful slice:

- `agent(prompt, opts)` and `parallel(thunks)` only, built directly on the existing
  `spawnAgent`/`TaskRegistry` primitives (`awaitDone`/`snapshot`/failure-to-null mapping)
  — no `pipeline()` yet, since a pipeline's independent-per-item staging needs more
  scheduling logic than a straight barrier fan-out.
  - `opts.schema` structured-output forcing can be deferred to a follow-on: the MVP's
    `agent()` can just return raw text, matching what `ctx.spawnAgent`/`Agent` tool already
    produce, until the provider layer grows real tool-choice forcing.
- A single in-process script execution path (eval or dynamic import of a checked-in `.js`
  file), no subprocess isolation yet, consistent with ADR 0003's trusted-execution posture.
- No `phase()`/`log()` UI progress tree yet — plain textual output is enough for a first
  cut; a live tree needs SSE-event/contract work (Server + TUI/Web domains) that's a
  reasonable v2.
- No resumability yet — re-running a script from scratch on every invocation is acceptable
  for an MVP; per-`agent()`-call memoization is real follow-on work and should not block
  a first landing.
- No `/workflow` slash-command surface yet if that requires new CLI plumbing beyond what
  exists; a first cut can be exposed purely as a new `Tool` the model calls directly (same
  shape as `Agent` today), with a human-facing command surface following once the tool
  itself is validated.

Clearly follow-on, not MVP: `pipeline()`, `opts.schema` forced structured output,
resumability/caching, `phase`/`log` live-progress UI, concurrency-cap/total-agent-count
tuning beyond what `spawnAgent` already enforces, and the `/workflow` human-invocable
command surface.

## Assumptions

- ADR 0003's "everything is allowed, always" trusted-execution posture is read as already
  answering the sandboxed-vs-trusted script-execution question in favor of trusted
  in-process execution — this is an assumption for architect confirmation, not a locked
  decision made by this ticket.
- A Workflow tool would live under Core (`src/agent/`) per the existing ownership map in
  CLAUDE.md §3, since it's a peer of the `Agent` tool — not a new domain.

## Risks

- Building this without resolving the CLAUDE.md §4 item 8 tension first risks landing
  something that has to be unwound or re-justified after the fact.
- A naive in-process `eval`/`new Function` script runner has no crash containment — a
  script bug (infinite loop, unbounded fan-out) could take down the host agent process
  unless it goes through the same fan-out budget checks `spawnAgent` already enforces
  (which it would, if `agent()`/`parallel()` are thin wrappers over `spawnAgent`/
  `TaskRegistry` as recommended above).
- Provider-level structured-output forcing being absent could tempt an implementer to
  fake `opts.schema` with prompt-only nudging and call it "supported," which would be a
  silent reliability regression versus Claude Code's own tool-forced version — should be
  explicitly deferred, not quietly downgraded.

## Architect ruling (Fable, 2026-07-19)

Decisions on every Open Question below, plus the invariant-8 tension. The concrete MVP is
spun off as **DH-0222** (a `ready` implementation ticket); this ticket stays as the research
record. See also **ADR 0010** (`docs/adr/0010-workflow-scripts-vs-ad-hoc-agents.md`).

**The ad-hoc-only tension is resolved by ADR 0010, not an amendment.** CLAUDE.md §4 invariant
8 governs sub-agent *personas/identities* (predefined agent-definition files with a baked
system prompt / `subagent_type` selected instead of an ad-hoc `{model, prompt}` spawn), not
deterministic orchestration *control flow*. A Workflow script is the same category as
`scripts/build.ts` — checked-in trusted automation — and every sub-agent it spawns still goes
through the identical `spawnAgent({model, prompt, ...})` primitive with no baked identity. So
invariant 8 does **not** block a Workflow script, and its wording needs no change. ADR 0010
records the scope note and its guardrails (ad-hoc spawns only; no selectable sub-agent
personas; same fan-out budget). Reading #1 of "Biggest architectural tension" above is the
adopted one.

## Open Questions — resolved

1. **Invariant 8 — RESOLVED (does not block).** Governs personas, not control-flow scripts.
   Recorded as ADR 0010 (a scope clarification, not an amendment). See ruling above.
2. **Execution model — RESOLVED: in-process dynamic `import()` of a trusted script file, no
   subprocess.** ADR 0004's trusted-execution posture (plus the fact that a Bash tool already
   runs arbitrary trusted code) settles this in favor of in-process execution for the MVP.
   Use dynamic `import()` of a resolved file path — **not** `new Function`/string `eval`:
   dynamic import gives real module semantics and Bun's native TS loader for free, and matches
   how checked-in trusted automation already runs. Crash containment for the MVP comes from
   (a) the existing `spawnAgent` fan-out budget (an unbounded-fan-out script is refused, not
   run to exhaustion) and (b) wrapping the whole script invocation in try/catch so a script
   throw becomes a `Workflow` tool-error result, not a host-process crash. A script that hangs
   the host with an infinite loop is accepted MVP risk — identical to a `Bash` call running
   `while true`, and no worse under this trust posture. Subprocess isolation is a possible
   follow-on, not MVP.
3. **Tool vs. slash command — RESOLVED: tool-only for the MVP.** The MVP ships a single new
   `Workflow` `Tool` (peer of `Agent`) that the model calls directly. No `/workflow` human
   CLI/TUI command yet — that needs new CLI plumbing and a separate audience's ergonomics, and
   should follow once the tool itself is validated. Confirms the "Recommended MVP scope"
   above.
4. **On-disk location — RESOLVED: a path argument resolved against `cwd`, no `dh.json`
   change.** The MVP `Workflow` tool takes a `script` input = a path relative to the agent's
   `cwd`; the recommended (unenforced) convention is a `workflows/` directory. **No `dh.json`
   schema extension** — that keeps the MVP off the `src/contracts/` architect gate (§4 item 6)
   and off any new config surface. A `workflowPaths`-style config key is a possible follow-on
   if discovery ergonomics demand it, decided then.
5. **Resumability — RESOLVED: out of MVP scope.** Re-run the script from scratch each
   invocation. Per-`agent()`-call memoization is real follow-on work; it does not obviously
   share code with DH-0038's conversational-replay resume machinery (as this ticket notes) and
   must not block a first landing.
6. **`phase()`/`log()` progress-tree SSE — RESOLVED: out of MVP scope; when built, prefer
   reusing the existing agent-tree event shape.** The MVP has no live progress tree. `log()`
   in the MVP is a plain-text sink appended to the tool's textual output (or a no-op); `phase()`
   is deferred entirely. If/when a live tree is built (v2), the default is to reuse the
   existing agent-tree event shape rather than mint new `src/contracts/` event types — but that
   is a v2 decision requiring an architect pass per §6 item 2 at the time, not now.
7. **`parallel()` failure-to-null — RESOLVED: mirror Claude Code exactly.** A failed sub-agent
   inside `parallel()` resolves to `null`; the call does not reject. This is *script-level*
   control-flow ergonomics and is a different concern from ADR 0006's process exit-code
   contract, which governs the *`dh` process's* self-reported outcome — a null inside a script
   does not itself set a nonzero process exit code; the script decides what to do with the
   nulls (and may itself throw, which surfaces as a `Workflow` tool error). A synchronous
   throw from `spawnAgent` (fan-out budget exceeded) mid-fan-out must also collapse to that
   thunk's `null`, not abort the whole `parallel()` — see DH-0222's FRs.

## Notes

### 2026-07-19 — initial research pass
Filed by an ad-hoc research agent per owner request. Read `src/agent/tools/agent.ts`,
`src/agent/tools/types.type.ts`, `src/agent/tools/validate-input.ts`, `src/agent/runtime.ts`
(`AgentRuntime.spawnAgent`), `src/agent/tasks.ts` (`TaskRegistry`),
`src/agent/providers/types.ts`, `src/agent/resume.ts` (`foldEventsToMessages`,
`reconstructSubAgentHistory`), and grepped `src/`/`docs/` for "workflow"/"pipeline" (no
existing hits). No implementation was done; this ticket is intentionally left in `draft`
for an architect/owner to pick up, refine into `ready`, and decide the Open Questions above
before any code is written.

### 2026-07-19 — architect ruling + MVP spun off (Fable)
Ruled on all seven Open Questions (see "Open Questions — resolved" above) and the invariant-8
tension. Wrote **ADR 0010** (`docs/adr/0010-workflow-scripts-vs-ad-hoc-agents.md`): invariant 8
governs sub-agent personas, not orchestration control-flow scripts, so a Workflow script is
permitted without amending the invariant (guardrails: ad-hoc spawns only, no selectable
personas, same fan-out budget). Spun off **DH-0222** as the `ready` MVP implementation ticket
(`agent()` + `parallel()` only, in-process dynamic-import execution, tool-only surface,
`cwd`-relative script path, no schema-forcing/pipeline/resumability/progress-UI). This ticket
stays as the research record. Pattern mirrors DH-0219/0220/0221 (research/design doc → scoped
`ready` implementation ticket).
