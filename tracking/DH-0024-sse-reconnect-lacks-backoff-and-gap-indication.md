---
spile: ticket
id: DH-0024
type: bug
status: implementing
owner: stefan
resolution:
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
