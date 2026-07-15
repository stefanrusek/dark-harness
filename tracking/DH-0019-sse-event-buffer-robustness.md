---
spile: ticket
id: DH-0019
type: bug
status: implementing
owner: stefan
resolution:
blocked_by: []
created: 2026-07-15
relations:
  depends_on: []
  relates_to: [DH-0007]
  supersedes: []
implementation:
  - repo: dark-harness
---

# DH-0019: SSE/EventBuffer has no backpressure handling and silently serves a gap when `Last-Event-ID` was evicted

## Summary

`src/server/event-buffer.ts`'s `getEventsAfter` returns the entire current buffer (rather than
erroring or signaling a gap) when a resuming client's `lastEventId` was evicted or the process
restarted — the client has no way to know it missed events; this is explicitly documented as
"best effort" in the class's own doc comment, but there's no `gap`/`resync` marker in the SSE
event vocabulary (`src/contracts/events.ts`) for a client to detect and display "you may have
missed events." Separately, every live event/heartbeat is `controller.enqueue()`'d synchronously
with no check on the stream's backpressure/high-water mark — a slow consumer (bad network, paused
browser tab) can grow the ReadableStream's internal queue unbounded server-side, and the
enqueue-failure handlers use a bare `catch {}` that doesn't reliably unsubscribe/clean up if the
failure wasn't actually a disconnection.

## User Stories

### As an operator reconnecting after a gap, I want to know my client may have missed events, not silently see a clean-looking resume

- Given a `Last-Event-ID` that has been evicted from the buffer (or the server restarted), when a
  client reconnects, then a `resync`/`gap` event is emitted so TUI/Web can surface "history may be
  incomplete" rather than looking like nothing was missed.

### As an operator, I want a slow SSE consumer to not cause unbounded server-side memory growth

- Given a client that isn't draining its stream, when backpressure builds, then the server either
  applies backpressure-aware writes or drops/times out the connection rather than growing
  unbounded.

## Notes

> [!NOTE]
> Source: Server domain sweep findings #2, #3, #4. Finding #2 overlaps conceptually with
> **DH-0007**'s open-thread #2 (EventSource/bearer-token escalation, already resolved via ADR 0004's
> amendment) but is a distinct correctness gap in the resume path itself, not previously tracked.
