# Handoff: E2E (real-binary end-to-end tests)

**Addressed to:** the E2E domain lead.
**Owner directory:** `e2e/` (per `CLAUDE.md` §3).
**Status:** OPEN — unblocked 2026-07-15. Core's round 2 (`docs/handoffs/core.md`) landed
real Server/TUI/Web wiring in `src/cli.ts` — verified directly by the coordinator: compiled
`dist/dh --server`, curled a live `GET /api/events` (200) and `POST /api/commands`
(`request_agent_tree` returned a real root-agent node). All four run modes are real, not
stubs. Build against `origin/claude/coordinator-onboarding-kab9ls` HEAD.

---

## Context

Read `CLAUDE.md`, ADR 0008 (coverage + e2e gates), ADR 0004 (security matrix) before
starting. Per `HANDOFF.md` §10, this is real-binary testing — not unit tests with mocks, but
the actual compiled `dh` binary spawned as a subprocess and driven like a real user/operator
would, with the model swapped for a deterministic mock provider.

## Scope

1. **Mock provider endpoint**: an Anthropic-compatible local HTTP server (you can build this
   here, or coordinate with Core if they already stubbed something similar for their own
   tests — check `src/agent/providers/` status first) that returns scripted/deterministic
   responses. This is what makes e2e runs free and deterministic — no real API key needed
   in the gate.

2. **Binary compilation**: `bun run build` produces `dist/dh`. Your suite should build it
   once per run (or reuse a build step from CI) and spawn it as a real OS process for every
   scenario below.

3. **PTY harness for the TUI**: spawn `dist/dh` (local mode) under a pseudo-terminal, drive
   it with real keystrokes, assert on rendered screen content. Bun doesn't have a built-in
   PTY module — you'll need to either shell out to a PTY-capable wrapper or use an FFI/native
   binding; document whichever approach you land on and why.

4. **Headless browser for the web UI**: spawn `dist/dh --web`, drive the served UI with
   Playwright against the pre-installed Chromium (do not run `playwright install`; if the
   pinned `@playwright/test` version differs, launch with
   `executablePath: '/opt/pw-browsers/chromium'`). Assert on the same required-v1 behaviors
   from the Web handoff (status colors, token/cost display, log download, live updates).

5. **Real client↔server over HTTP/SSE across processes**: spawn `dist/dh --server`, then a
   separate `dist/dh --connect <host>` process, and assert the protocol actually works
   across the process boundary — not just in-process like the Server domain's own
   integration tests.

6. **Security matrix** (ADR 0004): unauthenticated client rejected (both POST and SSE) when
   `security.token` is set; authenticated happy path; a TLS client↔server run using a
   self-signed test cert generated for the suite.

7. **Exit-code matrix** (ADR 0006): `--job` mode returns 0/1/2+ correctly across a success
   case, a self-reported-failure case, and a harness-error case (e.g. malformed `dh.json`).

## Constraints

- Stay inside `e2e/`. If a domain's entry point doesn't expose what you need to drive it
  (e.g. no clean way to inject the mock provider URL), that's a request back to that domain,
  not a workaround inside `e2e/`.
- Real-API smoke tests (against the actual Anthropic API) are optional, manual, and **never**
  part of the CI gate — keep them clearly separated if you write any.

## Gates

`bun run e2e` (i.e. `bun test e2e`) is this domain's own gate — it doesn't contribute to the
100%-unit-coverage number, but it must pass in CI per ADR 0008.

## Definition of done (this round)

- Mock provider endpoint exists and is reusable across scenarios.
- At least one real-binary scenario passing per run mode (local TUI, `--web`, headless
  `--server` + `--connect`).
- Security matrix and exit-code matrix covered.
- Anything not yet covered (e.g. Windows-specific PTY behavior) named explicitly — this
  suite will likely need more than one round; say what's in v0.1's e2e gate vs. deferred.

## Status log

_(Append dated entries here. Status supersedes.)_

### 2026-07-15 — Round 1 (Hedy): mock provider + real-binary e2e suite, two cross-domain defects found

**Built, all passing against the real compiled `dist/dh` binary** (`bun run e2e` — 18 tests,
5 files, ~5s from a clean rebuild; `bun run typecheck` and `bun run lint` both clean):

- `e2e/support/mock-provider.ts` — an Anthropic-compatible local HTTP server implementing
  just `POST /v1/messages` (the only endpoint `src/agent/providers/anthropic.ts`'s
  `AnthropicProvider` ever calls). Takes a scripted queue of `MockTurn`s (text and/or
  `tool_use` calls, configurable `stop_reason`/usage); repeats the last turn on exhaustion as
  a safety net. Point a `dh.json` `provider[].baseURL` at its `.baseURL` and the real,
  unmodified `AnthropicProvider` drives the whole suite — no code changed in `src/agent/`.
- `e2e/support/build.ts` — builds `dist/dh` once per `bun test e2e` run via a cached
  module-level promise (all test files share it since `bun test` runs them in one process).
- `e2e/support/workspace.ts`, `port.ts`, `dh-process.ts` — per-test tmpdir + `dh.json`
  fixture writer, free-port picker (needed because `--server`/`--connect --port` reject `0`,
  unlike the client-side ephemeral servers), and a real-subprocess spawn/wait helper.
- `e2e/support/sse-client.ts` — a from-scratch `fetch`-based SSE client (hand-parses
  `id:`/`data:` records per ADR 0002/`src/server/sse.ts`), deliberately independent of
  `src/tui/sse-parser.ts` / `src/web/client/sse.ts` — this is a black-box test of the wire
  protocol, not a reuse of either client domain's own parser.
- `e2e/support/tmux-pty.ts` — **PTY harness decision: `tmux`, not `node-pty`.** Bun has no
  built-in PTY module and no working native-build toolchain was confirmed available in this
  environment; `tmux` was already present and verified interactively (`tmux new-session -d`
  + `capture-pane`/`send-keys`) to give `dist/dh` a genuine pseudo-terminal (real
  `process.stdout.columns/rows`, real raw-mode stdin) rather than a pipe. Documented per the
  handoff's "document whichever approach you land on and why."
