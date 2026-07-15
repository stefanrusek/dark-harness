# Handoff: Core (agent loop, tools, providers, config, CLI entry)

**Addressed to:** the Core domain lead.
**Owner directories:** `src/agent/`, `src/config/`, `src/cli.ts` (per `CLAUDE.md` §3).
**Status:** OPEN — first round.

---

## Context

Dark Harness (`dh`) is a single Bun binary running an LLM agent with sub-agents. This
handoff covers the part that actually runs the agent: the loop, its tools, model provider
adapters, `dh.json` config loading, and the CLI entry point that composes run modes. Read
`CLAUDE.md` (constitution) and `HANDOFF.md` §2, §4, §5 (full context) before starting —
this document assumes both.

You do not need the Server, TUI, or Web domains to exist to do this work. Build against
`src/contracts/` (already landed — the wire truth) and unit-test with mocks/stubs for
anything cross-domain (e.g. a fake HTTP sink standing in for the server's log/event
consumer).

## Scope

1. **`src/config/`** — load and validate `dh.json` against `DhConfig` (`src/contracts/config.ts`).
   - Default path: `dh.json` in cwd; overridable via a path argument (the CLI wires
     `--config <path>` to this).
   - Resolve `$(VAR)` in any string value against `process.env` at load time.
   - Reject configs missing `options.defaultModel`, an empty `models` array, or a model
     referencing an unknown `provider` name. Validation errors should be clear enough to
     act on (bad config is a harness-error class per ADR 0006 — exit code 2+, not a crash
     with a raw stack trace).

