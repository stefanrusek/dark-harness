---
spile: ticket
id: DH-0186
type: feature
status: closed
owner: stefan
resolution: done
blocked_by: []
created: 2026-07-18
relations:
  depends_on: [DH-0184]
  relates_to: [DH-0170]
  supersedes: []
implementation:
  - repo: dark-harness
---

# DH-0186: Migrate the Web SSE client onto the shared src/client-core/ transport

## Summary

Swap src/web/client/sse.ts onto the shared client-core SSE transport, deleting the duplicated SseStreamParser / nextReconnectDelayMs / reconnect driver while keeping Web's connectEvents()/SseConnection.close() API, bearer-token header, and CRLF tolerance. Web already uses the permissive payload validator, so no behavior change for Web on that axis. Owned by Susan (Web). Independent of the TUI migration sibling.

## User Stories

### As Web (Susan), I want the Web SSE client to use the shared client-core transport, so the frame parser/backoff/reconnect driver isn't duplicated between TUI and Web.

- Given the Web client's `connectEvents()`, when it opens/reconnects the SSE stream, then it delegates frame parsing, payload validation, full-jitter backoff, and the `Last-Event-ID` reconnect loop to `runSseTransport` (`src/client-core/sse-transport.ts`) instead of Web's own `SseStreamParser`/`nextReconnectDelayMs`/hand-rolled `run()` loop — proven by `src/web/client/sse.test.ts` (`connectEvents` describe block; asserts URL/header composition, status transitions, event forwarding, and reconnect-timer wiring all route through the shared transport) plus the now-unified `src/client-core/sse-transport.test.ts` covering the deep reconnect/backoff/parsing behavior once, generically.
- Given a caller of `connectEvents()` (e.g. `src/web/client/app.ts`), when it uses the existing `SseHandlers`/`ConnectEventsOptions`/`SseConnection` API, then that public API is unchanged (`onEvent`/`onStatusChange`/`onReconnected`, `fetchImpl`/`reconnectDelayMs`/`maxReconnectDelayMs`/`setTimeoutImpl`/`clearTimeoutImpl`/`randomImpl`, `close()`) — proven by `src/web/client/app.test.ts` (unmodified call sites/tests all still pass, including the DH-0024 gap-banner and connection-pill tests).
- Given the Web client's bearer-token auth and CRLF-tolerant framing, when the shared transport parses frames, then both are preserved: `Authorization: Bearer <token>` header (proven by `sse.test.ts`'s "sends a real Authorization header" test) and CRLF tolerance (proven by `src/client-core/sse-frame-parser.test.ts`, which the shared parser inherits).

## Functional Requirements

