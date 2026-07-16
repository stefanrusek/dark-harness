# Roster: Hedy — E2E domain lead

**Pronouns:** she/her
**Role:** E2E domain lead (`e2e/`) — real-binary end-to-end tests: PTY harness for the TUI,
headless browser for the web UI, HTTP/SSE across real processes, mock provider endpoint.
**Persistence:** persistent
**Owns:** `e2e/`
**Handoffs:** `docs/handoffs/e2e.md`

## Memory

### 2026-07-15 — Round 1: stood up the suite, found two real integration bugs

Picked "Hedy" (Hedy Lamarr) coming online — first time this domain has an owner (it was
blocked until Core's round 2 landed real Server/TUI/Web wiring).

**Worktree note:** the worktree I was launched into (`agent-afc969d4c7e712eba`) was
branched from an early ancestor commit (`12679e4`, before any of the five domains landed) —
not from `origin/claude/coordinator-onboarding-kab9ls` HEAD like the task briefing assumed.
Confirmed via `git merge-base --is-ancestor` that it had zero unique commits of its own, so I
fast-forwarded it to the real HEAD (`34e49a1`) before starting. Worth the coordinator
double-checking worktree provisioning if this recurs — a worktree silently missing five
domains' worth of code would otherwise look like "everything is stubbed" instead of "wrong
base commit."

**What I built:** see `docs/handoffs/e2e.md`'s 2026-07-15 status log entry for the full
rundown — mock Anthropic-compatible provider, a build-once-per-run helper, a tmux-based PTY
harness (documented why tmux over `node-pty`: no confirmed native-build toolchain, tmux
already present and verified), Playwright against the pre-installed Chromium with an
explicit `executablePath` (pinned `playwright-core` revision 1228 vs. the pre-installed
1194 — version mismatch, not a bug), and five test files (exit codes, server protocol,
security matrix, TUI, web) — 18 tests, all green, plus `typecheck`/`lint` clean.

**Judgment calls:**

- Chose to keep the mock provider minimal — only `POST /v1/messages`, since that's the only
  endpoint `AnthropicProvider.complete()` ever calls. No streaming support needed (the
  adapter never sets `stream: true`).
- When e2e testing surfaced two real cross-domain bugs (the TUI/Web root-agent bootstrap
  deadlock, and the missing CORS `Access-Control-Expose-Headers` for log-download
  filenames), I did **not** fix them myself (out of `e2e/`'s ownership, CLAUDE.md §3) and did
  **not** quietly design tests to avoid exercising the broken paths. Instead: confirmed each
  precisely (manual `curl` reproduction for the deadlock; comparing Node-`fetch` vs.
  real-browser-`fetch` behavior for the CORS issue), wrote tests that assert the *actual*
  current behavior with an inline explanation of why, and wrote up both prominently in the
  handoff status log as cross-domain requests. This is exactly the kind of thing ADR 0008
  says real-binary/real-browser e2e is for ("miss real integration failures unit tests
  wouldn't catch") — I think surfacing them loudly is more valuable than a quieter partial
  workaround, but flagging here in case the coordinator wants to route this differently
  (e.g. as a blocking issue vs. a routine next-round fix).
- Did not attempt to test a *second* message to an already-completed root agent (multi-turn
  conversation) — traced it far enough to notice `AgentRuntime.sendMessageToRoot` becomes a
  silent no-op post-completion (the `pendingMessages` queue it feeds is never drained again),
  which reads as a separate, narrower Core-domain question rather than something to route
  around in e2e's own coverage. Flagged, not resolved.

**Open threads for whoever picks this up next round:**

- Once TUI/Web fix the bootstrap deadlock, `e2e/tui.test.ts`'s local-mode test and
  `e2e/web.test.ts` can very likely drop their "kick off turn 1 via direct API call" workaround
  and drive the entire flow through real keystrokes/clicks — worth revisiting then, the
  comments in both files point at exactly what to change.
- Sub-agent (`Agent` tool) e2e coverage is a clean next slice: script a `tool_use` mock turn
  and assert the sidebar/tree shows a child node — the support modules here (mock provider's
  `toolCalls` field already exists) are ready for it, just not exercised yet.
- Haven't touched `.github/workflows/`; someone should confirm `bun run e2e` is actually
  wired into the gate (Nightingale's domain).

### 2026-07-15 — Round 2 (fresh process, no memory of Round 1): fixed the Round-5-superseded tests

Came online fresh (no memory of the Round 1 instance's session) to act on Core's Round 5
cross-domain request: three tests in `e2e/server-protocol.test.ts` still assumed "one message
ends the session" (a real design Core deliberately superseded that round — interactive
sessions now pause `"waiting"` between exchanges instead of ending), so they hung/failed.

Read this file and `docs/handoffs/e2e.md` first per CLAUDE.md §7's resuming convention, then
Core's Round 5 diagnosis (already precise — exact tests, exact line ranges, exact fix,
pointing at `src/cli.test.ts`'s own Round-5 fix as the pattern to mirror). Fixed all three:
swapped `session_ended` waits for `agent_status: "waiting"` waits in the resume and
download-logs tests (their actual point — SSE resume semantics, log/tar shape — never
depended on the session ending); for the full-turn test, added an explicit `stop_agent` POST
before the `session_ended` wait, and changed the expected `exitCode` from `0` to
`ExitCode.TaskFailure` (Round 3's "stop collapses into failed" convention, not a success
completion).

**Judgment call:** kept the fix minimal and mechanical, exactly as Round 5's request framed
it — no new coverage added (e.g. no new test for a genuine second exchange producing new
output; that's arguably still open work, see below) since the task was specifically "these
three tests are stale, fix them," not "expand multi-turn coverage." Full detail in
`docs/handoffs/e2e.md`'s Round 2 status log entry.

**Open thread still not picked up:** a real e2e test proving a *second* `send_message` to an
already-waiting root agent produces new output that references the first exchange (the
`runtime.test.ts`/`cli.test.ts` accumulating-echo pattern Core used in Round 5, at the
real-binary/real-HTTP+SSE level) — flagged by the Round 1 instance, still not built. Would
slot naturally alongside the now-fixed full-turn test in `server-protocol.test.ts`.

**Gates:** `bun run typecheck` clean, `bun run lint` clean on the touched file (pre-existing
untracked `dh.json` lint failure is unrelated, noted in the handoff), `bun test
e2e/server-protocol.test.ts` — 5 pass, 0 fail. Did not run the full `bun run e2e` (no
tmux/Chromium in this sandbox, unrelated to this change, per the task's own scoping).

### 2026-07-15 — Round 2, gap 2a (fresh process again): built sub-agent e2e coverage, found a real Core bug

Came online fresh again for the architect (Fable)'s two-gap review round. Same worktree
provenance issue as Round 1 recurred (worktree branched from the pre-domain-landing ancestor
commit `12679e4`, zero unique commits, fast-forwarded to real HEAD `0478707`) — now twice;
worth someone looking at why worktree provisioning for this role keeps picking the wrong
base.

**What I built:** full detail in `docs/handoffs/e2e.md`'s dated Round 2 status-log entry.
Short version: one new e2e scenario in `e2e/server-protocol.test.ts` driving a real
`tool_use` -> `Agent` tool -> nested sub-agent spawn through the actual compiled binary,
asserting real (not fixture) SSE events (`agent_spawned` for both root and child,
`agent_output` carrying each one's own `agentId`, root's own turn resuming after the
tool_result) and a real two-level `getAgentTree()` shape, plus confirming the sub-agent's own
JSONL log is independently downloadable via `download_logs`.

**Judgment calls:**

- Two separate mock-provider instances (one per model — root's own, the sub-agent's own) —
  not the one-shared-provider pattern every prior test used — because root's Agent-tool-call
  HTTP request and the sub-agent's own loop's HTTP request are a genuine concurrent race
  against a shared call-count queue once the tool actually executes; discovered this the hard
  way (first draft hung/mis-ordered) before landing on giving them independent providers.
- Found a real, previously-undetected bug exactly in the risk class this task called out:
  `AgentRuntime.spawnAgent()` (`src/agent/runtime.ts`) threads the root's `interactive` flag
  into every sub-agent too, so Round 5's "pause 'waiting' instead of ending" convention (meant
  for a human steering the root session) also applies to sub-agents — meaning a spawned
  sub-agent that already finished its one turn never reaches `"done"`, and the `Agent` tool's
  `run_in_background: false` blocking path (`ctx.tasks.awaitDone`, `src/agent/tools/agent.ts`)
  would hang forever in any interactive/server context. Did not fix it (Core's files) —
  confirmed by hand, wrote the committed test to assert the *actual* current behavior (child
  status `"waiting"`, not `"done"`) with a prominent inline comment explaining why, and wrote
  it up in full in the handoff rather than either quietly working around it or committing a
  test that would hang CI. Same posture Round 1 took for the TUI/Web deadlock and CORS
  findings.
- Did not attempt gap 2b (Bedrock provider e2e coverage) — prioritized 2a per the task's own
  instruction to do so if time-constrained. Still fully open for whoever picks this up next;
  said so explicitly in the handoff rather than silently dropping it.

**Gates:** `bun run typecheck` clean, `bun run lint` clean (145 files), `bun test
e2e/server-protocol.test.ts` 6 pass/0 fail/32 `expect()` calls, `bun run test:coverage` 693
pass/0 fail/100% coverage maintained. Ran the full `bun run e2e`: `exit-codes.test.ts` and
`server-protocol.test.ts` pass; `tui.test.ts`/`web.test.ts` fail on missing `tmux`/Chromium in
this sandbox (expected, same as every prior round); also noticed `security.test.ts`'s
bearer-token SSE test timing out here — confirmed pre-existing and unrelated to this round's
diff (touched file is only `server-protocol.test.ts`), not investigated further, flagged in
the handoff for a future round.

### 2026-07-15 — Round 4 (fresh process again): build-stamping survives real compilation

Came online fresh for Core Round 8's follow-on request (`docs/handoffs/e2e.md` Round 4).
Same recurring worktree-provenance issue (branched from the pre-domain-landing ancestor
`12679e4`, zero unique commits) — third time for this role; fast-forwarded to real HEAD
(`037952c`) before starting, same as Rounds 1 and 2 gap-2a.

**What I built:** full detail in `docs/handoffs/e2e.md`'s Round 4 status entry. Short
version: switched `e2e/support/build.ts`'s `ensureBuilt()` to shell out to
`bun scripts/build.ts --outfile dist/dh` instead of raw `bun build --compile`, and added
`e2e/build-stamp.test.ts` — two real-binary scenarios (`--server` and standalone
`--instructions --job`) that read each run's actual `agent-root.jsonl` header off disk and
assert `client` (`"server"`/`"none"`) and the full `build` stamp (`version`, 40-hex-char
`gitSha`, `releaseTag: null`) are really there, not just unit-tested in isolation.

**Judgment call:** for the `--server` scenario, had to first discover (by hitting an ENOENT)
that the root agent's JSONL log doesn't exist until the first `send_message` — a bare
`--server` start has no root agent yet. Fixed by connecting SSE and POSTing a real
`send_message` before reading the log file, mirroring the existing full-turn test in
`server-protocol.test.ts`.

**Gates:** `bun run typecheck`/`bun run lint` clean, `bun run test:coverage` 741/741 pass,
100% coverage. Full `bun run e2e`: 17 pass/4 fail, all four the same pre-flagged environment
gaps (no `tmux`, no Chromium binary, and the pre-existing `security.test.ts` bearer-token SSE
timeout noted in Round 2 gap-2a) — no regressions. The three files this round's diff actually
touches are 12/12 green in isolation.

**Open threads unchanged:** multi-turn second-`send_message` e2e coverage (Round 2) and gap 2b
(Bedrock provider e2e coverage, Round 2 gap-2a) are both still open for whoever picks this up
next.

### 2026-07-15 — Round 5 (fresh process again): closed gap 2b, Bedrock e2e coverage

Came online fresh for the 2b task order in `docs/handoffs/e2e.md`. This worktree/session was
branched correctly from the real HEAD this time (no ancestor-provisioning issue to flag).

**What I built:** full detail in `docs/handoffs/e2e.md`'s Round 5 entry. Short version:
`e2e/support/mock-bedrock-provider.ts` (a cleartext HTTP/2 mock server for Bedrock's
`Converse` API) and `e2e/bedrock-provider.test.ts` (3 scenarios: success, self-reported
failure, and tool_use-then-resume), all driving the real compiled binary and the real
unmodified `BedrockProvider` via the AWS SDK's own `AWS_ENDPOINT_URL_BEDROCK_RUNTIME`
environment variable — no source change to `src/agent/providers/bedrock.ts` needed, contrary
to what I initially expected after seeing it only reads `config.region`.

**Two real discoveries, in order:**
1. `BedrockRuntimeClient` resolves its endpoint via the SDK's standard env-var convention
   regardless of application code — meaning e2e could reach a local mock without any Core
   change, once I read the actual `@smithy`/`@aws-sdk` source in `node_modules` instead of
   assuming a code change was required.
2. `BedrockRuntimeClient` always builds an HTTP/2 request handler, even for the non-streaming
   `Converse` call — this only showed up by actually running the scenario against `Bun.serve`
   (HTTP/1.1) and hitting an opaque `node:http2` `TypeError`. Root-caused it by grepping the
   SDK's `runtimeConfig` for `requestHandler`, then rebuilt the mock on `node:http2`'s h2c
   server instead.

**Judgment calls:**
- Per this round's own instructions, deliberately built the `dh.json` fixture with
  `ModelConfig.name` ("bedrock-mock") different from `ModelConfig.model` (a fake Bedrock model
  id), and assert the mock's captured wire-level `modelId` equals the latter, not the former —
  this is the exact shape of bug Core's round 11 found and fixed via real AWS testing. Test 1
  would have failed pre-round-11.
- Did not write the optional Bedrock README section — explicitly routed to Prompt (owns
  `README.md`) in the handoff rather than doing it myself or silently skipping it, with the
  content Prompt would need summarized there.
- Chose obviously-fake (non-empty) static AWS credential env vars for the mock, not empty
  strings, to avoid the SDK falling through to a real credential-chain lookup in some
  environments.

**Gates:** `bun run typecheck` clean, `bun run lint` clean (152 files, one auto-fix applied to
the new test file), `bun run test:coverage` 745/745 pass, 100% coverage maintained (unit tests
under `src/` only — e2e is a separate gate). Full `bun run e2e`: 20 pass / 4 fail, all four the
same pre-flagged environment gaps as every prior round (no `tmux`, no Chromium binary, the
pre-existing `security.test.ts` bearer-token SSE timeout) — no regressions. New
`bedrock-provider.test.ts`: 3/3 green.

**Open threads for whoever picks this up next:** the Bedrock README addition (now explicitly a
request to Prompt, not e2e); multi-turn second-`send_message` e2e coverage (open since Round
1/2, still untouched, oldest open thread in this domain).

### 2026-07-15 — Round 7 (fresh process again): closed DH-0006, plain multi-turn conversation e2e coverage

Came online fresh to work `tracking/DH-0006-e2e-multiturn-conversation-coverage.md` (already
`status: implementing`) — the oldest open thread this domain has carried, flagged every
round since Round 1. Full detail in `docs/handoffs/e2e.md`'s Round 7 entry.

**Same recurring worktree-provenance bug, a fourth time:** branched from the pre-domain
ancestor `12679e4` again, zero unique commits; fast-forwarded to real HEAD (`fb07db7`) before
starting. This is now a firm pattern specific to this role across at least four separate
rounds/sessions — worth someone actually investigating the provisioning path rather than each
fresh instance independently rediscovering and working around it every time.

**What I built:** one new test, `"a second send_message to a waiting root agent continues the
same conversation"`, added to the existing top-level `describe` block in
`e2e/server-protocol.test.ts` (deliberately not the sub-agent block) — real compiled
`dh --server`, real HTTP/SSE, a two-turn mock provider. Sends a first message, waits for the
turn to fully complete (`agent_status: "waiting"`), *then* sends a second message and asserts
the new output. The part that actually proves shared history rather than two independent
runs: reading the mock provider's own captured second `/v1/messages` request body and
asserting it carries the full prior exchange (`roles === ["user", "assistant", "user"]`,
each message's content checked) ahead of the new user turn — a plain output-string check
alone wouldn't have ruled out a context-free second call.

**Gates:** `bun run typecheck` clean, `bun run lint` clean (one biome format auto-fix on the
new test), `bun test e2e/server-protocol.test.ts` 7/7 pass (up from 6), `bun run
test:coverage` 806/806 pass, 100% coverage (no `src/` touched). Full `bun run e2e`: 21 pass /
4 fail, all four the same pre-flagged sandbox gaps every prior round has hit (no `tmux`, no
Chromium binary, the pre-existing `security.test.ts` bearer-token timeout) — no regressions.

**Ticket closed:** DH-0006 front matter -> `status: closed`, `resolution: done`, Resolution
section added; `tracking/views/dark-harness-view.md` regenerated to reflect it.

**Open threads:** none newly introduced. The domain's other long-standing open items (Bedrock
README addition routed to Prompt; TUI/web tests needing a real `tmux`/Chromium in-sandbox)
are unchanged and not this round's scope.

### 2026-07-15 — Round 8 (fresh process again): closed DH-0033 and DH-0034

Came online fresh for two tickets in `tracking/`, both already `status: implementing`:
DH-0033 (mock provider can't simulate errors/streaming) and DH-0034 (port race, cleanup
ordering, missing `--connect --web` coverage). Full detail in `docs/handoffs/e2e.md`'s Round
8 entry. Fifth recurrence of the worktree-provenance issue (branched from `12679e4` again,
zero unique commits, fast-forwarded to `33dc751`) — worth flagging loudly enough by now that
someone actually traces the provisioning path for this role.

**DH-0033:** added error-injection to `e2e/support/mock-provider.ts` (`MockTurn.error`,
`errorTurn`/`malformedTurn` helpers) and five new exit-code-matrix scenarios. Real discovery:
my first-draft assertions (`callCount === 1`, matching the ticket's own "no adapter retries"
framing) were wrong — the `@anthropic-ai/sdk` client itself already retries 429/5xx up to its
default `maxRetries` (2), independent of DH-0009 (harness-level retry, still open). Corrected
the assertions and the inline reasoning to match observed reality rather than trusting the
ticket's framing uncritically once the test itself proved it wrong.

**DH-0034:** `e2e/support/port.ts` gained `startDhServer` (retry-on-bind-timeout mitigation
for the port-allocation race), retrofitted onto all 8 existing `--server` call sites.
`e2e/support/cleanup.ts` (`createCleanupRegistry`) replaces the flat-array +
manual-push-order convention with structural process-before-workspace ordering, retrofitted
onto all 7 files that need it. New `e2e/connect-web.test.ts` covers `dh --connect --web`
against a real remote `dh --server`.

**Judgment call — verifying what I can't fully run:** `connect-web.test.ts` needs a real
Chromium binary this sandbox doesn't have (same gap `web.test.ts` has always had). Rather
than leaving it entirely unverified, I ran it anyway and confirmed it gets all the way to
`chromium.launch()` before failing — real server spawn, real `--connect --web` client spawn,
ready-message parsing, and the connect-mode-specific assertion all pass first. That's the
strongest verification available without the missing tooling, and I said so explicitly
rather than implying full verification happened.

**Gates:** `bun run typecheck`/`bun run lint` clean, `bun run test:coverage` 806/806 pass
(100% coverage, no `src/` touched), full `bun run e2e` 25 pass / 5 fail — all five the
same pre-existing/expected sandbox gaps (2 `tmux`, 2 Chromium — including the new file — and
the pre-existing `security.test.ts` bearer-token timeout) — no regressions from retrofitting
15 call sites across 8 files.

**Both tickets closed.** No new open threads; `tmux`/Chromium sandbox gaps remain, as every
round has noted since Round 1.

### 2026-07-15 — Round 9 (fresh process again): DH-0056 hostile-Markdown TUI e2e coverage

Came online fresh for DH-0056 (Markdown rendering, not raw escape passthrough). Full detail
in `docs/handoffs/e2e.md`'s Round 9 entry. Worktree-provenance issue recurred with an extra
wrinkle: fast-forwarding to the `local/` remote's same-named branch tip still landed short of
the real local `claude/coordinator-onboarding-kab9ls` branch, which is what actually carried
DH-0056's landed work — checked `git merge-base` before each reset, no unique commits lost.

**What I built:** `e2e/markdown-rendering.test.ts` — a positive Markdown-formatting smoke
test and a hostile-input test combining DA/DSR, OSC 52 clipboard-hijack, and cursor/
screen-clear frame-spoof sequences in one scripted turn, both against the real compiled
binary via the existing tmux PTY harness. Added `TmuxSession.captureRaw()` (`tmux
capture-pane -e`) so hostile-ANSI tests can assert on the *raw* escape-inclusive pane content,
not just the already-stripped plain capture `capture()` returns.

**Web coverage explicitly deferred:** confirmed via `git log`/`find src/web -iname
"*markdown*"` that Susan's `src/web/client/markdown-dom.ts` hasn't landed yet — only the
shared parser and TUI's renderer exist. Follow-up round should mirror this round's TUI
scenarios for the DOM renderer once it lands.

**Real regression found (not mine, not fixed):** installed `tmux` via `brew install tmux` to
actually verify my new file against the real binary (never available in this sandbox before,
per every prior round's notes) — this let `e2e/tui.test.ts` run to completion for what looks
like the first time, and both its existing scenarios now hang on a `⚠ Reconnected — history
may be incomplete.` banner and never reach `"session ended"`, reproducible in total isolation
from my diff. Likely the recently-merged periodic SSE keep-alive (Server round 2,
`d7acdb4`) causing a spurious mid-turn reconnect. Flagged prominently in the handoff, not
fixed (Server/TUI's files) and not routed around in my own tests (switched my own wait
condition to rendered content instead of session-lifecycle text, which was the correct
target for what these tests are actually proving anyway).

**Gates:** `bun run typecheck`/`bun run lint` clean (171 files). `bun run test:coverage`:
1138/1138 pass on rerun, 100% coverage, no `src/` touched. `bun test
e2e/markdown-rendering.test.ts`: 2/2 pass. Full `bun run e2e`: 27 pass / 5 fail — 2
Chromium-path gap (pre-existing), 1 pre-existing `security.test.ts` timeout, 2 newly-surfaced
`tui.test.ts` reconnect failures (the regression above, not this round's diff).

**Open threads:** Web-side DH-0056 coverage (blocked on Susan's round landing); the
SSE-reconnect regression (Server/TUI cross-domain question, not e2e's to fix).
