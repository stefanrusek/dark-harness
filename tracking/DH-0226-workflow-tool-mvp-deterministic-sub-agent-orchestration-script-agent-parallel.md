---
spile: ticket
id: DH-0226
type: feature
status: verifying
owner: stefan
resolution:
blocked_by: []
created: 2026-07-19
relations:
  depends_on: []
  relates_to: [DH-0213]
  supersedes: []
implementation:
  - repo: dark-harness
---

# DH-0226: Workflow tool MVP: deterministic sub-agent orchestration script (agent() + parallel())

## Summary

First Workflow tool: a new Core Tool (peer of Agent) that dynamic-imports a trusted cwd-relative script and runs it with agent()/parallel() orchestration primitives built on the existing spawnAgent/TaskRegistry. MVP scope per DH-0213 architect ruling + ADR 0009.

## Context

Implementation ticket spun off from the DH-0213 research doc (read it for the full landscape).
The invariant-8 tension is resolved by **ADR 0009** — a Workflow script is trusted control-flow
automation (like `scripts/build.ts`), not a named sub-agent persona, so it is permitted
provided every spawn stays ad hoc through `spawnAgent`. This ticket is the smallest genuinely
useful slice: `agent()` + `parallel()` only, in-process execution, tool-only surface.

**In scope:** a new `Workflow` `Tool`; a script loader (dynamic `import()`); the `agent()` and
`parallel()` primitives built on `ctx.spawnAgent`/`ctx.tasks`. **Explicitly out of scope**
(follow-on, do not build): `pipeline()`, `opts.schema` forced structured output, resumability/
memoization, `phase()`/live progress-tree SSE, a `/workflow` human command surface, any
`dh.json` schema change, subprocess isolation.

## User Stories

### As an agent, I want to run a checked-in orchestration script that fans out sub-agents deterministically

- Given a script file at a `cwd`-relative path whose default export is an async function, when
  the model calls `Workflow` with that `script` path, then the harness dynamic-imports the
  file, invokes its default export with the injected workflow API and the optional `input`, and
  returns the function's resolved return value (coerced to string) as a non-error `ToolResult`.
- Given the script path does not resolve to an importable file, when `Workflow` runs, then it
  returns an `isError: true` result naming the unresolved path (no host-process crash).
- Given the script's default export throws (or rejects), when `Workflow` runs, then the throw
  is caught and returned as an `isError: true` result carrying the error message (no
  host-process crash).
- Given the imported module has no callable default export, when `Workflow` runs, then it
  returns an `isError: true` result saying a default-export function is required.

### As a workflow script, I want an agent() primitive that spawns one ad-hoc sub-agent and returns its output

- Given I call `await wf.agent(prompt)`, when it runs, then it spawns exactly one sub-agent via
  `ctx.spawnAgent({ model: <opts.model ?? options.defaultModel>, prompt, background: false,
  description: <opts.description ?? a default label> })`, awaits it, and resolves to the
  sub-agent's final output string.
- Given the spawned sub-agent finishes with status `failed`, when `agent()` awaits it, then
  `agent()` rejects with an error carrying the sub-agent's error (so a bare `await wf.agent(...)`
  surfaces the failure; `parallel()` maps it to `null` — see below).
- Given `opts.model` names a model not in `dh.json`, when `agent()` runs, then it rejects with a
  clear unknown-model error (same resolution rule as the `Agent` tool).

### As a workflow script, I want a parallel() primitive with barrier fan-out and failure-to-null

- Given `await wf.parallel([t1, t2, t3])` where each `tN` is a `() => Promise<T>` thunk, when it
  runs, then all thunks are started concurrently (every `spawnAgent` issued before any is
  awaited) and the call resolves only after all have settled, preserving input order.
- Given a thunk rejects (including an `agent()` failure, or a synchronous throw from
  `spawnAgent` such as the fan-out budget being exceeded), when `parallel()` settles, then that
  thunk's slot resolves to `null` and the other thunks are unaffected — `parallel()` itself
  never rejects.

