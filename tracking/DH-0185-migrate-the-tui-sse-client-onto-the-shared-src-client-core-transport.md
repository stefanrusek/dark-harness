---
spile: ticket
id: DH-0185
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

# DH-0185: Migrate the TUI SSE client onto the shared src/client-core/ transport

## Summary

Swap src/tui/sse-client.ts onto the shared client-core SSE transport and delete src/tui/sse-parser.ts plus the now-duplicated backoff/reconnect logic. Preserve the TUI's existing onConnectionChange / onEvent / onReconnected / onParseError callback surface and its connecting-vs-reconnecting semantics. Net behavior change: model_switched / resync / agent_thinking events stop being dropped by the removed KNOWN_TYPES allowlist (see DH-0184). Owned by Mary (TUI). Independent of the Web migration sibling.

## User Stories

### As the TUI, I want to run its SSE connection through the shared client-core transport instead of its own duplicated implementation

- Given a running TUI session, when it connects to the server's `/api/events` stream, then it uses `runSseTransport` (`src/client-core/sse-transport.ts`) for frame parsing, payload validation, `Last-Event-ID` tracking, and full-jitter reconnect/backoff, not TUI-local copies. Proven by `src/tui/app.test.ts` (all SSE-driven scenarios: connect, event dispatch, reconnect, auth headers) exercising `startTui` end to end against a fake `fetchImpl`, and by `e2e/tui.test.ts` / `e2e/slash-commands.test.ts` / `e2e/markdown-rendering.test.ts` exercising the real compiled binary's SSE connection over a real HTTP stream.
- Given the TUI's existing callback surface (`onConnectionChange`, `onEvent`, `onReconnected`, `onParseError`) and its connecting-vs-reconnecting semantics, when the migration lands, then that surface and semantics are preserved unchanged — only the transport/parsing/reconnect internals move. Proven by `src/tui/app.test.ts` (connection-status transitions, reconnect notice, auth header propagation) passing unmodified in behavior (only its `EVENTS_PATH` import path changed, from the deleted `sse-client.ts` to `app.ts`, which now re-exports it).
- Given a `model_switched`, `resync`, or `agent_thinking` server-sent event, when it arrives over SSE, then the TUI's reducer (`src/tui/state.ts`) actually receives and handles it, since the shared transport's `parseServerSentEventPayload` (DH-0184) has no type allowlist — fixing the latent bug in the old TUI-local `sse-parser.ts`'s `KNOWN_TYPES` set (DH-0170) that silently dropped all three. Proven by `src/tui/state.test.ts` (reducer-level `model_switched`/`resync`/`agent_thinking` cases, already present and now reachable in production) and by `e2e/slash-commands.test.ts`'s `/model switches the provider-side model id on the next request` test, updated in this round to assert on the now-live `model switched to model-b` status text the server's `model_switched` event produces (previously masked by the drop bug, so the test only ever observed the transient local "switching..." status).

## Functional Requirements

- `src/tui/sse-client.ts` and `src/tui/sse-parser.ts` (plus their test files) are deleted; the TUI has no SSE frame-parsing, payload-validation, or backoff/reconnect logic of its own.
- `src/tui/app.ts` calls `runSseTransport` from `src/client-core/sse-transport.ts`, passing the full target URL (`${baseUrl}${EVENTS_PATH}`) and the same callback set it wired to `runSseClient` before.
- `EVENTS_PATH` (`/api/events`) is preserved as a TUI-visible export (relocated into `app.ts`) since `app.test.ts` depends on it to build its fake SSE endpoint.
- 100% line coverage maintained (`bun run test:coverage`); all four CLAUDE.md §5 gates green, including real-binary e2e.

## Assumptions

- Web's own migration (DH-0186) is out of scope here and untouched — confirmed no edits to `src/web/client/`.

## Risks

- The `model_switched` fix changes real e2e-observable timing (the transient "switching model to X…" status can now be fully superseded by the server's confirmation before the next tmux screen capture) — `e2e/slash-commands.test.ts` was updated to assert on either status text rather than only the transient one, so it no longer race-loses against the fix.

## Open Questions

(none)

## Notes

### 2026-07-18 — implementation

- Migrated `src/tui/app.ts` off `src/tui/sse-client.ts`'s `runSseClient` onto `src/client-core/sse-transport.ts`'s `runSseTransport`, passing `url: \`${baseUrl}${EVENTS_PATH}\`` (TUI now owns `EVENTS_PATH` itself, re-exported from `app.ts` since `sse-client.ts` is gone).
- Deleted `src/tui/sse-client.ts`, `src/tui/sse-client.test.ts`, `src/tui/sse-parser.ts`, `src/tui/sse-parser.test.ts` — all frame-parsing/payload-validation/backoff logic now lives solely in `src/client-core/`.
- Updated `src/tui/app.test.ts`'s `EVENTS_PATH` import to come from `./app.ts`.
- Updated a stale comment in `src/tui/state.ts` (the `agent_thinking` reducer case) that referenced the now-deleted `sse-parser.ts`'s `KNOWN_TYPES` allowlist, documenting that the event is now actually reachable at runtime.
- Confirmed the KNOWN_TYPES bug fix is live: fixed `e2e/slash-commands.test.ts`'s `/model switches the provider-side model id on the next request` test, which previously only ever observed the transient local "switching model to model-b…" status because the server's real `model_switched` SSE confirmation was silently dropped by the old allowlist. With the fix, that confirmation now arrives and can supersede the transient status before the test's next screen poll, so the assertion was widened to accept either status string as valid proof of the switch.
- Gate results (this worktree): `bun run typecheck` clean; `bun run lint` clean (biome auto-fixed one import-order sort in `app.ts`); `bun run test:coverage` 134/134 suites pass, 100.00% lines (13307/13307); `bun run e2e` 38/38 tests pass across 11 files, including `e2e/slash-commands.test.ts`, `e2e/tui.test.ts`, and `e2e/markdown-rendering.test.ts` against the real compiled binary and a real PTY. One `e2e/web.test.ts` browser-hook timeout was observed on an earlier full-suite run and confirmed as a pre-existing flake unrelated to this change (passed cleanly in isolation; `src/web/client/` untouched).
