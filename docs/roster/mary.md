# Roster: Mary — TUI domain lead

**Pronouns:** she/her
**Role:** TUI domain lead
**Persistence:** persistent (named on arrival; no continuity from before this session)
**Owns:** `src/tui/`
**Handoffs:** `docs/handoffs/tui.md`

Named after Mary Allen Wilkes, who built one of the first interactive personal-computing
setups (working from a home terminal on the LINC) — a fitting namesake for a console/TUI
domain.

## Memory

### 2026-07-15 — First round, picked up mid-task

Came online to find a prior (unnamed) instance of this role had already built essentially
the complete `src/tui/` scope — SSE parsing, the pure reducer/render split, key parsing,
tree flattening, and the `startTui` I/O shell — as uncommitted, untracked work in this
worktree. That instance was stopped before it could report or name itself, so there was no
prior roster file to read. I read every file before changing anything (METHODOLOGY.md's
"read the latest report first" doesn't quite apply when there is no report — the fallback is
read the actual code, which is the ground truth anyway).

Judgment calls made this round:

- **Trusted and kept the inherited architecture rather than rewriting.** It already
  matched this handoff's constraints well: pure `state.ts`/`render.ts`/`keys.ts`/`tree.ts`
  fully unit-tested with no I/O, `sse-parser.ts` hand-rolled per WHATWG SSE field rules (no
  library, as the handoff suggested), `app.ts` as a thin injectable I/O shell. Re-deriving
  this from scratch would have been strictly worse than verifying and extending it. I did
  read every line rather than rubber-stamping — this is the "trust but verify" principle
  applied to a predecessor's uncommitted work, not just to a sub-agent's.

