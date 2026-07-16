# Roster: Susan — Web domain lead

**Pronouns:** she/her
**Role:** Web domain lead (self-named after Susan Kare, who designed the original
Macintosh's icons and interface elements — a fitting namesake for the one domain where
"make it a joy to use" is an explicit, real requirement, not decoration)
**Persistence:** persistent (named on arrival; no continuity from before this session)
**Owns:** `src/web/`
**Handoffs:** `docs/handoffs/web.md`

## Memory

### 2026-07-15 — First round, picked up mid-task

Came online to find a prior (unnamed) instance of this role had already built essentially
the complete `src/web/` scope as uncommitted, untracked work in this worktree: route/
protocol definitions, the full client (state reducer, SSE client, command builders, DOM
rendering, download handling), the static bundle (`index.html`/`styles.css`), and
`serveWebUi`. That instance was stopped before it could report, name itself, or reconcile
with in-flight decisions from other domains — so there was no handoff status-log entry and
no roster file to read. I read every file before touching anything, then finished the round
rather than starting over. Full detail of what got built and fixed is in
`docs/handoffs/web.md`'s status log — this file is the durable part worth remembering on
top of that.

**The load-bearing judgment call this round:** the inherited code used native `EventSource`
with the bearer token in a `?token=` query string, flagged inline as a cross-domain
assumption. Reading Radia's (Server) status log first showed she'd already found this exact
gap (`EventSource` can't set `Authorization`) and escalated rather than guess. I
independently converged on the same fix she'd suggested — a `fetch()`-based SSE reader,
real header, never a token in a URL — mid-rewrite, and the coordinator then confirmed via
message that this had become a locked decision (2026-07-15 ADR 0004 amendment, architect-
decided). **Lesson for next time coming back to this role:** when picking up inherited
work, read every other domain's latest status-log entry before assuming the inherited
approach is still current — a stopped instance can't know what landed after it stopped, and
by the time I read it, Radia's finding was already public knowledge sitting one `git log`
away.

**A structural rule worth remembering:** this project's root `tsconfig.json` is one shared
`tsc` program covering every domain's files at once (`bun run typecheck` = `tsc --noEmit`
over `include: ["src", "e2e"]`). Adding browser DOM types to that shared `lib` array (which
`src/web`'s client code genuinely needs — `Document`, `HTMLElement`, etc.) silently changes
global type resolution for *every other domain's files too*, because DOM's declarations
(e.g. `BodyInit`) overlap with `bun-types`'. It broke a typecheck-clean line in
`src/server/server.ts` that had nothing to do with me. Fix: never add DOM to the shared
root `lib` — give `src/web` its own TS program instead (`src/web/tsconfig.json`, `extends`
the root, adds DOM libs, `include: ["**/*"]`; root gets `"exclude": ["src/web"]`;
`package.json`'s `typecheck` script chains both `tsc` invocations). If a future round of
work in `src/web` needs more DOM surface, extend `src/web/tsconfig.json`'s own `lib`, never
the root's.

**Bun coverage-instrumentation quirks** (see `docs/roster/radia.md` for the first two she
found — both recurred here): a class with only field initializers and no explicit
constructor shows 0/1 function coverage on its synthetic constructor even when
instantiated constantly (fixed the same way: explicit empty constructor +
`biome-ignore lint/complexity/noUselessConstructor`). New one I hit that is **not** an
instrumentation artifact, worth distinguishing: several "function not hit" coverage gaps
this round were genuine untested code paths (an arrow callback wired to a DOM event
listener that no test ever dispatched, a `.catch()` handler on a command that no test ever
made fail) — don't assume every function-coverage gap is a quirk; check whether the
function is actually reachable by a plausible test before writing it off.

**Design taste note for whoever reviews the UI:** the "joy to use" visual/interaction
design (dark "factory floor at night" palette, status conveyed via label+shape+motion not
color alone, restrained purposeful motion, `prefers-reduced-motion` respected, light theme
via `prefers-color-scheme`) is the inherited instance's work, not mine — I reviewed it
carefully against the handoff's requirement and judged it well-executed rather than
reworking it. Full rationale lives in `src/web/client/styles.css`'s header comment.

**Open threads (check whether resolved before assuming still open):**
1. Extracting a shared SSE parser between `src/web/client/sse.ts` and
   `src/tui/sse-parser.ts` (independently built, same wire format, same problem) — judged
   not worth the architect sign-off a `src/contracts/` move would need, this round. A
   reasonable future cleanup, not a live blocker.
2. The `tsconfig.json`/`package.json` split (above) is the one change this round that
   reaches outside `src/web/`'s own files. I judged it a routine "stop my gate from
   breaking someone else's file" fix, not an invariant-class change, but flagged it for the
   coordinator to sanity-check regardless.

**Deferred, not done:** exponential backoff on SSE reconnect (fixed 2s delay — fine for a
local/air-gapped target); real browser-driven e2e (explicitly E2E's job; I did run one
manual `Bun.serve` smoke test by hand to confirm the real bundle boots, not part of the
automated gate).

### 2026-07-15 — Round 2: fixed the fresh-session interactive bootstrap deadlock

Hedy (E2E), driving a real headless browser, found that a fresh `dh --web` session could
never send its first message: `AppView` never called `request_agent_tree` on boot, so
nothing ever learned the root agent's id until `agent_spawned` fired over SSE — which never
fires until someone sends a first message, which the composer can't do without already
knowing the root's id. A real operator could not start a fresh session at all. Full detail
in `docs/handoffs/web.md`'s Round 2 status entry — this file is the durable part.

**Worked in a fresh worktree this round** (`susan-round2`, off
`origin/claude/coordinator-onboarding-kab9ls`), not the round-1 one, per the coordinator's
instruction — first time doing that for this role. Worth remembering as the pattern for
whenever a coordinator message specifically says "fresh clean checkout": don't reuse the
old worktree even though it still exists and still has my committed history: it may be
stale relative to `origin` (other domains' merges, ADR amendments, CORS fixes) in ways that
matter for the new task. Create a new worktree tracking the named branch, confirm `git log`
shows what the coordinator described before starting.

**The fix:** `seedFromTree` in `state.ts` — finds the tree entry with `parentAgentId ===
null` (never hardcode which id is "the root"), seeds `rootAgentId`/`selectedAgentId` and
registers every node (flattening nested `children`) into `state.agents`, but only if not
already known — idempotent and order-independent against whichever of
{`request_agent_tree` response, `agent_spawned` SSE event} happens to resolve first, since
both paths call into the same reducer-shaped functions and both defer to "first one wins,
never overwritten by a later boot-time snapshot." `app.ts`'s `start()` now fires the
`request_agent_tree` bootstrap alongside opening the SSE connection — races harmlessly.

**A new pattern worth keeping for next time:** when a fix changes what the app does at
boot, check test *harnesses* for hidden ordering assumptions, not just individual
assertions. Here, every existing `app.test.ts` test that called `start()` suddenly also
issued a `request_agent_tree` command as ITS first fetch call — which broke exact-array
`commandBodies` assertions project-wide (fixed by updating each) and would have made
`commandResponse`-override tests (testing one specific action's failure) also fail the
*unrelated* bootstrap call, showing a spurious extra error banner (fixed by special-casing
`request_agent_tree` in the harness's fetch double *before* checking `overrides
.commandResponse`, and giving the tree-bootstrap fixture the same agent id
`spawnRoot()`'s helper already used, so the two paths describe one consistent fake agent
rather than racing two different ones).

**Cross-domain edit this round, flagged clearly (see the handoff status log for the full
version):** I edited `e2e/web.test.ts` (Hedy/E2E's directory) because fixing the deadlock
made that file's own workaround-era assertion false — it was literally testing around the
bug I fixed (its header comment said so explicitly), and once fixed, the test hung for its
full 30s timeout on a `.empty-state` locator that no longer appears. Replaced the workaround
(a direct `fetch` POST to `/api/commands`) with real Playwright interaction against the
composer, which is now possible. Did **not** touch `e2e/tui.test.ts` — same class of defect,
but that's Mary's Round 3 to fix on the TUI side, not mine to preempt.

**Bun coverage-instrumentation quirk, refined:** the "last switch-case closing brace shows
uncovered" quirk (Radia's original finding) recurred in `applyEvent`'s `default` case, but
her original fix (drop the block braces) doesn't work when the case has a local `const` —
biome's `noSwitchDeclarations` correctly demands a block around it. Fix: replace the local
`const _exhaustive: never = event` with a call to a tiny top-level `assertNever(_value:
never): void {}` helper — same compile-time exhaustiveness guarantee, no local declaration
in the case, so no block required, so the coverage quirk doesn't trigger. This is probably
the more general form of Radia's fix — prefer it over the local-const pattern in any future
exhaustive-switch code in this codebase.

**Gates this round:** `bun run typecheck`, `bun run lint`, `bun run test:coverage` (100%
funcs/lines on every `src/web/` file), and `bun run e2e` (18/18, including the fixed
`web.test.ts`) — all green. Full detail in the handoff status log.

### 2026-07-15 — Round 3: liveness indicator ("time in current status")

Added `statusSince` (ISO timestamp) to `AgentNode`, bumped only on an actual status
transition (`event.status !== node.status`), seeded on first sight of an agent from the
triggering event's own `timestamp` — every `ServerSentEvent` already carries one, so this
needed no wire-protocol change. Rendered as a coarse elapsed label ("just now" / "42s" /
"3m 12s" / "1h 05m", via new `format.ts:formatElapsed`) in both the sidebar row and the
detail header, ticking live via a new injected `setInterval` in `app.ts` (mirrors the
existing `setTimeoutImpl` pattern used for SSE backoff/error-banner-hide) so a stalled
`running` turn visibly ages even with zero new SSE events arriving.

**Judgment call: "time in current status," not "last event at."** The handoff left the
framing open. I picked "time in current status" because the Anthropic provider adapter
calls `messages.create` non-streaming — no incremental `agent_output` arrives mid-turn — so
in this codebase's current form the two framings measure the same thing, and "time in
current status" is the more honest/general label (it stays meaningful if a future provider
adapter starts streaming output, where "last event at" would then measure something
different and arguably less useful for the "is it stalled" question).

**Pattern worth reusing: threading one injected clock through both the ticking interval and
the elapsed-time seed.** `AppDeps.nowFn` feeds both `renderAll()`'s `now` (passed to
`renderSidebar`/`renderAgentHeader`) and `bootstrapAgentTree()`'s `nowIso` (passed to
`seedFromTree`) — one source of truth for "what time does this app think it is," so a test
can hold time fixed, fire the injected interval tick directly, and assert the rendered
elapsed text moved by exactly the expected delta. No real sleeps anywhere in the new tests.

**Environment note for whoever runs this role's gate next:** the worktree I was launched
into (a fresh `worktree-agent-*` branch) only had the two founding-doc commits — none of the
built `src/` tree that's already merged into `origin/claude/coordinator-onboarding-kab9ls`.
Fast-forward-merged onto that branch before starting (working tree was clean, so lossless).
Also: `bun run e2e` in this sandbox has no `tmux` binary and no Chromium at the expected
install path, so 4/18 e2e tests fail for environment reasons unrelated to any code change —
worth checking whether that's expected here or whether the sandbox needs re-provisioning
before trusting a red `e2e` run in this kind of environment again.

**Gates:** `bun run typecheck`, `bun run lint`, `bun run test:coverage` (100% funcs/lines,
every `src/web/` file, 695 tests project-wide) — all green. `bun run e2e`: 14/18, the 4
failures are the sandbox tooling gaps above, not a regression (nothing this round touches
routes, auth, or the wire protocol). Full detail in `docs/handoffs/web.md`'s Round 3 status
entry.

### 2026-07-15 — Round 4: structured conversation transcript (turn separation, user-message echo)

Replaced `AgentNode.output: string` with `AgentNode.transcript: Turn[]` (`{role: "user" |
"assistant", text, timestamp}`) — the flat-string design had no turn separation and never
recorded the operator's own sent messages at all, confirmed against real screenshots vs.
Claude Code's CLI. Full detail (helper names, render-path changes, visual design, judgment
calls) is in `docs/handoffs/web.md`'s Round 4 status entry — this file is the durable part.

**The one judgment call worth remembering if this comes up again:** the wire protocol has no
explicit turn-end signal — `agent_output` is just a raw chunk stream. The only reliable
client-side turn boundary is "did the role change since the last turn." I merge consecutive
`agent_output` chunks into the same assistant turn (a streamed response arrives in many small
pieces) but never merge two consecutive user turns (each send is a distinct, deliberate
action) — asymmetric on purpose, not an oversight.

**Environment note, third time now:** this round's worktree again started with only the two
founding-doc commits, no built `src/` tree — same gap as Round 2/3. Fast-forward-merging
`origin/claude/coordinator-onboarding-kab9ls` before starting is now the established fix; a
future round landing in a bare worktree like this should check `git log` against what the
coordinator's task description implies exists before assuming something's broken.

**Gates:** `bun run typecheck`, `bun run lint` (biome auto-fixed a few formatting nits — the
*second* `bun run lint` run, after `biome check --write .`, is the one that has to be clean),
`bun run test:coverage` (796 tests, 100% funcs/lines on every touched `src/web/` file). `bun
run e2e`: 20/24 — the 4 failures are this same sandbox's tooling gaps (no `tmux`, no Chromium
binary, one bearer-token-matrix timeout), not a regression.

### 2026-07-15 — Round 5: closed DH-0024 and DH-0029 (Web side)

Closed two `tracking/` tickets this round: DH-0024 (SSE reconnect backoff + gap indication) and
DH-0029 (keyboard/ARIA accessibility, missing `stopped` color, persistent error history, hung-
command timeout). Full technical detail is in `docs/handoffs/web.md`'s Round 5 status entry —
this file is the durable part.

**The judgment call worth remembering: closing a ticket doesn't require every user story in it
to be fully satisfiable by Web alone, as long as that's said plainly.** Both tickets are framed
as spanning "both clients," and DH-0024 additionally depends on DH-0019 (a server-side
`resync`/`gap` wire event that isn't built yet). I closed my half of each with `resolution:
done` and a `## Notes` entry naming exactly what's Web-only-and-done vs. what's genuinely
blocked on someone else's work (TUI's own pass on DH-0024/DH-0029, or DH-0009/DH-0017 adding a
provider-error-detail field to `src/contracts/events.ts` for DH-0029's #35). The alternative —
leaving both `implementing` until every cross-domain dependency resolves — would leave a
completed, tested, gated piece of work permanently unmarked as done, which seemed like the
wrong trade. If a future round disagrees with that call, the per-ticket notes make it easy to
see exactly what was and wasn't covered and reopen the specific gap as a new ticket rather than
relitigating the whole thing.

**A concrete instance of "don't add data that isn't there yet":** DH-0029's #35 asks for a
human-readable reason when an agent goes `failed`. I did not fabricate one from whatever's in
the transcript or fudge it from the `CommandAck.error` path (a different, already-working
code path — command failures, not agent-status-transition failures) — `AgentStatusEvent` has
no error field, so there's nothing honest to render yet. Named DH-0009/DH-0017 as the likely
owners of adding that wire field rather than guessing at my own shape for it unilaterally.

**Test-infrastructure fix worth flagging for whoever touches `app.test.ts` next:** its shared
harness used to serve the *same* fake SSE stream body for every `/api/events` fetch, which
happened to work only because no existing test ever drove a genuine reconnect-then-reopen
sequence. Testing DH-0024's gap banner required a real reconnect, which exposed that a second
`getReader()` on an already-fully-read stream hangs/throws. Fixed by minting a fresh stream per
fetch (mirroring `sse.test.ts`'s own lower-level harness) with a `get stream()` accessor so
every pre-existing test — which only ever touches the first connection — sees no behavior
change. Worth remembering if a future round needs to simulate SSE reconnects at the `app.ts`
level again: check whether the harness's stream is shared or fresh before assuming a hang is a
real bug.

**Gates:** `bun run typecheck`, `bun run lint`, `bun run test:coverage` — 100% funcs/lines on
every `src/web/` file (`src/cli.ts` remains the only sub-100% file project-wide, untouched).
`bun run e2e`: 21/25 — the 4 failures are the same sandbox tooling gaps as every prior round
(no `tmux`, no Chromium binary, one bearer-token-matrix timeout), not a regression; nothing
this round touches routes, auth, or the wire protocol.

### 2026-07-15 — Round 6: DH-0056 (Markdown rendering) + DH-0012 (Web's memory-growth piece)

**DH-0056:** built `src/web/client/markdown-dom.ts` against Mary's already-landed shared
parser (`src/markdown/index.ts` — `parseMarkdown`/`sanitizeText`/AST types, signed off on as
spec'd, no changes needed on my side). Programmatic DOM only (`createElement`/`textContent`/
`createTextNode`), zero `innerHTML`, matching `render.ts`'s existing style and the ticket's
D4 element mapping exactly (heading→h1-h6, code span→`<code>`, code block→`<pre><code
class="language-...">` with the info string filtered to `[a-z0-9-]`, lists→`<ul>`/`<ol
start=N>`, blockquote→`<blockquote>`, thematic break→`<hr>`, strong/em/strike→`<strong>`/
`<em>`/`<del>`, preserved line breaks→`<br>`). Links: `new URL(url, pageOrigin)` resolved,
scheme-allowlisted to `http:`/`https:`/`mailto:` only — anything else (including
`javascript:`/`data:`, and anything unparsable) renders as plain inline text instead of an
anchor; allowed links get `rel="noopener noreferrer"` + `target="_blank"`, `href` set via the
element property.

**Wired into `render.ts`:** `buildTurnElement` now calls a new `renderTurnText` helper — user
turns stay plain `textContent` (they're echoed operator input, not model-authored Markdown),
assistant turns go through `parseMarkdown` + `renderMarkdownInto`. **The fast path changed as
the ticket's Risks section predicted was necessary:** `appendTranscript`'s old behavior
(`textEl.appendChild(createTextNode(newSuffix))`) is wrong once a turn is Markdown — a
streamed chunk can retroactively close/change an unterminated fenced code block (D1's
"streaming rule": an unclosed fence at end-of-input renders as closed), so the still-growing
last turn needs a full re-parse-and-rebuild (`renderTurnText` again, which calls
`renderMarkdownInto`'s `container.textContent = ""` + rebuild) on every chunk, not just an
append. Still cheap in practice — one bounded turn's worth of re-parse per event, not the
whole transcript; the ticket's Risks section explicitly called this an acceptable trade,
revisit only if profiling ever says otherwise.

**DH-0012 (Web's piece):** added the two caps this domain was missing, both modeled directly
on Mary's already-shipped TUI equivalents (`src/tui/state.ts`) rather than inventing a new
shape: `MAX_TRANSCRIPT_CHARS = 200_000` (same number as TUI's `MAX_OUTPUT_CHARS`, no reason
for Web to pick a different one) trims oldest turns first (shifting whole turns, then
trimming the new-oldest turn's *start* if still over budget) inside both
`appendAssistantChunk` and `addUserTurn` — Web's turn text is always a plain JS string with no
terminal-width/codepoint-slicing concern TUI has to worry about, so a plain `.slice()` is
sufficient (no codepoint-safe slicing needed here). `DEFAULT_COMPLETED_RETENTION = 50`
(exported, matching the owner's fixed-count decision) evicts the oldest *terminal*
(done/failed/stopped) agents from `state.agents` beyond 50, oldest-by-`spawnOrder`-first,
active agents never evicted — wired into `applyEvent`'s `agent_status` case only (that's the
only event that can newly make an agent terminal, mirroring exactly where the TUI's
equivalent call sits).

**One thing intentionally not done, flagged rather than silently skipped:** the ticket
mentions a `dh.json` `limits.completedRetention` knob so the default can be changed without a
code change. Web has no `dh.json` access at all (it's browser-only, served client-side per
ADR 0001) — same situation Mary already noted for the TUI not reading `dh.json` directly.
This is Web's own hardcoded default until/unless a config value gets threaded through some
other mechanism (e.g. embedded into the served `index.html`/an API response) — that threading
decision is bigger than this ticket and not mine to invent unilaterally.

**Test note:** new `markdown-dom.test.ts` covers every block/inline AST kind and the link
scheme-filter matrix (http/https/mailto allowed; javascript:/data:/unparsable rejected,
including a relative-URL-resolves-against-origin case) against `happy-dom`. New DH-0012 tests
in `state.test.ts` exercise both caps through the public reducer API (`applyEvent`/
`addUserTurn`), not by reaching into the private `trimTranscript`/`evictCompletedAgents`
helpers — same style the file already used throughout.

**Bun coverage-instrumentation quirk, recurred a third time:** the "last switch-case closing
brace shows as an uncovered line" quirk (Radia's original finding, refined by me in Round 2)
showed up again in `markdown-dom.ts`'s `renderInlineNode` — the switch's closing `}` shows
0-hit even with full case coverage. Left as-is (matches the documented, accepted pattern);
not a real gap.

**Gates:** `bun run typecheck` (both TS programs), `bun run lint` (clean after `biome check
--write .`), `bun run test:coverage` — 1167 tests project-wide, 0 fail, 100% funcs/lines on
every file touched this round. Did not run `bun run e2e` this round (out of scope for this
task per the coordinator's brief — Hedy's DH-0056 E2E piece per the ticket's D7 table is
separate follow-on work).

### 2026-07-16 — DH-0069: sidebar/header use description
Sidebar row label, its aria-label, and the agent-header name (src/web/client/render.ts) now
prefer `agent.description` over `model · shortAgentId` / `model (id)`, falling back only
when absent (root always keeps "root"/"Root agent"). This required a `src/contracts/` +
`src/web/client/state.ts` change too, since Web's tree is built from `AgentSpawnedEvent` SSE
events, not the `AgentTreeNode` tree-poll path TUI uses — see Grace's roster note on the
`AgentSpawnedEvent.description` addition. Added coverage in state.test.ts and render.test.ts.

### 2026-07-16 — DH-0066: architect design-review polish pass

First pass on Fable's design review (`tracking/DH-0066-*.md`) — full detail of what
shipped vs. what's deliberately deferred is in that ticket's Notes section (status log
entry) now, not just here. This file is the durable judgment-call summary.

**The one bug worth remembering the shape of: consecutive-assistant-turn concatenation.**
`appendAssistantChunk` used to merge a new `agent_output` chunk into the transcript's last
turn whenever that turn's `role` was `"assistant"` — but "last turn is assistant" is not
the same fact as "this turn is still the same, currently-streaming turn." Two genuinely
separate turns (an agent finishing one turn, then starting a second one later with no user
message in between) both being `role: "assistant"` meant they silently glued into one
bubble with no boundary at all — exactly what the review's live capture caught. Fixed by
adding `AgentNode.turnOpen`, a boolean that's the actual "is there an in-flight assistant
turn" fact, set on every chunk and cleared the instant `agent_status` reports anything
other than `"running"`. **Pattern worth reusing:** when a merge/dedup decision is being
made on "does the last item have property X," ask whether X is really proof of "same
logical unit" or just an accidental match on a field that recurs — here `role` recurred
across genuinely distinct turns, so it needed a dedicated boolean for the fact it was being
used as a stand-in for.

**Judgment call on the prose-font Open Question:** the ticket explicitly framed
`--font-ui`-for-prose/`--font-mono`-for-code as "the review's recommendation" and called
the existing all-mono look "an accident of `.turn-text`'s single font-family rule, not a
recorded design decision" in its own Assumptions section — so I took that as license to
just implement the recommendation rather than leaving it as a genuinely open owner-taste
question. If a future round disagrees, it's a small, contained CSS revert.

**Didn't reproduce the "sidebar renders empty while viewing a sub-agent after
`session_ended`" bug** (`spike-agent-tree.png`) — read `evictCompletedAgents`/
`seedFromTree` carefully and found no code path that should drop agent rows on session
end, but this sandbox has no Chromium binary to drive a real repro. Left as an open item on
the ticket rather than shipping a speculative fix for a bug I couldn't observe — worth
revisiting with a working browser before assuming it's fixed or assuming it's real.

**Didn't close the ticket.** Genuine scope remains (tool-call chips and the sub-agent
spawn-prompt-as-opening-turn both need an SSE wire-vocabulary change, which routes through
architect review per CLAUDE.md §6 — not something a Web-only pass can resolve
unilaterally; plus the unreproduced sidebar bug above, plus a couple of explicitly
low-priority "delight" nits). Moved `draft` → `implementing` with a clear status-log split
of done vs. not, rather than either closing prematurely or leaving it looking untouched.

**Gates:** `bun run typecheck`, `bun run lint`, `bun run test:coverage` — 100% funcs/lines
on every file touched this round, 1397 tests project-wide. `bun run e2e`: 30/32 (built
`dist/dh` first, which fixed 1 of the previously-failing tests from a missing binary) — the
remaining 2 failures are this sandbox's already-documented missing-Chromium-binary gap, not
a regression; nothing this round touches routes, auth, or the wire protocol.

### 2026-07-16 — DH-0100 verification (no Web changes)

Verified only, no code touched. `src/web/client/styles.css`'s `--status-*` custom
properties already match `docs/design/style-guide.md` §1 exactly (running `#4f8cff`,
waiting `#f5a524`, done `#35c469`, failed `#f2545b`, stopped `#9a7bd1`), and `stopped` still
has explicit `.status-dot.status-stopped` / `.status-badge.status-stopped` rules (the
DH-0029 regression guard holds — no silent fallback to an unstyled default). No drift
found, no CSS changes made. Also recorded the DH-0100 casing decision in style-guide.md §4:
Web keeps Title Case badges, TUI/CLI keep lowercase — intentional per-surface convention,
not a residual inconsistency.

### 2026-07-16 — DH-0105: unify connection-state vocabulary (joint TUI/Web round with Mary)

Web's own connection states (`connecting`/`open`/`reconnecting`/`closed` in
`src/web/client/state.ts`/`sse.ts`) turned out to already have the right *semantics* —
`reconnecting` already correctly covered "dropped, actively retrying" (both a scheduled-
retry wait and the next attempt itself), and `closed` already only fired from an explicit
`close()` (never from a mid-loop failure, since the SSE loop retries forever on its own).
The only real change on the Web side was renaming two of the four words to the shared
vocabulary Mary and I settled on jointly (`docs/design/style-guide.md` new §1.2): `"open"`→
`"live"`, `"closed"`→`"disconnected"`. `"connecting"`/`"reconnecting"` were already correct
and unchanged. Updated `state.ts`'s `ConnectionStatus` type, `sse.ts`'s two
`onStatusChange` call sites, `format.ts`'s `CONNECTION_LABELS`, and the `.connection-*` CSS
class names in `styles.css` (`.connection-open`→`.connection-live`,
`.connection-closed`→`.connection-disconnected`) to match.

The investigation that mattered was on Mary's side (TUI's `error`/`closed` states were
genuinely ambiguous, mine weren't) — see her roster entry for the full reasoning; I confirm
here that the Web's `reconnecting` semantics (mid-retry, whether waiting or actively
attempting) is exactly what both surfaces now share, so nothing on my end needed the
"can't distinguish X" gap-closing the ticket anticipated might be necessary.

Added the shared `EXPECTED_CONNECTION_LABEL_WORDS` drift-guard table to `format.test.ts`
(mirrors Mary's in `render.test.ts`), asserting Web's labels match the same word list modulo
Title Case.

Gates: `bun run typecheck`/`lint`/`test:coverage` clean; `state.ts`/`sse.ts`/`format.ts`
still 100%/100%. Verified via `sse.test.ts`'s existing mocked-fetch reconnect scenarios
(drop → `reconnecting` → `live` sequences, already deterministic, now just relabeled) rather
than a live browser run — this sandbox is missing `/opt/pw-browsers/chromium`
(pre-existing, documented in my 2026-07-16 DH-0100 entry above), so `e2e/web.test.ts`/
`e2e/connect-web.test.ts` can't run headless-browser assertions here; both still fail on
that same pre-existing gap, not a regression from this change. The one e2e assertion that
does exercise the connection pill live end-to-end without a browser
(`e2e/tui.test.ts`, PTY-based) passes against a freshly rebuilt binary.

### 2026-07-16 — DH-0104: unify number/cost/elapsed/token formatting (Web slice)

Same joint dispatch as Grace's/Mary's entries this round. Read the owner's 2026-07-16
rulings first: 2-dp cost + `<$0.01` + `—` unknown (Web already mostly did this, minus the
unknown-cost distinction — see below); tokens compact in glanceable chrome (badges/strips,
which is everywhere Web shows a token count today); elapsed spaces+"just now" (Web's
`formatElapsed` already matched this exactly — no change needed there, just re-pointed at
the new shared implementation so it can't drift from TUI's independently in the future).

**What changed in `src/web/client/format.ts`:** `formatTokenCount`, `formatCostUsd`, and
`formatElapsed` are now thin re-exports of the new shared `src/format.ts` (imported as
`sharedFormatCostUsd`/`sharedFormatElapsed`/`formatTokenCountCompact` to avoid name
collisions with the wrapper functions) rather than three independent implementations.
`formatCostUsd`'s signature changed from `(costUsd: number)` to `(costUsd: number | null |
undefined)` — `null`/`undefined` now render `—`, closing the ticket's one real-correctness-
angle gap: Web previously had no way to represent "unknown cost" distinctly from "known cost
of exactly $0", so an unpriced model rendered as `$0.00` (indistinguishable from free).

**The correctness fix that required touching `state.ts` (not just formatting):** to actually
have an "unknown" value to pass into the new `formatCostUsd`, `AgentNode` needed a signal for
"has any `token_usage` event for this agent ever carried a `costUsd`" — added `hasCost:
boolean`, set `true` only when `event.costUsd !== undefined` in the `token_usage` reducer
case. `SessionTotals.costUsd` is now `number | null` (`null` only if *no* tracked agent has
ever reported a cost). This is a display-layer flag, not an accounting change — `costUsd`
itself still sums exactly the same numbers it always did; `hasCost` only decides whether the
render layer is allowed to say "$0.00" vs. "—". Judgment call I made without it being
spelled out in the ticket: this genuinely required a `state.ts` field, not just a
`format.ts`/`render.ts` change, because the "unknown" signal didn't exist anywhere in the
reducer's output before — I scoped it as narrowly as possible (one boolean, one `if`) to stay
inside the ticket's "rendering only, not accounting" assumption.

`render.ts`'s one `agent.costUsd` call site (the detail header) now passes `agent.hasCost ?
agent.costUsd : null`. Session-totals/sidebar-badge call sites already passed a `number |
null`-shaped value through `formatCostUsd`, unaffected beyond the signature widening.

**Tests:** `state.test.ts`'s "empty session" totals test updated (`costUsd: 0` -> `costUsd:
null`, with a comment explaining why null is correct for zero agents). `render.test.ts`'s
`fakeAgentNode` helper got a `hasCost: true` default (matches its historical always-`$0.00`-
if-unset behavior for existing tests that don't care about the unknown case).
`format.test.ts` gained: unknown-cost em-dash tests, a non-finite-input test updated (NaN now
`—`, not `$0.00` — a real behavior change, and the more correct one), and three "matches the
shared cross-surface test vectors" tests (cost/tokens/elapsed) importing the vector tables
from `../../format.ts` directly.

Gates: typecheck/lint/test:coverage green, every touched file 100%/100%
(`format.ts`/`render.ts`/`state.ts` all at 100% funcs, state.ts's 99.60% line figure is a
pre-existing gap unrelated to this diff, unchanged by it). `e2e/web.test.ts`/
`e2e/connect-web.test.ts` still fail in this sandbox on the pre-existing missing-Chromium gap
(documented in my and Mary's prior-round entries) — not exercised live this round for that
reason; Web's formatting call sites are proven via `render.test.ts`/`format.test.ts`'s direct
assertions instead.