- Playwright (`playwright`, not `@playwright/test`) launches with an explicit
  `executablePath: "/opt/pw-browsers/chromium"` — the installed `playwright-core@1.61.1`
  pins chromium revision 1228, but the environment's pre-installed browser is revision 1194,
  so the version-matched default download path would 404; the symlink at that path resolves
  straight to the `chrome` binary and works fine headless.

**Test files (what actually runs and passes):**

- `e2e/exit-codes.test.ts` (4 tests) — `--job`/`--instructions` exit-code matrix (ADR 0006):
  self-reported success (0), self-reported `TASK_FAILED` (1), malformed `dh.json` JSON (2+),
  and a semantically-invalid config (unknown model reference, 2+).
- `e2e/server-protocol.test.ts` (5 tests) — real `dh --server` process driven by a plain
  `fetch` client across an actual OS process boundary: pre-start `request_agent_tree` (root
  node present with status "waiting" even before any message), unknown-agentId 404,
  a full `send_message` → SSE `agent_spawned`/`agent_output`/`token_usage`/`agent_status`/
  `session_ended` sequence, `Last-Event-ID` resume replaying buffered events, and
  `download_logs` (both per-agent JSONL and the full tar bundle).
- `e2e/security.test.ts` (6 tests) — ADR 0004 matrix against the real server: unauthenticated
  POST/SSE both 401, wrong token 401, authenticated POST+SSE happy path through to
  `session_ended`, a self-signed-cert TLS round trip (reusing `src/server/testdata/test-{cert,key}.pem`
  — confirmed plain `http://` genuinely fails against a TLS-only listener), and TLS+token
  together.
- `e2e/tui.test.ts` (2 tests) — real PTY via tmux. One drives local `dh` (server+TUI in one
  process): boots, alt-screen renders, left-arrow → real `request_agent_tree` round-trip
  populates the tree view with the synthesized root node, keystrokes render in the input box.
  The other spawns a **real second `dh --connect localhost --port <p>` process** against a
  real `dh --server`, proving cross-process SSE rendering live in the actual console client.
- `e2e/web.test.ts` (1 test) — real headless Chromium against `dh --web`: connection pill,
  status-dot colors, live output text, token/cost display, session-ended banner, composer
  visibility, and both log-download buttons.

