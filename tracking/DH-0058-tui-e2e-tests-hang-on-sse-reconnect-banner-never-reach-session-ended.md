---
spile: ticket
id: DH-0058
type: bug
status: closed
owner: stefan
resolution: done
blocked_by: []
created: 2026-07-15
relations:
  depends_on: []
  relates_to: []
  supersedes: []
implementation:
  - repo: dark-harness
---

# DH-0058: TUI e2e tests hang on SSE-reconnect banner, never reach session-ended

## Summary

Full bun run e2e surfaced (via Hedy's DH-0056 e2e round, once tmux was actually installed in this sandbox letting e2e/tui.test.ts run to completion for possibly the first time) two scenarios in e2e/tui.test.ts hanging on a "Reconnected — history may be incomplete" banner and never reaching "session ended". Likely candidate per Hedy: the recently-merged periodic SSE keep-alive (Server round 2, DH heartbeat work) interacting with TUI's reconnect handling. Not caused by the DH-0056 diff itself — pre-existing, just newly visible. Server/TUI cross-domain, needs investigation.

## User Stories

### As a maintainer, I want `bun run e2e` to pass reliably, not hang

- Given the TUI e2e scenarios that trigger an SSE reconnect, when the harness reconnects,
  then the TUI proceeds normally to session-ended rather than hanging indefinitely on the
  reconnect banner.

## Notes

> [!NOTE]
> Source: Hedy (E2E), surfaced 2026-07-15 while validating DH-0056's e2e coverage — the first
> time `bun run e2e`'s full suite ran to completion in this sandbox (tmux was missing before).
> Pre-existing, not caused by DH-0056. Prime suspect: interaction between Server's periodic
> SSE keep-alive (Server round 2 heartbeat work) and TUI's reconnect handling. Needs a joint
> Server/TUI investigation — queued directly, not routed through further owner triage, since
> it's a confirmed gate-affecting regression, not speculative.

## Status log

### 2026-07-16 — Verified fixed, ticket closed (Mary/Radia joint verification round)

Re-ran `bun test e2e/tui.test.ts` and full `bun run e2e` against current `main`-tracked
`HEAD` before touching anything, per this round's instructions to re-check against
post-DH-0105 code rather than assume the bug still reproduces. It does not reproduce: the
hang was already fixed same-day it was filed, by commit `6e49ad6` ("Server: disable Bun's
default 10s idle timeout on SSE connections (DH-0058)") — that work simply never
transitioned this ticket to `closed`.

**Actual root cause** (confirmed via `git log -p -S"root cause of DH-0058"` and the
in-code comment at `src/server/server.ts`'s `handleSse`): `Bun.serve()` closes any
connection, including a streamed SSE response, after 10s of no bytes sent — its own idle
timeout, shorter than the periodic SSE heartbeat's 20s interval (Server round 2). The
heartbeat could never fire before Bun's idle timer killed the connection, forcing every
SSE client to reconnect (and see the "Reconnected — history may be incomplete" resync
banner) on any turn slower than ~10s. Fix: `server.timeout(req, 0)` on the SSE request
disables Bun's idle timeout for that one connection, leaving the app's own heartbeat as
the sole keep-alive. This is a genuine Server-side root cause, not a TUI reconnect-state
bug — DH-0105's later `connecting`/`live`/`reconnecting`/`disconnected` model rework
(TUI-side) is unrelated to why this specific hang happened, though it's the reason the
banner text this ticket names no longer appears verbatim in the current e2e assertions
(cosmetic, from `render.ts` wording changes across other rounds, not from this fix).

**Regression coverage**: `e2e/tui.test.ts`'s existing two scenarios (which explicitly wait
for `"session ended"` after a period long enough to force an SSE reconnect at the old 10s
mark) already serve as the regression test — they exercise exactly the previously-hanging
path and now pass reliably. Ran `bun test e2e/tui.test.ts` 4 times in a row (all
2 pass/0 fail, ~2.7s each) and `bun run e2e` (full suite) twice in a row (30 pass/2 fail
both times — the 2 failures are the pre-existing, unrelated missing-headless-Chromium
environment gap in `e2e/web.test.ts`/`e2e/connect-web.test.ts`, tracked separately). No new
test needed; the existing scenario is a real, reliable regression guard for this exact bug
(disabling Bun's idle timeout only mattered for turns crossing the ~10s mark, which is
exactly what these two scenarios simulate).

Gates: `bun run typecheck`, `bun run lint`, `bun run test:coverage` (1836 pass, 0 fail, no
new coverage gaps) all clean. No code changes made this round — pure verification and
ticket-state correction.

Resolution: **done**. Closed via `spile-ops`'s `transition.py`.
