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

### 2026-07-15 — Mary (TUI domain lead)

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
