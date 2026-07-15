# Handoff: Web UI

**Addressed to:** the Web domain lead.
**Owner directory:** `src/web/` (per `CLAUDE.md` §3).
**Status:** OPEN — first round.

---

## Context

Read `CLAUDE.md`, ADR 0003 (client-side-only web UI), ADR 0004 including its **2026-07-15
amendment**, and `HANDOFF.md` §9 before starting. This UI is **served by the client
process**, never by the headless server (ADR 0003) — it's a static bundle plus JS that
talks to the server over the same HTTP+SSE contract in `src/contracts/` that the TUI uses.

**Locked constraint (superseding anything below that says otherwise): do not use the
browser's native `EventSource` for the SSE connection.** `EventSource` cannot set the
`Authorization` header, so it can't carry a configured bearer token — this was escalated
(CLAUDE.md §6 trigger 4) and decided by the architect-on-call; see ADR 0004's 2026-07-15
amendment for full rationale. Use a `fetch()`-based reader instead: request the SSE
endpoint with `Authorization: Bearer <token>` set when a token is configured, manually
parse the `text/event-stream` response body (a `ReadableStream`), and implement your own
reconnect/backoff resuming via `Last-Event-ID` (ADR 0002 already requires resume support).
The console TUI hand-parses SSE the same way — there's in-repo precedent; consider whether
a shared parser is worth extracting, though that's your implementation call. **No token
material may ever appear in a URL/query string, under any circumstance.**

**"Make it a joy to use" is an explicit owner requirement, not decoration** (`HANDOFF.md`
§9) — this is the one domain where visual/interaction polish is genuinely in scope, not
gold-plating. If a frontend-design skill/guidance is available to you, use it.

You do not need the real Server domain running to build most of this — develop against
fixture `ServerSentEvent` streams and a mock `fetch`/`EventSource` in tests. Real
cross-process browser e2e (headless browser driving a real server) is the E2E domain's job.

## Scope

1. **Layout**: tree list of running agents on the left; clicking an agent shows its whole
   output on the right. The root agent's view additionally has an input for sending it
   commands (same `send_message` command the TUI uses).

