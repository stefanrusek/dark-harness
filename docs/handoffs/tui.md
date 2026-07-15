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