## Functional Requirements

Concrete design the implementer builds against. Two new files, one export added to the tool set.

### `src/agent/tools/workflow.ts` (new — Core, Grace)

```ts
export const workflowTool: Tool = Object.freeze<Tool>({
  name: "Workflow",
  description:
    "Run a deterministic orchestration script that coordinates ad-hoc sub-agents with real " +
    "control flow (agent(), parallel()) instead of turn-by-turn model judgment. `script` is a " +
    "path (relative to cwd) to a .ts/.js module whose default export is `async (wf, input) => " +
    "any`.",
  inputSchema: {
    type: "object",
    properties: {
      script: { type: "string", description: "Path to the workflow script, relative to cwd." },
      input: { type: "object", description: "Optional JSON passed as the script's second arg." },
    },
    required: ["script"],
    additionalProperties: false,
  },
  async execute(input, ctx): Promise<ToolResult> { /* see below */ },
});
```

`execute` flow:
1. `validateInput(workflowTool.inputSchema, "Workflow", input)` (reuse existing validator).
2. Resolve `script` against `ctx.cwd` (`path.resolve(ctx.cwd, script)`). Reject a resolve/
   import failure as an `isError` result (catch the `import()` rejection — do not let it escape).
3. `const mod = await import(resolvedPath);` — dynamic `import()`, **not** `new Function`/eval.
   Bun's loader handles `.ts` natively. Require `typeof mod.default === "function"`; otherwise
   `isError` result.
4. Build the injected `WorkflowApi` (below) from `ctx`, then
   `const result = await mod.default(api, input.input ?? {});` inside a try/catch.
5. On success return `{ output: String(result ?? ""), isError: false }` (optionally append any
   `log()` buffer — see WorkflowApi). On throw return `{ output: <message>, isError: true }`.

### `src/agent/workflow/runner.ts` (new — Core, Grace) — the injected API

```ts
export interface WorkflowAgentOpts { model?: string; description?: string }

export interface WorkflowApi {
  /** Spawn one ad-hoc sub-agent, await it, resolve to its output. Rejects if it fails. */
  agent(prompt: string, opts?: WorkflowAgentOpts): Promise<string>;
  /** Barrier fan-out. Each thunk started before any is awaited; a rejected thunk -> null;
   *  never rejects; order preserved. */
  parallel<T>(thunks: Array<() => Promise<T>>): Promise<Array<T | null>>;
  /** MVP: append a line to a buffer surfaced in the tool's textual output. */
  log(message: string): void;
}