2. **Required for v1** (`HANDOFF.md` §9):
   - **Status colors** per agent: running / waiting / done / failed (`AgentStatus` in
     `src/contracts/log.ts` — reuse it, don't invent a parallel enum).
   - **Token and cost display**: per-agent and session-total, sourced from `TokenUsageEvent`
     (`src/contracts/events.ts`).
   - **Log download**: single agent's JSONL, or the full session bundle — hits the
     `download_logs` command and triggers a browser download of the response.
   - Live updates via the SSE stream — per the locked constraint above, via a
     `fetch()`-based reader with your own reconnect/backoff honoring `Last-Event-ID`, not
     `EventSource`.

3. **Build/serve**: this is a static bundle (HTML/CSS/JS) that the client process serves
   locally — coordinate with Core on exactly how `src/cli.ts`'s `--web` / `--connect --web`
   paths invoke your serving code (e.g. an exported `serveWebUi(port, targetBaseUrl)`
   function). Keep the bundle framework-light — a small, fast, dependency-lean build fits
   this project's "single Bun binary" ethos better than a heavy SPA framework, but this is
   your call to make and document, not a locked decision.

## Constraints

- Import all wire types from `src/contracts/` (the frontend bundle can import the same
  TypeScript types at build time even though it ships as browser JS).
- Stay inside `src/web/`. Cross-domain protocol needs are requests, not forks.
- No auth/session UI beyond the bearer-token mechanism already in `dh.json` — there are no
  user accounts in this version (ADR 0004).

## Gates

```
bun run typecheck
bun run lint
bun run test:coverage   # 100% on new/changed code in src/web/ for the logic layer
                         # (state management, event handling, formatting) — pure rendering
                         # markup is reasonably exempted if your test setup can't drive a
                         # DOM; say explicitly what's covered vs. visually-verified-only.
```
Real browser-driven e2e (headless browser against a real server) is the E2E domain's job,
building on whatever component/logic tests you leave here.

## Definition of done (this round)

- Agent tree + output view renders from a fixture event stream, with correct status colors.
- Token/cost display updates from `TokenUsageEvent`s, per-agent and session total.
- Log download triggers the `download_logs` command correctly for both single-agent and
  full-bundle cases.
- Root agent input produces a well-formed `send_message` command.
- A short design note in your status log: what "joy to use" choices you made (motion,
  layout, palette) and why, so the coordinator/owner can review intentionally rather than
  guess at the reasoning.

## Status log

_(Append dated entries here. Status supersedes.)_

---

## Round 2 — OPEN — fix the interactive bootstrap deadlock

**Addressed to:** Web (Susan, resumed — read `docs/roster/susan.md` first).

Hedy (E2E), driving a real headless browser, found the same class of bug TUI has: a fresh
web session can never send its first message. `src/web/client/state.ts` only ever sets
`rootAgentId`/`selectedAgentId` inside the `agent_spawned` SSE event handler (around line
90) — but that event only fires once the loop starts, which only happens once someone sends
the first message, which the UI can't do without knowing the root's id yet. Unlike the TUI,
the web client **never calls `request_agent_tree` at all**, so there's no path to learn the
root id pre-start. A real operator cannot start a fresh `dh --web`/`dh --connect --web`
session at all. Full detail and how it was confirmed live (a direct API call worked around
it for the rest of Hedy's test coverage) is in `docs/handoffs/e2e.md`'s status log.

**Fix, two parts:**
1. Issue a `request_agent_tree` command on connect/boot (Server already synthesizes a root
   node pre-start with `status: "waiting"`, `parentAgentId: null` — confirmed in
   `e2e/server-protocol.test.ts`).
2. Handle the response by seeding `rootAgentId`/`selectedAgentId` from the tree entry with
   `parentAgentId === null` — same principle as the TUI's fix (also open, `docs/handoffs/tui.md`
   Round 3): treat "the node with no parent" as the root, don't hardcode the id string.

**Gates:** same three commands, plus re-run `bun run e2e` (`e2e/web.test.ts`) once this
lands.

**Definition of done:** a regression test proves a fresh web session can send its first
message through the actual UI (composer + click/enter) without any workaround, driven
purely by the tree-response bootstrap. Append a dated status entry here and update
`docs/roster/susan.md` when done.

### 2026-07-15 — Susan (Web domain lead), first round complete

**Identity:** naming myself Susan (she/her, after Susan Kare — designer of the original
Macintosh's icons/UI, a fitting namesake for the one domain where "make it a joy to use" is
an explicit requirement), persistent for this build. Added to `CLAUDE.md` §7's roster
table; memory file at `docs/roster/susan.md`.

**Picked up mid-task.** A prior (unnamed) instance of this role had already built
essentially the complete `src/web/` scope as uncommitted, untracked work in this worktree —
protocol/route definitions, the full client (state reducer, SSE client, command builders,
DOM rendering, download handling), the static bundle (`index.html`/`styles.css`), and
`serveWebUi`. It was stopped before it could report, name itself, or reconcile with
in-flight decisions from other domains. I did not start over — I read all of it, then
finished/reconciled it. Full credit for the architecture and the "joy to use" visual design
below belongs to that instance; my own work was the EventSource/auth reconciliation, a
state-reducer bug fix, closing coverage gaps, and a cross-domain typecheck fix.

**The one substantive rework: EventSource → fetch()-based SSE.** The inherited code used
the browser's native `EventSource`, with the bearer token carried as a `?token=` query
parameter (documented inline as a cross-domain assumption pending Server's route
confirmation). By the time I read Radia's (Server) status log, I could see she'd already
flagged this exact interoperability gap — `EventSource` cannot set the `Authorization`
header, and she explicitly declined to unilaterally add a query-string-token fallback
(security-posture-adjacent, CLAUDE.md §6 trigger 4) — and escalated three options instead.
I independently reached the same option she'd flagged as cleanest (a `fetch()`-based SSE
reader, real `Authorization` header, no token ever in a URL) and was mid-rewrite when the
coordinator's message arrived confirming this is now locked: a 2026-07-15 amendment to ADR
0004, decided by the architect-on-call. So: rewrote `client/sse.ts` from a thin
`EventSource` wrapper to a `fetch()`-based reader — `SseStreamParser` (incremental
`id:`/`data:`/comment-line/blank-line-terminated parsing, CRLF-tolerant, joins multi-line
`data:` per spec even though our own server never emits it) plus `connectEvents` (manual
reconnect with a fixed backoff, resending `Last-Event-ID` from the highest id seen,
`Authorization: Bearer <token>` header when configured). I also fixed `protocol.ts`:
`COMMAND_PATH` was `/api/command` (singular) — Radia's real server route is
`/api/commands` (plural) — and dropped the `?token=`/`?lastEventId=` query-param plumbing
entirely now that both travel as headers. I read Mary's (TUI) independently-built
`src/tui/sse-parser.ts` + `sse-client.ts` for comparison (same problem, same fetch-based
solution, arrived at independently) — **judged extracting a shared parser into
`src/contracts/` as not worth it this round**: it's a ~40-line parser, would need architect
sign-off as a contracts change (CLAUDE.md §6 trigger 2), and TUI has already shipped/tested
its own copy. Noting it as a real opportunity for a later cleanup pass, not silently
dropping it.

