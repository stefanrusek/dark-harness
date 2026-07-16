---
spile: ticket
id: DH-0059
type: bug
status: ready
owner: stefan
resolution:
blocked_by: []
created: 2026-07-15
relations:
  depends_on: []
  relates_to: []
  supersedes: []
implementation:
  - repo: dark-harness
---

# DH-0059: Interactive root agent never reaches session_ended without an explicit stop

## Summary

Surfaced while fixing DH-0058 (SSE idle-timeout bug, now fixed): Core round 5's change (loop.ts, commit 7a20fd5) makes an interactive root agent (server/TUI/Web always run interactive: true) pause forever in 'waiting' status after a turn with no tool call, by design, so a human can keep chatting. session_ended only fires on an explicit stop (e.g. the SIGTERM handler in cli.ts calls stopAgent). But the TUI's own Ctrl+C/quit path (src/tui/app.ts) never calls stop_agent before exiting, so quitting the TUI doesn't produce session_ended either. This independently hangs e2e/tui.test.ts's two scenarios and e2e/security.test.ts's authenticated happy-path test (all currently waiting on this fix, separate from the now-fixed DH-0058 heartbeat bug). Cross-domain: Core (loop.ts/cli.ts session-lifecycle semantics) and TUI (app.ts quit path) jointly, touches session-lifecycle/exit-code semantics (CLAUDE.md 6.4 trigger).

## User Stories

### As an operator, I want Ctrl+C to stop the agent whenever the server it lives in is the thing being shut down, and to leave it running when only a remote client detaches

- Given local mode (server + TUI client in the same process — the default `dh` invocation),
  when Ctrl+C is pressed, then the agent stops, the server shuts down, and the terminal
  exits — same as today's headless `--server` SIGTERM behavior.
- Given headless `--server` mode, when Ctrl+C/SIGTERM is received, then the agent stops and
  the process exits (already correct today — this is the reference behavior to match).
- Given `--connect <host>` client mode (a client connected to a separate, already-running
  server process), when Ctrl+C is pressed, then only the local client exits — the remote
  server and its agent keep running untouched, since the agent lives in the server process,
  not the client.

## Functional Requirements (architect design, 2026-07-15 — Fable)

The distinguishing factor is **whether this process owns the server** (local mode, headless
`--server`) vs. **is a client only** (`--connect`) — not which UI, not which keystroke. The
sections below are the concrete design; Grace (Core) and Mary (TUI) each have a scoped piece
with the interface between them pinned down in §7.

### 1. Mode knowledge: cli.ts passes ownership in; the TUI cannot detect it

The TUI cannot infer "the server is in my process" from anything it can observe — its
`baseUrl` is `http://localhost:<port>` both in local mode (embedded `DhServer` on an
ephemeral port) and in a same-host `--connect localhost`. Only `src/cli.ts` knows, because
`runInteractiveMode()` is what did or didn't construct the `DhServer`: the `connect` branch
calls `deps.startTui(targetBaseUrl, token)` with no local server; the `local` branch calls
`deps.startTui(baseUrl, token)` a few lines after `server.start()`. No new state needs
deriving — the branch itself is the state. It just has to be **threaded into `startTui` at
construction time**:

- Cross-domain contract: `startTui(baseUrl: string, token: string | undefined,
  opts?: { ownsServer?: boolean; io?: Partial<TuiIO> })` — the existing third positional
  `io` param folds into the options bag (Mary updates her unit tests; cli.ts never passed
  `io`). `ownsServer` defaults to `false`, so `--connect` behavior is unchanged by omission.
- `CliDeps.startTui`'s type in cli.ts updates to match. The local branch passes
  `{ ownsServer: true }`; the connect branch passes nothing (or `{ ownsServer: false }`).
- Inside the TUI, `ownsServer` is seeded into `TuiState` by `initialState()` so the pure
  reducer (`state.ts`) can branch on it — it is state, not an `app.ts`-local closure
  variable, because the Ctrl+C decision lives in the reducer.

Note Ctrl+C in a raw-mode alt-screen TUI arrives as the `0x03` keystroke (`keys.ts` →
`ctrl_c`), **not** as SIGINT — cli.ts's existing `installSignalHandlers` never fires in
local TUI mode. The signal handler stays exactly as is (it is the correct and already-working
path for headless `--server` and local `--web`, both cooked-mode); the TUI key path is the
thing being fixed.

### 2. Stop mechanism: TUI sends the wire `stop_agent`, waits for `session_ended`, then quits; cli.ts backstops

Recommended (over internally re-triggering the SIGTERM handler): the TUI stays a pure
protocol client and uses the **existing wire command** — no new interface into Core beyond
the `ownsServer` boolean, and the "session ended (exit N)" confirmation renders through the
completely ordinary SSE path (`state.ts` already handles `session_ended`; `render.ts`
already prints it). Re-triggering SIGTERM internally was rejected: the handler calls
`io.exit()` synchronously, which would kill the process before `session_ended` ever reached
the TUI (or the JSONL log flush), and would tear the terminal down from under raw mode.