2. **`src/agent/providers/`** — one adapter per `ProviderConfig.type`:
   - `anthropic`: wraps the Anthropic SDK; must accept a custom `baseURL` (this is how the
     `"local"` provider in the sample config works — same adapter, different endpoint).
   - `bedrock`: wraps AWS Bedrock via the standard AWS credential chain (no custom
     credential handling — rely on the SDK's default chain).
   - Both adapters implement one common internal interface (your call on its exact shape —
     it's internal, not part of `src/contracts/`) so the agent loop is provider-agnostic.

3. **`src/agent/tools/`** — implement the fixed tool set from `HANDOFF.md` §4, semantics
   mirroring Claude Code's tools of the same name: `Bash`, `Read`, `Edit`, `Write`, `Agent`,
   `ToolSearch`, `Skill`, `TaskOutput`, `SendMessage`, `Monitor`, `TaskStop`, `McpAuth`.
   - Every async-capable tool takes `run_in_background: boolean`, **default `true`**,
     overridable by `options.runInBackgroundDefault` in `dh.json`.
   - `Agent` spawns are **ad-hoc only** — no named/predefined agent definitions. It takes a
     model name (looked up in `dh.json` `models`, falling back to `options.defaultModel`), a
     prompt, and standard params. Nesting is unbounded.
   - Scope realistically for this round: get `Bash`, `Read`, `Edit`, `Write` fully real and
     tested. `Agent`, `ToolSearch`, `Skill`, `TaskOutput`, `SendMessage`, `Monitor`,
     `TaskStop` need working implementations for a single-process in-memory case (sub-agents
     run as concurrent async tasks within the same server process — no distributed
     execution in this version). `McpAuth` may be a documented stub (OAuth flow) if full
     implementation doesn't fit this round — **say so explicitly** in your status report if
     you stub it.

4. **`src/agent/loop.ts`** (or similar) — the agent loop itself: takes a system prompt (from
   the Prompt domain, but don't block on it — accept any string for now), a model, a
   starting instruction, runs tool-call turns until the model signals completion, and
   emits the events the Server domain will forward as SSE (`ServerSentEvent` in
   `src/contracts/events.ts`) and log lines (`LogLine` in `src/contracts/log.ts`). Emit via
   a simple callback/EventEmitter interface for now — the Server domain wires it to the
   real HTTP/SSE + JSONL sinks. Don't reach into `src/server/`.

5. **`src/cli.ts`** — entry point:
   - Flags: `--web`, `--server`, `--connect <host>`, `--port <n>`, `--instructions <file>`,
     `--job`, `--config <path>`. Mode composition exactly per `HANDOFF.md` §2 / ADR 0001.
   - `--instructions <file>` reads the file (path only, never inline text) and starts the
     root agent on it immediately.
   - `--job`: process exits per the `ExitCode` contract (`src/contracts/exit-codes.ts`) when
     the root agent finishes. The agent loop needs a defined way to self-report
     success/failure that this maps to 0/1; harness errors (bad config, provider auth
     failure, crash) map to 2.
   - This file **composes** the Server/TUI/Web entry points but doesn't implement them —
     import them from their domains. If those domains haven't landed yet when you reach
     this step, stub the imports with a clear `// TODO(server domain)`-style marker and
     note it in your status report; don't block the whole handoff on it.

## Constraints

- Import all wire types from `src/contracts/`. Do not redeclare `DhConfig`, `LogLine`,
  `ServerSentEvent`, `ExitCode`, etc. locally.
- If you find you need a *new* field or type in `src/contracts/`, that's a request to the
  coordinator (Ada), not a local fork — flag it in your status report rather than editing
  `src/contracts/` yourself (CLAUDE.md §6 escalation trigger 2).
- Stay inside `src/agent/`, `src/config/`, `src/cli.ts`. If you think you need to touch
  another domain's directory, that's a cross-domain request, not a direct edit.

## Gates

```
bun run typecheck
bun run lint
bun run test:coverage   # 100% on new/changed code in your directories
```
(`bun run e2e` is out of scope for this handoff — that's the E2E domain, sequenced after.)

## Definition of done (this round)

- `src/config/` loads and validates a `dh.json` matching the sample in ADR 0007, with tests
  covering the happy path and each validation failure.
- `Bash`, `Read`, `Edit`, `Write` tools work and are tested against a real temp filesystem
  (not mocked away entirely — at least one integration-style test per tool).
- The agent loop can run a trivial scripted exchange against a fake/mock provider (a
  minimal in-test stub is fine here; the real mock-provider HTTP server is the E2E domain's
  job) and emits both event and log-line callbacks correctly shaped per `src/contracts/`.
- `src/cli.ts` parses all documented flags and exits with the right code for at least the
  `--job` success/failure/harness-error cases, even if it's calling into stubbed
  Server/TUI/Web entry points.
- Anything not finished this round is listed explicitly in a dated status section appended
  below, not left implicit.

## Status log

_(Append dated entries here as you make progress or hand off further. Do not overwrite
earlier entries — status supersedes, but the history stays.)_

### 2026-07-15 — Grace, first round (resumed from a stopped instance's WIP)

I'm Grace, the Core domain lead, coming online in worktree `worktree-agent-a572554c3ba0257bf`
where a previous, stopped instance of this role had already built most of `src/config/` and
most of `src/agent/` (providers, tools, task registry, loop) uncommitted on disk, plus
`bun.lock`/`package.json` diffs adding `@anthropic-ai/sdk` and
`@aws-sdk/client-bedrock-runtime`. I read all of it before changing anything (status
supersedes; the inherited code is the status, not a prior report). Full detail of what I
inherited/verified/built lives in `docs/roster/grace.md`'s Memory section — this entry is the
handoff-facing summary.

**Fixed in inherited code:**
- Two `exactOptionalPropertyTypes` typecheck errors in `src/agent/runtime.ts` (conditional
  spread instead of passing possibly-`undefined` values into non-`| undefined` optional
  fields).
- `src/agent/runtime.ts` had zero tests (it didn't even show up in the coverage report — bun
  only instruments files a test imports). Added `src/agent/runtime.test.ts`, 18 tests,
  exercising the real `AnthropicProvider` against a local mock Anthropic-compatible HTTP
  server (not a fake `ModelProvider` — `createProvider()` always builds the real adapter from
  config, which is how the sample config's "local provider" pattern is meant to work). Now
  100%/100% funcs/lines.

**Built new:**
- `src/cli.ts` (didn't exist before this round). All documented flags (`--web`, `--server`,
  `--connect <host>`, `--port <n>`, `--instructions <file>`, `--job`, `--config <path>`);
  `composeMode()` implements the exact mode table from HANDOFF.md §2 / ADR 0001 as a pure,
  independently-tested function. `--instructions` runs the root agent directly via
  `AgentRuntime` and `--job` maps its outcome to `ExitCode` (0/1/2+) per ADR 0006 — verified
  with three live subprocess runs (`bun run src/cli.ts` against real local mock servers):
  success → exit 0, self-reported `TASK_FAILED` → exit 1, bad `--config` path → exit 2.
  Server/TUI/Web don't exist in this worktree yet, so every other mode combination calls one
  of five `TODO`-marked stub functions instead of importing those domains directly — all of
  `main()`'s dependencies are injected via a `CliDeps` interface, so swapping the stubs for
  real imports later should be contained. 40 tests, 100%/99.44% funcs/lines (the one
  uncovered line is the `import.meta.main` process-entry guard itself — see "known gaps"
  below).

**Cross-domain finding (read-only check of Server's landed work on
`claude/coordinator-onboarding-kab9ls`, per the coordinator's instruction — never merged
in):**
1. **Fixed:** Radia's `src/server/exit.ts` (`waitForExitCode`) subscribes to a
   `session_ended` `ServerSentEvent` to resolve `--job`'s exit code server-side, but the
   inherited `loop.ts` never emitted one. This is a real integration gap I could close from
   my side of the boundary without needing `src/server/` to exist: `AgentRuntime.runRoot()`
   now emits `session_ended` (with `exitCode` mapped from the root agent's self-report) on
   every normal return path — sub-agents spawned via `spawnAgent()` correctly do not emit
   it, since only the root run represents "the session." Two new tests cover it.
2. **Flagged, not guessed at:** Radia's `src/server/agent-loop.ts` defines an
   `AgentLoopHandle` interface she needs Core's real loop to satisfy (directly, or via a thin
   `src/cli.ts` adapter) once Server actually lands in a shared tree — her handoff explicitly
   asks for this to be routed to Core as a reconciliation item rather than assumed to line
   up. `src/server/` doesn't exist in this worktree, so there's nothing concrete to adapt to
   or typecheck against yet. **Requesting the coordinator route this as an explicit
   reconciliation task** once Core and Server share a tree — likely candidates are (a) make
   `AgentRuntime`/`runAgentLoop`'s shape satisfy `AgentLoopHandle` directly, or (b) a thin
   wrapper in `src/cli.ts` (which already owns the composition of config → runtime →
   exit-code mapping) bridging the two. I have an opinion (probably (b), since `cli.ts`
   already does exactly this kind of composition and `AgentLoopHandle` is Server's own
   internal contract, not `src/contracts/` wire truth) but didn't act on it unilaterally
   since it's Radia's interface and a two-domain decision.

**Known, explained coverage gaps (not silent per CLAUDE.md's workflow rules):**
- `src/agent/tasks.ts`: 94.74% func coverage (18/19) despite 100% lines. I instrumented every
  function in the file with temporary markers and confirmed all real functions fire across
  the full suite — this is almost certainly the same instrumentation artifact Radia already
  independently noted in `docs/handoffs/server.md`'s status log (a class's implicit
  field-initializer constructor showing as an uncounted/uncalled synthetic slot). Not a real
  gap. (Restored the file to its pre-instrumentation state before committing — no diff there.)
- `src/cli.ts`: 99.44% lines (178/179). The uncovered line is the literal
  `await main(process.argv.slice(2));` inside `if (import.meta.main) { ... }`. Confirmed
  empirically (isolated repro, not just assumed) that `import.meta.main` is only `true` for
  the actual process entry module and cannot be forced true for a module under test — the
  same structural boundary as Python's `if __name__ == "__main__":`. Verified this exact path
  manually instead via three live subprocess runs (see above) rather than chasing a unit-test
  workaround that would've meant an artificial file split purely to game the coverage tool.

**Deferred / explicitly out of scope this round** (all inherited from the previous instance,
unchanged by me):
- `McpAuth` tool — documented stub per the handoff's own allowance for this round.
- `src/agent/mcp.ts` (`ToolSearch` backing) — searches *configured* `mcpServers` entries and
  returns synthetic descriptors; does not dial a real MCP server/list its actual tools.
- No real `--connect` client, headless server process, or TUI/web rendering this round — see
  the cross-domain section above for what remains once Server/TUI/Web land in this tree.

**Gates:** `bun run typecheck` clean, `bun run lint` clean, `bun run test:coverage` — 233
tests, 99.85%/99.98% funcs/lines aggregate across `src/agent/`, `src/config/`, `src/cli.ts`,
and `src/contracts/` (both shortfalls explained above, neither a real gap in tested
behavior).