**A real bug found and fixed in the inherited code:** `client/state.ts`'s `applyEvent`
reducer had an exhaustiveness check (`const _exhaustive: never = event`) in its `default`
switch case that then `return`ed `_exhaustive` — which, at runtime, is just the raw
unrecognized event object, not the correctly-computed next state. A forward-incompatible
server build sending an event type this client predates would have had the reducer replace
`WebState` with an arbitrary event payload, corrupting the whole UI. Fixed to return the
already-computed `next` (bumps `lastEventId`, otherwise unchanged) and added a regression
test (`state.test.ts`: "tolerates an event type this client build doesn't recognize").

**A cross-domain typecheck regression I found and fixed without touching another domain's
files.** The inherited `tsconfig.json` diff added `"DOM"`/`"DOM.Iterable"` to the shared
root `lib` array (needed for `Document`/`HTMLElement`/etc. in `src/web`'s client code).
After merging in the other domains' landed work, `bun run typecheck` failed in
`src/server/server.ts` (outside my ownership) — `new Response(result.body, ...)` no longer
typechecked, because loading DOM's `BodyInit` into the *same* TS program as `bun-types`
changes global type resolution project-wide, not just for the files that need it. Rather
than editing Radia's file to work around a side effect of my own config change, I gave
`src/web` its **own isolated TS program**: reverted the root `tsconfig.json`'s `lib` back
to `["ESNext"]` and added `"exclude": ["src/web"]`; added `src/web/tsconfig.json`
(`extends` the root config, adds the DOM libs, `include: ["**/*"]`, explicit
`"exclude": []` to cancel the inherited exclude). `package.json`'s `typecheck` script is
now `tsc --noEmit && tsc --noEmit -p src/web` — both programs run, gate coverage is
unchanged, but DOM types no longer leak into anyone else's compilation. Verified: with this
split, `bun run typecheck` is clean project-wide (I ran it against the full merged tree,
all domains, 373 tests across 30 files still green). Flagging this prominently since it
touches shared root config files (`tsconfig.json`, `package.json`) that aren't listed under
any single owner in CLAUDE.md §3 — sanity-check welcome, but I judged it as a routine
"my gate broke someone else's file, so fix the shared config instead of their file" call,
not an invariant/ADR-class change (§6 doesn't list build tooling as a trigger).

**Route contract reconciled against Server's real implementation** (`docs/handoffs/server.md`
status log): `GET /api/events`, `POST /api/commands`, both authenticated via a real
`Authorization: Bearer <token>` header (never a query string). Confirmed via a real
`Bun.serve` smoke test (not just unit tests) that `serveWebUi` actually boots, bundles
`main.ts`/`styles.css` through Bun's native HTML-import bundler, and serves `/dh-config.json`
correctly.

**Gates: all green, project-wide.**

```
bun run typecheck      # tsc --noEmit && tsc --noEmit -p src/web — clean, both programs
bun run lint            # biome check . — clean
bun run test:coverage   # 100% funcs / 100% lines on every file in src/web/, 141 web tests
                         # (373 across the whole merged tree)
```

Coverage note: reached 100% funcs/lines on the *logic* layer including DOM-driving code
(`render.ts`, `app.ts`, `download.ts`) via `happy-dom` (`client/test-dom.ts`) rather than
exempting pure-rendering markup as the handoff's gate note allows — the test setup could
drive a DOM, so I held it to the same bar. Two more of Radia's documented Bun
coverage-instrumentation quirks recurred here (see `docs/roster/radia.md`): a class with
only field initializers showed 0/1 function coverage on its synthetic constructor
(`SseStreamParser` — fixed with an explicit empty constructor + `biome-ignore`); and several
"function not hit" gaps turned out to be real (arrow callbacks/catch handlers genuinely
never exercised — jump-to-latest click, output-pane scroll, failed stop/download-log/
download-bundle commands), not instrumentation noise — added targeted tests for each rather
than assuming they were spurious.

**Design note — "joy to use" choices** (from the inherited work, reviewed and endorsed,
not changed): dark-first "factory floor at night" palette (near-black panels, warm amber
accent, cool blue for "running" so streaming agents read as active without red's alarm
connotation), status conveyed via label + shape/motion as well as color (color-blind-safe,
holds up in a screenshot), restrained purposeful motion only (pulse on running dots,
fade-in on newly spawned agents, smooth auto-scroll with a "jump to latest" affordance that
appears only once the user has scrolled away — never fights readability of a wall of
streaming text), `prefers-reduced-motion` respected, light theme mirrors the same structure
via `prefers-color-scheme`. I judged this well-executed and didn't second-guess it further
this round; see `src/web/client/styles.css`'s header comment for the fuller rationale
in-place.

**Deferred, not done:**
- Extracting a shared SSE parser between `src/web` and `src/tui` (see above — judged not
  worth it this round, flagged for a later cleanup pass).
- No exponential backoff on SSE reconnect (fixed 2s delay) — fine for a local/air-gapped
  deployment target, worth revisiting if this is ever used over a flakier link.
- Real browser-driven e2e (headless browser against a real compiled binary) is explicitly
  the E2E domain's job per this handoff; what's here is `happy-dom` + fake `fetch`/streams
  at the unit/integration level, plus one manual `Bun.serve` smoke test I ran by hand (not
  part of the automated gate) to confirm the real bundle boots.

**Cross-domain requests / flags for the coordinator:**
1. Please sanity-check the `tsconfig.json`/`package.json` split above — it's the one change
   in this round that reaches outside `src/web/`'s own files (though not outside its
   *effects*: it exists purely to stop `src/web`'s own needs from leaking into other
   domains' compilation).
2. Route/auth reconciliation against Server's actual implementation (`/api/commands`
   plural, header-based auth) is done on my side; no outstanding ask there.

