---
spile: ticket
id: DH-0059
type: bug
status: refining
owner: stefan
resolution:
blocked_by: ["architect design pass in progress"]
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

## Functional Requirements

- The distinguishing factor is **whether this process owns the server** (local mode,
  headless `--server`) vs. **is a client only** (`--connect`) — not whether the UI is a TUI
  or Web client, and not which specific keystroke is used. TUI's Ctrl+C/quit path
  (`src/tui/app.ts`) needs to know which mode it's running in and call `stop_agent`
  (mirroring the existing SIGTERM handler in `src/cli.ts`) only when it owns the server.
  Web should get the analogous fix if it has the same gap (implementer to check).

## Notes

> [!NOTE]
> Owner decision (2026-07-15): the rule is "the agent lives inside the server, not the
> client" — Ctrl+C shuts down whatever this process is responsible for. Surfaced while
> fixing DH-0058; independently blocks `e2e/tui.test.ts`'s two scenarios and
> `e2e/security.test.ts`'s authenticated happy-path test (all currently hang waiting on
> `session_ended`, which never fires today in local/headless mode either, since quit paths
> never call `stop_agent`).
