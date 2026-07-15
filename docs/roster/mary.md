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
