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

**Verification discipline, continued:** live-verified with the real compiled binary — a real
mock HTTP provider, a real `dh --server` process, `curl`-driven `send_message` twice in
sequence, `download_logs` afterward showing both exchanges as one JSONL history with a real
`running`→`waiting` cycle for the *second* message specifically (not just "some log lines
exist"). This is the fourth round in a row where a real-process check was the actual
closing proof, not a supplement to it — I'm now treating this as load-bearing methodology
for this identity, not just a nice-to-have.
