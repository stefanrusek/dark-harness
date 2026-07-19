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

## Open Questions

1. Does CLAUDE.md §4 item 8 ("ad-hoc only, no named/predefined agent definitions") block a
   persistent, checked-in Workflow *script* outright, or does it only govern named *agent
   personas*? Needs an explicit architect ruling (see "Biggest architectural tension"
   above) — possibly an ADR amendment — before implementation starts.
2. Script execution model: in-process `eval`/dynamic `import()` of a trusted Bun-run file,
   or a subprocess for crash/resource isolation? Does ADR 0003's posture actually settle
   this, or does "everything is allowed" only cover *tool* permissions, not *arbitrary code
   execution inside the harness process* (a materially larger blast radius than a Bash
   tool call, which at least runs as a distinct OS process already)?
3. Tool vs. slash command vs. both: does a Workflow get invoked by the model as a new
   `Tool` (peer of `Agent`), by a human operator via a `/workflow <script>` CLI/TUI command,
   or both from day one? Different audiences (model-driven vs. human-driven) may want
   different discovery/invocation ergonomics.
4. Where do Workflow scripts live on disk — a new `workflows/` convention alongside
   `skillPaths` in `dh.json`, inline in the prompt, or something else? Does this need a
   `dh.json` schema extension (CLAUDE.md §4 item 6 — extend minimally, architect sign-off
   for `src/contracts/` changes)?
5. Is per-`agent()`-call resumability (memoize by content hash, replay unchanged calls)
   worth building against dh's existing `.dh-logs`/JSONL logging shape, or does it need an
   entirely separate cache format? DH-0038's resume machinery reconstructs conversational
   state, not discrete memoized function-call results — these may not share much code.
6. If/when `phase()`/`log()` progress-tree rendering is built, does it need new SSE event
   types in `src/contracts/` (architect-reviewed per CLAUDE.md §6 item 2), or can it reuse
   the existing agent-tree event shape that already powers TUI/Web agent trees for ordinary
   `Agent` spawns?
7. Should `parallel()`'s "failed thunk resolves to null rather than rejecting the whole
   call" semantics be mirrored exactly, or does dh's existing task-failure/error-reporting
   convention (exit-code contract, ADR 0005) suggest a different failure-shape for a dh
   context?

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