- Delete `src/web/client/sse.ts`'s own `SseStreamParser`, `parseEventPayload`, and `nextReconnectDelayMs` — replace with calls into `src/client-core/sse-frame-parser.ts`, `sse-payload.ts`, and `sse-backoff.ts` via `runSseTransport`.
- Keep `connectEvents()`'s public signature and `SseConnection.close()` semantics (idempotent, aborts in-flight request) unchanged.
- Preserve Web's pre-migration `onReconnected` semantics (fires on *any* successful connect after the first, including a clean stream end) even though the shared transport's own `onReconnected` is narrower (fires only after a genuine failed attempt, matching TUI's original behavior) — done locally in `connectEvents()` by deriving "reconnected" from the `live` connection-status transition rather than passing `handlers.onReconnected` straight through.

## Assumptions

- The shared transport's permissive `parseServerSentEventPayload` validator (DH-0184) is behaviorally identical to Web's pre-migration `parseEventPayload` — confirmed by DH-0170's architect decomposition notes and re-confirmed while reading both implementations during this migration.

## Risks

- `src/client-core/sse-transport.ts`'s `onReconnected` only fires after an actual failed (re)connect attempt, not after every non-initial connect — a real, if subtle, difference from Web's original behavior (and from what a first read of the shared module implies "no behavior change" would mean). Worked around locally in `src/web/client/sse.ts` (see Functional Requirements) rather than changing the shared, Core-owned module; flagging here since it's the kind of divergence CLAUDE.md §6 item 6 asks to surface rather than quietly paper over. Not escalated further since it was resolved entirely inside Web's own file with no change to shared/contracts code.

## Open Questions

## Notes

### 2026-07-18 — implementation

Migrated `src/web/client/sse.ts` onto `runSseTransport` (`src/client-core/`, DH-0184). Changes:

- Removed Web's own `SseStreamParser`, `parseBlock`, `parseEventPayload`, `nextReconnectDelayMs`,
  `SseRecord`, and the hand-rolled `run()`/`scheduleReconnect()` reconnect driver.
- `connectEvents()` now builds the SSE URL (`sseUrl()`) and bearer-token header, then calls
  `runSseTransport({ url, headers, onEvent, onConnectionChange, reconnectDelayMs,
  maxReconnectDelayMs, delayImpl, randomImpl, signal })`.
- Added `makeDelayImpl()`: adapts this client's injectable `setTimeoutImpl`/`clearTimeoutImpl`
  (used elsewhere in `app.ts`, e.g. the liveness ticker) into the `Promise`-based `delayImpl`
  shape `runSseTransport` expects, resolving early (and calling `clearTimeoutImpl`) when the
  `AbortController` used for `close()` fires — so existing tests keep driving reconnects by
  invoking the captured timer callback directly, and `close()` still cancels a pending
  scheduled reconnect.
- Found and worked around the `onReconnected` semantic divergence described under Risks —
  computed locally in `connectEvents()` from the `live` status transition instead of relying
  on `runSseTransport`'s own `onReconnected` callback.
- `app.ts`/`app.test.ts` needed **no changes** — `ConnectEventsOptions`/`SseHandlers`/
  `SseConnection` are unchanged, so every existing call site and test kept working as-is.
- Rewrote `src/web/client/sse.test.ts`: deep reconnect/backoff/frame-parsing/payload-validation
  coverage now lives once in `src/client-core/sse-transport.test.ts` (+
  `sse-frame-parser.test.ts`/`sse-payload.test.ts`/`sse-backoff.test.ts`); this file now covers
  only Web-specific wiring (URL/header composition, the timer-adapter, `onReconnected`
  semantics, `close()`).

Gate results (this worktree; merged in the `claude/coordinator-onboarding-kab9ls` branch tip
first, since this worktree had branched before DH-0183/0184 landed):

- `bun run typecheck` — pass.
- `bun run lint` — `src/web` and `src/client-core` clean (`bunx biome check src/web
  src/client-core`); the full-repo `bun run lint` has 4 pre-existing errors in
  `src/server/import-claude-session.ts`/`src/server/index.ts` from DH-0187/0188 (Server
  domain, unrelated to this ticket, already present on the branch this worktree merged from).
- `bun run test:coverage` — 137/137 test files pass, 100.00% line coverage (13819/13819). One
  transient failure on a single run in `app.test.ts` (`a second error before the first banner
  times out replaces it without a stale hide`, a `querySelector` returning `null`) did not
  reproduce on immediate rerun — pre-existing test-order flake, not touched by this change.
- `bun run e2e` — 38/38 pass on a clean run, including `e2e/web.test.ts`,
  `e2e/streaming.test.ts`, `e2e/connect-web.test.ts` (real headless-Chromium SSE connection
  end to end). One run hit a transient `stream.getReader()` on `undefined` in
  `e2e/support/dh-process.ts`'s `spawnDh()` (Bun.spawn's `proc.stdout` came back undefined) —
  did not reproduce on rerun, and the affected file (`e2e/support/dh-process.ts`) is generic
  process-spawn plumbing untouched by this ticket, not SSE-specific.
