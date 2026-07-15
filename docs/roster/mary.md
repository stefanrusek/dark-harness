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
