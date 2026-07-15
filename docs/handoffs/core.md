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
behavior; the `tasks.ts` one was subsequently fixed by the coordinator — same
explicit-empty-constructor fix Radia used — see the merge commit).

---

## Round 2 — OPEN — integration: wire cli.ts to the real Server/TUI/Web

**Addressed to:** Core (Grace, resumed — read `docs/roster/grace.md` first).

All six domains now share one tree (`claude/coordinator-onboarding-kab9ls`): Server
(Radia), TUI (Mary), Web (Susan), Prompt (Iris), CI/Release (Nightingale), Core (you) are
all merged and gate-green individually. `src/cli.ts` still calls five `TODO`-marked stub
functions instead of the real Server/TUI/Web entry points — this round replaces those with
real wiring, per your own request in round 1's status log.

**Scope:**

1. **Build the `AgentLoopHandle` adapter** (Server's `src/server/agent-loop.ts` interface —
   your round-1 status log already flagged this and you leaned toward "(b) a thin wrapper in
   `src/cli.ts`"; that's still the right call, land it there). Concretely, `AgentRuntime`
   (`src/agent/runtime.ts`) doesn't match `AgentLoopHandle` shape-for-shape:
   - `AgentLoopHandle.onEvent(listener): Unsubscribe` / `.onLog(listener): Unsubscribe` are
     multi-subscriber; `AgentRuntimeOptions.onEvent`/`.onLogLine` are single fixed callbacks
     set at construction. The adapter needs to fan a single `AgentRuntime` callback out to a
     `Set` of subscribers (own call on exact mechanics).
   - `AgentLoopHandle.getAgentTree(): AgentTreeNode[]` needs building from
     `AgentRuntime.tasks.list()` (flat `TaskSnapshot[]`) into the nested `AgentTreeNode`
     shape (`agentId`/`parentAgentId`/`model`/`status`/`children`) — you already have
     `parentAgentId` on every `TaskSnapshot`, so this is a straightforward
     group-by-parent, but is it only agent-kind tasks that belong in the tree, or bash-kind
     too? Decide and document — my read of the contract's intent is agent-kind only (the
     tree is about sub-agents, not every background Bash call), but it's your call as the
     domain that knows the tool semantics best.
   - `AgentLoopHandle.sendMessage(agentId, message)` / `.stopAgent(agentId)` map onto
     `AgentRuntime.tasks.sendMessage(id, message)` / `.stop(id)` — check whether "agentId"
     in the `AgentLoopHandle`/wire-truth sense and the task registry's task ids
     (`agent-N`) are the same identifier space; if not, the adapter needs the translation.
2. **Wire the four real run modes in `src/cli.ts`**, replacing `runStubbedMode()`'s five stub
   calls:
   - `--server`: construct a `DhServer` (`src/server/index.ts`) with the adapter as its
     `agentLoop`, `config.security` passed through to `DhServerOptions.security`, and a real
     session log directory.
   - Local console (no `--web`): call `startTui(baseUrl)` (`src/tui/index.ts`) pointed at
     the just-started local server.
   - `--web` (local): call `serveWebUi({ port, targetBaseUrl, token })`
     (`src/web/index.ts` or `src/web/server.ts` — check Susan's actual export path) pointed
     at the just-started local server, and print/return its `url` per HANDOFF.md §2's
     "open/print the URL" requirement.
   - `--connect <host> [--web]`: same TUI/Web calls, but `baseUrl`/`targetBaseUrl` point at
     the remote host instead of a locally-started server (no local `DhServer` in this mode).
3. **`--instructions` + `--job` still needs to work standalone** (no server/client attached)
   for the dark-factory headless case — don't regress the exit-code path you already built
   and verified via live subprocess runs.
4. Keep `CliDeps`/dependency-injection testability — the point of that interface was exactly
   to make this swap-in "contained," per your own round-1 note.

**Constraints:** you're reading from `src/server/`, `src/tui/`, `src/web/` (their public
`index.ts`/`server.ts` exports only — not reaching into their internals), same as any other
cross-domain import. If any of their exports don't fit what you need, that's a request back
to that domain in this handoff's status log, not a workaround.