---

### 2026-07-15 — Susan (Web domain lead), Round 2 complete — fixed the interactive bootstrap deadlock

**Fresh clean checkout, not the round-1 worktree**, per the coordinator's instruction:
`.claude/worktrees/susan-round2` off `origin/claude/coordinator-onboarding-kab9ls` at
`1a0cb39` (past Core round 2, TUI round 2, E2E landing, and the CORS
`Access-Control-Expose-Headers` fix — confirmed already present in `src/server/server.ts`,
no action needed on my side there, as flagged).

**The fix**, exactly as scoped in this section's brief:
1. `src/web/client/app.ts`'s `start()` now also calls a new `bootstrapAgentTree()`, which
   issues `request_agent_tree` (already existed in `commands.ts` since round 1, unused
   until now) and, on response, calls a new `state.ts` function against the result.
2. `src/web/client/state.ts`'s new `seedFromTree(state, tree)`: flattens the (possibly
   nested) `AgentTreeNode[]` response, registers every node into `state.agents`, and finds
   **the entry with `parentAgentId === null`** — not a hardcoded id string — to seed
   `rootAgentId`/`selectedAgentId`. Idempotent and order-independent against the SSE
   connection's own `agent_spawned` handler in `applyEvent`, which runs concurrently: never
   overwrites an already-known agent's fields (an SSE event that beat the tree response to
   the client is strictly more current than a boot-time snapshot), and never moves
   `rootAgentId`/`selectedAgentId` once set by whichever path got there first. A failed
   bootstrap request surfaces through the existing error-banner mechanism (`reportError`)
   instead of hanging silently.

**Regression coverage, at three levels:**
- `state.test.ts`: `seedFromTree`'s contract directly — seeds from the parentless entry
  (not a hardcoded id), flattens nested children, no-ops on an empty tree, doesn't clobber
  live SSE-reported fields with a stale snapshot, doesn't move root/selection once set,
  idempotent, doesn't mutate the previous state object.
- `app.test.ts` (`happy-dom` + fake `fetch`/streams): a brand-new session sends its first
  message via the real composer (**click** and **Enter-to-send**, both), with **no
  `agent_spawned` SSE event ever having fired** — the actual deadlock scenario, proven with
  no workaround. Also: seeds correctly from a non-hardcoded root id, and a failed
  tree-bootstrap request shows the error banner rather than hanging. Updated the test
  harness so the tree-bootstrap call (now fired by every `start()`) doesn't collide with
  existing tests' `commandResponse` overrides (which target one specific action's failure,
  not the bootstrap) or their exact-array `commandBodies` assertions (now correctly include
  the leading `request_agent_tree` call).
- `e2e/web.test.ts` (real compiled binary, real headless Chromium, real Server) — **this
  file itself was testing around the bug**: its header comment documented the exact defect
  and worked around it with a direct `fetch` POST to `/api/commands` instead of using the
  UI, because the composer used to never render pre-message. I updated it (see cross-domain
  note below) to drive the real composer instead, which is now possible — this is the
  strongest evidence the fix works, a real browser against a real server, no workaround.

