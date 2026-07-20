---
spile: ticket
id: DH-0184
type: feature
status: closed
owner: stefan
resolution: done
blocked_by: []
created: 2026-07-18
relations:
  depends_on: [DH-0183]
  relates_to: [DH-0170]
  supersedes: []
implementation:
  - repo: dark-harness
---

# DH-0184: Extract the shared SSE transport (frame parser + full-jitter backoff + Last-Event-ID reconnect + payload validation) into src/client-core/, resolving the validation-strictness divergence

## Summary

Build one shared SSE-client transport module in src/client-core/ replacing the duplicated logic in src/tui/{sse-parser,sse-client}.ts and src/web/client/sse.ts: incremental SSE field parser, full-jitter exponential backoff (the byte-equivalent 1000/30000 constants), and the Last-Event-ID reconnect driver. ARCHITECT DECISION on the DH-0170 item-1 validation divergence: the canonical payload validator is the PERMISSIVE shape-check (version/id/timestamp/type present and correctly typed), NOT a hardcoded event-type allowlist. The TUI's strict KNOWN_TYPES set is a confirmed latent BUG: it omits model_switched, resync, and agent_thinking (all in the contracts ServerSentEvent union, all handled by the TUI reducer), so those events are silently dropped at the parser before reaching the reducer. Unknown/future event types are tolerated by the reducer's exhaustiveness default, not filtered by the parser. Module ships fully unit-tested but does not itself migrate either client (see the two migration sub-tickets).

## User Stories

### As the TUI or Web domain lead migrating onto the shared transport (DH-0185/DH-0186), I want one SSE transport module to import

- Given a raw SSE byte/text stream chunked at arbitrary boundaries, when it is fed
  incrementally to `SseFrameParser.push()`, then completed `{id, event, data}` frames are
  returned per the WHATWG SSE field-parsing rules (blank-line-terminated, multi-line `data:`
  joined with `\n`, CRLF tolerated). Proven by `src/client-core/sse-frame-parser.test.ts`.
- Given a frame's `data:` payload, when it is validated via `parseServerSentEventPayload`,
  then it is accepted iff `version === 1` and `id`/`timestamp`/`type` are present and
  correctly typed — with **no event-type allowlist** — so `model_switched`, `resync`, and
  `agent_thinking` (previously dropped by the TUI's pre-DH-0184 `KNOWN_TYPES` bug) now parse
  through, same as any other well-shaped payload. Proven by
  `src/client-core/sse-payload.test.ts`, in particular the
  `"accepts model_switched, resync, and agent_thinking"` and
  `"tolerates an entirely unrecognized event type"` cases.
- Given a sequence of consecutive connection failures, when the reconnect delay is computed
  via `computeBackoffDelayMs`, then it follows full-jitter exponential backoff
  (`random() * min(cap, base * 2^attempt)`) with the byte-equivalent 1000ms/30000ms
  default constants both clients had independently converged on. Proven by
  `src/client-core/sse-backoff.test.ts`.
- Given a live SSE connection that drops (non-OK response, thrown fetch, or a clean stream
  end) or the caller's `AbortSignal` firing, when `runSseTransport` runs its reconnect loop,
  then it resends `Last-Event-ID` on every reconnect attempt, reports the shared
  `ConnectionStatus` vocabulary (`connecting`/`live`/`reconnecting`/`disconnected`) correctly
  at each transition, fires `onReconnected` only after a prior failure (never on the first
  connect), and stops cleanly (reporting `disconnected`) once the signal aborts. Proven by
  `src/client-core/sse-transport.test.ts` (ported 1:1 from `src/tui/sse-client.test.ts`'s
  suite, generalized from `baseUrl` to a full `url`, plus an added
  `maxReconnectDelayMs`-cap case).

## Functional Requirements

- `src/client-core/sse-frame-parser.ts` — `SseFrameParser` class + `RawSseFrame` interface.
  Extracted from `src/tui/sse-parser.ts`'s incremental parser (a strict superset of Web's
  `SseStreamParser`, which additionally required the `event` field).
- `src/client-core/sse-payload.ts` — `parseServerSentEventPayload(data: string)`. Canonical
  validator per the architect decision baked into this ticket: permissive shape-check
  (`version`/`id`/`timestamp`/`type` present, correctly typed), no `KNOWN_TYPES` allowlist.
  Resolves the DH-0170 validation-strictness divergence by fixing the TUI's confirmed latent
  bug (silently dropped `model_switched`/`resync`/`agent_thinking`) rather than propagating
  it forward.
- `src/client-core/sse-backoff.ts` — `computeBackoffDelayMs`, plus the exported
  `DEFAULT_RECONNECT_DELAY_MS` (1000) / `DEFAULT_MAX_RECONNECT_DELAY_MS` (30000) constants.
- `src/client-core/sse-transport.ts` — `runSseTransport(options): Promise<void>` +
  `SseTransportOptions`. The Last-Event-ID reconnect driver, generalized from
  `src/tui/sse-client.ts`'s `runSseClient` (loop + `AbortSignal`, injectable
  `fetchImpl`/`delayImpl`/`randomImpl`) to take a full `url` instead of a `baseUrl` +
  path constant, so it's agnostic to how each client composes its server target (TUI's
  `EVENTS_PATH` constant vs. Web's `sseUrl(target)`).
- No changes to `src/tui/` or `src/web/` — migrating either client onto this module is
  explicitly out of scope (DH-0185/DH-0186).
- 100% line coverage on all four new files (`bun run test:coverage`, gate per CLAUDE.md §5).

## Assumptions

- The reconnect driver's callback-based, `AbortSignal`-driven shape (TUI's design) is the one
  carried forward as the shared implementation, rather than Web's timer-based
  `connectEvents()`-returns-`{close()}` shape — both are reconciled onto one URL-taking API by
  DH-0185/DH-0186 during their own migrations, not here.
- `version === 1` remains part of the permissive check (not dropped entirely) per the
  ticket Summary's literal wording ("version/id/timestamp/type present and correctly typed").

## Risks

- None identified — this ticket adds a new, unconsumed module; it cannot regress either
  client's current runtime behavior since neither imports it yet.

## Open Questions

- None open for this ticket. DH-0185/DH-0186 will surface any real friction in the exact
  driver-shape reconciliation while migrating.

## Notes

### 2026-07-18 — implementation

Built `src/client-core/sse-frame-parser.ts`, `sse-payload.ts`, `sse-backoff.ts`, and
`sse-transport.ts`, extracting the incremental SSE field parser, the permissive payload
validator (fixing the TUI's `KNOWN_TYPES` bug per the architect decision), full-jitter
backoff, and the Last-Event-ID reconnect driver out of `src/tui/{sse-parser,sse-client}.ts`
and `src/web/client/sse.ts` without modifying either existing file. Added a full test suite
per module (`*.test.ts`), largely ported from the TUI's existing suites plus new cases
covering the validation-strictness fix and a custom `maxReconnectDelayMs`. All four quality
gates green locally: `bun run typecheck`, `bun run lint`, `bun run test:coverage` (100.00%
lines, 132/132 tests — one `src/web/client/app.test.ts` case was flaky under full-suite
parallelism, confirmed passing standalone and on a clean rerun, unrelated to this change),
`bun run e2e` (38/38 on a clean run — `e2e/web.test.ts`'s headless-browser case is
intermittently flaky in this environment, confirmed passing on rerun). TUI and Web remain
unmigrated, as scoped — that's DH-0185/DH-0186.