**Two confirmed cross-domain defects, found specifically because this is real-binary/real-browser
testing (ADR 0008's whole rationale) — not fixed here, out of `e2e/`'s ownership per CLAUDE.md §3:**

1. **Interactive-mode bootstrap deadlock (TUI + Web, blocks every fresh interactive session).**
   Neither `src/tui/state.ts` nor `src/web/client/app.ts` ever learns the root agent's id
   until an `agent_spawned` SSE event arrives — but that event only fires once
   `runAgentLoop` starts, which only happens once an operator sends the *first* message,
   which neither client can do because they don't know the root's id yet.
   `request_agent_tree` *does* return a synthesized root node pre-start (verified directly in
   `server-protocol.test.ts`'s first test — `agentId: "agent-root"`, `status: "waiting"`),
   and the TUI's left-arrow tree view even fetches it, but
   `applyTreeResponse` (`src/tui/state.ts`) never feeds it into `state.rootAgentId`, and the
   Web client never calls `request_agent_tree` at all. Net effect, confirmed live in
   `e2e/tui.test.ts`: type a message, press Enter, get "No root agent yet — please wait."
   forever — a real operator cannot start a fresh `dh`, `dh --web`, or `dh --connect` session
   through its own UI. `e2e/tui.test.ts` and `e2e/web.test.ts` both work around it for their
   own coverage by sending the first `send_message` via a direct API call (learning the
   target the same way the real client does — `/dh-config.json` for Web), then verify
   everything downstream for real. **Requests fix from TUI (Mary) and Web (Susan)** — likely
   a one-line-ish fix each (seed `rootAgentId`/`selectedAgentId` from the
   `request_agent_tree` response, and/or issue it automatically on boot instead of only on
   left-arrow); **Core (Grace)** may also want to weigh in on whether `ROOT_AGENT_ID` should
   become a wire-level constant in `src/contracts/` instead of a Core-internal string both
   clients would otherwise have to hardcode.
2. **Missing `Access-Control-Expose-Headers: Content-Disposition` (Server, breaks the web
   log-download filename).** `src/server/server.ts`'s `CORS_HEADERS` never exposes
   `Content-Disposition`, so a real cross-origin browser `fetch` (the web UI and the dh
   server are different origins even in local `--web` mode per ADR 0003) can't read it —
   `src/web/client/download.ts`'s `filenameFromContentDisposition` always falls back to a
   generic client-computed name. For per-agent downloads this coincidentally matches
   (`${agentId}.jsonl`), masking the bug; for the full-session bundle it doesn't — every
   session's bundle downloads as the same generic `dh-session-logs.tar.gz` instead of the
   real `session-<sessionId>.tar`, losing the session id and implying (wrongly, via the
   `.gz` suffix) gzip compression. `e2e/web.test.ts` asserts the actual current filenames
   (documented inline) so the suite stays honest rather than asserting the intended
   behavior. **Requests a one-line fix from Server (Radia):** add
   `Access-Control-Expose-Headers: Content-Disposition` (and any other headers the download
   flow needs) to `CORS_HEADERS`.

**Explicitly deferred/unverified this round (no silent truncation, CLAUDE.md §8):**

- Sub-agent spawning (`Agent` tool) / nested agent-tree rendering — every scenario here uses
  a single-turn root agent; no test scripts a `tool_use` turn, so Bash/Read/Edit/Write tool
  execution and the sub-agent tree UI are not driven end-to-end at all.
- `stop_agent`/TaskStop not exercised.
- Multi-turn conversation with a *second* user message to an already-*completed* root agent
  is not covered — worth flagging separately from defect #1 above: once `runAgentLoop`
  returns after a single no-tool-call turn, `AgentRuntime`'s `sendMessageToRoot` becomes a
  silent no-op (the `pendingMessages` queue it pushes into is never drained again), so this
  may be a related but distinct Core-domain gap worth a look, not just a client bug.
- Windows PTY behavior — the tmux-based harness is Linux/macOS-only; not tested here, as
  flagged as likely out-of-scope-this-round in the original handoff text.
- `--config <path>` (non-default config file location) not explicitly exercised (every test
  relies on the default `dh.json`-in-cwd resolution).
- `bedrock`-type provider not exercised (only `anthropic`-type, via the mock).
- Did not touch or verify `.github/workflows/` (Nightingale's domain) — have not confirmed
  `bun run e2e` is actually wired into the CI gate; worth a cross-check with Nightingale/Ada.
- Parallel/sharded `bun test` execution not stress-tested beyond running all 5 files together
  once; port collisions are mitigated via `findFreePort()` but not adversarially tested.

No changes made outside `e2e/` (mock-provider/build/workspace/port/dh-process/sse-client/tmux-pty
support modules plus the five test files above) and this status-log entry + `docs/roster/hedy.md`.

### 2026-07-15 — Round 2 (Hedy, fresh process): fixed the three Round-5-superseded tests in `server-protocol.test.ts`

Core's Round 5 (`docs/handoffs/core.md`) landed the interactive-session multi-exchange fix
and flagged, as a cross-domain request rather than editing `e2e/` directly, that three tests
in `e2e/server-protocol.test.ts` still encoded the old "one message ends the session"
assumption and would hang/fail. This round is exactly that fix, per the precise diagnosis
already in the handoff (no new investigation needed) — mirroring the pattern Core's own
`src/cli.test.ts` used for the identical problem.

**Fixed, all in `e2e/server-protocol.test.ts`:**

1. `"send_message to agent-root runs a full turn, observable live over SSE"` — now expects
   `agent_status: "waiting"` (not `"done"`) and the tree to read `"waiting"` after one
   message, with no `session_ended` at that point. To actually observe a `session_ended`,
   the test now POSTs `stop_agent` for `agent-root` first, then waits for `session_ended` —
   asserting `exitCode: ExitCode.TaskFailure` (imported from `src/contracts/exit-codes.ts`),
   matching Round 3's "a genuine stop collapses into failed" convention, not `Success`.
2. `"SSE resume via Last-Event-ID replays buffered events"` — swapped its synchronization
   point from `session_ended` (which now never fires after a single message) to
   `agent_status: "waiting"`, on both the original and the Last-Event-ID-resumed connection.
   The test's actual point (does resume replay the same buffered event by id) is unaffected
   by which event type is used as the sync point.
3. `"download_logs: per-agent JSONL and full session tar bundle"` — same swap, waits for
   `agent_status: "waiting"` before hitting `download_logs`; the JSONL/tar shape assertions
   themselves are untouched.

No other test files touched — the other four (`exit-codes.test.ts`, `security.test.ts`,
`tui.test.ts`, `web.test.ts`) don't share this assumption (per Round 5's own note, only
`server-protocol.test.ts` surfaced it, since the tmux/Chromium-dependent files fail on
missing tooling in this sandbox regardless, unrelated to this change).

**Gates:** `bun run typecheck` clean (both TS programs). `bun run lint` clean on
`e2e/server-protocol.test.ts` itself (biome auto-fixed import order/formatting after my
edits); the one remaining lint failure is the pre-existing untracked `dh.json` in the repo
root, present before this round and unrelated to it (same file Round 5's own status log
already noted as pre-existing). `bun test e2e/server-protocol.test.ts` — 5 pass, 0 fail, 22
`expect()` calls. Did not run the full `bun run e2e` — this sandbox has no `tmux`/Chromium,
so `tui.test.ts`/`web.test.ts` fail on missing tooling regardless of this change, per the
task's own scoping.

---

## Round 2 — OPEN — two coverage gaps found by an architect-level review

**Addressed to:** E2E (Hedy, resumed — read `docs/roster/hedy.md` first).

Fable (architect-on-call) ran a full gap analysis comparing `HANDOFF.md`'s intent against
what's built. Two findings are E2E-domain; bundled into one round since both likely touch
`e2e/support/mock-provider.ts` and/or `server-protocol.test.ts`.

### 2a. Sub-agent spawning has zero real-binary e2e coverage — the priority item this round

HANDOFF.md §1's one-sentence product definition is "runs an LLM agent (and any number of
sub-agents)." Confirmed (your own prior status log already says this explicitly): "every
scenario here uses a single-turn root agent; no test scripts a `tool_use` turn" — meaning
Bash/Read/Edit/Write tool execution, and especially a sub-agent actually being spawned and
appearing in the agent tree, has never once been exercised against the real compiled binary.
Given the TUI/Web bootstrap deadlock was *only* ever found via real-binary e2e (not unit
tests), a nested-agent-tree bug of similar severity could exist right now undetected — this
is exactly the risk class ADR 0008's e2e gate exists to catch, on the product's single most
headline capability.

**Fix:** at least one scenario that scripts the mock provider (`MockTurn` already supports
`tool_use`, per your own prior work) to emit a real `tool_use` turn calling `Agent` to spawn
a sub-agent; confirm the sub-agent's own SSE events/log file appear; confirm
`getAgentTree()` returns a real nested parent-child structure (every existing test only
covers the single-root case); if feasible in the time you have, a TUI or Web scenario
confirming the tree UI actually renders nesting > 1 level (the tree/agent-tree UI code
exists on both clients per earlier rounds — this would be the first time it's driven by a
real nested tree rather than a hand-built fixture).

### 2b. Bedrock provider is unexercised beyond unit tests and undocumented

HANDOFF.md §5 names Bedrock as a first-class provider alongside Anthropic specifically for
operators without Anthropic access — the whole point of the provider abstraction. Your own
status log already states plainly: "`bedrock`-type provider not exercised (only
`anthropic`-type, via the mock)." Combined with no README guidance beyond the one-line
sample config entry, the second of exactly two named providers is effectively unverified and
undocumented for a real operator.

**Fix:** at minimum, one e2e scenario exercising the Bedrock adapter against a mock/stub
Bedrock-shaped endpoint (mirroring however the Anthropic mock provider works today). If a
README addition on Bedrock setup (region, credential-chain expectations) seems like the
more valuable use of remaining time/lower lift, that's a request to Prompt rather than
something to do yourself — say so explicitly rather than silently skipping it.

