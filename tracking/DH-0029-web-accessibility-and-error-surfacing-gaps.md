---
spile: ticket
id: DH-0029
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

# DH-0029: Web UI has no keyboard-reachable agent list, no ARIA live regions, a missing "stopped" status color, and both clients drop errors after a few seconds with no history

## Summary

A cluster of Web/TUI operator-experience gaps: the Web sidebar's agent rows are plain `<li>`
elements with only a `click` handler — no `tabindex`/`role`/keydown handling — so the agent tree is
entirely unreachable via keyboard, contradicting HANDOFF §9's "make it a joy to use" for keyboard-
only or accessibility-tool users; there is no `aria-live`/`role="status"`/`role="log"` anywhere, so
a screen-reader user gets no announcement when new output streams in or the connection drops/
reconnects; `styles.css` has no `.status-dot.status-stopped`/`.status-badge.status-stopped` rule
(every other `AgentStatus` has a deliberate color, "stopped" falls back to an unstyled default —
looks like an oversight from when "stopped" was added, and is inconsistent with the TUI which does
color it). Both clients show a transient error banner that auto-hides (Web: fixed 5s) with no
persistent error history/log — a fast operator (or a burst of failures) can miss a real provider
error entirely, and neither client's SSE handling has any path to show *why* an agent went
`failed` (no error-detail text, only the red badge) — an operator has to go find the JSONL log by
hand. Neither client times out/aborts a hung command send, leaving no "still waiting" feedback.

## User Stories

### As a keyboard-only or screen-reader user, I want to navigate and be informed of the agent tree without a mouse

- Given the Web UI's agent sidebar, when navigating via keyboard, then rows are focusable and
  operable with Enter/Space, and live regions announce new output/connection changes.

### As an operator, I want to see why an agent failed, not just a red badge

- Given an agent transitions to `failed` (e.g. a provider error), when viewing it in either client,
  then a human-readable reason is shown, not just the status color.

### As an operator, I want past errors to remain reviewable, not vanish after a few seconds

- Given an error banner has auto-hidden, when the operator wants to review it, then some
  persistent error log/history is available, in both clients.

## Notes

> [!NOTE]
> Source: TUI/Web domain sweep findings #19 (undocumented `q` escape key in agent view — minor),
> #25 (missing stopped-status CSS), #27 (Web lacks TUI's "last heard from" staleness signal), #33,
> #34 (transient, easy-to-miss error banners in both clients), #35 (no provider-error detail
> surfaced anywhere), #37 (no timeout/abort feedback on a hung command send), #38 (sidebar rows not
> keyboard-focusable), #39 (no ARIA live regions), #40 (status dot has no `aria-label`, tooltip
> only).

> [!NOTE]
> **Resolution (Web domain lead, Susan):** closed for `src/web/` only — the TUI side of this same
> ticket (#19, #27, and the TUI half of #33/#34) is the TUI domain lead's own pass, not touched here.
>
> Done in `src/web/`:
> - #38 (keyboard nav): sidebar rows (`renderSidebar` in `render.ts`) now have `role="option"` on a
>   `role="listbox"` list, `tabindex="0"`, `aria-selected`, and Enter/Space keydown handling.
> - #39 (ARIA live regions): connection pill (`role="status"`/`aria-live="polite"`), the output
>   transcript (`role="log"`/`aria-live="polite"`), the gap banner (`role="status"`), and the error
>   banner (`role="alert"`) — wired in `buildShell`.
> - #40 (status dot label): the dot itself is now `aria-hidden` (it was a decorative color swatch
>   with only a hover-only `title`); the row instead carries an `aria-label` naming the agent and its
>   status in text, which is what a screen reader actually needs.
> - #25 (missing stopped color): added `--status-stopped` plus `.status-dot.status-stopped` /
>   `.status-badge.status-stopped` rules in `styles.css` (a muted violet, distinct from the other
>   four status colors).
> - #33/#34 (error history): added `WebState.errorLog` (`state.ts`'s `logError`, capped at 50
>   entries) and a persistent, always-in-the-DOM `<details class="error-log-panel">` (`renderErrorLog`
>   in `render.ts`) that lists every reported error with a timestamp, newest first — independent of
>   the existing 5s auto-hiding banner, which is unchanged and still the first thing an operator sees.
> - #37 (hung command feedback): `commands.ts`'s `sendCommand` now races its fetch against a timeout
>   (default 15s, injectable) and reports a clear "No response after Ns — the server may be
>   unresponsive." `CommandError` instead of hanging silently forever. This is a UI-level timeout, not
>   a network cancellation — the underlying `fetch` isn't aborted (no `AbortSignal` plumbed through
>   the injectable `fetchImpl`, which test doubles and some environments don't reliably honor), so an
>   eventual late response is simply ignored once the timeout has already reported failure. Worth a
>   follow-up if a future round wants true cancellation.
>
> **Deliberately not done — needs a `src/contracts/` change I can't make unilaterally:** #35
> (human-readable reason for a `failed` agent). `AgentStatusEvent`/`AgentSpawnedEvent` in
> `src/contracts/events.ts` carry no error-detail field at all — there is nothing for the client to
> render even after Command-level errors are already surfaced via `CommandAck.error` (unrelated code
> path: a failed `send_message`/`stop_agent` *command* already shows the server's message via
> `CommandError`, but that's not the same as *why an agent's status went to `failed`*, which is a
> provider-level event with no wire representation yet). This overlaps **DH-0009** (provider retry/
> error taxonomy) and **DH-0017** (error swallowing/status inconsistencies), which look like the
> right owners for adding that field to `src/contracts/events.ts` — once one of them does, Web's
> side is a small follow-up: render whatever text arrives next to the failed badge.
