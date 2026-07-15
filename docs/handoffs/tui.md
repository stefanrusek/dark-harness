# Handoff: Console TUI

**Addressed to:** the TUI domain lead.
**Owner directory:** `src/tui/` (per `CLAUDE.md` §3).
**Status:** OPEN — first round.

---

## Context

Read `CLAUDE.md` and `HANDOFF.md` §8 before starting. This is the console client: a
Claude-Code-style full-screen TUI using the alternate screen buffer, talking to a server
(local or remote) over the HTTP+SSE protocol in `src/contracts/`.

You do not need the real Server domain running to build most of this — write your SSE
parser and render logic against **recorded/fixture event streams** (arrays of
`ServerSentEvent` from `src/contracts/events.ts`), and integration-test against an
in-process fake server (a tiny `Bun.serve` stub emitting fixture events) if you want a more
realistic test. The real cross-process wiring is the E2E domain's job.

## Scope

1. **SSE client parsing** — the console client is not a browser, so parse the `text/event-stream`
   format yourself: `data:`/`id:`/`event:` lines, blank-line-terminated events, `id:` tracked
   for `Last-Event-ID` on reconnect. Trivial in Bun (a readable stream + line splitting) —
   no library needed.

2. **Full-screen TUI** using the alternate screen buffer (`\x1b[?1049h` / `\x1b[?1049l`) with
   raw-mode stdin for keypress handling:
   - **Default view**: the root agent — streaming output plus a text input box for sending
     it messages (posts a `send_message` `ClientCommand`).
   - **Left-arrow in an empty input** opens the agent tree list (fetched via
     `request_agent_tree`); selecting an agent switches to its output view.
   - **Non-root agent views are read-only** — no input box — with a key (document your
     choice, e.g. `Esc` or `q`) to jump back to the root view.
   - Handle terminal resize (`SIGWINCH`) gracefully.

3. **Connection modes**: this client is used both for `dh` (local, server in the same
   process) and `dh --connect <host>` (remote). The TUI itself doesn't care which — it just
   points at a base URL and port; `src/cli.ts` (Core) decides that URL and passes it in.
   Define a clear entry function (e.g. `startTui(baseUrl: string): Promise<void>`) that Core
   can call — coordinate the exact signature in your status log if Core lands first with a
   different expectation.

## Constraints

- Import all wire types from `src/contracts/`. Do not redeclare `ServerSentEvent` or
  `ClientCommand` shapes locally.
- Stay inside `src/tui/`. If you need something from the server protocol that isn't in
  `src/contracts/`, request it — don't invent a side-channel.