**Gates:** the standard three (`typecheck`, `lint`, and whichever of `bun run e2e` your
sandbox can actually run — note explicitly what you couldn't run, same as prior rounds).
Append a dated status entry here and update `docs/roster/hedy.md` when done.

---

### 2026-07-15 — Round 2 (Hedy, fresh process): built 2a's sub-agent coverage, found a real bug; did not attempt 2b

**Worktree note (same class of issue as Round 1):** the worktree I was launched into
(`agent-a0afc5ca1e85a9cc1`) was branched from the same early ancestor commit (`12679e4`,
before any domain landed), not from the real `claude/coordinator-onboarding-kab9ls` HEAD.
Confirmed zero unique commits via `git merge-base --is-ancestor`, fast-forwarded to the real
HEAD (`0478707`) before starting. Worth the coordinator looking at why worktree provisioning
keeps doing this.

**What I built:** one new scenario in `e2e/server-protocol.test.ts`, describe block
`"sub-agent spawning over real HTTP/SSE (Round 2, gap 2a)"` — scripts a real `tool_use` turn
that calls the `Agent` tool against the real compiled binary, and asserts:
- both `agent_spawned` events (root, then the sub-agent with `parentAgentId: "agent-root"`)
- the sub-agent's own `agent_output` SSE event, carrying its own `agentId`
- the root's own follow-up turn *after* the tool_result (proving the loop actually resumed
  post-tool-call, not just that the tool fired)
- `getAgentTree()` returning a real two-level nested tree (not a hand-built fixture) —
  the first time tree nesting depth > 1 has been asserted at the wire level
- the sub-agent's own JSONL log file is independently downloadable via `download_logs` with
  its own header line (`agentId`/`parentAgentId`) — ADR 0004 per-agent logging actually fires
  for a spawned child, not just the root