**Gates:** same four commands as round 1, run against the full merged tree this time
(`bun run typecheck` now runs both TS programs — root + `src/web`, per Susan's split).

**Definition of done:** all four real run modes work (verify at least `--job` end-to-end
against a real local `DhServer` + mock provider, and that `--web`/console modes actually
start without crashing — full PTY/browser-driven verification is still the E2E domain's
job). Anything you can't finish this round, name explicitly in a new dated status entry
below.

---

## Round 3 — OPEN — real cancellation (stopAgent should actually stop something)

**Addressed to:** Core (Grace, resumed — read `docs/roster/grace.md` first).

The owner is about to test `dh` interactively for the first time. Right now `stopAgent` is
a documented no-op for the root agent and only does task-registry bookkeeping (marks
status, calls `controller.abort()`) for sub-agents — it never actually reaches
`runAgentLoop`, so a "stopped" agent keeps running its current turn to completion
regardless. Confirmed by reading the code: `AgentLoopParams` (`src/agent/loop.ts`) has no
`signal` field at all; `AgentRuntime.spawnAgent()` (`runtime.ts` ~line 170) has the
`TaskRunHandle`'s `AbortSignal` sitting right there in scope and never passes it to
`runAgentLoop`; `runRoot()` (~line 211) has no `AbortController` at all — the root agent
isn't tracked in `tasks`, so there's genuinely nothing to abort yet. `src/cli.ts`'s
`stopAgent` (~line 224) documents exactly this gap.

**Scope, minimum viable (cooperative cancellation is fine — a full mid-provider-call abort
is a nice-to-have, not required):**
1. Add `signal?: AbortSignal` to `AgentLoopParams` (`loop.ts`). Check it between turns at
   least (stop starting a new turn once aborted); if it's not much more work, also pass it
   through to the provider call and tool invocations that already accept one (`Bash`
   already does, per `tools/bash.ts`) so an in-flight turn can actually be interrupted, not
   just the *next* one prevented. Your call on how deep to go — document exactly what "stop"
   does and doesn't interrupt, so the TUI/Web status the operator sees isn't misleading.
2. `spawnAgent()`: pass `handle.signal` into its `runAgentLoop({...})` call.
3. `runRoot()`: give `AgentRuntime` its own root-level `AbortController` (instance field),
   pass its `.signal` into `runAgentLoop`, and expose a way to trigger it (e.g.
   `stopRoot(): void`) that `src/cli.ts`'s `AgentLoopHandle` adapter's `stopAgent` calls for
   `ROOT_AGENT_ID` instead of the current no-op.
4. Decide (and document) what an aborted turn reports: presumably `AgentLoopResult.success:
   false` with a clear `finalOutput`/reason, mapped the same way a self-reported task
   failure already is — no new `ExitCode`/contracts change needed unless you find you
   genuinely need one (that'd be a request, not a fork, per usual).

**Gates:** same four commands, plus re-run `bun run e2e` — consider (your call, and this may
mean a request to Hedy/E2E rather than you touching `e2e/`) whether a real stop-a-running-
agent scenario belongs in the e2e suite now that it'd have real behavior to verify.

**Definition of done:** a regression test proves that calling `stop` on a running agent
(root or sub-agent) actually changes its trajectory — it doesn't run to natural completion
as if nothing happened. State exactly what's covered vs. still a known gap (e.g. if you
scope to "stops before the next turn" rather than "interrupts an in-flight model call,"
say so explicitly). Append a dated status entry here and update `docs/roster/grace.md`.

### 2026-07-15 — Grace, Round 2 (integration: wire cli.ts to the real Server/TUI/Web)

Worked in a fresh worktree (`grace-round2`, branched from `origin/claude/coordinator-onboarding-kab9ls`
at commit `4fc7c5b`) per the coordinator's instruction — my round-1 worktree predates all
five other domains landing. Full detail/judgment-call rationale lives in
`docs/roster/grace.md`'s Memory section; this is the handoff-facing summary.

**1. Identifier-space unification (the Round 2 scope's open question, resolved by
construction, not by adding a translation layer).** `AgentRuntime.spawnAgent()` now passes
its own loop-internal `agentId` (`agent-<uuid>`) as `StartTaskParams.id`, so the task
registry's id for every agent-kind task *is* the same string the loop uses for its own SSE
events/log lines — no bidirectional lookup table needed anywhere. `src/agent/tasks.ts`
gained an optional caller-supplied `id` on `start()` (new `DuplicateTaskIdError` guards
against reuse) to make this possible.

**2. `AgentRuntimeOptions.onLogLine` signature change** — now `(agentId, line) => void`
instead of `(line) => void`. Most `LogEvent` variants don't self-describe their agentId
(only `LogHeader` does); Server's `AgentLoopLogListener` needs it to route to the right
per-agent JSONL file, and `AgentRuntime` is the layer that already knows which agentId
every `runAgentLoop()` call belongs to (root vs. a specific sub-agent), so it threads it
through rather than pushing the burden onto `loop.ts` or its caller. `loop.ts`'s own
`onLogLine` type is unchanged.

**3. `AgentRuntime` root-agent additions** — `runRoot()` now also registers a root-level
`sendMessage` sink (mirroring what `spawnAgent()` already did for sub-agents via the task
registry), a new `sendMessageToRoot()` method to use it, a `rootHasStarted` getter, and a
new `getAgentTree(): AgentTreeNode[]` method building the nested tree from the task
registry's flat list plus the root's own tracked state. `AgentTreeNode`/`AgentStatus` are
`src/contracts/` types already, so this needed zero dependency on `src/server/` — it lives
entirely in Core.

**Judgment call — tree scope:** only agent-kind tasks appear in the tree; a
`run_in_background` Bash call was never addressable by agentId in the wire protocol to
begin with (its output surfaces as a tool_result on its *parent's* own stream).

**Real bug found and fixed via a live integration test, not a hypothetical:** my first pass
had `getAgentTree()` return `[]` until `runRoot()` had been called at least once. Server's
own `src/server/commands.ts` validates a `send_message`'s `agentId` against
`getAgentTree()` *before* ever calling `AgentLoopHandle.sendMessage()` — so an empty tree
made the very first message meant to *start* the root agent unreachable through the real
HTTP command handler, 404ing with "unknown agentId: agent-root" before my adapter's lazy-
start logic ever ran. Caught by curling a real running `dh --server` process by hand, not
by a unit test (unit tests all used a hand-built fake `AgentLoopHandle`/`DhServer` combo
that happened not to exercise `commands.ts`'s real validation path for this specific
scenario — worth remembering: fakes can hide exactly this class of contract mismatch, real
processes don't). Fixed by having `getAgentTree()` always include a root node — status
`"waiting"` (an existing `AgentStatus` value, not a new one) before `runRoot()` has ever
run. Added both a unit-level regression test and a real-HTTP integration test
(`send_message to a not-yet-started root reaches the real HTTP command handler and starts
it`, in `src/cli.test.ts`) driving an actual `DhServer` instance over `fetch()` so this
can't silently regress.

**4. `src/cli.ts`: the AgentLoopHandle adapter, landed in cli.ts per my own round-1 lean
("(b) a thin wrapper in src/cli.ts")** — `AgentRuntimeLoopAdapter implements AgentLoopHandle`,
fanning `AgentRuntime`'s single fixed `onEvent`/`onLogLine` callbacks out to `Set`-based
multi-subscriber `onEvent`/`onLog`, delegating `getAgentTree()` straight to the new
`AgentRuntime` method, and translating `sendMessage`/`stopAgent` for the root vs. everything
else:
- `sendMessage(ROOT_AGENT_ID, msg)`: lazily starts the root (`runtime.runRoot(msg)`,
  fire-and-forget — a `.catch()` emits a synthetic `agent_status: failed` event rather than
  crashing the process on an unhandled rejection) on the first call, steers the running loop
  via `sendMessageToRoot()` after that.
- `sendMessage`/`stopAgent` for any other id delegate straight to `runtime.tasks`.
- `stopAgent(ROOT_AGENT_ID)` is a **documented no-op** — `loop.ts` has no cooperative
  cancellation at all yet (pre-existing since round 1, not new this round: `TaskStop`'s
  abort signal only ever interrupted a `run_in_background` Bash call, never a loop mid-turn,
  for sub-agents either). A safe no-op is honest about what's actually supported instead of
  throwing and failing the command handler for an operation the loop genuinely can't
  perform. Flagged as a real future-work gap, not swept under the rug.

**5. Wired the four real run modes**, replacing `runStubbedMode()`'s five stub functions
entirely:
- `--server`: real `DhServer` with the adapter, `config.security` passed through,
  `.dh-logs/<sessionId>/` as the log directory (matches the `.gitignore` entry already
  anticipating this convention), on the requested/default port.
- Local console: same real `DhServer` on an **ephemeral port (0)**, then `startTui(baseUrl)`
  — blocks until the operator quits, then stops the server.
- Local `--web`: same real `DhServer` on an ephemeral port, `serveWebUi({port: 0,
  targetBaseUrl, token})` on its own ephemeral port, prints the URL per HANDOFF.md §2's
  "open/print the URL." Doesn't stop anything afterward (same as `--server` — the process
  just keeps the sockets open).
- `--connect [--web]`: no local `DhServer` at all; `startTui`/`serveWebUi` point straight at
  the remote host/port.

**Judgment call — `--port` scope:** only `--server`'s own listen port and `--connect`'s
remote target port are operator-configurable via `--port`, exactly matching ADR 0001's
"listen port for --server, target port for --connect." Every locally-started service that
exists purely so an in-process TUI/Web client has something to talk to (local mode's own
`DhServer`; either mode's web-UI static server) binds ephemeral (port 0) and prints/returns
the URL instead — HANDOFF.md never documents `--port` as applying to local mode.

**Judgment call — client-side TLS for `--connect`:** ADR 0004 says clients dial `https://`
when the target uses TLS but leaves "auto-detect or a client-side flag" to the fleet. I
reused `security.tls`'s presence on the *connecting side's own* `dh.json` (the same pattern
ADR 0004 already establishes for the bearer token: "clients supply their own token via
their own dh.json") rather than inventing a new flag or a probe-the-server-first mechanism.
Flagged here in case a future round wants true auto-detection instead.

**6. `--instructions` standalone path is unchanged in behavior** (per Round 2's explicit
"don't regress" instruction) — still bypasses `AgentRuntimeLoopAdapter`/`DhServer` entirely,
using the same direct `AgentRuntime` + `ExitCode` mapping from round 1. `--connect
--instructions` remains rejected: the wire protocol's `ClientCommand` union has no "start a
brand-new root agent remotely" command (only `send_message`/`stop_agent`/
`request_agent_tree`/`download_logs` against an *already-running* session), so there's
nothing to route it to yet. The non-`--job` fallthrough (instructions ran, process stays
alive for inspection) now falls through to the real interactive wiring instead of a stub
print — note this is a **fresh** `AgentRuntime`/session, not a continuation of the one that
ran the instruction; unifying those is out of scope this round.

**Cross-domain requests flagged, not guessed at:**
- **TUI has no way to pass an auth token/header.** `startTui(baseUrl, io)`'s public
  signature (checked `src/tui/app.ts`, `http-client.ts`, `sse-client.ts`) has no `headers`/
  `token` parameter, even though `sendCommand`/`runSseClient` both already support a
  `headers` option internally. This means **`security.token`-protected sessions don't work
  with the console TUI at all** (commands/SSE will 401) — Web already handles this correctly
  via `serveWebUi`'s `token` option. Requesting Mary extend `startTui`'s signature with an
  optional token/headers passthrough; I didn't reach into `src/tui/` internals to patch it
  myself per the ownership boundary.
- **`AgentLoopHandle.stopAgent` can't truly interrupt a running loop** (see point 4 above) —
  this is a `src/agent/loop.ts` limitation (no `AbortSignal` support in `runAgentLoop` at
  all), not `src/cli.ts`'s to silently paper over. Worth a future round if true
  mid-turn cancellation matters (currently `TaskStop`/`stopAgent` only ever abort a
  `run_in_background` Bash call, or mark an already-finished task's bookkeeping).

**Verification beyond unit tests (per the DoD's "verify... against a real local DhServer +
mock provider" and "start without crashing"):**
- `src/cli.test.ts` gained a dedicated `AgentRuntimeLoopAdapter + DhServer + waitForExitCode`
  describe block: real `AgentRuntimeLoopAdapter` + real `DhServer` + a real local mock-
  Anthropic HTTP server + real `waitForExitCode` (Server's own export), confirming the full
  chain resolves `ExitCode.Success`/`TaskFailure` correctly from the root agent's
  self-report — plus the real-HTTP regression test from point 3 above.
- Live subprocess smoke tests (not just unit tests) for all four interactive modes plus the
  standalone path, against a real local mock-provider HTTP server:
  - `--server`: real headless server started, responded correctly to `request_agent_tree`
    (`{"ok":true,"tree":[]}` — well, `[{"waiting"...}]` after the fix), served a working SSE
    stream, and a real `download_logs` tar download.
  - Local console (no flags): real ephemeral `DhServer` + real `startTui` — confirmed actual
    alt-screen rendering and an SSE "connecting" → "open" status transition against the real
    server.
  - `--web`: real ephemeral `DhServer` + real `serveWebUi` — confirmed the static page
    serves (200) and `/dh-config.json` correctly reports the internally-started server's
    `baseUrl`.
  - `--instructions --job`: unchanged from round 1, re-verified — exit 0 (success), exit 1
    (`TASK_FAILED`), exit 2 (bad `--config` path).

**Known, explained coverage gap:** `src/cli.ts` is 96.88% funcs (31/32), 100% lines. The one
uncovered function is `defaultDeps()`'s real `startTui` wrapper — invoking it for real would
require an actual PTY (raw-mode stdin, real terminal rendering), the same structural
boundary as the `import.meta.main` gap from round 1. Confirmed via the same function-by-
function `console.error` instrumentation technique as round 1 (temporarily marked every
function in `cli.ts`, ran the suite, diffed which markers never fired — restored the file
before committing, zero diff). Verified manually instead via the live subprocess smoke test
above (local console mode). This is exactly the class of thing CLAUDE.md assigns to the E2E
domain's PTY harness once it lands.

**Gates:** `bun run typecheck` clean (both TS programs — root + `src/web`), `bun run lint`
clean, `bun run test:coverage` — 633 tests passing across the full merged tree, 99.95%/
100% funcs/lines aggregate (the one explained gap above). `bun run e2e` still has nothing to
run — `e2e/` hasn't landed in this tree yet, consistent with round 1's "out of scope, E2E
domain, sequenced after."

### 2026-07-15 — Grace, Round 3 (real cancellation: stopAgent actually stops something)

Worked in a fresh worktree (`grace-round3`, branched from
`origin/claude/coordinator-onboarding-kab9ls` at `f6ad86f`) per the coordinator's
instruction. Scope: `stopAgent` was a real no-op for the root and only task-registry
bookkeeping for sub-agents — the coordinator traced the exact gap (no `signal` field on
`AgentLoopParams`, `spawnAgent()` never passing `handle.signal` through, `runRoot()` having
no `AbortController` at all) before opening this round, so implementation started from a
precise, already-diagnosed starting point rather than needing rediscovery.

**What "stop" now does, exactly (the minimum-viable scope, chosen deliberately — full detail
and the effort trade-off in `docs/roster/grace.md`):**
1. **Between turns** — `AgentLoopParams.signal` (new) is checked at the top of every turn,
   before starting a new one. An already-aborted signal stops before the *first* turn too
   (the provider is never called).
2. **During the provider call itself** — both built-in providers now forward the signal to
   their SDK's own native abort support (`anthropic.ts`: `messages.create(params, {signal})`;
   `bedrock.ts`: `client.send(command, {abortSignal})` — confirmed both actually accept this
   from the installed SDKs' own `.d.ts` files before writing any code, not assumed). An
   in-flight model request genuinely gets interrupted, not just the next one prevented — this
   was flagged in the handoff as "nice to have, not required" but turned out to be
   straightforward given both SDKs already support it, so it's in.
3. **NOT covered**: a tool call already in progress (e.g. a blocking `Bash` call without
   `run_in_background`) runs to completion once started — `ToolContext` has no `signal` field
   this round. Documented explicitly in `loop.ts`'s `AgentLoopParams.signal` doc comment and
   here, not silently left out.

**Wiring:**
- `spawnAgent()`: passes `handle.signal` (the `TaskRunHandle`'s `AbortSignal`, already
  sitting in scope — `TaskRegistry.stop(id)` already called this same controller, it just
  never reached the loop before) straight into `runAgentLoop({..., signal: handle.signal})`.
- `runRoot()`: creates a fresh `AbortController` per call (`this.rootController`, a new
  instance field — root isn't a `TaskRegistry` entry, so it needed its own), passes its
  `.signal` into the loop, and a new `stopRoot(): void` method triggers it. Idempotent/safe
  to call before the root has started or after it's finished (both are no-ops).
- `src/cli.ts`'s `AgentRuntimeLoopAdapter.stopAgent(ROOT_AGENT_ID)` now calls
  `runtime.stopRoot()` instead of the round-2 no-op.

**What an aborted turn reports:** exactly the same shape a self-reported failure already
uses — `AgentLoopResult.success: false`, an `agent_status: "failed"` event, a logged
`failed` event with a reason distinguishing which of the two check points fired
(`STOPPED_BETWEEN_TURNS_REASON` / `STOPPED_DURING_PROVIDER_CALL_REASON`, both exported from
`loop.ts`). Judgment call: did **not** introduce a new `AgentStatus` value for "stopped" —
`TaskStop`'s existing sub-agent bookkeeping already collapses "stopped" into "failed"
(`task.error = "stopped by TaskStop"`), so keeping the loop's own report in that same shape
keeps the two mechanisms consistent instead of adding a status value only one of them uses.
A genuine (non-abort-caused) provider error still propagates normally — the new try/catch
around the provider call only treats it as "stopped" when `params.signal?.aborted` is
actually true, so this isn't a blanket swallow of provider exceptions.

**Verification (both automated and live, not just automated):**
- `loop.test.ts`: already-aborted-before-first-turn, aborted-between-turns (with a partial
  `finalOutput` preserved from the turn that did complete), aborted-during-the-provider-call
  (a provider that only rejects once its signal fires — proves the interruption, not just a
  timeout), a genuine unrelated provider error still propagating, and the signal-omitted path
  unchanged from before.
- `anthropic.test.ts`/`bedrock.test.ts`: unit-level proof the exact `AbortSignal` object
  reaches the SDK call's options, and that omitting a signal doesn't send `{signal:
  undefined}` (own real value, not just a coverage-driven line).
- `runtime.test.ts`: two tests spin up a mock provider endpoint that **never responds** on
  its own — `stopRoot()`/`tasks.stop(subAgentId)` finishing the run at all (rather than the
  test timing out) is the actual proof; if the abort didn't genuinely propagate to the
  outbound fetch, these would hang until bun's default per-test timeout and fail. That
  failure mode is a deliberate part of the test design, not a flake risk — a broken build
  fails loudly and fast rather than passing by accident.
- `cli.test.ts`: same never-responding-server pattern, but through the real
  `AgentRuntimeLoopAdapter` + real `send_message`-then-`stopAgent` sequence.
- **Live subprocess smoke test** (real compiled/dev binary, real HTTP, a real never-
  responding mock provider — not just unit tests): started `dh --server`, POSTed
  `send_message` to `agent-root` (provider hangs forever), confirmed via
  `request_agent_tree` the root was stuck `"running"`, POSTed `stop_agent`, and confirmed the
  tree reported `"failed"` promptly afterward — the actual owner-facing flow this round
  exists for, exercised end-to-end.

**Cross-domain request, not acted on unilaterally:** `e2e/` (Hedy's domain) doesn't have a
stop-a-running-agent scenario yet, and now it'd have real behavior worth verifying at the
real-binary/real-process level (not just my own unit/integration tests). Concrete spec for
whoever picks this up: extend `e2e/support/mock-provider.ts` (or add a one-off inline mock
server the way `server-protocol.test.ts`'s sibling tests already do for other cases) with a
turn that delays or never resolves, `send_message` to start the root, confirm via SSE it's
`agent_spawned` but stuck before `agent_status`, POST `stop_agent`, and assert the SSE stream
reports `agent_status: failed` promptly rather than waiting for the provider to naturally
resolve — mirrors `server-protocol.test.ts`'s existing `send_message to agent-root runs a
full turn, observable live over SSE` test almost exactly, just with a stop in the middle.
Did not add this myself — `e2e/` is Hedy's owned directory, and CLAUDE.md's ownership model
treats this as a request, not something for me to implement directly, even though the
round-3 handoff explicitly left the call to me.

**Gates:** `bun run typecheck` clean, `bun run lint` clean, `bun run test:coverage` — 668
tests passing, 99.95%/100% funcs/lines aggregate (same single explained gap as round 2:
`cli.ts`'s real `startTui` default needs an actual PTY). `bun run e2e` — 18 tests passing,
unchanged by this round's work (no e2e file touched, per the cross-domain request above).

---

## Round 4 — OPEN — fix `rootStatus` getting stuck on a runRoot() crash

**Addressed to:** Core (Grace, resumed — read `docs/roster/grace.md` first).

While independently verifying Round 3's cancellation fix by hand (a real `dh --server` +
real never-responding HTTP server, not the mock provider used in tests), I found a **real,
separate bug** — not related to cancellation itself, which I confirmed works correctly with
a valid `apiKey`. This one triggers on a harness-level crash (I hit it via a `dh.json`
missing `apiKey` against a real Anthropic-shaped endpoint, but any `runAgentLoop` throw
before it resolves would do it):

`AgentRuntime.runRoot()` (`runtime.ts` ~line 227) sets `this.rootStatus = "running"` before
calling `runAgentLoop`, but only updates it again (`"done"`/`"failed"`) on the **normal
resolve path**, after `await runAgentLoop(...)`. If that call *throws* instead of
resolving, `this.rootStatus` is never touched again — it stays `"running"` forever.
`src/cli.ts`'s adapter (`sendMessage`, ~line 208) does catch this and emit a one-time SSE
`agent_status: "failed"` event to whatever's currently listening, but that's a transient
broadcast, not persisted state — a client that connects *after* the crash (or a fresh
`request_agent_tree` poll) reads `getAgentTree()`, which derives from the never-updated
`this.rootStatus`, and sees a permanently `"running"` zombie root agent. Confirmed live:
status stayed `"running"` for 20+ seconds after the crash, no error surfaced anywhere a
`request_agent_tree` poll could see.

This matters a lot right now: the owner is about to test this interactively for the first
time, and a `dh.json` typo (bad `apiKey`, wrong `baseURL`, etc.) is exactly the kind of
thing a first-time user hits. Right now that looks like a silently stuck spinner, not a
clear failure.

Note this is scoped to the *interactive lazy-start* path specifically — the standalone
`--instructions`/`--job` path (`src/cli.ts`'s `main()`) already wraps its own
`runtime.runRoot(...)` call in a try/catch that maps to `ExitCode.HarnessError` correctly;
that path is unaffected.

**Fix:** `runRoot()` itself should update `this.rootStatus` (and probably still emit the
`session_ended` event, since that's also currently skipped on this path) on *any* exit —
normal or thrown — not just the resolve path. A `try/catch` (or `try/finally` with a
success/failure flag) around the `runAgentLoop` call that sets `rootStatus = "failed"` and
fires `session_ended` with `ExitCode.HarnessError`-shaped semantics before rethrowing (so
`cli.ts`'s existing `.catch()` still sees the error and does whatever it already does) is
probably the smallest correct fix — centralize it here rather than pushing the fix into
`cli.ts`, since any other caller of `runRoot()` should get the same correctness for free.

**Gates:** same four commands. **Definition of done:** a regression test proves that when
`runAgentLoop` throws (a fake provider that rejects, or similar), `getAgentTree()` reports
the root as `"failed"` afterward, not stuck `"running"` — polled after the fact, not just
observed via a transient event. Append a dated status entry here and update
`docs/roster/grace.md` when done.

### 2026-07-15 — Grace, Round 4 (fix: rootStatus stuck on a runRoot() crash)

Worked in a fresh worktree (`grace-round4`, branched from
`origin/claude/coordinator-onboarding-kab9ls` at `abe2a78`). The coordinator's own trace was
precise and complete before I started — exact line, exact mechanism, exact suggested fix —
so this was implementation + verification, not diagnosis.

**Fix** (`src/agent/runtime.ts`'s `runRoot()`): wrapped the `await runAgentLoop(...)` call
in a `try/catch`. On catch: `this.rootStatus = "failed"`, fire the same `session_ended`
event shape the normal-completion path already uses (`exitCode: ExitCode.HarnessError`),
then rethrow. Exactly the fix the handoff suggested — centralized in `runtime.ts` rather
than `src/cli.ts`, so every caller of `runRoot()` gets the correctness for free, not just
the interactive adapter path. `src/cli.ts` needed no changes at all: the standalone
`--instructions` path's own try/catch (already mapping to `ExitCode.HarnessError`) and the
adapter's `sendMessage()` `.catch()` (already emitting a transient `agent_status: failed`
event) both still see the rethrown error exactly as before — this fix only makes
`AgentRuntime`'s own persisted state (what `getAgentTree()` reads) consistent, it doesn't
change what any existing caller observes.

**Scope check — is there a second, related gap?** `resolveModel()`/`providerFor()` (called
*before* `rootStatus` is ever set to `"running"`) can also throw `ConfigModelError`, but
that's a different, narrower case: (a) `rootStatus` stays whatever it was before (`"waiting"`
on a fresh runtime), not misleadingly `"running"` — not the same zombie symptom; (b) it's
validated away at config-load time already (`src/config/validate.ts` rejects an unknown
`options.defaultModel`/an unknown provider reference per ADR 0006), and `src/cli.ts` never
calls `runRoot()` with an explicit out-of-config `modelName` — so in practice this path is
unreachable in production usage, only exercised by an artificial test config. Left it as-is;
expanding the `try/catch` to cover it too would be scope beyond what the bug report actually
needs, for a case that doesn't reproduce the reported symptom and isn't reachable from any
real caller.

**Regression tests** (`runtime.test.ts`, `cli.test.ts`) — a mock HTTP server returning a real
401 (matching how a real Anthropic-shaped endpoint responds to a bad `apiKey`, the
coordinator's actual repro, not a synthetic throw):
- `runRoot()` rejects, but `getAgentTree()[0]?.status` reads `"failed"` immediately
  afterward — polled after the throw has already been handled by the caller, not observed
  via any event.
- The crash path fires `session_ended` with `exitCode: ExitCode.HarnessError`.
- Polled 3x with real delays between calls (mirroring an operator's client polling loop, not
  a single check) — never reports `"running"` again.
- The same scenario driven through `AgentRuntimeLoopAdapter.sendMessage()` +
  `.getAgentTree()` (the actual wire-protocol-shaped path the coordinator's manual repro
  went through, not a raw `AgentRuntime` call), also polled 3x with real delays.

**Live verification** (real compiled/dev binary, not just tests) — reproduced the
coordinator's exact manual repro: real `dh --server`, a real mock server returning 401 for
every request (simulating the bad-`apiKey` crash), `send_message` to start root, then polled
`request_agent_tree` four times over ~20 seconds via `curl`. Every poll after the crash
reported `"status":"failed"` — confirmed the fix holds over the same real timescale the
coordinator used to find the bug, not just immediately after.

**Gates:** `bun run typecheck` clean, `bun run lint` clean, `bun run test:coverage` — 672
tests passing, 99.95%/100% funcs/lines aggregate (same single pre-existing explained gap as
rounds 2-3: `cli.ts`'s real `startTui` default needs an actual PTY). `bun run e2e` — 18
tests passing, unchanged (no `e2e/` file touched this round — the bug and its fix are both
fully within `src/agent/`, no new cross-domain wire-protocol behavior to verify there).

---

## Round 5 — OPEN — interactive sessions can only ever have one exchange

**Addressed to:** Core (Grace, resumed — read `docs/roster/grace.md` first).

**Confirmed live by the owner and coordinator, testing on a real machine against a real
local model (LM Studio):** a root agent (and, by the same code path, any sub-agent) can only
ever receive **one** message. After the first exchange completes with no tool call (a normal
conversational turn — e.g. the model asks a clarifying question, or just answers), sending a
*second* message returns `{"ok":true}` from the command handler but **does nothing at all**
— no new turn, no output, status stays `"done"` forever. Reproduced directly: two
`send_message` POSTs to a real running `dh --server`, `request_agent_tree` polled after each
— identical `"done"` tree both times, second message silently vanished.

**Root cause** (confirmed by reading `src/agent/loop.ts`, whose own header comment documents
the design): the loop treats **any** turn where `completion.stopReason !== "tool_use"` as
terminal — self-reported success/failure via the `TASK_FAILED` text-marker convention, per
ADR 0006. That's exactly correct for the standalone `--instructions`/`--job` dark-factory
path (a one-shot autonomous task genuinely should exit when the model stops working). It's
wrong for interactive sessions (server/TUI/Web): a conversational turn with no tool call
routinely just means "waiting for the human's reply," not "task complete." Separately,
`AgentRuntime.runRoot()`'s `registerSendMessage` sink (`this.rootSendMessage = fn`) is never
cleared after the loop returns — so a second `sendMessageToRoot()` call doesn't throw, it
silently pushes into a dead closure's `pendingMessages` array that nothing reads anymore.
Same underlying mechanism for sub-agents via `TaskRegistry`/`spawnAgent()` — this isn't
root-specific.

**This needs a real design, not a patch — scope it properly:**

1. **A mode distinction is required.** The standalone `--instructions`/`--job` path's current
   behavior (end on first non-tool-call turn, `TASK_FAILED` marker, exit code per ADR 0006)
   must be preserved exactly — don't regress dark-factory autonomous runs. Interactive
   sessions (root agent under server/TUI/Web, and sub-agents reachable via `SendMessage`)
   need the loop to instead: on a non-tool-call turn, mark status `"waiting"` (already an
   existing `AgentStatus` value in `src/contracts/` — check whether TUI/Web already render
   it sensibly, they were built against the full enum) and **pause without returning**,
   keeping the conversation's message history intact, resuming the same loop when the next
   message arrives via the registered sink. Only a genuine stop (`stopAgent`/`TaskStop`,
   already wired via `AbortSignal` from Round 3) should actually end an interactive session
   — there's no natural "done" state for an ongoing conversation, same as a real chat UX.
2. **This must work for both root and sub-agents** — they share `runAgentLoop`; find the one
   fix that covers both rather than a root-only patch, consistent with `HANDOFF.md`'s own
   tool descriptions ("steer a running agent between turns" implies this for both).
3. **`maxTurns` needs reconsidering** in light of a session that may now run indefinitely
   across many exchanges — your call on the exact mechanics (per-message turn budget vs.
   whole-conversation cap vs. something else), just document the choice and reasoning.
4. Don't touch `src/contracts/` unless you find you genuinely need a new `AgentStatus` value
   (you probably don't — `"waiting"` already exists) — if you do, that's a request per usual.

**Gates:** the standard four. Add regression tests proving: (a) an interactive root agent
can have a real second exchange, with message history preserved (the model can reference
something from the first exchange in its second response — the strongest proof it's really
the same conversation, not two independent ones); (b) the standalone `--instructions --job`
path still exits correctly on the very first non-tool-call turn, unaffected; (c) the same
multi-exchange behavior works for a sub-agent via `SendMessage`.

**Definition of done:** live-verify against a real running `dh --server` process (build the
binary, spawn it, POST two `send_message`s in sequence, confirm the second one actually
produces new output/events and correctly references context from the first) — don't just
trust unit tests for this one, the bug was only caught by doing exactly that. Append a dated
status entry here and update `docs/roster/grace.md` when done.

### 2026-07-15 — Grace, Round 5 (interactive sessions can now have more than one exchange)

Worked in the shared tree (`claude/coordinator-onboarding-kab9ls`) at the commit landing
Round 4's fix. Full design read of `loop.ts`/`runtime.ts`/`tasks.ts`/`cli.ts`'s
`AgentRuntimeLoopAdapter` before touching anything, per the round's own instruction.

**The fix — a real mode distinction, not a patch:**

1. **`AgentLoopParams.interactive?: boolean`** (`loop.ts`, default `false` = unchanged
   standalone behavior). On a non-tool-use turn: `false` keeps the exact original
   TASK_FAILED/max_tokens self-report logic and terminal `return` — the standalone
   `--instructions`/`--job` path is byte-for-byte unaffected. `true` instead emits
   `agent_status: "waiting"` + a `status_change` log line, then pauses (via a promise the
   `registerSendMessage` sink's callback resolves when a new message arrives, or the
   `AbortSignal`'s `abort` listener resolves if stopped) without ever returning from
   `runAgentLoop`. Resuming emits `agent_status: "running"` and falls through to the
   existing top-of-loop `pendingMessages` injection — no new plumbing needed there, it
   already existed for mid-turn `SendMessage` injection. A new
   `STOPPED_WHILE_WAITING_REASON` (alongside the existing Round 3 between-turns/
   during-provider-call reasons) names this third distinct stop point.
2. **`AgentRuntimeOptions.interactive?: boolean`** (`runtime.ts`, default `false`) — set once
   per `AgentRuntime` instance and threaded into every `runAgentLoop()` call it makes:
   `runRoot()` and `spawnAgent()` alike, so root and sub-agents behave identically (the
   round's own requirement — one fix, not a root-only special case). `src/cli.ts`'s
   `AgentRuntimeLoopAdapter` (the only interactive-mode entry point — server/TUI/Web) now
   constructs its internal `AgentRuntime` with `interactive: true`. The standalone path's
   `createRuntime` dep (`new AgentRuntime({config, systemPrompt})`) never sets it, so it
   stays `false` — preserving the dark-factory path exactly, unchanged.
3. **Task-registry/rootStatus bookkeeping now tracks the mid-conversation waiting/running
   transitions**, not just the terminal done/failed one: `spawnAgent()`'s `onEvent` handler
   now calls `this.tasks.setStatus(agentId, event.status)` whenever the sub-agent's own
   `agent_status` event fires (using `TaskRegistry.setStatus()`, which already existed but
   was unused — apparently anticipated for exactly this by an earlier round but never
   wired up). `runRoot()`'s `onEvent` callback does the equivalent for `this.rootStatus`
   directly (root isn't a `TaskRegistry` entry). Without this, `getAgentTree()` would keep
   reporting a stale "running"/"waiting" between real transitions, since it reads these
   fields, not the loop's internal state.
4. **`maxTurns` (judgment call, as the round asked):** kept as a single whole-conversation
   cap, unchanged from before — `turns` only increments once per actual model round-trip, so
   time spent paused "waiting" between messages (arbitrary wall-clock time) never counts
   against it. A per-message budget was considered and rejected: it would let a conversation
   made of many short exchanges run forever, defeating the point of a safety cap. Hitting the
   cap still ends the session as `"failed"` (`"exceeded max turns"`) — the one exception to
   "only a genuine stop ends an interactive session," documented in `loop.ts`'s module doc
   comment.

**Consequence worth naming explicitly (not a bug, but a real behavior change):** an
interactive session now has no "natural" success completion at all — it either keeps
pausing/resuming forever, or ends via `stopAgent`/`TaskStop` (collapsed into `"failed"` per
Round 3's existing convention) or the `maxTurns` safety valve. `session_ended` with
`ExitCode.Success` essentially never fires for an interactive root anymore; that event/exit-
code pairing is now exclusively a standalone-path (`--job`) concept, which is exactly
correct per the round's own framing ("no natural 'done' state for an ongoing conversation,
same as a real chat UX").

**A real regression I found and fixed while verifying, not left implicit:** three existing
tests in `src/cli.test.ts`'s `AgentRuntimeLoopAdapter`/`AgentRuntimeLoopAdapter + DhServer`
describe blocks encoded the exact old (buggy) behavior as their expectation — "send one
message, wait for `session_ended`/`status: done`." Two of these hung the entire suite (real
timeouts, not flakes) because the interactive adapter's root now correctly never reaches
that state on a plain conversational turn. Fixed by rewriting them to match the new
semantics: wait for `agent_status: "waiting"` instead of `session_ended`; the
"waitForExitCode via a real DhServer" test now proves the exit code resolves via an explicit
`stop_agent` (the only way an interactive session's exit code is determined post-Round-5),
not via self-report; the "send_message reaches the real HTTP handler" test now also proves
a genuine **second** `send_message` produces new output that provably depends on the first
(an accumulating-echo mock provider that only produces the expected reply if both messages
really reached it as one ongoing history) — this is the actual regression test for the bug
the round exists to fix, driven through the real command handler, not a raw `AgentRuntime`
call.

**New regression tests added** (beyond fixing the three above):
- `loop.test.ts`: interactive-mode pause-then-resume with message history intact (scripted
  provider, no HTTP); non-interactive mode's behavior proven byte-for-byte unchanged;
  aborting while paused "waiting" reports stopped via the new
  `STOPPED_WHILE_WAITING_REASON`, not a hang or a crash.
- `runtime.test.ts`: a new describe block, "an interactive session survives more than one
  exchange" — a real second *and third* exchange against a real mock HTTP server (an
  accumulating-echo server proving the full history really persists, not just the last
  message), for both the root (`sendMessageToRoot`) and a sub-agent (`tasks.sendMessage` on
  a `spawnAgent()`-spawned task) — satisfying the round's explicit requirement that both
  paths get the same fix and the same proof.
- `cli.test.ts`: as described above.

**Live verification (per the DoD, real binary + real HTTP, not just unit tests):** built the
release binary (`bun run build`), started a real local mock Anthropic-compatible HTTP server
and a real `dh --server` process pointed at it via a real `dh.json`, and drove it with `curl`:
`request_agent_tree` → root `"waiting"`; `send_message` "first message" → tree stays
`"waiting"` (not stuck, not ended); `send_message` "second message" → tree still `"waiting"`;
`download_logs` for `agent-root` shows both exchanges as one ongoing JSONL history —
critically, a `status_change` to `"running"` and a fresh `message`/`token_usage` cycle for
the *second* message, proving it was a real new turn, not a silently-dropped no-op (the
exact symptom the owner and coordinator originally reproduced against LM Studio).

**Cross-domain request, not acted on unilaterally (e2e/ is Hedy's domain):** three tests in
`e2e/server-protocol.test.ts` encode the same now-superseded "one message ends the session"
assumption `cli.test.ts` did, and will fail/hang for the identical reason (confirmed by
running `bun run e2e` — this repo's sandbox has no `tmux`/Chromium, so the TUI/`--connect`/
web-browser e2e tests fail on missing tooling, unrelated to this round, but the
security/exit-code/server-protocol suite *does* run here and surfaced this):
- `"send_message to agent-root runs a full turn, observable live over SSE"` (lines 76-122):
  asserts `agent_status: "done"` and `session_ended: {exitCode: 0}` after a single
  `send_message`. Needs the same rewrite `cli.test.ts` got: expect `agent_status: "waiting"`
  and no `session_ended` after one message; to actually observe a `session_ended`/exit code,
  send a `stop_agent` command first (exit code will be `TaskFailure`, not `Success`, per
  Round 3's stopped-collapses-into-failed convention — see this round's `cli.test.ts` fix for
  the exact pattern to mirror).
- `"SSE resume via Last-Event-ID replays buffered events"` (lines 124-145) and
  `"download_logs: per-agent JSONL and full session tar bundle"` (lines 147-179): both use
  `sse.waitFor((e) => e.type === "session_ended")` as their synchronization point after a
  single `send_message` — this now hangs forever (confirmed: both timed out at bun's 5s
  default in this run). Fix: wait for `agent_status: "waiting"` (or a `status_change` log
  line, if the download_logs test wants to assert on `type: "message"`/`"header"` content
  instead) as the "the turn has completed" signal instead of `session_ended`; neither test's
  actual point (SSE resume semantics; log/tar download shape) depends on the session having
  *ended*, only on a turn having *completed*, so this should be a small, mechanical fix once
  reframed. Did not edit `e2e/` myself — out of Core's ownership per `CLAUDE.md` §3, same
  boundary held in Round 3 even when a handoff explicitly offered the option to cross it.

**Gates:** `bun run typecheck` clean (both TS programs). `bun run lint` clean except for a
pre-existing untracked `dh.json` in the repo root (present before this round started, not
part of this change — left untouched). `bun run test:coverage` — 688 tests passing,
99.96%/100% funcs/lines aggregate (same single pre-existing explained `cli.ts` gap as every
prior round: the real `startTui` default needs an actual PTY). `bun run e2e` — 11 pass / 7
fail: 4 failures are pre-existing environment gaps (no `tmux`, no Chromium at
`/opt/pw-browsers/chromium` in this sandbox — unrelated to this round, noted per the round's
own instruction that this might not be runnable here); 3 failures are the real, now-stale
`server-protocol.test.ts` expectations described above, flagged to Hedy rather than fixed
directly.

---

## Round 6 — OPEN — three gaps found by an architect-level review against HANDOFF.md's intent

**Addressed to:** Core (Grace, resumed — read `docs/roster/grace.md` first).

Fable (architect-on-call) ran a full gap analysis comparing the founding `HANDOFF.md` spec's
intent against what's actually built, at the owner's request. Three of the findings are
Core-domain and share touched files (`src/contracts/config.ts`, `src/cli.ts`,
`src/agent/runtime.ts`) — bundled into one round rather than three separate ones to avoid
you colliding with yourself. Fable's own analysis is the architect sign-off for the
`src/contracts/config.ts` additions below (CLAUDE.md §6.2) — no further architect round-trip
needed unless you find the shape doesn't fit cleanly.

### 6a. No JSONL logging on the standalone `--instructions`/`--job` path

HANDOFF.md §7 treats session logging as "first-class... same weight as the agent loop
itself," critical for dark-factory diagnostics. Confirmed: `src/cli.ts`'s standalone branch
(`deps.createRuntime(config, systemPrompt)`) constructs a bare `AgentRuntime` with no
`SessionLogger` attached — only `runInteractiveMode`'s `DhServer` path gets one. A crashed or
failed unattended container run currently leaves **no JSONL trail at all**, for the exact
scenario (headless, unattended, hours-long) the product is built around.

**Fix:** wire the same `SessionLogger`/log-directory mechanism (`.dh-logs/<sessionId>/` or
similar) into the standalone path, independent of whether a `DhServer` is running — likely
means extracting the log-wiring `DhServer`/`server.ts` currently does into a small shared
helper both paths call, rather than duplicating it. Should not require starting an HTTP
server just to get a JSONL sink.

### 6b. Cost display is wired end-to-end but always shows $0.00

HANDOFF.md §9 lists "token and cost display, per agent and session total" as **required for
v1**. Confirmed: `TokenUsageEvent.costUsd` is optional in `src/contracts/events.ts`, and the
Web client fully sums/formats/renders it (tested down to sub-cent formatting) — but nothing
in `src/agent/loop.ts` or either provider adapter (`anthropic.ts`, `bedrock.ts`) ever
computes a real value. It's fully wired and looks done, but is structurally inert.

**Fix:** add an optional per-model price field to `src/contracts/config.ts`'s model entries
(e.g. `inputPricePerMToken`/`outputPricePerMToken` — your call on exact naming/shape) since
local/Bedrock models have no fixed public price and this must come from config, not a
hardcoded table. Have `loop.ts` (or the provider adapters) compute `costUsd` on every
`token_usage` event when a price is configured; leave it `undefined` (current behavior) when
not configured, so existing tests/behavior for unconfigured models don't regress.

### 6c. `maxTurns` isn't configurable from `dh.json`

HANDOFF.md §1 promises unattended runs of potentially hours; §4's own real-run data cites
"1309 Bash calls" in one observed session. `loop.ts` hardcodes `DEFAULT_MAX_TURNS = 100` with
an optional `maxTurns` param that's never threaded from config anywhere — a genuinely long
dark-factory task could hit this safety-valve failure with no operator-facing way to raise
it short of patching source.

**Fix:** add an optional `options.maxTurns` to `DhConfig` (bundle this into the same
`src/contracts/config.ts` change as 6b above — one contracts diff, not two), thread it
through `AgentRuntimeOptions` into every `runAgentLoop` call (`runRoot()` and
`spawnAgent()`), defaulting to the current 100 when unset so nothing regresses.

**Gates:** the standard four. Add regression tests for each: (a) a standalone
`--instructions --job` run produces a real JSONL log file; (b) a configured price produces a
non-zero `costUsd` on a `token_usage` event, and an unconfigured one still produces
`undefined` (no regression); (c) a configured `maxTurns` actually changes when the loop's
safety-valve fires. Append a dated status entry here and update `docs/roster/grace.md` when
done — note any of the three you have to defer, explicitly, rather than silently dropping.
