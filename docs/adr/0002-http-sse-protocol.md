# ADR 0002: HTTP + SSE over WebSocket for client↔server

**Status:** Accepted

## Context

The client (console or web) needs to receive a heavy, mostly one-directional stream of
agent output from the server, and occasionally send small commands (send message, request
agent tree, download logs, stop a task). Candidates: WebSocket, or HTTP POST + Server-Sent
Events.

## Decision

**HTTP + SSE on a single port.**

- Server → client: SSE stream of **versioned JSON events** (explicit `version` field per
  event). Must support resume via the standard `Last-Event-ID` header.
- Client → server: plain HTTP POST for commands.
- The console client parses SSE itself (not a browser) — trivial in Bun, no library needed.

Rationale: SSE is plain HTTP, so it survives proxies/middleboxes that mishandle WebSocket
upgrades; it has built-in reconnection semantics via `Last-Event-ID`; and the traffic
pattern (heavy down, light up) doesn't need WebSocket's bidirectional symmetry.

## Consequences

- No WebSocket dependency or upgrade-handshake edge cases.
- Reconnection/resume logic must be implemented against `Last-Event-ID` from day one —
  it's part of the wire contract, not an optional extra.
- Command responses are ordinary HTTP responses (status + JSON body), separate from the
  event stream; the two channels are not request/response-paired.
- Event schema versioning lives in `src/contracts/` (single source of truth) — every event
  type change is a contracts-domain change (CLAUDE.md §6 escalation trigger 2).