**Design choice — two independent mock providers, not one shared queue:** my first draft
used one `startMockAnthropicProvider` instance for both root and sub-agent (mirroring every
existing test's pattern), scripting turns by call-arrival order. That doesn't work here:
root's Agent tool call and the sub-agent's own loop both fire real HTTP requests
concurrently once the tool executes, so which one's request lands first at the shared mock
is a genuine race, not something `await`-chaining guarantees (I initially assumed the
`run_in_background: false` blocking path would serialize it — see the bug below on why that
path can't be used at all). Fixed by giving the sub-agent its own model (`"sub"`) pointed at
its own mock provider instance in the test's `dh.json` — root's turns are strictly ordered by
its own provider's call count, the sub-agent's one turn by its own, independently.

**A real bug found via this real-binary test (not fixed — out of e2e's ownership per
CLAUDE.md §3, flagged as a cross-domain finding for Core, same posture as Round 1's TUI/Web
deadlock and CORS findings):**

`AgentRuntime.spawnAgent()` (`src/agent/runtime.ts`) threads `interactive: this.interactive`
into every sub-agent's own `runAgentLoop()` call, identically to the root's. Round 5's
"interactive sessions pause `'waiting'` instead of ending after a non-tool-use turn"
convention (`docs/handoffs/core.md`) was designed for the *root* — a human keeps typing
follow-up messages into the same session, so "waiting for the next message" is the correct
terminal state between exchanges. Applied to a sub-agent spawned via the `Agent` tool, the
same convention means a sub-agent that has already delivered its one and only output over SSE
(confirmed: `subProvider.callCount` stays at 1 forever, i.e. the sub-agent's own loop never
asks the model anything else) never reaches `"done"` — it sits `"waiting"` indefinitely,
because nothing will ever call `sendMessage()` on a sub-agent nobody is watching.

This silently breaks the `Agent` tool's own `run_in_background: false` (blocking) mode in
*any* interactive/server context: `ctx.tasks.awaitDone(taskId)`
(`src/agent/tools/agent.ts`) never resolves, since a task's status transition to
`"done"`/`"failed"` (what `TaskRegistry.awaitDone` actually waits on) never happens once the
sub-agent's status is pinned to `"waiting"`. Confirmed directly by hand while building this
test — scripting the identical scenario with `run_in_background: false` reproduces the hang
(the root's own second turn never arrives, `rootProvider.callCount` stays stuck at 1). I did
not commit that as a test, since a hanging `bun test` isn't useful CI signal on its own;
flagging it here in prose, with the passing test's own inline comment pointing at the exact
two files (`runtime.ts`'s `spawnAgent`, `tools/agent.ts`'s `awaitDone` call) is the more
actionable trail for whoever picks this up. The committed test itself asserts the *actual*
current behavior (child status `"waiting"`, not `"done"`) rather than working around it,
exactly like Round 1's precedent for surfacing rather than quietly avoiding a broken path.

**Not attempted this round: 2b (Bedrock provider e2e coverage).** Prioritized 2a per the
task's own framing ("prioritize 2a if you don't have time for both") — ran out of scope after
the sub-agent scenario plus tracking down and writing up the bug above. Bedrock remains
covered only by `src/agent/providers/bedrock.test.ts` (unit-level), with no real-binary e2e
scenario and no README guidance beyond the one-line sample config entry. Still open for
whoever picks up Round 3 (or a fresh Round 2 continuation) — the task's own framing suggests
either a mock/stub Bedrock-shaped HTTP endpoint (mirroring `mock-provider.ts`'s pattern) or,
if lower lift, routing a README addition to Prompt instead; I did neither, so both options are
still live.

**Gates:** `bun run typecheck` clean (both TS programs). `bun run lint` clean (145 files, no
fixes). `bun test e2e/server-protocol.test.ts` — 6 pass, 0 fail, 32 `expect()` calls (5
pre-existing + this round's 1 new). `bun run test:coverage` — 693 pass, 0 fail, 100% coverage
maintained across `src/`. Ran the full `bun run e2e`: this sandbox has neither `tmux` nor a
Chromium binary (confirmed via `which`/the actual launch error, `/opt/pw-browsers/chromium`
does not exist here), so `tui.test.ts` and `web.test.ts` fail exactly as in every prior round,
unrelated to this change. Also observed `e2e/security.test.ts`'s bearer-token SSE happy-path
test timing out at 5000ms in this sandbox — confirmed pre-existing and unrelated (file
untouched by this round's diff, `git diff --stat` shows only `server-protocol.test.ts`
changed); not investigated further since it's outside this round's scope, but worth a future
round's attention if it's not just sandbox flakiness.

### 2026-07-15 — Round 3: close out the sub-agent "waiting" cross-domain finding

Core's Round 7 (commit `2768976`) fixed the bug flagged above: sub-agents no longer inherit
the root's `interactive` flag, so a spawned sub-agent that has already delivered its final
output now correctly reaches `"done"` instead of hanging in `"waiting"` forever. Confirmed
this broke `server-protocol.test.ts`'s "sub-agent spawning over real HTTP/SSE (Round 2, gap
2a)" test (status `"done"` now, not the previously-asserted `"waiting"`).

Updated the test: both assertions of the child's status now expect `"done"`, and the large
comment block documenting the bug as open/unfixed was replaced with a short pointer to this
fix (Core round 7, commit `2768976`) for future readers. Nothing else in the test changed.

**Gates:** `bun test e2e/server-protocol.test.ts` — 6 pass, 0 fail, 32 `expect()` calls.
`bun run typecheck` clean. `bunx biome check e2e/server-protocol.test.ts` clean (the repo-wide
`bun run lint` currently fails on an untracked, unrelated `dh.json` scratch file at repo root
that predates this round's work and isn't part of `e2e/`).

---

## Round 4 — OPEN — verify build-stamping survives compilation, end to end

**Addressed to:** E2E (Hedy, resumed — read `docs/roster/hedy.md` first).

Core's Round 8 (just landed) added `scripts/build.ts` (stamps real build identity into the
compiled binary) and `client`/`build` fields on the JSONL `LogHeader` (ADR 0005's amendment).
`e2e/support/build.ts`'s `ensureBuilt()` currently calls raw `bun build --compile` — it
should use the new script instead, and this is worth a real end-to-end assertion that the
`--define` stamping actually survives all the way through `bun build --compile` in this
project's actual build (not just Core's own unit-level verification).

**Fix:** switch `ensureBuilt()` to invoke `bun scripts/build.ts --outfile dist/dh` (mirroring
the `package.json`/`release.yml` call-site pattern). Add an assertion — using an existing
real-binary run per mode you already drive — reading the root agent's first (header) log
line and confirming: a `--server` mode run has `client === "server"`; a standalone
`--instructions --job` run has `client === "none"`; both have `build.version` matching
`package.json`'s version, `build.gitSha` matching `/^[0-9a-f]{40}$/`, and `build.releaseTag
=== null` (since this is a local, non-release build). This is the concrete end-to-end proof
that the stamp mechanism actually works through the real build pipeline this project uses,
not just in isolation.

**Gates:** the standard three, plus whichever e2e files your sandbox can actually run (same
tmux/Chromium caveat as every prior round — note explicitly what you couldn't run). Append a
dated status entry here and update `docs/roster/hedy.md` when done.

### 2026-07-15 — Round 4 status (Hedy, fresh process, resumed): DONE

**Worktree note (recurring, per prior rounds):** launched into a worktree
(`agent-a511bf423269437d4`) again branched from the pre-domain-landing ancestor commit
(`12679e4`), zero unique commits of its own. Confirmed via `git merge-base --is-ancestor` and
fast-forwarded to the real HEAD (`037952c`) before starting — third time this has happened for
this role; still worth someone looking at the worktree provisioning for E2E specifically.

**What I built:**

- `e2e/support/build.ts`'s `ensureBuilt()` now spawns `bun scripts/build.ts --outfile dist/dh`
  (cwd repo root) instead of raw `bun build --compile ./src/cli.ts --outfile dist/dh` — same
  call-site shape `package.json`/`release.yml` use, per Core's request.
- New `e2e/build-stamp.test.ts`, two scenarios, both driving the real compiled binary:
  - `--server` run: since the root agent (and its JSONL log) isn't created until the first
    `send_message` (confirmed against `e2e/server-protocol.test.ts`'s own "no message sent"
    tree test), the test connects SSE, POSTs `send_message` to `agent-root`, waits for
    `agent_output`, then reads `<workspace>/.dh-logs/<sessionId>/agent-root.jsonl`'s first
    line directly off disk and asserts `header.client === "server"`.
  - Standalone `--instructions --job` run: runs to completion (exit 0), then reads the same
    file shape and asserts `header.client === "none"`.
  - Both assert `header.type === "header"`, `header.build.version === pkg.version`,
    `header.build.gitSha` matches `/^[0-9a-f]{40}$/` (the full sha `scripts/build.ts` stamps,
    not the shortened one it only uses in its own console log line), and
    `header.build.releaseTag === null` (no `--release-tag` passed to a local dev build).

**Judgment call:** rather than trying to guess/parse the randomly-generated `sessionId`
ahead of time, each test just `readdirSync`s the workspace's `.dh-logs/` directory (each test
uses its own fresh tmp workspace, so exactly one session directory ever exists there) and
asserts there's exactly one entry before reading into it — simpler than threading the
sessionId out of stdout, and doubles as an implicit assertion that a run only ever creates one
session directory.

**Gates:** `bun run typecheck` clean, `bun run lint` clean (149 files; biome auto-fixed one
import-order nit in the new test file). `bun run test:coverage`: 741 pass / 0 fail / 100%
coverage maintained. Ran `bun run e2e` in full: 17 pass / 4 fail — all four failures are
environment gaps already flagged in prior rounds, not regressions from this change:
`tui.test.ts` (2 tests, missing `tmux`), `web.test.ts` (1 test, missing Chromium at
`/opt/pw-browsers/chromium`), and `security.test.ts`'s bearer-token SSE test (timeout,
flagged as pre-existing/unrelated back in Round 2 gap-2a's status entry). The three files
this round actually touches/depends on —`build-stamp.test.ts`, `exit-codes.test.ts`,
`server-protocol.test.ts` — are 12/12 green on their own (`bun test e2e/build-stamp.test.ts
e2e/exit-codes.test.ts e2e/server-protocol.test.ts`).

No open threads added this round beyond what was already tracked (multi-turn second-exchange
coverage, gap 2b Bedrock e2e coverage — both still open from prior rounds).

---

### 2026-07-15 — Round 5 (Hedy, fresh process): closed gap 2b, Bedrock e2e coverage

Came online fresh for this file's 2b task order. Read this file's 2b entry and
`docs/roster/hedy.md` first per `CLAUDE.md` §7's resuming convention.

**Key research finding before writing any code:** `BedrockProvider` (`src/agent/providers/
bedrock.ts`) never reads a `baseURL`/`endpoint`-shaped field from `ProviderConfig` — only
`config.region` — so a config-only e2e scenario looked impossible at first (that would have
been a cross-domain request to Grace/Core, per the task's own framing). But the underlying
AWS SDK v3 client (`BedrockRuntimeClient`) resolves its endpoint through the standard
"endpoints 2.0" environment-variable convention independent of application code: confirmed by
reading `node_modules/@smithy/core/dist-cjs/submodules/endpoints/index.js` (`ENV_ENDPOINT_URL
= "AWS_ENDPOINT_URL"`, joined with the service id) and `node_modules/@aws-sdk/
client-bedrock-runtime/dist-cjs/index.js` (`serviceId: config?.serviceId ?? "Bedrock
Runtime"`) — so setting `AWS_ENDPOINT_URL_BEDROCK_RUNTIME` in the spawned process's
environment redirects the real, unmodified `BedrockProvider`/`BedrockRuntimeClient` to a local
mock with **zero source changes and no client injection** — the real e2e path this domain is
supposed to build, not a cross-domain ask.

**Second finding, only surfaced by actually running it:** `BedrockRuntimeClient` always
constructs a `NodeHttp2Handler` (`requestHandler: NodeHttp2Handler.create(...)` in the SDK's
`runtimeConfig`), even for the non-streaming `Converse` operation — there's no config path to
make it fall back to HTTP/1.1. `Bun.serve` (used for the existing Anthropic mock) only speaks
cleartext HTTP/1.1, which the SDK's http2 session rejected outright (`TypeError: The
"authority" argument must be of type string, Object, or URL` deep inside `node:http2`, then
`dh: root agent crashed: bedrock provider request failed: ... http2 request did not get a
response`). Fix: built the mock on Node's `node:http2` module (`http2.createServer(...)`,
cleartext h2c — Bun's Node-compat layer supports it) instead of `Bun.serve`.

**What I built:**
- `e2e/support/mock-bedrock-provider.ts` — h2c mock server implementing the one wire call the
  adapter makes, `POST /model/{modelId}/converse` (path confirmed from the SDK's own operation
  table). Records every request body and every `modelId` path segment (decoded) in call
  order; exposes `startMockBedrockProvider(turns)` (async — `listen(0)` resolves after an
  actual OS port is bound, unlike `Bun.serve`'s synchronous return), `successTurn`,
  `taskFailedTurn`, and `mockBedrockEnv(baseURL, region?)` (bundles
  `AWS_ENDPOINT_URL_BEDROCK_RUNTIME` + dummy static `AWS_ACCESS_KEY_ID`/
  `AWS_SECRET_ACCESS_KEY`/`AWS_REGION` — enough for the SDK to sign requests locally with zero
  real AWS network egress; the mock never verifies SigV4).
- `e2e/bedrock-provider.test.ts` — three scenarios, all against the real compiled binary via
  `spawnDh`'s `extraEnv`:
  1. Success path -> exit 0, asserting `provider.modelIds` equals the real `ModelConfig.model`
     value and explicitly `.not.toBe("bedrock-mock")` (the friendly `name`).
  2. Self-reported `TASK_FAILED` -> exit 1, same convention as the Anthropic exit-code tests.
  3. A real `tool_use` turn (Bash) followed by a second turn — asserts `callCount === 2`, both
     calls carry the real model id, and the *second* request's message history actually
     contains a `toolResult` block, proving the loop resumed post-tool-call over Bedrock, not
     just that the first call fired.
  All three deliberately use a `dh.json` fixture where `ModelConfig.name` ("bedrock-mock") and
  `ModelConfig.model` (a fake Bedrock model id, `anthropic.claude-3-5-sonnet-20241022-v2:0`)
  differ, per this round's explicit instruction — exactly the two fields Core's round 11 found
  conflated in every real provider call. Had this suite existed before round 11, test 1 alone
  would have failed the moment `provider.modelIds` diverged from the expected value.

**Judgment calls:**
- Did not attempt the optional README addition on Bedrock setup (region, credential-chain
  expectations) this round — prioritized building and hardening the actual e2e scenario given
  the h2c discovery ate the bulk of the time budget. Per this round's own framing, that
  addition is a request to **Prompt** (owns `README.md`), not something for e2e to write
  directly — flagging it explicitly here rather than silently doing or dropping it. Content
  Prompt would need: `provider.region` config field, standard AWS credential-chain resolution
  (env vars / shared config / instance role — nothing custom, per `bedrock.ts`'s own doc
  comment "no custom credential handling"), and a note that Bedrock Converse errors surface
  through the same `ProviderError` wrapping as Anthropic.
- Kept `mockBedrockEnv`'s credentials as obviously-fake string literals (not empty strings) —
  empty values risk the SDK falling through to a *real* credential-chain lookup (shared config
  file, IMDS, etc.) in some environments instead of using the static values, which would be a
  slow/networked failure mode in CI rather than a fast deterministic one.
- Did not attempt a streaming (`ConverseStream`) scenario — `bedrock.ts` only ever calls
  `ConverseCommand`, never `ConverseStreamCommand`, so there is nothing in the real adapter for
  it to exercise; noting this so a future round doesn't assume it's an oversight.

**Gates:** `bun run typecheck` clean. `bun run lint` clean (152 files; biome auto-fixed one
import-order/wrap nit in the new test file via `biome check --fix`). `bun run test:coverage`:
745 pass / 0 fail / 100% coverage maintained (`src/` unit tests only — this round's new files
live under `e2e/`, outside that gate's scope, same as every prior e2e round). Ran `bun run e2e`
in full: 20 pass / 4 fail — the same four pre-existing environment gaps as every prior round
(missing `tmux` for `tui.test.ts`, missing Chromium at `/opt/pw-browsers/chromium` for
`web.test.ts`, and `security.test.ts`'s bearer-token SSE timeout, all flagged back in Round 2
gap-2a) — no regressions. `e2e/bedrock-provider.test.ts` itself: 3 pass / 0 fail / 13
`expect()` calls, run both in isolation and as part of the full suite.

**Open threads for whoever picks this up next:** the README/Bedrock-setup addition (routed to
Prompt above, not e2e); multi-turn second-`send_message` e2e coverage (open since Round 1/2,
still untouched).

### 2026-07-15 — Round 6 (Hedy, fresh process): fixed sub-agent test broken by Core round 12's proactive wake-up

Core round 12 (commit `b9384f2`) added proactive push-notification wake-ups: when a
background task or sub-agent completes, the parent agent now gets an automatic extra turn
to process the completion notification. That broke gap 2a's sub-agent-spawning test
(`e2e/server-protocol.test.ts` — "Agent tool spawns a real sub-agent") at
`expect(rootProvider.callCount).toBe(2)`: root now makes a real third call.

Traced why 3 is correct, not just bumped the number: root's turn 1 is the `tool_use` that
spawns the sub-agent (background, so its tool_result returns immediately without waiting on
the sub-agent); turn 2 is root's own "Root heard back from the sub-agent." text, which sends
it to SSE status "waiting"; turn 3 is the new proactive wake-up fired once the sub-agent
actually finishes, giving root one more turn to process that completion push notification
(mock provider's under-scripting safety net just repeats the last turn, so it also emits
"Root heard back..." text again — harmless, only `callCount` and the tree shape are asserted
after it).

That wake-up is asynchronous relative to root's first "waiting" SSE event, so a naive
"assert callCount right after seeing waiting" was flaky in the full-file run (caught it
failing both on `callCount` and later on the `getAgentTree()` status still reading
`"running"` mid-wake-up, in ~1/8 runs). Fixed by waiting for the *second* `agent_status:
waiting` event for `agent-root` (turn 2's, then turn 3's) before asserting `callCount` or
fetching the tree. Confirmed with 10 back-to-back full-file runs, no flakes.

**Gates:** `bun test e2e/server-protocol.test.ts` — 6 pass / 0 fail, confirmed flake-free
over 10 runs. `npx biome check e2e/server-protocol.test.ts` clean. `bun run typecheck` and
`bun run lint` on the full repo currently fail, but on pre-existing **uncommitted** changes
outside `e2e/` (`src/agent/runtime.ts`'s `AgentStatus` narrowing, a `task-stop.ts` format
nit, and others across `src/agent`, `src/tui`, `src/web`) — confirmed by `git stash`ing
everything and re-running `bun run typecheck` clean, then restoring. Not this round's scope
(out of `e2e/` ownership per `CLAUDE.md` §3) and not touched.

**Open threads:** the pre-existing uncommitted typecheck/lint failures above are Core/TUI/Web
territory, not e2e — flagging for whoever owns landing round 12's work, since a dirty tree
with failing gates was left uncommitted going into this round.

### 2026-07-15 — Round 7 (Hedy, fresh process): closed DH-0006, plain multi-turn conversation e2e coverage

Picked up `tracking/DH-0006-e2e-multiturn-conversation-coverage.md` (already `implementing`),
the oldest open thread in this domain — flagged by Round 1, re-flagged every round since
(Round 2, Round 2 gap-2a, Round 4, Round 5, Round 6 implicitly): every existing e2e test that
happens to touch a second exchange (the sub-agent-spawning test) does so as a side effect of
testing spawning, not as its actual point. No test asserted "a root agent, with no
sub-agents, holds a real second conversation exchange over real HTTP/SSE, and the second
response is provably conditioned on the first."

**Worktree note, again:** the fourth time this exact issue has recurred for this role — this
worktree started branched from the pre-domain-landing ancestor commit `12679e4` (zero unique
commits of its own; confirmed via `git merge-base --is-ancestor`), not from the real
`origin/claude/coordinator-onboarding-kab9ls` HEAD (`fb07db7`, which by this round also
includes the Spile-tracker migration — `tracking/DH-0001` through `DH-0008` and
`tracking/SPILE-SPEC.md`). Fast-forwarded before starting, same as every prior round. This is
now a firmly established pattern for this role specifically; worth the coordinator looking at
worktree provisioning rather than each instance independently rediscovering and working
around it.

**What I built:** one new test in `e2e/server-protocol.test.ts`,
`"a second send_message to a waiting root agent continues the same conversation"`, in the
existing top-level `describe` block alongside the other plain-root-agent scenarios (not the
sub-agent `describe` block below it — deliberately, since the whole point is proving this
without any sub-agent involved). Real compiled `dh --server`, real HTTP/SSE, one mock
provider scripted with two turns. Flow: send "Hi, my name is Ada." -> assert output "Nice to
meet you, Ada." -> wait for `agent_status: "waiting"` -> **only then** send "What is my
name?" -> assert output "Yes, I remember your name is Ada." -> wait for the second
`"waiting"` status.

The actual proof of shared conversation history (not just "two exchanges happened, who knows
if they were connected"): the mock provider's `requests` array captures every `/v1/messages`
body it actually received (`e2e/support/mock-provider.ts` already exposed this — no support
code changed). Asserted the *second* request's `messages` array has
`roles === ["user", "assistant", "user"]` and, flattening each message's content, that
element 0 contains the first user message, element 1 contains the model's first reply
verbatim, and element 2 contains the new user message — i.e. the real agent loop sent the
full prior exchange back to the provider ahead of the new turn. A test that only checked
`chunk === "Yes, I remember your name is Ada."` would have passed even if the second call had
been a completely fresh, context-free session (the mock provider doesn't care what's in the
request when scripted with plain `successTurn`s) — the request-body assertion is what
actually rules that out.

**Judgment call:** put this test alongside the existing single-turn tests in the first
`describe` block rather than inventing a new one — it is testing the exact same "plain root
agent" surface as `"send_message to agent-root runs a full turn..."`, just extended by one
more exchange, so grouping it there reads as "the next scenario in the same family" rather
than a new category.

**Gates:** `bun run typecheck` clean, `bun run lint` clean (one auto-fix applied by
`biome check --write` to this test's own formatting, nothing else touched).
`bun test e2e/server-protocol.test.ts` — 7 pass / 0 fail (was 6, now 7), 42 `expect()` calls.
`bun run test:coverage` — 806 pass / 0 fail, 100% coverage maintained (no `src/` files
touched this round). Full `bun run e2e` — 21 pass / 4 fail, all four the same pre-flagged
environment gaps every prior round has hit (no `tmux`, no Chromium binary at
`/opt/pw-browsers/chromium`, the pre-existing `security.test.ts` bearer-token SSE timeout) —
no regressions from this change.

**Ticket closed:** `tracking/DH-0006-e2e-multiturn-conversation-coverage.md` front matter set
to `status: closed`, `resolution: done`, with a Resolution section added; regenerated
`tracking/views/dark-harness-view.md` to move DH-0006 from `implementing` to
`Recently Closed`.

**Open threads unchanged:** the pre-existing uncommitted typecheck/lint failures flagged in
Round 6 were not present in this round's tree (clean `typecheck`/`lint` from the start, so
presumably landed by whoever owned that by now). TUI/web tests still need real `tmux`/a
Chromium binary in the sandbox to run — unrelated to this round, flagged every round since
Round 1.

### 2026-07-15 — Round 8 (fresh process again): closed DH-0033 and DH-0034

Came online fresh to work two tickets, both already `status: implementing`:
`tracking/DH-0033-mock-provider-cannot-simulate-errors-or-streaming.md` and
`tracking/DH-0034-e2e-flakiness-risks-and-missing-connect-web-coverage.md`. Same recurring
worktree-provenance bug, a fifth time (branched from the pre-domain-landing ancestor
`12679e4`, zero unique commits); fast-forwarded to real HEAD (`33dc751`) before starting —
now enough repeats across rounds that this really does look like something in the
provisioning path for this role specifically, worth someone actually tracing rather than each
fresh instance independently rediscovering and working around it every time.

**DH-0033 (mock provider can't simulate errors/streaming):** gave `e2e/support/mock-provider.ts`
an error-injection mode — `MockTurn.error` (status + JSON body, or a literal `rawBody` for a
malformed non-JSON response), with `errorTurn(status, body?)`/`malformedTurn(rawBody?)`
shorthands — and added five new scenarios to `e2e/exit-codes.test.ts`: 429, 500, a malformed
200-body response, and a mid-multi-turn failure (tool_use turn succeeds, resume call fails
with a 529). All assert `ExitCode.HarnessError` (>=2), proving the harness never raw-crashes
on a provider failure.

**Real discovery, not assumed going in:** first draft of these tests asserted
`provider.callCount === 1` per the ticket's own framing ("neither adapter retries, so one
failure kills the run") — every one of them failed with `callCount` of 3 or 4 instead. Traced
it to the `@anthropic-ai/sdk` client itself: it already retries retryable HTTP statuses
(429/5xx) up to its own default `maxRetries` (2) before the adapter's `try/catch` ever sees a
rejection — real retry behavior already exists today, just at the SDK layer, independent of
DH-0009 (harness-level retry/backoff/error taxonomy, still open). Fixed the assertions to
match reality (3 calls for a single retryable failure, 4 for the two-turn scenario) rather
than asserting what I'd assumed before running it, and rewrote the tests' own inline comment
to describe the actual mechanism instead of the wrong assumption. Flagged in the ticket's
Resolution that DH-0009 landing might reconfigure `maxRetries` and these counts should be
revisited then — Core's call, not e2e's.

**DH-0034 (port race / cleanup ordering / missing `--connect --web` coverage):** all three
findings addressed.

- `e2e/support/port.ts` gained `startDhServer` — wraps `findFreePort` + spawn + "listening on
  port" wait in a retry loop (3 attempts default): if a spawned `dh --server` doesn't confirm
  listening within 5s (losing the check-then-use race to a concurrently-running test file),
  it's killed and retried with a freshly-checked port. Retrofitted onto all eight existing
  `--server` call sites across `server-protocol.test.ts`, `security.test.ts`, `tui.test.ts`,
  `build-stamp.test.ts`.
- `e2e/support/cleanup.ts` (`createCleanupRegistry`) replaces the flat
  `cleanups: (() => void)[]` + manual-push-order convention with two stacks (`addProcess`,
  `addWorkspace`) — `runAll()` always drains every process cleanup before any workspace
  cleanup regardless of registration order, so a future test author pushing in the "wrong"
  order can no longer create the failure mode the ticket described. Retrofitted onto all
  seven e2e files that spawn processes and/or create workspaces.
- New `e2e/connect-web.test.ts`: a real `dh --server` (via `startDhServer`) plus a separate
  real `dh --connect <host> --port <n> --web` client process, driven with the same
  pre-installed-Chromium approach as `e2e/web.test.ts`. Asserts the connect-mode-specific
  ready message (`"connected to http://localhost:<port>"`) and that the browser-rendered
  output is genuinely the *remote* server's own SSE stream (the client process itself holds
  no usable model config — a correct render can only have come over the wire).

**Judgment call — mid-multi-turn error test's `Bash` tool call:** scripted the tool_use turn
with a real `Bash` tool call (`{ command: "echo hi" }`) rather than an arbitrary tool name, so
the scenario exercises a real tool execution before the provider error hits on resume, closer
to what an actual mid-run failure looks like than a synthetic no-op tool.

**What I could not verify in this sandbox:** no `tmux` and no Chromium binary at
`/opt/pw-browsers/chromium`, same gaps every round has hit since Round 1. This blocks running
`e2e/connect-web.test.ts` to actual completion — confirmed instead that everything short of
the browser launch works (real server spawn, real `--connect --web` client spawn, ready-line
parsing, the "connected to" assertion all pass; failure is exactly at `chromium.launch()`,
"executable doesn't exist"), which is as far as this sandbox lets any web/browser e2e test go
(same situation `e2e/web.test.ts` has always been in).

**Gates:** `bun run typecheck`/`bun run lint` clean across all touched files. `bun run
test:coverage`: 806/806 pass, 100% coverage unchanged (no `src/` touched this round). Full
`bun run e2e`: 25 pass / 5 fail — all five pre-existing/expected gaps (2 `tmux`-dependent
tests in `tui.test.ts`, 2 Chromium-dependent tests — `web.test.ts` and the new
`connect-web.test.ts` — and the pre-existing `security.test.ts` bearer-token SSE timeout
flagged since an earlier round) — no regressions introduced by this round's refactor of the
eight `--server` call sites or the seven cleanup-registry retrofits.

**Tickets closed:** DH-0033 and DH-0034, both front matter -> `status: closed`,
`resolution: done`, Resolution sections added; `tracking/views/dark-harness-view.md`
regenerated.

**Open threads:** none newly introduced. `tmux`/Chromium sandbox gaps are unchanged and, as
ever, not fixable from within this domain's own scope.