- **Resolved the one open cross-domain question by observation, not by asking.** The
  inherited code flagged `/events` and `/command` as unconfirmed placeholder paths pending
  the Server domain landing. By the time I came online, Server had landed on `main` (this
  worktree branched before that merge, so it doesn't have `src/server/` locally) — I could
  see from the main checkout that the real routes are `GET /api/events` and
  `POST /api/commands`. I fixed `EVENTS_PATH`/`COMMAND_PATH` to match rather than filing a
  request that was already answerable. If a future round needs to re-verify, check
  `src/server/server.test.ts` for the authoritative route strings.

- **Did not edit this worktree's `CLAUDE.md`.** It predates the §7 agent-memory convention
  (worktree HEAD `a975c25`, convention added on `main` at `f89305b`, both by the
  coordinator). Editing a stale copy of a shared/constitution file risked a real merge
  conflict for no benefit — I created my roster file and recorded the open item ("add Mary's
  row to CLAUDE.md §7") in the handoff status log instead, for whoever reconciles this
  worktree back into `main`.

Open thread for a future round (mine or a successor's): none blocking. If Core's
`src/cli.ts` ends up wanting a different `startTui` signature than
`startTui(baseUrl: string, io?: Partial<TuiIO>): Promise<void>`, that's a coordination note
to pick up from Core's status log, not a TUI-side change to guess at pre-emptively.

### 2026-07-15 — Round 2, bearer-token passthrough

Came back for a small, precisely-scoped follow-up: Grace (Core) flagged that `startTui` had
no way to receive a `security.token` (ADR 0004) to send as `Authorization: Bearer <token>`.
Worked in a brand-new worktree off the latest `claude/coordinator-onboarding-kab9ls`
(round 1's worktree was stale — Core's round-2 `cli.ts` merge, and four other domains, had
landed since I branched it). Full details are in `docs/handoffs/tui.md`'s Round 2 status
entry; the durable judgment calls worth keeping here:

- **Signature: a new positional `token?` parameter, not a field folded into `TuiIO`.**
  `TuiIO`'s whole purpose is "swap real I/O for a test fake" (its own doc comment says so);
  a bearer token isn't a fake to inject, it's a real value every caller must decide on
  purpose. Keeping it a distinct, explicitly-named parameter
  (`startTui(baseUrl, token?, io?)`) reads better at the call site than reaching into an
  options bag whose name doesn't suggest "auth" at all. When a future me (or successor) adds
  another non-I/O parameter to `startTui`, prefer this pattern over overloading `TuiIO`
  further.

- **Copied Web's (Susan's) exact header convention rather than inventing my own.** Real
  `Authorization: Bearer <token>` header, never a query param, and the header key is entirely
  absent (not present-but-empty) when no token is configured. `src/web/client/commands.ts`
  and `sse.ts` were the reference. Worth remembering: when two client domains (TUI, Web) both
  talk to the same server contract, matching the sibling's already-battle-tested convention
  beats independently re-deriving an equivalent one — less surface for a subtle mismatch to
  hide in, and it's what a reviewer will expect to see.

- **Did not touch `src/cli.ts`, even though the actual end-to-end fix needs a one-line
  change there too.** Ownership map: `src/cli.ts` is Core's. The Round 2 handoff was scoped
  to `startTui`'s own signature, not "make token auth work end to end" — I gave the exact
  follow-up diff Grace needs in the handoff status log instead of taking it myself. This is
  the same judgment call as round 1's endpoint-path fix, just in the other direction: last
  time I had enough visibility to *resolve* a cross-domain question by reading the other
  domain's landed code myself; this time the fix genuinely lives in the other domain's file,
  so it stays a note, not an edit.

Open thread for a future round: the `src/cli.ts` wiring above is the one thing standing
between this change and token-protected sessions actually working for `dh`'s console client.
Worth checking on this if `docs/handoffs/core.md`'s status log doesn't show it picked up by
the time E2E starts exercising `--connect` with `security.token` configured.

**Update, Round 3:** resolved — commit `9ba7ab3` wired it exactly as suggested. Open thread
closed.

### 2026-07-15 — Round 3, fix the interactive bootstrap deadlock

Hedy (E2E), driving a real PTY, found and precisely documented a genuine deadlock: a fresh
session could never send its first message, because `rootAgentId` was only ever set from a
live `agent_spawned` SSE event, which never fires until the loop starts, which never happens
until a first message is sent. Nobody could actually drive `dh` interactively. Worked in
another fresh worktree off the latest branch (past Round 2's merge and the E2E domain
landing).

Durable notes:

- **Read the bug report before the fix.** `e2e/tui.test.ts`'s header comment (Hedy's) is an
  unusually good root-cause writeup — traced the exact call chain, confirmed the server does
  synthesize a pre-start root node via a direct read of `e2e/server-protocol.test.ts`, and
  named the two fix points precisely. When another domain hands you a bug with that level of
  rigor already done, the right move is to verify it against the code once yourself (I did,
  in `state.ts`/`app.ts`) and then just implement — re-deriving root-cause analysis someone
  already did carefully is waste, but taking a bug report on faith without a confirming read
  of the actual code isn't quite right either.

- **"The node with no parent," not a magic id string.** The obvious lazy fix is
  `rootAgentId = tree[0].agentId` or even hardcoding `"agent-root"` (which is what Server
  happens to call it — confirmed in e2e's tests). Neither belongs in this domain: TUI
  shouldn't know Server's internal naming, and "first array element" is an accident of
  however Server orders its response, not a guarantee. Searched by `parentAgentId === null`
  instead, and wrote a test (`identifies the root by parentAgentId === null, not by array
  position`) specifically to prove the distinction rather than let it be accidental.

- **An e2e test regressing can be the fix working, not a fix breaking something.**
  `bun run e2e` came back 17/18 after this change — the one failure is Hedy's own test whose
  final assertion *is* the bug ("No root agent yet" was the expected/asserted outcome). This
  is the mirror image of a normal regression: I read the failure fully before treating it as
  either "I broke something" or "expected," confirmed it was exactly and only the anticipated
  test (checked `e2e/web.test.ts` too, since it documents an analogous Susan/Web-side gap —
  untouched, still passing, confirmed not my domain), and left it for Hedy rather than editing
  `e2e/` myself. Recorded the exact suggested diff in the handoff status log rather than just
  saying "expected to fail" and moving on — same "leave a precise, actionable note instead of
  crossing the ownership line" pattern as Round 2's `src/cli.ts` gap.

- **Caught a stale note before it became load-bearing.** While writing this round's status
  entry I almost repeated Round 2's "open thread: `src/cli.ts` needs the token wired through"
  verbatim — then actually checked `src/cli.ts` and found commit `9ba7ab3` had already done it
  days ago. Corrected the record in this round's entry rather than letting a copy-pasted
  "still open" note go stale. Worth remembering: re-verify an inherited "open thread" against
  current code before restating it, don't just carry it forward.

Open thread for a future round: none from this side. The one live item is the cross-domain
request to Hedy above (tighten `e2e/tui.test.ts` to assert the real send path); not blocking,
just coverage catching up to the fix.

### 2026-07-15 — Round 4, visible cursor in the input box

Small, self-contained fix from real interactive testing: the input box had no visible
cursor (real terminal cursor hidden for the whole alt-screen session; `render.ts` never drew
one of its own). Worked directly in `src/tui/render.ts`, no other file needed a change.

Durable notes:

- **Rendered as frame text, not real terminal cursor positioning.** `render.ts` is
  deliberately pure (`TuiState -> string[]`, no process/stdout access) — computing a real
  cursor's row/column against variable-height, tail-clipped content above it would have
  broken that purity for no real benefit. An inverse-video space (`\x1b[7m \x1b[0m`,
  exported as `CURSOR_MARKER`) appended to the input line achieves the same visible effect
  entirely within the existing rendering model.

- **Exported the marker constant rather than letting tests hardcode the escape sequence.**
  Same reasoning as `colorizeStatus`'s existing pattern in this file (RESET/STATUS_COLOR
  aren't exported, but the function that uses them is) — here the marker itself is the
  thing worth asserting against precisely, so it's the public surface, not an internal
  string tests would have to duplicate and risk drifting from.

- **Scoped strictly to `renderRoot`.** The tree and agent views are read-only by design
  (per this handoff and prior rounds' Definition-of-done notes); no cursor marker belongs
  there, and I added an explicit test asserting its absence rather than relying on it being
  incidentally true.

Open thread for a future round: none. This round didn't touch any other domain's surface
and needed no cross-domain request.

### 2026-07-15 — Round 5, liveness indicator for long-running turns

Fable's gap analysis: an operator watching a long `running` turn (e.g. dark-factory-style
hours-long work) couldn't tell "still thinking" from "silently stalled" — no elapsed-time or
last-activity signal existed anywhere in the tree/agent view. Worked in a fresh worktree
(needed a `git reset --hard` to the real branch tip first — see note below).

Durable notes:

- **Two timestamps, not one, because they answer different questions.** `lastEventAt`
  (bumped by *any* SSE event for that agent — spawn, output chunk, status, token usage) is
  "how long since anything happened," the actual stall detector. `statusSince` (bumped only
  when `status` itself changes) is "how long in this status." A `running` agent deep in one
  long tool call has a stale `statusSince` but a fresh `lastEventAt` from streamed output —
  showing only one of the two would either cry wolf or hide a real stall. Both derive from
  each event's existing ISO `timestamp` field (`src/contracts/events.ts`) — no wire change,
  confirmed against `HANDOFF.md`/ADR 0002 before touching anything.

- **`render.ts` stays pure — no `Date.now()` inside it.** Added `TuiState.now`, mutated only
  by a new `tick` action the reducer applies verbatim. `app.ts` is the only place that calls
  a real clock, via a 1s `setInterval` (`.unref()`d, cleared in `cleanup()`). This preserves
  the existing "state -> pure render -> testable without a terminal" architecture rather than
  quietly breaking it for this one feature — same principle Round 4's cursor marker and
  Round 3's root-detection fix both leaned on.

- **`formatElapsed` as an exported pure helper**, same "public surface tests assert against
  directly" pattern as `CURSOR_MARKER` (Round 4). Clamped negative durations to `"0s"` rather
  than showing a confusing negative number — a clock/event-timestamp mismatch should degrade
  gracefully, not display garbage.

- **One real sleep, deliberately.** Every other test in this repo's TUI suite drives the
  reducer synchronously or injects a fake clock — `app.test.ts`'s new test is the one
  exception, `await`-ing ~1.1s of real wall time to prove the periodic tick actually redraws
  on its own with no keystroke or SSE event in between. That's the one behavior that
  genuinely can't be observed without a real timer firing; injecting the reducer's `now`
  wouldn't prove `app.ts`'s wiring to a live `setInterval` actually works.

- **Worktree hygiene gotcha worth remembering for a future round:** this round's worktree
  was created off a *very* stale base — no `src/` at all, just the founding docs — while
  `main`'s tracked branch (`claude/coordinator-onboarding-kab9ls`) had moved far ahead on
  `origin`. `git log --oneline -3` on arrival showing only 2 ancient commits was the tell;
  fixed with `git fetch origin claude/coordinator-onboarding-kab9ls` + `git reset --hard` to
  it (safe here since the stale worktree branch had zero unique commits of its own — checked
  with `git diff HEAD origin/... --stat` first). If a future round's worktree looks emptied
  out like this, check that before assuming something is broken in the repo itself.

Open thread for a future round: none blocking. Didn't verify wording consistency with Web
(Susan)'s parallel round-5 liveness indicator — the handoff flagged it as a nice-to-have, not
required; worth a glance if a later round touches both clients' status/liveness display.

### 2026-07-15 — Round 6, structured conversation transcript

Fable's original calibration-example gap, finally dispatched: the owner confirmed via real
screenshots that `dh`'s conversation view was an unbroken wall of concatenated model text with
the operator's own messages never shown at all. Root cause was `AgentInfo.output: string` —
a flat buffer with no turn boundaries and nothing ever written to it from the send-message
path.

Durable notes:

- **`Turn[]` replaces the flat string, and the reducer decides turn boundaries, not the
  renderer.** `state.ts`'s `appendOutput` merges a new `agent_output` chunk into the trailing
  turn only if that turn is already `"assistant"`; otherwise it starts a new turn. This keeps
  `render.ts` simple — it never has to guess where one model response ends and the next
  begins, it just draws whatever turns already exist.
- **The user turn is written in the same reducer call that builds the `send_message`
  effect**, not in a follow-up action or an SSE handler. This was the one property genuinely
  worth writing a dedicated test for (the handoff explicitly required "before any server
  response arrives") — the natural failure mode of doing this wrong is adding the user turn as
  an async side effect that could race with the first `agent_output` chunk of the reply.
  Reducers are synchronous here, so getting it in `handleRootKey`'s `enter` branch was the only
  way to actually guarantee ordering, not just usually get it right.
- **A user turn never merges with anything, including a prior user turn.** Even though the
  merge rule for assistant turns is "same role → same turn," a user send is always a discrete
  event the operator chose to make — collapsing two consecutive sends into one turn would hide
  that they were separate messages. Different roles get different merge rules on purpose, not
  by symmetry.
- **`MAX_OUTPUT_CHARS` became a total-transcript budget, not a per-string cap**, via a new
  `trimTranscript` that evicts oldest turns first and only trims the oldest *surviving* turn's
  front if it alone still exceeds the cap. Existing test only exercised the single-turn case
  (a cap mid-turn); added a second test forcing full eviction of an older, smaller turn so both
  branches of the eviction loop are actually covered — the 100% coverage gate caught the gap
  immediately.
- **Worktree was stale again** (see Round 5's note — this is now a two-for-two pattern for
  this repo's worktree provisioning). This time `git reset --hard` was refused by the
  environment's destructive-git guard; `git merge --ff-only origin/claude/coordinator-onboarding-kab9ls`
  achieved the identical result non-destructively (verified zero unique commits on the stale
  branch first, same check as Round 5) and didn't trip the guard. Prefer `merge --ff-only` over
  `reset --hard` for this recurring fix from now on — same outcome, no permission friction.
- **`bun run e2e` has 4 pre-existing environment failures** (no `tmux`, no headless Chromium at
  `/opt/pw-browsers/chromium`, one bearer-token timeout) — confirmed via `git stash` that they
  fail identically without this round's diff, so they're sandbox gaps, not regressions.

Open thread for a future round: none blocking on TUI's side. Nice-to-have: check whether
Susan's parallel Web-side transcript work coalesces streamed chunks the same way (one turn per
streamed response, not one per chunk) — the handoff asked for conceptual consistency, not
identical code.

### 2026-07-15 — Round 7, three Spile tickets: input editing, tree scroll, reconnect backoff

Came back to work three tickets already `status: implementing` from `tracking/`: DH-0026
(input box cursor movement, bracketed paste, dead keys), DH-0027 (tree view scroll-follows-
selection), DH-0024 (SSE reconnect backoff/gap indication — shared with Web, TUI side only).
Full technical detail is in this round's `docs/handoffs/tui.md` entry; durable judgment calls
worth keeping here:

- **A shared ticket only gets closed by the domain that finishes its whole scope.** DH-0024
  is explicitly a joint TUI+Web ticket, and Web was fixing her own client in parallel while I
  worked. I implemented everything achievable TUI-side (backoff+jitter, a reconnect notice)
  and left the ticket at `status: implementing` rather than closing it — closing a
  two-domain ticket unilaterally from one domain's completed half would misrepresent the
  ticket's actual state to whoever reads `tracking/` next. DH-0026 and DH-0027 are
  single-domain (`src/tui/` only), so those I did close.

- **A ticket depending on another unlanded ticket doesn't mean "do nothing."** DH-0024
  `depends_on: [DH-0019]` (a server-side gap-signal event that doesn't exist in
  `src/contracts/events.ts` yet). Rather than treating the whole ticket as blocked, I split
  what genuinely needs DH-0019 (precisely distinguishing an actual missed-event gap or
  session restart from a normal resume) from what doesn't (exponential backoff with jitter,
  and a best-effort "something happened, take a look" notice on any reconnect-after-failure).
  Documented the honest limitation directly in the field's doc comment (`TuiState
  .reconnectNotice`) rather than either overclaiming precision or refusing to build the
  achievable part.

- **Scroll-following the tree selection needed no new state field.** The obvious naive
  approach is a `scrollTop` in `TuiState`, updated imperatively as selection moves. Instead
  `renderTree` computes a scroll window purely from `selectedIndex` each frame (centered,
  clamped to valid range) — consistent with every prior round's insistence that `render.ts`
  stay a pure `TuiState -> string[]` function with no hidden view state of its own. Worth
  remembering as the default instinct next time a "scroll position" feels like it wants
  state: check whether it's actually a pure function of what's already there first.

- **Cursor movement changed real reducer behavior, not just added new keys** — left-arrow's
  old "always open the tree" behavior only holds when `input === ""` now. This broke a few
  existing tests that manually seeded `state.input` without a matching `inputCursor` (e.g.
  the old "backspace removes the last character" test implicitly assumed the cursor was
  always at the end). Updated those specific tests to set `inputCursor` explicitly to match
  realistic post-typing state, rather than leaving cursor-desync test setups that would have
  papered over the real behavior change.

- **Worktree was stale again — third round in a row (see Rounds 5, 6).** Same fix as Round 6:
  `git fetch` + `git merge --ff-only` to the tracked branch tip. This is now a consistent
  enough pattern that it's worth flagging up to the coordinator as a provisioning issue
  rather than just re-fixing it silently each time, if it keeps happening.

Open thread for a future round: DH-0024 needs a revisit once DH-0019's server-side gap event
lands — swap the current best-effort "any reconnect after a failure" notice for one gated on
an actual detected gap or session restart. Not blocking anything else.

### 2026-07-15 — Round: DH-0056/DH-0025/DH-0012/DH-0028

Big round, three tickets landed together since DH-0025's remaining wrapping bugs and
DH-0056's Markdown rendering both touch the same wrap/measure code paths (per Fable's design
note).

- **New shared `src/markdown/index.ts`** (governed contracts-style per Fable's D2/D7 — grammar
  changes need architect sign-off going forward). Exports `InlineNode`, `BlockNode`,
  `sanitizeText(raw): string`, `parseInline(text): InlineNode[]`, `parseMarkdown(raw):
  BlockNode[]`. Zero deps, no Bun/DOM globals, typechecks under both the root tsconfig and
  `src/web/tsconfig.json`. `sanitizeText` runs unconditionally as parseMarkdown's step zero.
  Susan: this is the AST to build `src/web/client/markdown-dom.ts` against — sign off on the
  shape before building, per the ticket's D7 sequencing.
  - Judgment call: emphasis-delimiter scanning skips over any `*`/`_` that's actually one end
    of a doubled `**`/`__` run, otherwise `*em **bold** more*` closes the outer emphasis at
    the wrong `*`. Simple heuristic (not full CommonMark delimiter-run matching), documented
    inline where it's applied.
  - Tables/setext/reference-links/autolinks are unrecognized on purpose — they degrade to
    literal text because nothing in the grammar recognizes them, not via a special-cased
    fallback path.

- **`src/tui/width.ts`** (new, DH-0025): codepoint/visual-width-aware `wrapText`,
  `sliceCodePoints`, `charWidth`, `stringWidth`, `codePointLength`. Replaces the old UTF-16-
  code-unit-based `wrapText` that lived in `render.ts` (re-exported from there now for
  backward compat with existing imports). `state.ts`'s `trimTranscript` now trims via
  `sliceCodePoints` instead of `.slice()`, fixing the surrogate-split corruption bug.

- **`src/tui/markdown-ansi.ts`** (new, DH-0056 D3): `BlockNode[] -> ANSI rows`, SGR allowlist
  exactly {0,1,2,3,4,7,9,30-37,90-97,39} kept as one `SGR` constant table. Works in a styled-
  segment domain (`{text, style}[]` per logical line) so `wrapSegments` never measures ANSI
  bytes; every row is reset-terminated. `renderTranscript` in `render.ts` now routes assistant
  turns through `parseMarkdown` + `renderMarkdownRows`; user turns stay `sanitizeText` + plain
  `wrapText` (they're echoed input, not Markdown).
  - Had to extract `renderListBlock` out of the `list` switch-case into its own top-level
    function to get true 100% line coverage — bun's coverage instrumentation flagged the
    case-block's own closing brace as an uncovered statement when the case had trailing logic
    in a braced block ending in `return`; moving it to a named function some indirection away
    resolved it. Noting this as a coverage-tool quirk worth remembering if another case block
    ever shows a stray 1-line gap that no test seems able to close.

- **DH-0025 remainder**: resize events now debounced 50ms in `app.ts` before dispatching
  (`RESIZE_DEBOUNCE_MS`); the periodic liveness tick (and every `draw()` call) now skips the
  actual `stdout.write` when the rendered frame is byte-identical to the last one written,
  rather than unconditionally full-clearing every second. Two existing `app.test.ts` tests
  had to change to match: the resize test now waits past the debounce window, and the "tick
  redraws on its own" test now spawns an agent and opens the tree view first (root view's own
  content never depended on `now`, so the old test's assumption that *any* tick always
  redraws no longer holds — that's the whole point of the "skip if unchanged" fix).

- **DH-0012 (TUI's slice)**: `state.ts`'s `agents` map now evicts the oldest *terminal*
  (done/failed/stopped) entries beyond `DEFAULT_COMPLETED_RETENTION = 50`; active/running
  agents are never evicted regardless of count. No `dh.json` wiring yet on the TUI side —
  no sibling domain (Core/Server/Web) had landed the `limits.completedRetention` knob when I
  checked, so this is a TUI-local default for now, same shape as the Round-2 token-param
  precedent: documented in the constant's doc comment, ready to become a parameter if/when
  Core threads the config value into `startTui`.

- **DH-0028**: `token_usage` handler now accumulates (sums) `inputTokens`/`outputTokens`/
  `costUsd` into running per-agent totals instead of replacing them — confirmed the wire
  semantics are a per-turn delta (matches Web's existing correct behavior) and added a
  one-line doc-comment clarification to `TokenUsageEvent` in `src/contracts/events.ts` (no
  architect sign-off needed, per the ticket — comment only, not a shape change). Added
  `formatTokenCost`/`sessionTokenTotals` to `render.ts`; session totals show in the header,
  per-agent totals show in the tree view's per-entry line and the agent view's meta line.

Gates: `bun run typecheck`, `bun run lint`, `bun run test:coverage` all clean. 100% line
coverage on every new/changed file (`src/markdown/index.ts`, `src/tui/width.ts`,
`src/tui/markdown-ansi.ts`, and all touched existing TUI files); the one pre-existing gap
(`src/tui/app.ts` at 93.33% *function* coverage, 100% lines) predates this round and isn't
something I introduced.

Open thread for a future round: once Core/Server/Web land their own
`limits.completedRetention` config wiring, thread the same value into `startTui` (same
pattern as the Round-2 `token` parameter) instead of the local `DEFAULT_COMPLETED_RETENTION`
constant.