export function buildWorkflowApi(ctx: ToolContext): { api: WorkflowApi; drainLog(): string };
```

- `agent(prompt, opts)`:
  - Resolve model: `opts.model ?? ctx.config.options.defaultModel`; validate against
    `ctx.config.models` exactly as `resolveModelName` in `agent.ts` does (reuse/extract that
    logic — do not duplicate the error string divergently). Unknown model -> throw.
  - `const taskId = ctx.spawnAgent({ model, prompt, background: false, description })` where
    `description` defaults to a short label (e.g. `"workflow agent"`) when `opts.description`
    is absent — `spawnAgent`/the tree require a non-empty label.
  - `await ctx.tasks.awaitDone(taskId); const s = ctx.tasks.snapshot(taskId);`
  - `s.status === "failed"` -> throw `new Error(s.error ?? "sub-agent failed")`; else return
    `s.output`.
- `parallel(thunks)`: start every thunk deferring its throw into a rejected promise, then
  `Promise.all` the null-mapped promises so a synchronous `spawnAgent` throw inside a thunk
  becomes that slot's `null` rather than aborting the fan-out:

  ```ts
  const settled = thunks.map((t) =>
    Promise.resolve().then(t).then((v) => v, () => null),
  );
  return Promise.all(settled); // order preserved; never rejects
  ```
  (`Promise.resolve().then(t)` is what turns a *synchronous* throw from `t` — e.g. the fan-out
  budget check in `spawnAgent` — into a rejection that maps to `null`.)
- `log(message)`: push to an in-closure array; `drainLog()` returns it joined by `\n` for
  `execute` to append to the successful output. MVP-simple; no SSE.

### `src/agent/tools/index.ts` (Core)

- Import `workflowTool` and add it to `ALL_TOOLS` (uniform across root and every sub-agent,
  same as `agentTool`). No `composeTools`/config gating — it is always present, like `Agent`.

### Non-goals reaffirmed (guardrails from ADR 0009)

- `agent()` must only ever ad-hoc-spawn `{model, prompt}`; do **not** add a `subagent_type` /
  named-persona / script-registry concept.
- Every spawn goes through `ctx.spawnAgent`, so the existing `maxAgentDepth`/`maxConcurrentAgents`
  fan-out budget (DH-0013) applies unchanged — no privileged path around it.

## Assumptions

- ADR 0009 (invariant 8 governs personas, not control-flow scripts) and ADR 0004 (trusted
  in-process execution posture) are settled; this ticket does not relitigate them.
- The `Workflow` tool lives in Core (`src/agent/`) as a peer of `Agent`, per CLAUDE.md §3.
  No `src/contracts/` change (no wire-schema surface), so no architect gate beyond ADR 0009.

## Risks

- **Faking `opts.schema`.** No provider-level forced tool-choice exists (DH-0213); an
  implementer must **not** smuggle in a prompt-only structured-output "schema" and call it
  supported — it is explicitly deferred. `agent()` returns raw text only in this MVP.
- **`parallel()` sync-throw handling.** The single sharpest correctness edge: a `spawnAgent`
  throw is *synchronous*, so the thunk must be invoked via `Promise.resolve().then(t)` (not
  `t()` directly) for the throw to collapse to `null` instead of aborting the fan-out. Covered
  by a dedicated test (fan-out budget exceeded mid-`parallel()` -> that slot null, others fine).
- **In-process import blast radius.** A script infinite-loop can hang the host (accepted MVP
  risk per ADR 0009, identical to a `Bash` `while true`). Unbounded fan-out is contained by the
  existing budget. A script *throw* must be caught in `execute` and never crash the loop.

## Open Questions

None blocking. Deferred-by-design (follow-on tickets when demanded): `pipeline()`,
`opts.schema` forced structured output, per-`agent()`-call resumability, `phase()`/live
progress-tree SSE, `/workflow` human command surface, a `dh.json` `workflowPaths` config,
subprocess isolation.

## Notes

Spun off from DH-0213 (research) per the 2026-07-19 architect ruling (Fable). See ADR 0009 for
the invariant-8 resolution and DH-0213's "Open Questions — resolved" for the full rationale
behind each scoping decision. Per CLAUDE.md §9, closing this ticket requires each User Story
bullet above to name the specific `bun test src` case that proves it.

### 2026-07-19 — implementation, ready -> verifying

Built exactly the MVP scope: `src/agent/tools/workflow.ts` (new `Workflow` `Tool`, peer of
`Agent`, registered in `ALL_TOOLS`/`src/agent/tools/index.ts`) and
`src/agent/workflow/runner.ts` (`WorkflowApi`/`buildWorkflowApi`: `agent()`, `parallel()`,
`log()`). Both files match the ticket's FR signatures as written; no deviations from the
design were needed — the existing `ctx.spawnAgent`/`ctx.tasks.awaitDone`/`ctx.tasks.snapshot`
primitives lined up exactly as described.

User Story -> proving test map:

- "run a checked-in orchestration script ... dynamic-imports the file, invokes its default
  export ... returns the resolved value" ->
  `src/agent/tools/workflow.test.ts`: "successful script run resolves to the coerced return
  value plus drained log", "input defaults to {} when omitted".
- "script path does not resolve to an importable file -> isError naming the path" ->
  `workflow.test.ts`: "script path that does not resolve to an importable file -> isError,
  names the path".
- "script's default export throws/rejects -> caught, isError, no host-process crash" ->
  `workflow.test.ts`: "script's default export throwing -> caught, isError, carries the error
  message".
- "no callable default export -> isError" -> `workflow.test.ts`: "module with no callable
  default export -> isError, clear message".
- "`agent()` spawns exactly one sub-agent via `ctx.spawnAgent(...)`, awaits it, resolves to
  its output" -> `src/agent/workflow/runner.test.ts`: "spawns exactly one sub-agent via
  ctx.spawnAgent and resolves to its output", "uses opts.model when given, else
  ctx.config.options.defaultModel", "defaults description to a short label...".
- "spawned sub-agent finishes `failed` -> `agent()` rejects" -> `runner.test.ts`: "rejects when
  the spawned sub-agent finishes with status failed".
- "`opts.model` names an unknown model -> rejects with a clear unknown-model error" ->
  `runner.test.ts`: "rejects an unknown model name with a clear error".
- "`parallel()` starts every thunk before any is awaited (barrier), resolves after all settle,
  preserves order" -> `runner.test.ts`: "starts every thunk before any is awaited (barrier
  fan-out), preserving order".
- "a rejecting thunk (including an `agent()` failure or a synchronous throw such as the
  fan-out budget) maps that slot to `null`; `parallel()` itself never rejects" ->
  `runner.test.ts`: "an async rejection maps that slot to null...", "a synchronous throw from a
  thunk (e.g. a fan-out budget check) maps that slot to null...", "a real spawnAgent
  fan-out-budget throw inside a parallel() thunk maps to null; other thunks still complete"
  (this one drives a real `ctx.spawnAgent` synchronous throw mid-fan-out, the ticket's
  sharpest-edge case, per the `Promise.resolve().then(t)` detail in the FR), "an agent()
  failure inside parallel() maps to null via the same rejection path", "parallel() itself
  never rejects even when every thunk fails".
- Realistic multi-agent script, end to end against a scripted/mock provider ->
  `workflow.test.ts`: "end-to-end: a realistic multi-agent script fans out
  agent()+parallel() and a failed worker maps to null without failing the run" (unit tier,
  fixture at `src/agent/workflow/fixtures/multi-agent-script.ts`); real-binary tier:
  `e2e/workflow-tool.test.ts` — "a Workflow tool_use turn dynamic-imports a real script and
  fans out a real sub-agent via wf.agent()", the real compiled `dh --server` binary driven
  over HTTP/SSE against two mock-provider instances (root + the sub-agent's own model),
  confirming the script loader -> `WorkflowApi` -> `spawnAgent` path is real end to end.

Judgment calls / notes for the reviewer:

- `resolveModel()` in `runner.ts` intentionally duplicates (in miniature) `agent.ts`'s
  `resolveModelName` logic and error-string wording rather than importing it, because that
  helper is file-private and shaped around a validated tool `input` object rather than a bare
  `prompt`/`opts` pair. Extracting a shared helper was considered but judged unnecessary
  churn for two ~10-line call sites with intentionally-identical wording — flag if a future
  reviewer wants it factored out.
- Gate status at hand-off: `bun run typecheck`, this ticket's own unit tests (100% line
  coverage on every new file: `workflow.ts`, `runner.ts`, both `*.test.ts`, all four
  `workflow/fixtures/*.ts`), `bunx biome check` on every new/changed file, and the new e2e test
  against the real compiled binary all pass. The repo-wide `bun run test:coverage` and
  `bun run lint` runs currently fail on unrelated files (`src/web/client/app.test.ts`,
  `src/cli/header.test.ts`) — verified via `git stash` that both failures pre-exist / come from
  other agents' concurrent in-flight work on this shared branch, not from anything touched
  here; confirmed no DH-0226 file appears in `coverage/lcov.info`'s uncovered-line output.
  Whoever runs the final repo-wide gate before merge should re-check those two files once the
  concurrent work lands.