Reducer rules for `ctrl_c` (replacing the unconditional `quit` at `state.ts:277`):

1. `ownsServer === false` → `[{ type: "quit" }]` — unchanged today's behavior (silent detach).
2. `ownsServer === true`, session already ended (`state.sessionEnded !== null`), root never
   active (see below), or `rootAgentId` unknown → `[{ type: "quit" }]` — nothing to stop;
   quit must be prompt (<200ms), no shutdown wait.
3. `ownsServer === true`, first press, root has been active → set `shutdownRequested: true`
   in state, emit `[{ type: "send_command", command: { type: "stop_agent", agentId:
   rootAgentId } }]`. Render a status-line hint while waiting, e.g.
   `stopping session… (Ctrl+C again to force quit)`.
4. `ownsServer === true`, second press (`shutdownRequested` already true) → `[{ type:
   "quit" }]` — force quit, escape hatch for a stop that never completes (loop.ts's abort
   deliberately does not interrupt an in-progress blocking tool call).

"Root has been active": a new `TuiState` boolean, true once any root `agent_spawned` /
`agent_output` / `token_usage` event has been seen or the operator has sent a message —
the tree-response bootstrap alone (which synthesizes a root node pre-start) must NOT count,
because `stop_agent` on a never-started root is a no-op (`stopRoot()` is
`rootController?.abort()` with no controller yet) and `session_ended` would never arrive.

Completion path: when a `session_ended` SSE event arrives while `shutdownRequested` is set,
the reducer emits a **deferred quit** — spec'd as effect `{ type: "quit"; afterMs?: number }`
with `afterMs = SESSION_ENDED_LINGER_MS = 1000`. `app.ts` honors `afterMs` by drawing the
final frame first, then resolving after the delay. Two implementation notes for Mary, both
load-bearing: (a) `dispatch()` currently runs effects *before* `draw()`, and the quit
effect's `cleanup()` is synchronous — so without deferral the "session ended (exit 0)" frame
never paints and the e2e capture (150ms poll, tmux pane dies with the process) can never see
it; (b) `app.ts` also starts a hard fallback timer when `shutdownRequested` is set
(`SHUTDOWN_FALLBACK_MS = 5000`) that force-quits if `session_ended` never arrives (wire
failure, tool call still blocking).

cli.ts backstop (Grace), local branch after `await deps.startTui(...)` resolves — currently
`uninstallSignals(); server.stop()` with the agent never stopped:

```
try { agentLoop.stopAgent(ROOT_AGENT_ID); } catch { /* best-effort */ }
uninstallSignals();
server.stop();
return ExitCode.Success;
```

This guarantees no orphaned agent regardless of *how* the TUI resolved (graceful stop
already done — `stopRoot()` re-abort is idempotent; force quit; fallback-timer quit;
never-started root), and lets the loop's `reportStopped` JSONL lines land before the event
loop drains. It mirrors what the SIGTERM handler already does, minus `io.exit()` (the
process exits naturally once the server socket closes and stdin is paused).

Exit-code semantics (Core, `src/agent/loop.ts`): stopping an interactive agent **paused in
"waiting"** is a graceful end of conversation, not an interrupted task — the
`STOPPED_WHILE_WAITING_REASON` path (loop.ts ~line 476) changes to return `success: true`
(still emitting `agent_status: "stopped"` + the `status_change` log line with the same
reason). Via runtime.ts's existing `result.success ? Success : TaskFailure` mapping,
`session_ended` then carries `exitCode: 0` for an operator-ended waiting session. The other
two stop points (`STOPPED_BETWEEN_TURNS`, `STOPPED_DURING_PROVIDER_CALL`) keep
`success: false` — they interrupt active work. This is an ADR 0005 semantic clarification
(no new codes): Grace appends a short amendment note to `docs/adr/0005-exit-code-contract.md`
in her round, citing this ticket. Side effect to note in tests: a sub-agent stopped while
waiting no longer makes `spawnAgent`'s wrapper throw "sub-agent reported failure" —
`TaskRegistry.stop()` still records `"stopped"`, which is the more accurate outcome.

### 3. `--connect` Ctrl+C: unchanged, silent detach is correct

`ownsServer` defaults false, so rule 1 above preserves today's behavior byte-for-byte:
abort the SSE fetch, restore the terminal, resolve, process exits. No "client detached"
notification: the server already observes the SSE connection close, the wire protocol has no
detach command, and nothing would consume one. `--connect --web` likewise needs nothing —
that branch never installs signal handlers, so Ctrl+C kills only the local static-file
process, which is exactly the ownership rule.

### 4. Web: no change needed — confirmed, not assumed

