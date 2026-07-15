---
spile: ticket
id: DH-0024
type: bug
status: closed
owner: stefan
resolution: done
blocked_by: []
created: 2026-07-15
relations:
  depends_on: [DH-0019]
  relates_to: []
  supersedes: []
implementation:
  - repo: dark-harness
---

# DH-0024: Both TUI and Web SSE clients reconnect on a fixed delay with no backoff, and give no indication of a missed-event gap or session restart

## Summary

`src/tui/sse-client.ts` (`DEFAULT_RECONNECT_DELAY_MS = 1000`) and `src/web/client/sse.ts`
(`DEFAULT_RECONNECT_DELAY_MS = 2000`) both retry on a flat fixed delay forever, with no exponential
backoff or jitter — against a genuinely down server this hammers it indefinitely. Neither client
has any handling for the case where `Last-Event-ID` was evicted/unknown server-side (see
**DH-0019**) — both blindly resend the last-seen id with no "gap detected" indicator, and neither
distinguishes a transient drop from a full server restart (a new session with an empty/different
agent set looks identical in the UI to a brief blip). The Web client's liveness ticker keeps
advancing "time in current status" through a disconnection with no visual staleness cue, and the
TUI has the same issue less visibly.

## User Stories

### As an operator, I want reconnect attempts to back off instead of hammering a down server once a second/every two seconds forever

- Given repeated failed reconnect attempts, when they occur, then delay grows (e.g. exponential
  with a cap and jitter) rather than staying fixed.

### As an operator, I want to know when my view might be missing events, or when the server actually restarted underneath me

- Given a reconnect that resulted in a gap (per DH-0019) or a new session id, when it happens, then
  the TUI/Web UI shows an explicit "reconnected — history may be incomplete" or "session restarted"
  indicator, not a silently clean-looking resume.

## Notes

> [!NOTE]
> Source: TUI/Web domain sweep findings #1 through #6 (two independent implementations of the same
> missing-backoff gap, one in each client). Depends on **DH-0019** for the server-side gap-signal
> event this ticket's client-side indicator would consume.

> [!NOTE]
> **Resolution (Web domain lead, Susan):** closed for `src/web/` only — `src/tui/` is being fixed
> in parallel by the TUI domain lead as its own pass over this same ticket; nothing here touches
> `src/tui/`.
>
> - Story 1 (backoff): done in full. `src/web/client/sse.ts`'s `connectEvents` now uses full-jitter
>   exponential backoff (`nextReconnectDelayMs`: doubles per attempt, capped at 30s, reset to the
>   1s base once a connection succeeds) instead of a flat 2s retry.
> - Story 2 (gap/restart indicator): **DH-0019** (the server-side `resync`/`gap` wire signal this
>   story's acceptance criteria describe) is still `implementing`, not closed — Web can't add a
>   `src/contracts/` field unilaterally. Implemented the conservative version achievable without
>   that dependency: every SSE reconnect (`onReconnected` in `sse.ts`, fired once per successful
>   reconnect, never on the initial connect) is now treated as a *possible* gap and surfaces a
>   dismissible "Reconnected — history may be incomplete." banner (`state.possibleGap`,
>   `render.ts`'s `showGapBanner`/`hideGapBanner`). This does not yet distinguish a brief blip from
>   a full session restart — that distinction needs the DH-0019 signal (or a session/generation id
>   on the wire) to do honestly; revisit once DH-0019 lands so the banner text can be more specific
>   ("may be incomplete" vs. a confirmed "session restarted").
