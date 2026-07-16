# Roster: Grace — Core domain lead

**Pronouns:** she/her
**Role:** Core domain lead
**Persistence:** persistent
**Owns:** `src/agent/`, `src/config/`, `src/cli.ts`
**Handoffs:** `docs/handoffs/core.md`

## Memory

### 2026-07-15 — first round (resumed from a stopped instance's WIP)

I came online in an existing worktree (`worktree-agent-a572554c3ba0257bf`) with substantial
uncommitted work already on disk from a previous, stopped instance of this role: all of
`src/config/` (dh.json load/validate/interpolate), all of `src/agent/` except `runtime.ts`
and its providers/tools subtrees (Bash/Read/Edit/Write/Agent/ToolSearch/Skill/TaskOutput/
SendMessage/Monitor/TaskStop/McpAuth, the anthropic+bedrock provider adapters, the task
registry, the agent loop with its `TASK_FAILED` self-report convention), plus `bun.lock`/
`package.json` diffs adding `@anthropic-ai/sdk` and `@aws-sdk/client-bedrock-runtime`. I did
not have that instance's own memory of *why* it made each call — only the code and its
inline comments — so I read everything before touching anything, per METHODOLOGY.md's
"status supersedes" principle applied to inherited work-in-progress.

**What I inherited and fixed:**
- Two `exactOptionalPropertyTypes` typecheck errors in `src/agent/runtime.ts` (the
  composition root wiring config → providers → tools → loop → task registry) — the
  `AgentLoopParams.onEvent`/`onLogLine` are optional-but-not-`| undefined`, so passing
  `this.onEvent` directly (which *can* be `undefined`) violated strict optional-property
  typing. Fixed by conditionally spreading the key in only when defined
  (`...(this.onEvent ? { onEvent: this.onEvent } : {})`), same pattern in two call sites.
- `runtime.ts` had **zero tests** — it didn't even appear in the coverage report (bun's
  coverage tool only instruments files a test actually imports; an untested file is
  invisible to it rather than reported at 0%, which I confirmed by watching it appear only
  after I added `runtime.test.ts`). I wrote a full integration suite (16 tests) against a
  real local mock Anthropic-compatible HTTP server (`Bun.serve` returning canned Messages-
  API JSON, keyed off the last message's content so it's order-independent under concurrent
  sub-agents) — this exercises the *real* `AnthropicProvider` end-to-end rather than a fake
  `ModelProvider`, since `createProvider()` always builds a real adapter from config (that's
  literally how the "local provider" pattern in the sample `dh.json` is supposed to work).
  Now 100%/100% funcs/lines.