`src/web/client/app.ts` has no quit path at all beyond `connection?.close()` on SSE
teardown; no `beforeunload` hook, nothing sends `stop_agent`. That is **correct** under the
ownership rule: the browser is always a client, even in local `--web` mode — the server
lives in the `dh` process, whose terminal runs in cooked mode (no TUI), so Ctrl+C there is a
real SIGINT and the existing cli.ts handler already does stopAgent → server.stop → exit.
Wiring `beforeunload`/`sendBeacon` to `stop_agent` would *violate* the rule (tab close would
kill a session the browser doesn't own). Known cosmetic gap, explicitly out of scope: the
signal handler calls `io.exit()` synchronously after `stopAgent()`, so a connected browser
sees the SSE drop rather than a final `session_ended` event. If a later round wants it,
the fix is deferring `io.exit()` until `session_ended` is observed or a ~1s timeout — not
required by this ticket and not needed by any of the blocked tests.

### 5. Contract impact: none on the wire; one ADR 0005 amendment note

- `src/contracts/`: **no changes.** `session_ended` already carries `exitCode`; no new event
  types, no new commands, no `dh.json` schema change (ADR 0006 untouched).
- ADR 0005: one amendment note (per §2 above) clarifying that an operator stop of a
  *waiting* interactive session maps to exit 0, while stopping *actively working* agents
  remains exit 1. No new codes, no renumbering.
- This is otherwise pure process-lifecycle wiring in Core + TUI.

### 6. E2E unblocking (Hedy — triggers added, no assertions loosened)

- `e2e/tui.test.ts` local-TUI test: after the reply renders, add `session.sendKeys("C-c")`;
  the existing `waitFor(screen.includes("session ended"))` then passes — the TUI renders
  `session ended (exit 0)` and lingers 1000ms before exiting, comfortably above the 150ms
  capture poll. Assertions unchanged.
- `e2e/tui.test.ts` `--connect` test: after the reply renders on the client, POST
  `{ type: "stop_agent", agentId: "agent-root" }` to the server (the test already POSTs
  `send_message` the same way); the client — which stays running, Ctrl+C not involved —
  renders `session ended (exit 0)`. Assertions unchanged.
- `e2e/security.test.ts` happy path: after the authenticated `send_message`, wait for
  `agent_status: "waiting"` on the SSE stream, then POST an authenticated `stop_agent`;
  the existing `expect(ended).toMatchObject({ exitCode: 0 })` now passes *because of* the
  graceful-waiting-stop rule (stopping mid-provider-call would yield 1, hence the wait for
  "waiting" first). Assertion unchanged.
- `e2e/server-protocol.test.ts` (consequential correction, not a loosening): its
  stop-while-waiting test currently expects `exitCode: ExitCode.TaskFailure`; under the
  corrected semantics that assertion changes to `ExitCode.Success` — equally strict, new
  contract. Grace makes the mirror-image updates in `src/cli.test.ts` / loop/runtime unit
  tests.

### 7. Domain assignment and interface

**Grace (Core)** — `src/agent/loop.ts`, `src/cli.ts`, `docs/adr/0005` amendment note:
1. loop.ts: `STOPPED_WHILE_WAITING_REASON` stop returns `success: true` (status/log
   unchanged); other stop reasons unchanged.
2. cli.ts: local branch passes `{ ownsServer: true }` to `startTui`; post-`startTui`
   backstop `stopAgent(ROOT_AGENT_ID)` before `server.stop()` (try/catch, best-effort);
   `CliDeps.startTui` type updated to the contract in §1.
3. Unit tests (cli.test.ts, loop/runtime tests) updated for the exit-0-on-waiting-stop
   semantics; ADR 0005 amendment note.

**Mary (TUI)** — `src/tui/`:
1. `startTui` options bag per §1 (`ownsServer` + `io` folded together); `ownsServer` and
   `shutdownRequested` and root-has-been-active in `TuiState`.
2. Reducer `ctrl_c` rules 1–4 and the deferred-quit-on-`session_ended` effect per §2;
   `{ type: "quit"; afterMs?: number }` effect shape; status-line "stopping session…" hint.
3. app.ts: honor `afterMs` (draw before cleanup — see the effects-before-draw ordering trap
   in §2), `SHUTDOWN_FALLBACK_MS` timer; unit tests with fake IO.

**Hedy (E2E)** — the three test triggers + the server-protocol assertion correction per §6.
Sequenced after Grace and Mary land (Grace and Mary are independent of each other; the
`startTui` signature is the one shared seam — Grace's cli.ts change and Mary's startTui
change should land in one merge or with Mary first, since cli.ts compiles against her
export).

**Web (Susan)** — explicitly no change (§4).

Constants (TUI-owned, named here so tests can reference intent): `SESSION_ENDED_LINGER_MS =
1000`, `SHUTDOWN_FALLBACK_MS = 5000`.

## Notes

> [!NOTE]
> Owner decision (2026-07-15): the rule is "the agent lives inside the server, not the
> client" — Ctrl+C shuts down whatever this process is responsible for. Surfaced while
> fixing DH-0058; independently blocks `e2e/tui.test.ts`'s two scenarios and
> `e2e/security.test.ts`'s authenticated happy-path test (all currently hang waiting on
> `session_ended`, which never fires today in local/headless mode either, since quit paths
> never call `stop_agent`).