- Terminal-control code (ANSI escapes, raw mode) is inherently hard to unit test end-to-end;
  factor rendering logic (given state → output buffer) apart from raw terminal I/O so the
  former is fully unit-testable, and keep the latter as thin as possible. Note in your
  status report which parts you could not cover with unit tests (the real PTY-driven
  coverage is the E2E domain's job, per ADR 0008).

## Gates

```
bun run typecheck
bun run lint
bun run test:coverage   # 100% on new/changed code in src/tui/ — see the rendering/IO
                         # separation note above for how to make this achievable
```

## Definition of done (this round)

- SSE parser correctly reconstructs `ServerSentEvent`s from a raw stream fixture, including
  multi-line data and resume-relevant `id:` tracking.
- Root view renders streaming agent output and accepts input that produces a well-formed
  `send_message` command.
- Agent tree navigation (left-arrow → list → select → read-only view → back) works against
  a fixture/fake tree.
- Rendering logic is unit-tested; raw terminal I/O is isolated and its untested surface is
  named explicitly in your status report.

## Status log

_(Append dated entries here. Status supersedes.)_

---

## Round 2 — OPEN — bearer-token passthrough

**Addressed to:** TUI (Mary, resumed — read `docs/roster/mary.md` first).

Grace (Core), wiring `src/cli.ts`'s real run modes, flagged that `startTui(baseUrl, io?)`
has no way to pass a configured `security.token` (ADR 0004) down to the requests it makes —
`security.token`-protected sessions currently don't work with the console client at all
(the Web client already handles this correctly, via the fetch()-based SSE reader from the
ADR 0004 amendment).

Looking at the code myself: the low-level pieces already support it —
`sendCommand(baseUrl, command, { headers })` in `http-client.ts` and (check) `sse-client.ts`
already accept a headers passthrough. The gap is just that `startTui`'s own signature has
nowhere for a caller (`src/cli.ts`) to supply a token. Add an optional parameter (your call
on exact shape — `startTui(baseUrl, token?, io?)` or a `{ token }` field on the existing
`io`/options object, whichever fits the existing structure better) and thread it into the
`Authorization: Bearer <token>` header on every request the TUI makes, the same way Web
does it. No token in a URL, ever (same constraint as Web's ADR 0004 amendment).

**Gates:** same four commands. **Definition of done:** a configured token flows from
`startTui`'s caller into every HTTP/SSE request the console client makes; a regression test
proves it (e.g. asserting the `Authorization` header on an injected fetch double). Append a
dated status entry here when done, and update `docs/roster/mary.md`.

---

## Round 3 — OPEN — fix the interactive bootstrap deadlock

**Addressed to:** TUI (Mary, resumed — read `docs/roster/mary.md` first).

Hedy (E2E), driving a real PTY, found a genuine deadlock blocking every fresh interactive
session: `src/tui/state.ts`'s `applyTreeResponse` (around line 113) sets `next.tree` from a
`request_agent_tree` response but never seeds `rootAgentId` from it — `rootAgentId` is only
ever set in the `agent_spawned` SSE event handler (around line 91). But `agent_spawned` only
fires once the loop actually starts, which only happens once someone sends the *first*
message, which nobody can do because `handleRootKey`'s `enter` case (around line 153) checks
`state.rootAgentId === null` and refuses with "No root agent yet — please wait." A real
operator cannot start a fresh `dh`/`dh --connect` session through the TUI at all. Full
detail and how it was confirmed live in `docs/handoffs/e2e.md`'s status log.

**Fix, two parts:**
1. `applyTreeResponse` should seed `rootAgentId` (when still `null`) from the tree response's
   root node — the entry with `parentAgentId === null` (Server already synthesizes this
   pre-start, confirmed in `e2e/server-protocol.test.ts`: `agentId: "agent-root"`,
   `status: "waiting"`). This avoids hardcoding the literal id string anywhere in this
   domain — treat "the node with no parent" as the root, not a magic constant.
2. `request_agent_tree` currently only fires on left-arrow (`handleRootKey`'s `left` case).
   Fire it automatically on startup too, so `rootAgentId` is populated before the operator
   ever types anything — check `app.ts`'s init sequence for where to add this (an initial
   effect alongside whatever `initialState`/`runSseClient` already kick off).

**Gates:** same four commands, plus re-run `bun run e2e` (`e2e/tui.test.ts`) once this
lands — Hedy's test currently works around the bug by sending the first message via a
direct API call; once fixed, consider (your call) whether that test should be tightened to
prove the real UI flow works unaided, though that's E2E's file to touch, not yours.

**Definition of done:** a regression test proves a fresh TUI session can send its first
message through the actual UI (typing + enter) without the "please wait" message, driven
purely by the tree-response bootstrap, not a live `agent_spawned` event. Append a dated
status entry here and update `docs/roster/mary.md` when done.

### 2026-07-15 — Mary (TUI domain lead), Round 3: fix the interactive bootstrap deadlock

Worked in a fresh worktree off the latest `claude/coordinator-onboarding-kab9ls` (`1a0cb39`,
past my Round 2 merge, the E2E domain landing, and Ada's small fixes), per the coordinator's
instruction. Read `docs/roster/mary.md` then this handoff section, then `e2e/tui.test.ts`'s
header comment (Hedy's own confirmation of the deadlock, with a precise root-cause trace)
before touching code, to make sure my fix addressed the actual mechanism, not just the
symptom.

**Fix, both parts exactly as scoped:**
1. `src/tui/state.ts`'s `applyTreeResponse` now seeds `rootAgentId` (only when it's still
   `null`, never overwriting a value a live `agent_spawned` event already set) from the tree
   response — via `flattenTree(tree).find((entry) => entry.node.parentAgentId === null)`, i.e.
   "the node with no parent," not a hardcoded id. Server happens to call it `agent-root`
   (confirmed in `e2e/server-protocol.test.ts`) but nothing in `src/tui/` needed to know
   that literal string.
2. `src/tui/app.ts` now fires `{ type: "send_command", command: { type: "request_agent_tree" } }`
   through the existing `runEffect` path once, unconditionally, right alongside the
   `runSseClient` kickoff at startup — before the first `draw()`. This doesn't touch the view
   (still boots on the root view, not the tree view); it just gets the tree round-trip
   in flight immediately so `rootAgentId` is populated by the time an operator could
   plausibly finish typing a first message. Left-arrow still also fires it (unchanged,
   still useful for refreshing the tree view later), so a session now issues
   `request_agent_tree` twice if the operator ever opens the tree — harmless, same command,
   same handler, and now confirmed as intentional/tested behavior rather than an oversight.

**Test changes:**
- `src/tui/state.test.ts`: five new unit tests directly on `applyTreeResponse`/`reducer`
  covering the seeding logic — sets `rootAgentId` from the root node, does not clobber an
  already-known one, finds the root by `parentAgentId === null` regardless of array position
  (not just "trust `tree[0]`"), leaves it `null` when no node qualifies, and (the actual
  definition-of-done assertion at the reducer level) that seeding via `tree_response` alone
  is sufficient for a subsequent `enter` keypress to produce a `send_message` effect instead
  of the "please wait" status message. Extended the existing `treeNode()` test helper with an
  optional `parentAgentId` parameter (default `null`, so every pre-existing call site is
  unaffected) so non-root nodes could be constructed for these tests.
- `src/tui/app.test.ts`: added the definition-of-done regression test end to end through
  `startTui` — types a message and presses enter with **no `agent_spawned` SSE event ever
  injected**, only the automatic startup tree fetch, and asserts the `send_message` command
  goes out and "please wait" never appears. Also added a direct "fires request_agent_tree
  automatically on startup" test. Updated the two Round-2 token-header tests, which broke
  because they counted on exactly one command POST happening — now there are two (the
  automatic startup one plus their own left-arrow-triggered one); tightened rather than
  loosened, both requests are now asserted to carry the header, not just one.

**Gates:**
```
bun run typecheck      # tsc --noEmit && tsc --noEmit -p src/web — clean
bun run lint            # biome check . — 145 files, no issues
bun run test:coverage   # 642 pass / 0 fail, 100.00% lines repo-wide; src/tui/* 100.00%
                         # funcs+lines. src/cli.ts's pre-existing 96.88% funcs figure is
                         # unchanged and unrelated (not touched by this change).
bun run e2e             # 17 pass, 1 fail — see below, expected and anticipated.
```

**The one e2e failure is the fix working as intended, not a regression.**
`e2e/tui.test.ts`'s "boots, renders the alt-screen shell, and responds to real keystrokes"
test was written by Hedy to *document* this exact deadlock: its final assertion
(`await session.waitFor((screen) => screen.includes("No root agent yet"))`, line 75) treats
the broken behavior as the expected outcome. Now that the deadlock is fixed, pressing Enter
after typing a message actually sends it — the real footer never shows "No root agent yet",
so that `waitFor` times out. This is exactly what this round's handoff anticipated ("Hedy's
test currently works around the bug... consider whether that test should be tightened...
though that's E2E's file to touch, not yours"). Per `CLAUDE.md` §3's ownership map, `e2e/` is
Hedy's directory — I did not edit `e2e/tui.test.ts`, even though the needed change is
obvious from here (replace the `"No root agent yet"` wait with one for real send/render
behavior, matching how `e2e/tui.test.ts`'s own `--connect` test already asserts
`"Hello from the remote server!"` after a real send). Flagging as a cross-domain follow-up
for Hedy below rather than crossing the ownership boundary, consistent with how I handled
Round 2's `src/cli.ts` gap.

**Cross-domain request (for Hedy / E2E):** `e2e/tui.test.ts`'s local-TUI test (line ~37-76)
and its file-header comment (lines 6-22) both describe the now-fixed defect as current
behavior and need updating: the header comment should note the fix and point at this
handoff's Round 3 entry; the test's tail (from `session.sendKeys("Enter")` at line 72 through
the end) should assert the real send/receive path instead of `"No root agent yet"` — e.g.
wait for the mock provider's turn text to render, the way the `--connect` test in the same
file already does at line 123. Not a blocker for merging this round's fix; the deadlock is
genuinely gone and proven by unit tests either way, this is just E2E's coverage catching up
to match.

**Correction to Round 2's open thread:** the `src/cli.ts` token-wiring gap flagged at the end
of my Round 2 entry below is already resolved — commit `9ba7ab3` ("Wire security.token into
startTui per Mary's round-2 spec") applied exactly the one-line diff I'd suggested. Confirmed
by reading `src/cli.ts` directly this round (`CliDeps.startTui` is now
`(baseUrl: string, token?: string) => Promise<void>` and both call sites pass
`config.security?.token`). Noting the correction here per "status supersedes" rather than
leaving the Round 2 entry's now-stale "open thread" as the last word.

### 2026-07-15 — Mary (TUI domain lead), Round 2: bearer-token passthrough

Worked in a fresh worktree off `claude/coordinator-onboarding-kab9ls` (`34e49a1`, after
Core's round-2 `src/cli.ts` merge) rather than my stale round-1 worktree, per the
coordinator's instruction. Confirmed I'm already on the `CLAUDE.md` §7 roster table from
that merge; read `docs/roster/mary.md` first, then this handoff's new section, then did the
work.

**Signature chosen:** `startTui(baseUrl: string, token?: string, io: Partial<TuiIO> = {}): Promise<void>`
— a new positional parameter between `baseUrl` and `io`, rather than folding `token` into
the `io`/`TuiIO` options object. Reasoning: `TuiIO` and its doc comment ("lets tests inject
fake stdin/stdout/fetch") are specifically about swapping real I/O for test fakes; `token` is
a real connection parameter every caller (test or production) needs to supply deliberately,
not a fake to inject, so it reads better as its own argument — `startTui(baseUrl, config.security?.token)`
at the call site in `src/cli.ts` is about as close to self-documenting as this gets. This is
the first option the handoff offered, not the second.

**What changed (`src/tui/` only, per ownership — I did not touch `src/cli.ts`):**
- `src/tui/app.ts`: added the `token` parameter; when present, builds a single
  `{ Authorization: \`Bearer ${token}\` }` header object once per `startTui` call and spreads
  it into both the `sendCommand(...)` options (every command POST) and the
  `runSseClient(...)` options (the SSE connection, including every reconnect — the header is
  attached fresh on each `connectOnce` call inside `sse-client.ts`, which was already
  unchanged from round 1 and already supported a `headers` passthrough). When `token` is
  `undefined`, no `Authorization` key is added at all — never an empty/placeholder header,
  matching Web's "omits Authorization when no token is configured" behavior exactly
  (`src/web/client/commands.ts` / `sse.ts` were my reference for the exact convention:
  header name casing, `Bearer ` prefix, never a `?token=` query param).
- `src/tui/index.ts`: updated the entry-point doc comment for the new signature.
- `src/tui/app.test.ts`: updated all 10 existing `startTui(...)` call sites for the new
  positional argument (`undefined` where no token is under test), and added two new tests:
  "a configured token is sent as an Authorization: Bearer header on every request" (asserts
  the header on both the initial SSE connect and a triggered `request_agent_tree` POST) and
  "omits the Authorization header entirely when no token is configured" (asserts
  `.has("Authorization")` is `false` on both, not just that it's unset by omission).
- No changes needed to `sse-client.ts` or `http-client.ts` — both already accepted a
  `headers` passthrough from round 1; the whole gap really was exactly what Grace's note
  said, `startTui`'s own signature having nowhere to receive a token.

**Gates — all green** (ran the full-repo suite now that this worktree has every domain's
code, not just `src/tui/`):
```
bun run typecheck      # tsc --noEmit && tsc --noEmit -p src/web — clean
bun run lint            # biome check . — 133 files, no issues
bun run test:coverage   # 635 pass / 0 fail, 100.00% lines all files; src/tui/* 100.00%
                         # funcs+lines. src/cli.ts sits at 96.88% funcs — confirmed
                         # pre-existing (identical with/without my diff via `git stash`),
                         # not touched by this change, not a TUI-owned file.
```

**Cross-domain note (not a request, an FYI for Grace/Core):** `startTui`'s new signature is
`(baseUrl, token?, io?)`. The `CliDeps.startTui` type in `src/cli.ts` and the
`runInteractiveMode` call sites (`await deps.startTui(targetBaseUrl)` /
`await deps.startTui(baseUrl)`) still reflect the old `(baseUrl) => Promise<void>` shape and
don't pass `config.security?.token` through yet — that's the actual remaining wiring to make
token-protected sessions work end to end with the console client, and it's a `src/cli.ts`
edit, i.e. Core's file, not mine to make. Suggested one-line change for whoever picks this
up: `deps.startTui: (baseUrl: string, token?: string) => Promise<void>` in the `CliDeps`
interface and `defaultDeps()`, then `await deps.startTui(targetBaseUrl, config.security?.token)`
/ `await deps.startTui(baseUrl, config.security?.token)` at the two call sites.

Picked up mid-task from a prior instance of this role that was stopped before it could
report; its uncommitted work was sitting in the worktree untracked. I read it in full
before touching anything — it turned out essentially complete and high quality, covering
every item in this handoff's scope and definition-of-done:

- `src/tui/sse-parser.ts` — `SseFrameParser` (incremental `text/event-stream` parsing:
  `data:`/`id:`/`event:` fields, blank-line dispatch, multi-line `data:` joined with `\n`,
  `Last-Event-ID` tracking) + `parseServerSentEvent` (raw frame -> validated
  `ServerSentEvent` from `src/contracts/`, tolerant of malformed JSON/unknown shapes).
- `src/tui/sse-client.ts` — `runSseClient`: connects, reconnects with backoff and
  `Last-Event-ID` resume on drop, runs until an `AbortSignal` fires. Fetch/delay are
  injectable for testing.
- `src/tui/http-client.ts` — `sendCommand`: POSTs a `ClientCommand`, parses the
  `CommandAck`/`AgentTreeResponse` shape, surfaces network/parse/HTTP errors as clean
  messages (never logs the auth header value).
- `src/tui/keys.ts` — pure raw-stdin-text -> `KeyEvent` parser (arrows via CSI, enter,
  backspace, ctrl-c, tab, escape, printable chars).
- `src/tui/state.ts` — pure `(TuiState, Action) -> { state, effects }` reducer: root view
  (typing + enter -> `send_message` effect), left-arrow-on-empty-input -> tree view (fires
  `request_agent_tree`), tree navigation (up/down/enter/escape), read-only agent view
  (escape or `q` back to root), SSE event application, bounded per-agent output buffer
  (`MAX_OUTPUT_CHARS = 200_000`, documented, not a silent cap).
- `src/tui/render.ts` — pure `TuiState -> string[]` frame rendering (header/content/footer,
  word-wrap, tail-clipping to viewport, status colorizing) plus a separate `frameToAnsi`
  step; no process/stdout access in this module.
- `src/tui/app.ts` — `startTui(baseUrl, io?)` thin I/O shell wiring the pure modules to real
  alt-screen + raw-mode stdin + SIGWINCH + fetch, with every side-effecting dependency
  (`stdin`, `stdout`, `fetchImpl`) injectable via `TuiIO` for testing.
- `src/tui/index.ts` — re-exports `startTui(baseUrl: string, io?: Partial<TuiIO>): Promise<void>`
  as the entry point for Core's `src/cli.ts`.

**What I changed this round:** the inherited code assumed unconfirmed endpoint paths
(`/events`, `/command`) with an explicit TODO-style comment flagging them for Server to
confirm. The Server domain has since landed (visible from the main checkout — this worktree
branched before that merge): `src/server/server.ts` actually serves `GET /api/events` and
`POST /api/commands` (see `src/server/server.test.ts`). I updated `EVENTS_PATH` in
`sse-client.ts` and `COMMAND_PATH` in `http-client.ts` to match, and adjusted the one test
description that hardcoded the old assumption in prose. No other behavior change was
needed — the bearer-auth header passthrough (`options.headers`) already matches Server's
`Authorization: Bearer <token>` expectation, and the `CommandAck`/`AgentTreeResponse`
response shapes already match what `src/server/server.test.ts` asserts.

**Gates — all green:**
```
bun run typecheck      # clean
bun run lint            # biome check . — 29 files, no issues
bun run test:coverage   # 136 pass / 0 fail, 100.00% funcs, 100.00% lines on src/tui/
```

**Untested surface (explicitly, per this handoff's constraint):** raw terminal I/O itself
is isolated to `app.ts`'s edges and cannot be meaningfully unit-tested outside a real PTY:
- Actual `process.stdin.setRawMode`/`resume`/`pause` behavior and real keypress delivery
  (tests inject a `StdinLike` fake and call its listeners directly).
- Real `SIGWINCH`-driven `stdout.on("resize", ...)` delivery (tests call
  `stdout.triggerResize()` directly rather than resizing a real terminal).
- Whether the alt-screen/cursor ANSI escapes (`\x1b[?1049h`/`l`, `\x1b[?25l`/`h`) actually
  produce the intended effect in a real terminal emulator — tests assert the exact bytes are
  written, not the visual result.
- `defaultIO()`'s real `process.stdin`/`process.stdout`/global `fetch` wiring executes (for
  line coverage, since it's always called before being overridden by injected fakes) but is
  never exercised as live I/O by any unit test.
This is exactly the surface ADR 0008 assigns to the E2E domain's PTY harness — flagging it
explicitly per this handoff's instruction rather than letting the 100% coverage number imply
more than it does.

**Definition-of-done checklist:**
- [x] SSE parser reconstructs `ServerSentEvent`s from a raw stream fixture, multi-line data,
      `id:` tracking (`src/tui/sse-parser.test.ts`).
- [x] Root view renders streaming output and accepts input producing a well-formed
      `send_message` command (`src/tui/app.test.ts`, `src/tui/state.test.ts`).
- [x] Agent tree navigation (left-arrow -> list -> select -> read-only view -> back) works
      end to end against a fixture tree (`src/tui/app.test.ts`: "navigating into the tree,
      selecting an agent, and going back works end to end").
- [x] Rendering logic unit-tested; raw terminal I/O isolated and its untested surface named
      above.

**Cross-domain requests:** none outstanding — the one open question (endpoint paths) is now
resolved by direct observation of the landed Server code, not by request. If Server's route
paths change again, `EVENTS_PATH`/`COMMAND_PATH` in this domain are the two constants to
update. No changes needed to `src/contracts/` — the wire shapes already lined up exactly.

Agent-memory note: I came online after CLAUDE.md's §7 (roster/agent-memory convention)
already existed on `main` but before this worktree (branched at `a975c25`) had it. I did not
edit this worktree's `CLAUDE.md` — that's the coordinator's file to reconcile on merge (see
`docs/roster/mary.md` for my memory entry and a note to that effect). My roster-table row
still needs to be added to `CLAUDE.md` §7 by whoever merges this.

---

## Round 4 — OPEN — visible cursor in the input box

**Addressed to:** TUI (Mary, resumed — read `docs/roster/mary.md` first).

Confirmed via real interactive testing (owner, on a real terminal): typing in the root
view's input box works correctly, but there's no visible cursor — the app hides the real
terminal cursor entirely at startup (`app.ts`: `stdout.write(ALT_SCREEN_ENTER + HIDE_CURSOR)`,
only re-shown on quit) and `render.ts`'s input line (`const inputLine = \`> ${state.input}\`;`)
never renders a cursor marker of its own. Makes typing hard to track — you can't tell where
you are in the input.

**Fix:** render a synthetic cursor as part of the frame text itself (consistent with the
existing pure `TuiState -> string[]` rendering architecture — no need to calculate real
terminal cursor positions relative to variable-height content above it). A reasonable
approach: an inverse-video space or block character (`\x1b[7m \x1b[0m` or similar) appended
at the end of `state.input` when the root view is focused and editable; no cursor needed in
the read-only tree/agent views. Your call on the exact rendering, but it should be visually
obvious in a real terminal, not just "technically present."

**Gates:** the standard three (`bun run typecheck`, `bun run lint`, `bun run test:coverage`).
Add a render-level unit test asserting the cursor marker appears in the rendered frame when
appropriate and doesn't appear in read-only views. Append a dated status entry here and
update `docs/roster/mary.md` when done.

---

**Status — 2026-07-15, done.** Added `CURSOR_MARKER` (`\x1b[7m \x1b[0m`, an inverse-video
space) to `src/tui/render.ts`, appended after `state.input` only in `renderRoot`'s
`inputLine`. Tree and agent views are untouched (read-only, no cursor). Exported the
constant so tests can assert against it directly instead of hardcoding the escape sequence.

Added three tests to `src/tui/render.test.ts`:
- root view's input line ends with the marker when input is non-empty,
- the marker is still shown appended to `"> "` when input is empty (so the cursor is visible
  even before typing starts, not just once there's text to attach it to),
- tree and agent view frames never contain the marker.

**Gates — all green:**
```
bun run typecheck      # clean
bun run lint            # biome check . — clean
bun run test:coverage   # 691 pass / 0 fail; src/tui/render.ts 100.00%/100.00%
```

No cross-domain requests — this was fully containable inside `src/tui/render.ts` and its
test file, per the handoff's own framing.