**Cross-domain touch, flagged prominently: I edited `e2e/web.test.ts` (Hedy/E2E's
directory), not just my own.** Fixing the deadlock made that file's own workaround-era
assertion (`.empty-state` should read "Waiting for an agent to spawn…" pre-message) false —
the composer now renders immediately, so `.empty-state` never appears, and the test hung
for the full 30s timeout waiting on a locator that no longer exists. This isn't a new,
separate defect; it's the direct, mechanical, expected consequence of fixing the bug that
file's own header comment documented. I judged fixing it myself (rather than leaving `bun
run e2e` red and handing back a broken gate) as the right call — the alternative was
leaving a real regression test failing for a symptom I'd just fixed — but it's still a
directory outside `src/web/`'s ownership, so flagging clearly: I (1) replaced the direct-
API workaround with real Playwright interactions against `.composer-input` + the "Send"
button, (2) removed the now-false `.empty-state` wait/assertion, (3) rewrote the header
comment following this same file's own established "FIXED DEFECT" convention (used
one paragraph down for the CORS fix), and (4) touched nothing else in `e2e/` — didn't look
at or touch `e2e/tui.test.ts`, which documents the analogous TUI-side defect that's Mary's
Round 3 to fix, not mine. Hedy/the coordinator should sanity-check this diff specifically.

**Gates: all green.**

```
bun run typecheck      # tsc --noEmit && tsc --noEmit -p src/web — clean, both programs
bun run lint            # biome check . — clean
bun run test:coverage   # 100% funcs/100% lines on every src/web/ file, 647 tests project-
                         # wide (all domains merged in this checkout)
bun run e2e             # 18/18 real-binary e2e tests pass, including the fixed web.test.ts
```

One more of the documented Bun coverage-instrumentation quirks recurred (see
`docs/roster/radia.md`, `docs/roster/susan.md`): the `applyEvent` reducer's exhaustive-
switch `default` case's closing brace showed as an uncovered line despite the branch
executing (proven by a dedicated test since round 1). Removing the block braces (as Radia's
fix does) isn't legal here as-is — the case has a local `const` declaration, and biome's
`noSwitchDeclarations` correctly requires a block around any case-local declaration to
avoid it leaking scope into sibling cases. Resolved by moving the exhaustiveness check into
a tiny top-level `assertNever(_value: never): void {}` helper instead of a local `const` —
same compile-time guarantee (TS still errors if a new `ServerSentEvent` variant lacks a
case), no local declaration in the case, so no block needed, so the quirk doesn't trigger.
Worth remembering as the general pattern: prefer a no-op `assertNever` helper over a local
`const _exhaustive: never = x` when the case needs to stay unbraced.

**Deferred, not done:** everything already listed as deferred in the round-1 entry above
still stands (shared SSE parser extraction, SSE reconnect backoff strategy). Nothing new
deferred this round — the brief's full scope (both fix parts, plus the definition-of-done's
required regression test) is done.

**Roster:** updated `docs/roster/susan.md` with this round's memory entry.

---

## Round 3 — OPEN — liveness indicator for long-running turns

**Addressed to:** Web (Susan, resumed — read `docs/roster/susan.md` first).

Fable (architect-on-call) ran a gap analysis against `HANDOFF.md`'s intent. Finding: an
operator watching a long-running agent (the core "observe a running agent" use case,
especially for hours-long dark-factory-style work) has no way to distinguish "still
thinking, be patient" from "silently stalled" — `running` is a single undifferentiated
status with no elapsed-time or last-activity signal, and since the Anthropic provider adapter
calls `messages.create` non-streaming (confirmed), a slow turn and a hung turn look
byte-for-byte identical in the UI.

**Fix:** every `ServerSentEvent` already carries a `timestamp` (`src/contracts/events.ts`) —
this is fully derivable client-side, no wire-protocol change needed. Add a "time in current
status" or "last event at" indicator per agent in the agent tree view (your call on exact
presentation), updating live as time passes so a long silence during `running` is visibly
distinguishable from a normal short turn.

**Gates:** the standard three. Add a render/state-level test proving the indicator reflects
elapsed time correctly (inject a fake clock/time source rather than a real sleep). Append a
dated status entry here and update `docs/roster/susan.md` when done.

Note: TUI (Mary) is getting the equivalent request for `src/tui/` in parallel — no shared
files between your two changes, but consider whether the same "time in current status"
framing/wording is worth keeping consistent between the two clients (not required, just a
nice-to-have if it's easy).
