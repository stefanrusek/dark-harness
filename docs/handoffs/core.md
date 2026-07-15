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