**What I built new:**
- `src/cli.ts` — the entry point didn't exist at all. Flags: `--web`, `--server`,
  `--connect <host>`, `--port <n>`, `--instructions <file>`, `--job`, `--config <path>`,
  mode-composed exactly per HANDOFF.md §2 / ADR 0001 (`composeMode()` is a pure function of
  parsed flags, independently unit-tested). `--instructions` reads a file (never inline
  text) and runs the root agent directly via `AgentRuntime` (Server/TUI/Web don't exist in
  this worktree yet, so there's nowhere else for that to live this round). `--job` maps the
  result onto `ExitCode` (0/1/2+) exactly per ADR 0006; verified live with three real
  subprocess runs against real local mock servers (success → 0, self-reported `TASK_FAILED`
  → 1, bad `--config` path → 2), not just unit tests. Every other run-mode combination
  currently calls one of five clearly-`TODO`-marked stub functions
  (`startHeadlessServerStub`/`startConsoleStub`/`startWebStub`/`startConnectStub`) instead of
  importing `src/server|tui|web` (which don't exist yet) — swapping stubs for real imports
  once those domains land should be a small, contained change since `main()`'s dependencies
  are already injected via a `CliDeps` interface built exactly for this kind of seam.
- Everything is dependency-injected (`loadConfig`/`readInstructions`/`loadSystemPrompt`/
  `createRuntime`/`io` all live on an overridable `CliDeps`), so tests exercise real
  filesystem/process defaults in some cases and fully-faked versions in others without
  needing `process.exit` to ever actually fire mid-test-suite (the one place it legitimately
  can — `defaultDeps().io.exit`/console.log/console.error — is covered by monkeypatching
  `process.exit` and `spyOn`-ing `console.*` for exactly one test each, then restoring).

**Cross-domain reconciliation (found by reading Server's landed work on
`claude/coordinator-onboarding-kab9ls`, read-only, never merged in):**
- Radia's `src/server/exit.ts` (`waitForExitCode`) subscribes to a `session_ended`
  `ServerSentEvent` to resolve `--job`'s exit code, but my (inherited) `loop.ts` never
  emitted one — a real integration gap, not a hypothetical. Fixed it at the right layer:
  `AgentRuntime.runRoot()` (not `loop.ts`, since "session ended" is a root/session-level
  concept — sub-agents spawned via `spawnAgent()` correctly do *not* emit it) now emits
  `session_ended` with `exitCode` mapped from the root agent's self-report on every normal
  return path, success or failure. Covered by two new tests. Documented inline in
  `runtime.ts` and flagged in `docs/handoffs/core.md`'s status log.
- Radia's `src/server/agent-loop.ts` defines an `AgentLoopHandle` interface she needs Core's
  real loop to satisfy (directly, or via a thin `cli.ts` adapter) once Server lands in this
  tree — and her handoff explicitly asks for this to be routed to Core as a reconciliation
  item rather than assumed to line up. I did **not** guess at building that adapter, because
  `src/server/` doesn't exist in this worktree and there's no way to build/typecheck against
  a shape I can't import — flagged explicitly for the coordinator instead of silently
  deferring it.

**Known, explained coverage gaps (not silent — per CLAUDE.md's "no silent truncation"
rule):**
- `src/agent/tasks.ts`: bun reports 94.74% func coverage (18/19) despite 100% line coverage.
  I instrumented every named/anonymous function in the file with a temporary `console.error`
  marker and confirmed **all 17 real functions fire** across the full suite — the 19th/18th
  entry bun's `FNF`/`FNH` counts isn't traceable to any actual code path (almost certainly a
  synthetic slot for the class's implicit field-initializer constructor). Not a real gap;
  the instrumentation script and its output are in this status-log entry's sibling section
  in `docs/handoffs/core.md` if anyone wants to re-verify.
- `src/cli.ts`: 99.44% lines (178/179), 100% funcs. The one uncovered line is the literal
  `await main(process.argv.slice(2));` inside `if (import.meta.main) { ... }` — I confirmed
  empirically that `import.meta.main` is only `true` for the actual process entry module and
  can't be forced true for an imported module from a test (tried it in an isolated repro).
  This is the same class of gap as Python's `if __name__ == "__main__":` — a genuine process-
  entry boundary, not something a unit test can reach without literally spawning `dh` as a
  subprocess (which is the E2E domain's job, not this round's gate). I verified it manually
  instead: ran `bun run src/cli.ts` three times against real local mock servers and confirmed
  exit codes 0/1/2 as documented above.

**Deferred / explicitly out of scope this round:**
- `McpAuth` — inherited as a documented stub (OAuth flow) per the handoff's own allowance;
  I didn't touch it.
- `src/agent/mcp.ts`'s `ToolSearch` backing — inherited scope note says it searches
  *configured* `mcpServers` entries and returns synthetic descriptors; it does not dial a
  real MCP server. I didn't change this.
- No actual `--connect` client, headless server, or TUI/web rendering — those are stubs by
  design this round (Server/TUI/Web haven't landed in this worktree). See the cross-domain
  section above for what Core still needs to reconcile once they do.

All three gates green: `bun run typecheck`, `bun run lint`, `bun run test:coverage` (233
tests, 99.85%/99.98% funcs/lines aggregate, both shortfalls explained above).

### 2026-07-15 — Round 2 (integration: wire cli.ts to the real Server/TUI/Web)

Worked from a **fresh worktree** (`grace-round2`, in `.claude/worktrees/`, branched from
`origin/claude/coordinator-onboarding-kab9ls` at `4fc7c5b`) per the coordinator's explicit
instruction — my round-1 worktree (`worktree-agent-a572554c3ba0257bf`) predates Radia/Mary/
Susan/Iris/Nightingale's work landing, so it wasn't safe to keep building in. Set it up with
`git worktree add .claude/worktrees/grace-round2 -b grace-round2
origin/claude/coordinator-onboarding-kab9ls` after `git fetch`, then `bun install`.

Full technical writeup (identifier unification, the onLogLine signature change, the real
send_message-to-unstarted-root bug I found via a live curl against a real running server,
the four run modes, cross-domain requests to Mary re: TUI token auth) is in
`docs/handoffs/core.md`'s dated Round 2 entry — this section is durable judgment/process
notes for a future me resuming this identity, not a duplicate of that log.

**Process note worth remembering:** my first `getAgentTree()` design (empty until `runRoot()`
had run) passed every unit test I wrote, because my unit tests all drove either a hand-built
fake `AgentLoopHandle` or called the adapter's own methods directly — none of them routed a
`send_message` through Server's *actual* `commands.ts` validation logic (which checks
`findAgent(getAgentTree(), agentId)` before ever calling `AgentLoopHandle.sendMessage()`).
I only found the bug by literally starting a real `dh --server` process and curling it by
hand, mid-implementation, to sanity-check the "start the root via its first message" flow
end-to-end before calling it done. Lesson for next time (and for reviewing anyone else's
cross-domain adapter work): a green unit-test suite against fakes doesn't prove the fakes
match the real contract's actual behavior — for any adapter implementing another domain's
interface, drive at least one test through *that domain's real code*, not just your own
mock of it. I did have real-DhServer integration tests already planned for the DoD's
"verify against a real local DhServer" language, and it was specifically writing/running
those (well, running the manual curl check before I'd even finished writing the automated
version) that surfaced this — so that DoD requirement earned its keep here, concretely.

**Identifier design decision I'm glad I made:** unifying task-registry ids with the loop's
own agentId (rather than building a translation table in the adapter) turned out to matter
more than I expected going in — it's *why* the send_message-to-root bug above was even
fixable cleanly. If sub-agent task ids and loop agentIds were still two separate spaces, the
adapter would need to translate in both directions for every operation, and the tree/events/
logs would need to agree on which id space they're each using at every call site. Keeping
one id space eliminated a whole category of "which id is this again" bugs before they could
happen. Worth defaulting to "unify the identifier space" over "add a translation layer" in
future cross-domain integration work here, when there isn't a strong reason not to.

**Open thread for whoever picks up Round 3 (if there is one) or the E2E domain:** the two
cross-domain requests in this round's status log (TUI token auth passthrough; loop.ts has no
real cooperative cancellation) are real, not decorative — worth checking whether Mary's
picked up the first one before E2E writes a security-matrix test that assumes the console
TUI can authenticate.

### 2026-07-15 — Round 3 (real cancellation: stopAgent actually stops something)

Worked from a fresh worktree (`grace-round3`, branched from
`origin/claude/coordinator-onboarding-kab9ls` at `f6ad86f`) — the coordinator had already
traced the exact gap (no `signal` on `AgentLoopParams`, `spawnAgent()` not forwarding
`handle.signal`, `runRoot()` with no `AbortController`) before opening the round, which made
this a much faster round than 1 or 2: no discovery phase, straight to implementation.

Full technical writeup in `docs/handoffs/core.md`'s dated Round 3 entry. This section is
judgment/process notes for a future me.

**Scope decision I'm glad I made:** the handoff explicitly allowed stopping at "cooperative,
checked between turns" and called deeper work (interrupting an in-flight provider call) a
nice-to-have. Before deciding how deep to go, I checked the actual installed SDKs'
`.d.ts` files (`@anthropic-ai/sdk`'s `RequestOptions.signal`, `@smithy/core`'s
`HandlerOptions` with `abortSignal`) rather than assuming support existed or guessing at API
shape. Since both genuinely supported it with a one-line change per adapter, I went ahead —
but the check-first approach is the actual lesson: "is this actually easy" is answerable in
under a minute by reading the dependency's own types, and it's a much better basis for a
scope decision than a vibe about how hard something "probably" is. I did NOT extend this
same effort to threading a signal through individual tool executions (`ToolContext`) — that
would touch all 12 tools' call sites and every tool test's helper, a much bigger and more
invasive change for a comparatively narrow benefit (a long blocking tool call is the
exception, not the common case, for what "stop" needs to feel responsive for) — scoped that
out explicitly rather than either silently skipping it or over-building.

**Test design choice worth remembering for future cancellation/timing-sensitive work:** the
`runtime.test.ts`/`cli.test.ts` regression tests use mock HTTP servers that **never respond**
on their own. This means: if the abort signal genuinely doesn't propagate all the way to the
outbound fetch, the test hangs and fails via bun's default per-test timeout, rather than
passing by accident (which a "responds after a short delay, then check a flag" test design
would risk under CI timing variance). A test that can only pass by actually interrupting a
truly-pending operation is a stronger proof than one that races a timer. I'll default to this
pattern for any future "does cancellation really work" test rather than sleep-and-check.

**Ownership boundary held even when explicitly invited to cross it:** the round-3 handoff
said "your call, and this may mean a request to Hedy/E2E rather than you touching e2e/" —
i.e. it explicitly offered me the option to just add the file myself. I still routed it as a
request (with a concrete, actionable spec — not just "someone should add a test") rather than
writing into `e2e/` directly, consistent with how I've treated `src/tui/`, `src/server/`,
`src/web/` in rounds 1-2. The bar I'm using: an explicit invitation from a handoff doesn't
override the ownership map in CLAUDE.md §3 by itself — I'd want that to come from the
coordinator specifically reassigning the file, or from Hedy herself, not infer it from being
given latitude on a judgment call. Flagging this here in case a future me (or the
coordinator) disagrees with where I drew that line — it was closer than the round-1/2 calls.

**Verification discipline that paid off again:** did a real live subprocess test (not just
unit tests) — real `dh --server`, a real never-responding mock provider process, `curl`
driving the actual HTTP command API — timing the root's status transition from stuck
`"running"` to `"failed"` after `stop_agent`. This is the third round in a row where a live
process-level check surfaced or confirmed something the unit tests alone wouldn't have
(round 2's send_message-to-unstarted-root bug was found exactly this way). Worth keeping as
a standing habit for this identity: before calling a round done, drive the actual owner-
facing flow through a real process at least once, not just through fakes.

### 2026-07-15 — Round 4 (fix: rootStatus stuck 'running' forever on a runRoot() crash)

Worked from a fresh worktree (`grace-round4`, branched from
`origin/claude/coordinator-onboarding-kab9ls` at `abe2a78`) — a bug the coordinator found by
hand while independently verifying my round-3 cancellation fix (not a fix I asked for or
anticipated; the coordinator was doing exactly the kind of live-process verification I've
been advocating for in my own notes, and it paid off — a real bug I hadn't hit in any of my
own test scenarios because none of them happened to use a config that crashes the provider
call specifically).

Full technical writeup in `docs/handoffs/core.md`'s dated Round 4 entry. This section is
process notes.

**What made this round fast:** the coordinator's own diagnosis was exact — file, line,
mechanism, and a concretely correct suggested fix, all before I even started. There was
essentially no discovery phase; the work was implement-the-suggested-fix, verify it actually
closes the gap (not just "doesn't crash"), and check whether the fix's scope was exactly
right or needed adjusting (it was exactly right — see the handoff entry's "scope check" on
why I didn't also wrap `resolveModel`/`providerFor`). This is a good illustration of why the
fleet's escalation/handoff model works: a precise bug report with a proposed fix turns a
round that could have needed real investigation into a mostly-mechanical implementation
task, freeing the actual judgment for the one real open question (does the fix's scope need
to be wider than suggested, and it didn't).

**Verification habit paying off across rounds, now including catching me being wrong:**
rounds 2 and 3 both had a "live process check surfaced something the unit tests alone
wouldn't have" moment, and this round is a data point in the *other* direction — the
coordinator's own live check caught something *my* unit tests missed, in code I'd already
"verified" thoroughly in round 3. Worth internalizing: live verification isn't just a
belt-and-suspenders habit for my own work, it's also *why* the coordinator caught this in
the first place, and it's exactly the same discipline in both directions. I re-ran the
coordinator's exact repro (real `dh --server`, real 401-returning mock server, `send_message`
then four `request_agent_tree` polls over ~20 seconds via curl) as my own closing check
before calling this done, rather than trusting the regression tests alone to prove the fix
holds at the same real timescale the bug was found at.

**Open thread, not urgent:** the `resolveModel()`/`providerFor()` narrower case (see the
handoff entry's "scope check") is unreachable from any current caller, but only because
`src/cli.ts` happens to never call `runRoot()` with an explicit `modelName`. If a future
round adds a code path that does (e.g. a per-message model override from the TUI/Web input),
this narrower gap becomes reachable and worth revisiting — flagging so it doesn't get
silently forgotten.

### 2026-07-15 — Round 5 (interactive sessions can now have more than one exchange)

This was the deepest design round since round 1/2 — not a bug-with-a-precise-fix like rounds
3/4, but a genuine "figure out the right shape" task, as the handoff itself said it should
be. Full technical writeup in `docs/handoffs/core.md`'s dated Round 5 entry. This section is
judgment/process notes for a future me.

**The core design decision, and why I'm confident in it:** a per-runtime-instance
`interactive: boolean` flag (not a per-call one) threaded from `AgentRuntimeOptions` down
into every `runAgentLoop()` call that `AgentRuntime` instance ever makes. I considered (and
rejected) a per-call flag on `spawnAgent()`/`runRoot()` instead — it would let a single
runtime mix standalone and interactive sub-agents, which sounds flexible but isn't a real
scenario: a runtime is always entirely one or the other in practice (one CLI invocation, one
mode), and a per-call flag would create a footgun where forgetting to pass it silently falls
back to the wrong mode. Binding it to construction time (`AgentRuntimeLoopAdapter` always
passes `interactive: true`; the standalone `createRuntime` dep never sets it) means there's
exactly one place per code path where the mode is decided, and it can't drift call-to-call.

**The "no natural completion" consequence is real, not a rounding error — I said so
explicitly rather than let it be an implicit surprise.** Before this round, `session_ended`
with a Success exit code could fire for *any* root run, standalone or interactive. After this
round, it essentially can't fire for an interactive root at all — the only way an
interactive session ends is a stop (collapsing to `TaskFailure`, Round 3's convention) or
`maxTurns` (also `"failed"`). I flagged this loudly in the handoff entry rather than let a
future reader discover it by noticing `session_ended: Success` never shows up in interactive
traces and wondering if something's broken. It isn't — it's the design's actual shape now,
and it matches a real chat UX (a conversation doesn't "succeed," a task does).

**Process win: I caught my own regression by actually running the suite, not by reasoning
about it in the abstract.** After writing the loop.ts/runtime.ts changes, `bun run
test:coverage` timed out on two existing `cli.test.ts` tests — they encoded the exact
bug-as-a-feature I was removing ("send one message, wait for `session_ended`"). I could have
been tempted to treat a pre-existing green test as ground truth and second-guess my own
design instead, but the handoff's own bug report — reproduced live against LM Studio by the
owner and coordinator — was the actual ground truth; the tests were testing the bug. Fixed
by rewriting them to prove the *new* correct behavior (waiting-not-done; exit code only via
explicit stop; a second `send_message` provably referencing the first via an
accumulating-echo mock provider), not by reverting my design to keep old tests green. Worth
remembering next time a "regression" shows up while implementing a deliberate behavior
change: check whether the test encodes the bug before assuming the code is wrong.

**Ownership boundary held under real pressure this time, not just a hypothetical:** my
change breaks three real tests in `e2e/server-protocol.test.ts` (Hedy's domain) for the
identical reason the `cli.test.ts` ones broke — confirmed by actually running `bun run e2e`
and watching two of them hang to the 5s timeout, not by inspection alone. I diagnosed the
exact fix needed (same pattern as my own `cli.test.ts` rewrite: wait for `"waiting"` instead
of `session_ended`, add an explicit `stop_agent` where an exit code is actually wanted) and
wrote it up as a concrete, actionable request in the handoff rather than reaching into
`e2e/` myself, consistent with the line I drew in Round 3. This is the first round where my
own change *directly causes* another domain's tests to fail rather than just leaving a gap
they might want filled — a slightly different flavor of cross-domain courtesy than before,
but the same boundary.

### 2026-07-15 — Round 7 (sub-agents no longer inherit the root's `interactive` flag)

E2E's round-2 sub-agent-spawning coverage found a real bug (documented inline in its own
test, flagged as out-of-scope for E2E to fix): `spawnAgent()` in `src/agent/runtime.ts` was
passing the runtime-instance `interactive` flag into every sub-agent's loop params too, not
just the root's — so any sub-agent spawned from an interactive server/TUI/Web session
inherited Round 5's "pause instead of end" semantics and hung `"waiting"` forever instead of
ever reaching `"done"`, since nothing was ever going to call `SendMessage` on it to wake it
back up. This silently broke the `Agent` tool's blocking (`run_in_background: false`) mode in
exactly the contexts (server/TUI/Web) where most real usage happens.

**The fix itself was one line** (`interactive: this.interactive` → `interactive: false` in
`spawnAgent()`'s call to `runAgentLoop()`), but I didn't stop at "make the obvious change" —
the handoff explicitly asked me to confirm `SendMessage`-driven mid-conversation steering of a
still-running sub-agent wouldn't regress, and the honest way to check that was reading
`loop.ts` closely rather than assuming the one-line change was safe by construction. It is
safe: `registerSendMessage`'s pending-message queue is armed and drained unconditionally,
regardless of `interactive` — `interactive` only gates the decision made *after* a turn
returns with no tool use, which is exactly the one thing this fix needed to change and
nothing else. Wrote a dedicated regression test proving this rather than trusting the code
read alone, consistent with this identity's standing "prove it, don't just reason about it"
habit.

**A pre-existing test had encoded the bug as an expectation, and I judged that the honest fix
was to replace it, not patch around it.** The Round 5 describe block's second test asserted a
sub-agent under an interactive root *should* pause `"waiting"` after one exchange — true
before this round, actively wrong after. I deleted it and split its still-valid coverage
across two new, more precisely-targeted tests rather than trying to minimally edit an
assertion that no longer described a real invariant. This is the same judgment call as Round
5's own "the tests were testing the bug" moment, now encountered from the other side — as the
person whose earlier-round test itself needed to go.

**Held the `e2e/` ownership boundary on a one-line, unambiguous fix.** `e2e/
server-protocol.test.ts`'s own test had already documented this exact bug inline as a known
Core gap, with a precise note on what to change once fixed. I ran it, confirmed it now fails
exactly where expected (child's expected `status: "waiting"` needs to become `"done"`; the
root's stays `"waiting"` correctly, unchanged), and wrote up the one-line fix as a request
in `docs/handoffs/core.md` rather than editing `e2e/` myself — same standing rule as Round
3/5, held even though the fix is about as small and unambiguous as this kind of request ever
gets.

**Gates:** all four run; `bun run e2e`'s PTY/browser suites still aren't runnable in this
sandbox (no tmux/Chromium), but I ran `e2e/server-protocol.test.ts` directly per the round's
own instructions — 5/6 pass, the 1 failure being the pre-existing, now-flagged, not-a-new-
regression assertion above. Full detail in `docs/handoffs/core.md`'s dated Round 7 status log
entry.

**Verification discipline, continued:** live-verified with the real compiled binary — a real
mock HTTP provider, a real `dh --server` process, `curl`-driven `send_message` twice in
sequence, `download_logs` afterward showing both exchanges as one JSONL history with a real
`running`→`waiting` cycle for the *second* message specifically (not just "some log lines
exist"). This is the fourth round in a row where a real-process check was the actual
closing proof, not a supplement to it — I'm now treating this as load-bearing methodology
for this identity, not just a nice-to-have.

### 2026-07-15 — Round 6 (three architect-flagged gaps: JSONL logging, cost pricing, maxTurns config)

Bundled round, three independent fixes sharing the same three touched files
(`src/contracts/config.ts`, `src/cli.ts`, `src/agent/runtime.ts`) — Fable's gap analysis
against `HANDOFF.md` found all three, and pre-approved the `config.ts` shape as architect
sign-off (CLAUDE.md §6.2), so no separate contracts round-trip was needed this time. Full
technical writeup in `docs/handoffs/core.md`'s dated Round 6 status log entry. Judgment/
process notes for a future me:

**6a's key design call: reuse Server's `SessionLogger` directly rather than reimplementing
a JSONL sink in Core.** `SessionLogger` was already exported from `src/server/index.ts` and
`src/cli.ts` already imports several Server-domain types/classes (`DhServer`,
`AgentLoopHandle`, etc.) for the interactive path — importing `SessionLogger` too for the
standalone path is consistent with that existing pattern, not a new cross-boundary edit (I
never touched a file under `src/server/`). The alternative — writing a second, subtly
different JSONL writer inside `src/agent/` or `src/cli.ts` — would have created exactly the
kind of drift ADR 0005 is trying to prevent (one logging format, one implementation). Also
confirmed `loop.ts` already emits its own `LogHeader` line per agent, so this round didn't
need to write any header logic by hand — genuinely just a wiring gap, not a missing
capability.

**6b's `exactOptionalPropertyTypes` friction, worth remembering:** a ternary of the shape
`cond ? { pricing: X } : {}` fails to typecheck when `X`'s own declared type is `T |
undefined`, even inside the true branch where `X` is provably defined at that point —
TypeScript can't correlate the ternary's condition with a *different* expression's
narrowing. Solution used here (and in the `maxTurns` sibling case) was a small named helper
function that computes the value once, checks it for `undefined` with an early return, and
only then builds the object literal — `pricingOverride(model)`. Slightly more verbose than
I'd like, but it's the actually-correct way to satisfy this compiler flag rather than
reaching for an `as` cast to paper over it (a cast would have hidden a real case: what if a
future price field is added and someone forgets to update this helper?).

**Test-writing quirk in 6c's regression test:** the existing mock Anthropic server in
`runtime.test.ts` branches on `lastMessage`'s text, but after any tool call the *last*
message is a `tool_result` block (no text), so a naive "keep returning tool_use forever"
branch keyed on `text.includes(...)` would silently stop matching after the first turn. Had
to key the new `loop-forever` branch off `body.messages[0]` (the original instruction) —
the first message in the array — instead, since that's always still text no matter how many
tool-call round-trips have happened since. Worth remembering for any future maxTurns-related
mock-provider test: "keeps going forever" scripting needs to ignore later-turn tool_result
noise and look at the original instruction.

**Verification discipline, continued:** all three sub-items got dedicated regression tests
at the layer that actually proves the fix — 6a via a real `--instructions --job` CLI
invocation against a real mock HTTP provider (not a stubbed runtime) asserting a real file
exists on disk; 6b/6c via `AgentRuntime`-level tests against the same real mock-provider
pattern already established in this suite, not just `loop.ts`-level unit tests, so the
config-to-loop threading itself is covered, not just `loop.ts`'s pre-existing internal
logic. `bun run e2e` was not run this round (sandbox still lacks `tmux`/Chromium, the same
gap every prior round has hit) — noted explicitly in the handoff rather than silently
skipped.

### 2026-07-15 — Round 8 (client + build identity in the log header; `scripts/build.ts`)

A contracts round with real architect sign-off already in hand (Fable's ADR 0005 amendment),
so there was no design ambiguity to resolve — the work was faithful implementation across
five touched surfaces (contracts, a new build-info module, a new build script, plumbing
through loop.ts/runtime.ts/cli.ts, a `--version` rider) plus the mechanical fallout of making
two previously-optional-in-practice fields required everywhere. Full technical writeup in
`docs/handoffs/core.md`'s dated Round 8 status log entry. Process notes for a future me:

**The "required, not defaulted" instruction was worth taking literally, and it had a real
cost worth planning for up front.** The handoff explicitly said `client` should be required on
`AgentLoopParams`/`AgentRuntimeOptions` "so no call site can silently record a wrong value" —
I could have taken a shortcut (default to `"none"` in the constructor, keep the type
optional) and every existing test would have kept compiling untouched. I didn't, because the
whole point of the amendment is that a silently-wrong `client` value defeats the diagnostic
it exists to enable — a defaulted field is exactly the kind of thing that quietly drifts. The
real cost was ~50 existing test call sites across `runtime.test.ts`/`cli.test.ts` needing a
mechanical update; I handled `runtime.test.ts`'s ~40 sites with one small wrapper function
(`newAgentRuntime()`, defaults `client: "none"`) plus a scripted find-replace rather than
hand-editing each one, which kept the diff's actual content small and reviewable despite the
line count. Worth defaulting to "add one small test-local wrapper + scripted replace" over
either "hand-edit every site" or "make the field secretly optional to avoid touching tests"
next time a required-field change has a wide test-fixture blast radius.

**Found a real cross-file compile break outside my own three planned files, and fixed it
rather than treating it as someone else's problem to notice later.** `src/server/logger.test.ts`
and `src/server/server.test.ts` (Server-owned) had inline `LogHeader` object literals that
stopped type-checking the moment `client`/`build` became required — not something the round-8
handoff called out, since it was written before realizing every existing literal construction
of the type (not just constructor calls) would need updating. Since `bun run typecheck` is a
whole-repo gate, not a per-domain one, leaving those broken would have made the round
incomplete by its own definition of done even though the fix is one line per literal and
doesn't touch Server's actual logic/assertions. Fixed both directly (mechanical `client`/
`build` additions only) and flagged it explicitly in the status log as a cross-boundary touch,
rather than either silently leaving typecheck red for another domain to discover, or quietly
not mentioning that I'd touched files outside my three planned ones.

**Left one honest loose end rather than over-fixing it under time pressure to call the round
"clean":** `createStandaloneRuntime()` hardcodes `client: "none"` internally instead of
reading the `client` argument that `CliDeps.createRuntime` now formally accepts and that
`main()` now passes through. It's correct today (the only caller ever passes `"none"`), and
wiring it through fully would have meant either changing `createStandaloneRuntime`'s own
signature (a bigger, not-asked-for change to a function whose contract Round 6a specifically
designed) or introducing an unused-parameter warning at the type level to route around it.
I judged flagging this precisely in the status log was the more honest choice than quietly
"fixing" it with a change nobody asked to review, or not mentioning the parameter is currently
decorative for that one call site.

**Verification discipline, continued:** live-verified `scripts/build.ts` itself (not just its
unit-testable pieces) against four real scenarios — a clean stamped build, a `--release-tag
v0.1.0` build, a rejected non-`v`-prefixed tag (exit 2, no binary produced), and a raw `bun
build --compile` bypassing the script entirely (confirms "unstamped" is what a caller sees,
not a crash) — each checked by actually running the resulting binary's `--version`, not by
reading the script and assuming it's right. This is the same standing habit this identity's
prior rounds established (a live process check before calling something done), applied here
to a build-tooling script rather than a running agent process.

**Gates:** all green — `bun run typecheck`, `bun run lint`, `bun run test:coverage` (741
tests, 99.96%/100% funcs/lines aggregate; the sole func-coverage shortfall is `src/cli.ts`'s
pre-existing `if (import.meta.main)` process-entry gap from round 1, not a regression this
round introduced). `bun run e2e`: sandbox still lacks `tmux`/Chromium (same gap every prior
round has hit) — 15/19 pass, the 4 failures confirmed to be exactly the missing-binary ones,
not new assertion failures. Full detail in `docs/handoffs/core.md`'s dated Round 8 status log
entry, including the explicit confirmation that both `scripts/build.ts` and the new
`LogHeader` shape are fully complete (not stubs) for Server/CI-Release/E2E's follow-on
rounds to build against.

### 2026-07-15 — Round 9 (scripts/build.ts: accept `--flag=value`, reject unknown args)

Small, precisely-scoped fix — Nightingale found it the exact way this identity's own rounds
have kept finding bugs: by checking the actual output artifact (`file` on the compiled
binary showed native arm64 Mach-O instead of the requested Linux ELF), not from any error
message, since the script's own "stamped build" success line gave no indication anything was
wrong. `parseArgs()` in `scripts/build.ts` only matched `--target` as an exact token
(space-separated value); `--target=<value>` was silently swallowed as an unrecognized token
with no rejection logic to catch it, so the build silently proceeded for the host arch.

**Fix:** each flag now detects an inline `=value` by splitting on the first `=` in any
token starting with `--`, falling back to consuming the next argv slot when there's no
inline value — same recognition logic for all three flags (`--target`/`--outfile`/
`--release-tag`) for consistency. Any token that isn't a recognized flag in either form now
prints `scripts/build.ts: unrecognized argument "<arg>"` and exits 2 immediately, rather than
being silently dropped — this is the change that would have caught the original bug
immediately instead of needing a `file`-based binary inspection to discover it.

**Small implementation note:** biome's `noAssignInExpressions` rejected my first draft's
`argv[(i += 1)]` inline-assignment-in-subscript style; rewrote as an explicit `i += 1; x =
argv[i]` two-liner inside each branch instead. Not a design decision, just a lint-driven
mechanical rewrite — noting it in case a future me reaches for the terser form again and
hits the same lint error.

**Checked, didn't change:** `src/cli.ts`'s own `parseArgs` doesn't support `=value` either
and has no unknown-arg rejection to mirror — the round asked me to check for an existing
convention there, not necessarily copy one; since none exists, `scripts/build.ts` now sets
its own local convention rather than either inventing a mismatched one or leaving the bug
unfixed. Didn't touch `src/cli.ts` — out of this round's scope.

**Verification, same standing habit as every prior round — live process check, not just
reading the diff:** ran the actual script three times against the real host toolchain (this
is arm64 macOS): `--target=bun-linux-x64 --outfile /tmp/dh-test` → `file` confirmed a real
`ELF 64-bit ... GNU/Linux` binary (the `=` form now honored); `--target bun-linux-x64
--outfile /tmp/dh-test2` (space form) → same ELF output, confirming no regression to the
pre-existing form; `--bogus-flag foo` → stderr message plus exit 2, no binary written. Both
test binaries deleted afterward, nothing test-artifact left in the tree.

**Gates:** `bun run typecheck` and `bun run lint` both green. No unit test added — `scripts/`
is exempted from the 100% coverage gate per Round 8's own note, and this round's own DoD
asked for documented manual verification as the alternative, which is what's recorded above
and in `docs/handoffs/core.md`'s dated Round 9 entry. `bun run test:coverage`/`bun run e2e`
not re-run this round since no `src/` file changed.

### 2026-07-15 — Round 10 — costUsd reaches the JSONL log now, not just SSE

Two-file fix: added `costUsd?: number` to `LogEvent`'s `token_usage` variant in
`src/contracts/log.ts` (additive, same optional-field pattern as the two cache-token fields
already there), then added the missing `...(costUsd !== undefined ? { costUsd } : {})` spread
to the `emitLog` call in `src/agent/loop.ts` — it sits right next to the `emitEvent` call
that already had this spread since Round 6b, so the two had simply drifted apart rather than
one never being written. Added two regression tests in `loop.test.ts` mirroring the existing
Round 6b SSE-event tests but asserting on `logLines` instead of `events` (configured-pricing
case gets `costUsd: 10.5`; unconfigured case has no `costUsd` key at all). All four gates
green: typecheck, lint, test:coverage (743 pass, 100% cov except cli.ts's pre-existing,
unrelated process-entry gap), e2e (17/21, same sandbox tmux/Chromium gap every round hits).

**Durable note for future me:** this bug shipped in Round 6b because that round's own tests
only asserted on the SSE `events` array, never on `logLines` — the two are emitted from the
same function with near-identical object literals but are genuinely separate calls
(`onEvent` vs `onLogLine`), so nothing type-checks them into agreement automatically. Worth
remembering next time I touch either `emitEvent` or `emitLog` in `loop.ts`: if one call site
gets a new optional field, check whether its sibling call a few lines away needs the same
field, and add a test on *both* arrays, not just the one that's easiest to assert on.

### 2026-07-15 — Round 11 (fix: every provider call was sending the config alias, not the real model id)

Full technical writeup in `docs/handoffs/core.md`'s dated Round 11 entry. Process notes for a
future me.

**Why this shipped invisibly for ten rounds, and the actual lesson:** every existing test
fixture across the suite that happened to need a `ModelConfig` used a `name`/`model` pair that
either matched, or was never actually asserted on at the wire-request layer. `runtime.test.ts`'s
own `baseConfig()` fixture already had `name: "test-model"` vs `model: "mock-1"` deliberately
different since early rounds (for other reasons — distinguishing model-lookup-by-name from the
id sent over the wire never came up because nothing read the mock server's *request* body's
`model` field, only its response). The bug was reachable through the existing fixtures the
whole time; nothing was looking. Worth generalizing: a fixture that deliberately varies two
fields doesn't guarantee coverage of every place that could confuse them — only an assertion
that actually reads the value at the point of use does. I'll be more suspicious in future
rounds of "this config already has different name/model values, so it must be covered" as a
substitute for grepping every actual read site.

**Design call: a second field on the loop's own internal params, not a `src/contracts/`
change.** `AgentLoopParams` lives entirely in `src/agent/loop.ts` — it's Core's own internal
shape, never re-exported as wire truth, so adding `providerModel` needed no architect
round-trip (CLAUDE.md §6.2 only gates `src/contracts/` edits). Kept `model`'s existing meaning
untouched (friendly alias, display-only) rather than repurposing it, so the SSE event/log
header display paths needed zero code changes at their own call sites — only the two
`runtime.ts` construction sites and the one `provider.complete()` read site changed, which
kept the diff small and made "did I break display" trivially checkable by re-reading those
three untouched lines rather than needing new display-path tests.

**Verification discipline, continued — the fourth-plus round in a row where a live
subprocess check was the actual closing proof, not a supplement to it.** Same standing habit
as rounds 2/3/4/7: real `bun run src/cli.ts`, a real local mock HTTP server that logs the
literal `model` field of every request it receives, a `dh.json` with a deliberately-different
alias/id pair. This is exactly the class of bug the coordinator found by doing the equivalent
against real AWS Bedrock — a fake/mock that never inspects the field it's supposedly testing
against is indistinguishable from no test at all for that specific claim. Confirming this
directly at the real-HTTP-request layer (not just `provider.calls[]` in a unit test) is what
would have caught this bug before it shipped, and is what closes it out now.

### 2026-07-15 — Round 12 (push notification on background task/sub-agent completion)

Full technical writeup in `docs/handoffs/core.md`'s dated Round 12 status log entry. Judgment/
process notes for a future me.

**The key design decision: liveness is a status check, not "is a sink registered."** Both
`rootSendMessage` and a task's own `sendMessage` closure (set via `registerSendMessage`) are
never cleared once the owning loop returns — they just become stale closures over a dead
`pendingMessages` array nobody will ever drain again. I could have used "is a sink present" as
the delivery gate and it would have compiled and mostly worked, but it would silently
misreport orphaned deliveries as "delivered" (the call doesn't throw, it just goes nowhere).
Gating on `AgentStatus` (`"running"`/`"waiting"` = live; `"done"`/`"failed"` = stale) instead,
and specifically also checking `rootStarted` (since `rootStatus` defaults to `"waiting"` even
before `runRoot()` has ever been called — Round 2's own convention), is what makes the
"orphaned grandchild" case actually detectable rather than silently misreported.

**The orphaned-grandchild edge case — my answer, stated for the record since the owner asked
for one explicitly rather than leaving it implicit:** best-effort live delivery; always logged
regardless, as a `role: "system"` line on the *settled task's own* log (guaranteed still open,
unlike the parent's, which may already be closed/gone) rather than the parent's. I considered
and rejected two fancier alternatives: (a) queuing the notification for later delivery if the
parent somehow resumes — rejected because nothing in this codebase's model ever un-finishes an
agent, so "later" never actually arrives; (b) re-parenting an orphaned notification up to the
grandparent — rejected as solving a problem nobody asked for and adding a second delivery path
with its own liveness question. "Never lost, never blocks, never retries" is the right minimum
scope for this round; flagged explicitly in the handoff as a future round's call if operators
ever need more.

**Found a real, expected e2e regression caused by this round's own behavior change, and held
the ownership boundary on it — the fourth time this exact pattern has come up (rounds 3, 5, 7,
now 12).** `e2e/server-protocol.test.ts`'s Round 2 sub-agent-spawning test asserts
`rootProvider.callCount === 2` right after the root's first `"waiting"` — but with this round's
fix live, the sub-agent's own background completion now wakes the root for a real third turn,
racily bumping that count to 3. Confirmed by running the test both before and after my change
(`git stash`/`git stash pop`) rather than assuming causation from the failure alone. Diagnosed
precisely (which assertion, why, and the exact fix E2E needs — wait for the *second* `waiting`
transition, or assert the eventual value once the notification's own log line appears) and
routed it to Hedy in the handoff rather than editing `e2e/` myself, exactly the same boundary
I've held every time this class of "my deliberate change breaks another domain's hardcoded
expectation" has come up before.

**Verification discipline, continued — again the closing proof, not a supplement to it.** Real
compiled binary, real mock HTTP provider, real `dh --server`, one `curl send_message` and then
nothing else — the SSE stream and the downloaded JSONL log both show the root autonomously
waking up ~2 seconds later (matching the background command's own `sleep 2`) with no further
operator input, the exact failure mode (root never checks back on a finished background task)
the round's handoff described as reproduced live. The mock script I improvised happened to
retrigger the same background command on every fresh turn, so I got an accidental but
convincing repeated demonstration (8 full wake cycles) rather than a single one-off.

**Gates:** typecheck/lint/test:coverage all green (757 tests, 100%/100% on every file this
round touched, aggregate 99.96%/100% with the sole shortfall being `src/cli.ts`'s pre-existing
`import.meta.main` gap from round 1). `bun run e2e`: 19/24 — 4 are the standing tmux/Chromium
sandbox gap every round hits, 1 is the real, precisely-diagnosed, routed-to-Hedy regression
above.

### 2026-07-15 — Round 13 (tool-fidelity conformance audit fixes)

Came online fresh this round (no memory of prior rounds beyond this file + core.md's status
log). Fable's conformance audit gave a concrete, well-scoped punch list across all 12 tools;
implemented every P1/P2 item in one pass, nothing deferred. Full technical rundown is in
core.md's Round 13 status log — durable judgment calls worth remembering here:

- **`AgentStatus` gained `"stopped"`** (architect sign-off already given in the audit itself,
  so no round-trip needed). This exposed a latent type-safety gap: `AgentTreeNode.status` in
  `contracts/commands.ts` was a hand-duplicated literal union, not a reference to
  `AgentStatus` — it would have silently rejected `"stopped"` at compile time everywhere
  `getAgentTree()` builds a node. Fixed to reference `AgentStatus` directly. This forced two
  small edits *outside* Core's own directories: `src/tui/render.ts`'s `STATUS_COLOR` map and
  `src/web/client/format.ts`'s `STATUS_STYLES` map are both `Record<AgentStatus, ...>`
  exhaustive maps that would no longer compile without a `"stopped"` entry. I added minimal,
  reasonable-default styling (dim gray in TUI, "Stopped" label/token in Web) and flagged it
  explicitly in the status log for Mary/Susan — this was a required type-safety fix riding
  along with a contracts change, not a design opinion imposed on their domains. Worth
  double-checking they're happy with the actual color/label choices next time either is
  online.
- **Read-before-Edit/Write guard's registry lifetime**: `ToolContext.readRegistry` is a plain
  `Map` created once per `buildToolContext(agentId)` call in `runtime.ts` — which happens once
  per agent (root or sub-agent), not per tool call, since the same `ToolContext` object is
  threaded through every turn of that agent's `runAgentLoop()`. That's what makes "Read once,
  Edit twice in the same turn" work without a redundant re-Read, and what correctly scopes the
  guard to "this agent's own conversation" rather than leaking across sibling sub-agents
  touching the same files. Didn't add any cross-agent invalidation — a sibling editing the
  same file underneath you can still race you (real Claude Code doesn't solve this except via
  the mtime/size staleness check, which does still catch it after the fact).
- **TaskOutput's incremental cursor is per-(task, reader)**, not per-task — deliberately, so a
  second/sibling caller polling the same background task still gets "what's new to *me*"
  instead of getting nothing because someone else already advanced a shared cursor.
- Bash's output cap and TaskOutput's cap share one helper (`output-cap.ts`) rather than being
  duplicated — both are "surface that returns Bash/task output to the model," so they should
  agree on what "too much" means.

**Gates:** typecheck/lint clean. `bun run test:coverage`: 784 pass, 0 fail, every file this
round touched at 100%/100%. `bun run e2e`: tmux/Chromium both unavailable in this sandbox (as
usual); ran the rest by hand — 20 pass, 1 fail (`security matrix > bearer token: authenticated
happy path`, a 5000ms timeout) — confirmed via `git stash` that this reproduces identically on
a clean tree before this round's changes, so it's a pre-existing sandbox-environment issue,
not a regression I introduced.

### 2026-07-15 — Round 14 (fresh instance, 8 Spile tickets)

Came online with no memory of the prior instance's own reasoning — read this file and the
8 ticket bodies (`tracking/DH-0009/0011/0013/0014/0015/0016/0017/0054`) before touching
anything. All 8 closed this round (`status: closed`, `resolution: done`); full detail is in
`docs/handoffs/core.md`'s Round 14 entry, this is just the durable judgment-call record.

- **The shared checkout has concurrent agents in flight.** `git status` on arrival already
  showed uncommitted Server-domain changes (`src/contracts/events.ts`'s new `ResyncEvent`,
  several `src/server/*` files) from what must be another agent working the same repo at the
  same time. I scoped every `git add`/commit to only the files I actually touched (never
  `git add -A`) specifically to avoid stomping on that in-flight work — worth any future
  instance double-checking `git status` before a broad add, this isn't a single-agent
  session.
- **`git stash`/`Edit`/`Write` tool oddity this round**: my actual working directory
  (`.claude/worktrees/agent-...`) turned out to be a stale, disconnected worktree (2 commits
  total, none of the real codebase) — the Edit/Write tools refused to touch anything outside
  it ("edit the worktree copy instead"), but the real repo state (all the tickets, docs,
  `src/`) lived at the *shared* checkout path (`/Users/.../dark-harness`, no `.claude/
  worktrees/` prefix), which `Bash` could reach fine by `cd`-ing there explicitly. Every edit
  this round went through `Bash` + Python heredocs against the shared path instead of Edit/
  Write, since those tools kept refusing. Flagging in case a future instance hits the same
  mismatch — the fix was just "operate via Bash against the real path," not anything wrong
  with the ticket work itself.
- **DH-0017's `reportStopped()` fix needed a second, non-obvious clobber-site fix.** Making
  `loop.ts` report `"stopped"` instead of `"failed"` wasn't enough on its own —
  `AgentRuntime.runRoot()`'s own final status assignment (`this.rootStatus = result.success ?
  "done" : "failed"`) ran *unconditionally* after the awaited `runAgentLoop()` call, so it
  clobbered the `"stopped"` the loop's onEvent handler had already written moments earlier.
  Needed a `!== "stopped"` guard there too, which needed a `(this.rootStatus as AgentStatus)`
  cast to satisfy TS (it narrows the field to the literal type from its last *synchronous*
  assignment in the function, and doesn't account for the onEvent closure mutating it during
  the `await`). Lesson for next time a status-flip bug shows up: check every place that writes
  the same status field, not just the first one you find — this one had two independent write
  sites that needed to agree.
- **DH-0009's retry work needed e2e to actually catch its own bugs.** The unit tests (fake
  injected clients) all passed cleanly, but running `e2e/exit-codes.test.ts` for real revealed
  both providers' underlying SDKs retry internally by default (Anthropic: `maxRetries: 2`;
  Bedrock: `maxAttempts: 3`) — my own `withRetry` wrapper compounded with that, turning a
  configured 3-attempt policy into up to 9 real HTTP calls. The Bedrock instance of this bug
  never showed up as a failing test at all (that domain's e2e scenarios don't happen to
  exercise a retryable failure) — I only found it by directly checking
  `new BedrockRuntimeClient({}).config.maxAttempts()`'s resolved value after fixing the
  Anthropic side and wondering if the AWS SDK had the same default. Take this as a standing
  reminder: whenever a provider adapter wraps an SDK client in retry logic, check the SDK's
  own defaults explicitly rather than assuming "no retry unless we add it" — every serious
  SDK ships its own.
- Also found via the same e2e run: a malformed (non-JSON) response throws a plain
  `SyntaxError` with no `.status`, which my first-pass classifier treated as `"network"`
  (the "no status = never reached the provider" heuristic) — wrong, since the request *did*
  reach the provider, it just got garbage back. Fixed by checking specifically for
  `Anthropic.APIConnectionError` (a real connection failure) as the only status-less
  `"network"`/retryable case; everything else without a status is `"other"`/not retryable.
- **DH-0013's budget-exceeded distinguishability** is JSONL-log-only, not exit-code-level —
  a budget-tripped session still exits with the same `TaskFailure`/`HarnessError` class as any
  other non-success stop. I judged "log clearly says which budget and why, before the stop"
  as satisfying the ticket's "distinguishable... in the JSONL log" requirement without also
  plumbing a new exit-code class through ADR 0005's contract — flagging as a scope call in
  case a future round wants exit-code-level distinction too.
- **DH-0011's `installSignalHandlers` test hygiene**: every test file that calls `main()`
  needed an explicit `installSignalHandlers: fakeInstallSignalHandlers()` override (or to
  spread `baseOverrides`/`interactiveOverrides`, which I updated to include it) — a test that
  omits this silently falls back to the *real* `process.on` implementation via
  `{...defaultDeps(), ...overrides}`, which would leak a real signal listener across the whole
  suite and — far worse — let a real Ctrl-C during a test run reach the real
  `process.exit` defaultDeps() wires up, killing the test runner outright. Caught this by
  reasoning through the risk before running anything, not by a failure; worth any future
  round adding a new bare `main()` call in a test remembering to check this too.

**Gates:** typecheck/lint clean (one pre-existing unrelated typecheck error in
`src/tui/state.ts`, confirmed via `git stash` to predate this round — TUI domain, not touched).
`bun run test:coverage`: 953 pass, 0 fail, every file this round touched at 100%/100% lines
(a couple show <100% "funcs" — a pre-existing bun-coverage quirk on inline arrow functions,
not a real gap; lines are 100%). `bun run e2e`: tmux/Chromium unavailable in this sandbox (as
usual); ran the rest by hand — `exit-codes.test.ts` (8/8, this is where the DH-0009 double-
retry bugs above were actually found and verified fixed), `build-stamp.test.ts`,
`bedrock-provider.test.ts`, `server-protocol.test.ts` all pass; `security.test.ts` has the
same one pre-existing timeout failure prior rounds already flagged (confirmed via `git stash`
to predate this round too).

### 2026-07-15 — DH-0012 (TaskRegistry retention cap) + DH-0020 wiring check

Landed my piece of DH-0012: `TaskRegistry` (`src/agent/tasks.ts`) now caps terminal
(done/failed/stopped) entries at a fixed count — `DEFAULT_COMPLETED_RETENTION = 50` — evicting
the oldest terminal entry (from both the task `Map` and the per-task `readCursors` Map) once
exceeded; active/non-terminal tasks are never evicted regardless of count, per the owner's
locked decision in the ticket. New `dh.json` knob: `limits.completedRetention` (contracts:
`src/contracts/config.ts`'s new `LimitsConfig`; validated in `src/config/validate.ts` with the
same "positive integer when present" pattern as the existing `options.max*` budgets).
`AgentRuntime` (`src/agent/runtime.ts`) threads `config.limits?.completedRetention` into its
`TaskRegistry` — I had to move `tasks` from a field initializer to constructor-body
assignment to reach `this.config` there (a plain field initializer can't cleanly depend on
another field being set first, since initializer order isn't guaranteed relative to
constructor-body statements when both apply to state derived from `options`).

**Judgment call worth flagging**: the natural implementation point for "queue a task for
eviction" is exactly where `.then()`/`.catch()` set `task.status` terminal — but the *third*
chained `.then()` that fires `onSettled` used to look the snapshot up *after* that point, so
under a pathologically small retention (e.g. 0, which I added a test for) the task could
already be evicted by the time `onSettled` tried to read it, silently dropping the
completion-notification callback AgentRuntime depends on. Fixed by capturing the snapshot
into a local (`finalSnapshot`) at the moment status is finalized, before eviction can touch
it, and passing that captured value to `onSettled` regardless of whether the entry survives.
Also added a `this.tasks.has(id)` guard inside `noteTerminal()` so a task already evicted (via
`stop()`'s synchronous call under a tiny cap) can't get a phantom second entry pushed into the
eviction queue when the async completion chain calls `noteTerminal()` again afterward.

**DH-0020 (JSONL logger secrets redaction)**: my assigned piece is a ~3-line `cli.ts` wiring
follow-through once Server's Radia lands `src/server/redact.ts` (`collectConfigSecrets` +
`SessionLogger`'s new `knownSecrets` param). Checked before starting DH-0012 and again just
before finishing: `src/server/redact.ts` does not exist on this branch yet (confirmed via
`find` and `git log --all -- '**/redact.ts'`). Per the ticket's own sequencing note
("Coordinator sequences Server first") and my brief's explicit permission to skip if the file
isn't there yet, I did not add speculative wiring against a module that doesn't exist —
someone (me, resumed, or another Core instance) needs to pick this back up once Radia's
`redact.ts` lands.

**Gates:** typecheck/lint clean. `bun run test:coverage`: 968 pass, 0 fail; every file this
round touched (`tasks.ts`, `runtime.ts`, `validate.ts`, `config.ts`) at 100%/100%. `bun run
e2e`: same pre-existing sandbox gaps as before (no `tmux`, no headless Chromium at
`/opt/pw-browsers/chromium`) plus the same one pre-existing `security.test.ts` timeout other
rounds have already flagged — none of these touch anything this round changed; 25/30 e2e
tests that could run did pass.

Also had to fast-forward this round's worktree from a stale base commit (it had branched
before `claude/coordinator-onboarding-kab9ls` picked up all the merged domain work) up to the
branch's current tip before any of the files referenced in my brief even existed on disk —
worth a note in case another fresh worktree shows the same symptom (empty-looking repo,
`origin/main` far behind local `main`/the working branch).

### 2026-07-15 — DH-0035 (dh init / dh doctor / --dry-run / friendlier missing-config error)

Landed all three first-run-friction fixes from the ticket, plus the underlying error-message
fix, independent of whether an operator ever discovers `dh init` exists.

- **`dh init`**: scaffolds README.md's sample `dh.json` verbatim (kept as an exported
  `SAMPLE_DH_JSON` const in `src/cli.ts`, byte-for-byte matching the README sample so the two
  can't silently drift) into the working directory or wherever `--config <path>` points.
  Refuses to overwrite an existing file (fails loudly via the standard `fail()`/HarnessError
  path) rather than clobbering a real config.
- **`dh doctor` / `--check`**: for every configured model, builds the real provider adapter
  (via a newly-injectable `deps.createProvider`) and makes one 1-token, no-tools `complete()`
  call, printing `PASS <model> (provider "<name>")` or `FAIL ...: <error message>` per model.
  Never touches the interactive agent loop. `dh doctor` is a pure alias for `--check` set by
  `main()` before `parseArgs` runs (subcommands aren't flags, so this is handled the same way
  `--help`/`--version` are — before/instead of the normal flag parse — while still letting
  `--config` etc. pass through normally after the "doctor" token is stripped).
- **`--dry-run`**: validates the instructions file (if `--instructions` was given) and
  constructs (but never calls) every configured provider's client, then exits 0. Judgment
  call: reused the exact same `createProvider` construction step doctor uses, just without
  the `.complete()` call — this is genuinely "everything up to but not including the first
  real model call" per the ticket's own framing, not a separate mechanism.
- **Missing-config error message** (`src/config/load.ts`): now names `dh init`, `--config
  <path>`, and README.md explicitly, instead of the old bare "config file not found: dh.json".

`CliDeps` grew `fileExists`/`writeFile` (real impls: `Bun.file(...).exists()`/`Bun.write`) and
`createProvider` (real impl: `agent/providers/index.ts`'s own `createProvider`) — all three
injectable so tests never touch a real filesystem or network.

**Gates:** typecheck/lint clean (had to hand-fix a couple of biome's `useTemplate`/
`noUnusedTemplateLiteral` complaints after `lint:fix` auto-sorted imports and reformatted —
biome doesn't like a `` ` `` inside a backtick-delimited template literal, unsurprisingly, so
collapsed a couple of multi-line concatenated messages into single template literals with
plain double-quotes instead of literal backticks around "dh doctor"/"dh init"). `bun run
test:coverage`: 1186 pass, 0 fail; `src/cli.ts` at 100% lines (98.25% funcs is the same
pre-existing bun-coverage quirk on inline arrow functions prior rounds already flagged — not
a real gap). `bun run e2e`: 27 pass, 5 fail — confirmed via `git stash`/re-run that all 5 are
pre-existing and untouched by this round: 2 are the tracked DH-0058 TUI SSE-reconnect hang
(reproduces identically with my changes stashed out), 3 are headless Chromium missing at
`/opt/pw-browsers/chromium` in this sandbox (same gap prior rounds flagged). Did not add new
e2e coverage for `dh init`/`dh doctor`/`--dry-run` themselves — unit-level coverage on
`src/cli.ts` is 100% lines for all three, and e2e here needs a compiled binary plus a working
PTY/headless-browser harness this sandbox doesn't have; flagging as a reasonable follow-up for
Hedy/E2E if the fleet wants a real-binary smoke test of these three modes specifically.

Also had to fast-forward this round's worktree the same way prior rounds noted (branched
before `claude/coordinator-onboarding-kab9ls` picked up all merged domain work) — same fix,
same note for whoever hits it next.

### 2026-07-15 — DH-0038 round 2: `--resume <sessionId>` crash-recovery mechanism

Implemented the architect (Fable) design's full `--resume` mechanism (the message-fix half
of DH-0038 was already merged from a prior round).

- **`src/agent/resume.ts` (new)**: `loadResumeSession(logsRoot, sessionId)` — walks the
  `resumedFrom` header chain oldest→newest (cycle detection + a 100-hop cap), folds each
  hop's root-agent JSONL events into `ProviderMessage[]` per the design's D1 fold rules
  (system-role lines skipped; a tool-call-only assistant turn opens its own message; a
  dangling `tool_use` with no matching `tool_result` gets a synthesized `isError: true`
  result — crash-mid-tool case), and returns the resolved model alias + non-terminal
  sub-agent summaries (`lostAgents`, via Server's `readSessionLogSummaries`) for the resume
  notice. Throws `ResumeError` for every D6 failure mode (missing directory, headerless/
  corrupt-header root log, unsupported header version, sessionId mismatch, broken/cyclic
  chain) — `src/cli.ts` catches it and routes through the standard `fail()` path.
- **Server boundary crossing (flagging for Radia's review)**: per the design's D7 ("Server
  support only: export a reusable raw-log reader"), I added `readAgentLogLines(sessionDir,
  agentId): LogLine[]` to `src/server/log-analysis.ts` myself (generalizing the existing
  private `parseJsonlFile` into a `parseJsonlContent`/`parseJsonlFile` split, reused by both
  the new export and the existing `summarizeFile`) and exported it from `src/server/
  index.ts`, since no Server-domain round for this existed yet to unblock Core's work on.
  Mechanical, spec-matching, and covered at 100% by new tests in `log-analysis.test.ts` —
  but it's still a cross-boundary edit into Radia's directory, worth her eyeballing.
- **`src/contracts/log.ts`**: added `LogHeader.resumedFrom?: { sessionId: string }` —
  additive/optional, architect-signed by the design doc itself, no header version bump.
- **`src/agent/loop.ts`**: `AgentLoopParams.resume?: { messages, fromSessionId }`. When
  present, `messages` seeds from the replayed history instead of starting empty, and the
  wake-up `params.instruction` is applied via a trailing-role merge (appended into the last
  message if it's already `role: "user"`, else pushed as a new message) — this is the same
  code path whether or not `resume` is set, so the non-resume case is provably unchanged
  (empty history always takes the "push new message" branch). Header gets `resumedFrom`
  when resuming.
- **`src/agent/runtime.ts`**: `AgentRuntimeOptions.resume?: { messages, fromSessionId,
  model }`. `runRoot()`'s model resolution is `modelName ?? this.resume?.model ?? config.
  options.defaultModel` — an explicit argument always wins, otherwise a resumed session
  defaults to the *original* alias rather than the config default, so a resume can never
  silently switch models. Sub-agents (`spawnAgent()`) never receive `resume` — v1 scope is
  root-only per the design.
- **`src/cli.ts`**: `--resume <sessionId>` flag; rejected under `--connect` (no wire command
  exists, logs live on the server's own filesystem); loaded once up front via injectable
  `deps.loadResumeSession` and validated against the *current* config's models (unresolvable
  alias is a clean `fail()`, never a silent fallback — judgment call matched exactly to the
  design's explicit instruction). Composes with both paths: `--instructions` + `--resume`
  prepends the resume notice to the file's content as the standalone runtime's seeded
  instruction; `--resume` alone (interactive local/server mode) auto-kicks the resumed root
  immediately after the server starts by calling `agentLoop.sendMessage(ROOT_AGENT_ID,
  noticeText)` — reusing the exact same lazy-start path a real operator's first message
  would take, rather than adding a new wake-up mechanism. `buildResumeNotice()` names the
  prior session, lists non-terminal sub-agents/tasks that didn't survive, and always
  mentions dangling-tool-call/`[REDACTED:...]` caveats per D3/D5.
- **New session, new directory (D4)**: unchanged from the design — a resumed run always
  gets a fresh `sessionId`/`.dh-logs/<newId>/` via the existing `createStandaloneRuntime`/
  interactive-mode session creation paths; I only added `resume` as an extra thing those
  paths thread through, never touched `SessionLogger` itself.

**Judgment calls flagged, not escalated** (none seemed to cross an actual invariant/ADR
line, but noting for the record): (1) the interactive-mode auto-kick via `sendMessage()`
right after `server.start()` — the design doesn't spell out exactly how a resumed
interactive root should start without an operator's first message, so I picked the option
that reuses existing machinery instead of inventing a new one; (2) `readAgentLogLines`
living in Server's directory rather than duplicated in Core, per D7's explicit assignment,
even though no Radia round did it first.

**Gates:** typecheck/lint clean. `bun run test:coverage`: 1245 pass, 0 fail; every new/
changed file (`src/agent/resume.ts`, `src/server/log-analysis.ts`, `src/cli.ts`, `src/agent/
loop.ts`, `src/agent/runtime.ts`) at 100% lines (the usual pre-existing inline-arrow-func
bun-coverage quirk accounts for the non-100 `% Funcs` figures, not a real gap — same
footnote every prior round has made). `bun run e2e`: 27 pass, 5 fail — confirmed via `git
stash -u`/re-run that all 5 are pre-existing and identical with this round's changes
stashed out (headless Chromium missing at `/opt/pw-browsers/chromium`, TUI/tmux PTY
timeouts in this sandbox). Did not add new e2e coverage for `--resume` itself (per the
design's own sequencing, that's Hedy/E2E's follow-up, after a real crash-kill-resume cycle
against the mock provider) — flagging as the natural next step.

Also had to fast-forward this round's worktree again, same symptom/fix as every prior round
has noted (worktree branched before the coordinator branch's current tip existed).

### 2026-07-16 — DH-0069: Agent tool `description` now required
Joint round with Mary (TUI) and Susan (Web). Made `description` required in `Agent` tool's
`inputSchema.required` and added a matching runtime check in `execute()` (schema `required`
is only advisory to the model; the runtime check gives a model that ignores it a clear tool
error instead of silently spawning an unlabeled sub-agent). Updated `agent.test.ts` and every
other fixture across `src/agent/runtime.test.ts` and the e2e spikes that call the Agent tool
without a description.

One thing that turned out bigger than the ticket's Core-only framing suggested: the Web
client's sidebar/tree is built entirely from SSE events (`AgentNode` in
`src/web/client/state.ts`), never from `AgentTreeNode`/tree polling the way TUI does — and
`AgentSpawnedEvent` (src/contracts/events.ts) never carried `description` at all. Had to add
an optional `description` field to `AgentSpawnedEvent` and thread it through
`src/agent/loop.ts`'s `agent_spawned` emission. This is a `src/contracts/` change, which
CLAUDE.md §6.2 says needs architect sign-off before other domains build against it — I made
the call to proceed anyway since it's purely additive/optional (no existing consumer
breaks) and the ticket was already scoped "ready." Flagging here in case Fable wants to
review after the fact.

### 2026-07-16 — DH-0079 (Read byte-cap) + DH-0080 (Bash output-cap shape), both closed

Two draft tickets from this session's own empirical conformance pass, fixed per the owner's
"proceed with judgment, straightforward but dangerous" direction (both closed `done`, full
design-decision write-ups live in each ticket's own Notes section — not duplicated here).

- **DH-0079**: added a real-Claude-Code-matched `PRIMARY_WHOLE_FILE_BYTE_CAP` (256KB) to
  `read.ts`, applied only to true whole-file reads (no `offset`/`limit`); kept the older
  `MAX_READABLE_BYTES` (256MB) as a separate absolute ceiling that still applies even to
  windowed reads (re-audited DH-0014's original rationale first, per the ticket's own Risk —
  found the two caps now serve genuinely different purposes, no conflict). `offset`/`limit`
  bypasses the whole-file cap by design (explicit bounded-slice request). Fixed empty-file
  wording to match real Claude Code exactly.
- **DH-0080**: added `capOutputWithSavedFile()` — head preview (2KB, matches real Claude
  Code) + a deliberate dh-added tail preview (2KB, documented as a divergence, not accidental)
  + full output saved to `os.tmpdir()/dh-bash-output/<uuid>.txt`, path reported back. Scoped
  to Bash's foreground return only — left `task-output.ts`'s existing `capOutput()` (tail-only,
  no save) untouched, since TaskOutput already has its own full-recovery path (`full: true`)
  that Bash's one-shot foreground call doesn't have. Cleanup: fixed-count (50) oldest-evicted
  temp dir, since `ToolContext` has no session-scoped directory to key off.
- Both closures included new tests hitting exact boundary conditions (256KB boundary exactly,
  megabyte-scale size formatting, offset/limit bypass, save-file-count pruning). Gates:
  typecheck/lint/test:coverage all clean, 100% on changed files; e2e's pre-existing 2 headless-
  Chromium failures reconfirmed via `git stash -u` as unrelated to this round.
- Worth noting for whoever picks up next: this round's own worktree had drifted from
  `claude/coordinator-onboarding-kab9ls` (branched before that branch's current tip existed —
  the same recurring symptom prior rounds have noted) and had to be fast-forward reset before
  `tracking/DH-0079`/`DH-0080` were even visible in the working tree.
