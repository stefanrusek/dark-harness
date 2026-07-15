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
