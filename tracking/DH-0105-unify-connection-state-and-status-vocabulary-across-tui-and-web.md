---
spile: ticket
id: DH-0105
type: feature
status: draft
owner: stefan
resolution:
blocked_by: []
created: 2026-07-16
relations:
  depends_on: []
  relates_to: [DH-0024]
  supersedes: []
implementation:
  - repo: dark-harness
---

# DH-0105: Unify connection-state and status vocabulary across TUI and Web

## Summary

Connection state uses no shared vocabulary: the Web pill says Live/Connecting…/Reconnecting…/Disconnected while the TUI pill shows raw open/connecting/error/closed — Web has a 'reconnecting' state the TUI lacks and the TUI has an 'error' state the Web lacks. Status-word casing also differs (Web Title Case, TUI/CLI lowercase). Define one connection + status vocabulary in the design guide and render it consistently on both surfaces.

The connection indicator — the one thing that tells an operator whether their session is live
— speaks a different language on each surface, and the two surfaces don't even model the same
set of states:

| State | Web pill (`format.ts` CONNECTION_LABELS) | TUI pill (`headerRows` CONNECTION_COLOR) |
| --- | --- | --- |
| connecting | `Connecting…` | `connecting` |
| open/live | `Live` | `open` |
| reconnecting | `Reconnecting…` | *(no such state — has `error` instead)* |
| closed/lost | `Disconnected` | `closed` |
| error | *(no such state)* | `error` |

So the Web has a `reconnecting` state the TUI lacks, and the TUI has an `error` state the Web
lacks, and the words never match (`Live` vs `open`, `Disconnected` vs `closed`). For a
harness whose reconnect story is a documented feature (DH-0024, `Last-Event-ID` resume), the
"am I still connected?" signal should read identically in both clients. This ticket defines
one connection vocabulary + state set (in the design guide) and renders it consistently.
Owners: Mary (TUI) + Susan (Web). Also folds in the status-word casing decision if DH-0100
didn't already settle it.

## User Stories

### As an operator, I want the connection indicator to mean the same thing in the TUI and the Web

- Given the same underlying SSE connection state, when shown in the TUI header pill and the
  Web connection pill, then both use the same label word and the same color semantics
  (green=live, amber/pulsing=connecting-or-reconnecting, red=lost) per the design guide.
- Given the client is re-establishing a dropped connection (the DH-0024 `Last-Event-ID`
  resume path), when shown, then both surfaces express a `reconnecting` state (not `error` in
  one and `reconnecting` in the other) — reconnecting is a normal, non-alarming state and
  should read that way (amber + spinner/pulse, not red).
- Given a genuine unrecoverable connection error, when shown, then both surfaces express it
  the same way (whatever the design guide names it — likely fold `error` and `closed`/`lost`
  into one "disconnected" terminal state unless there's a real behavioral difference the
  operator must act on differently).

### As an operator, I want the connection label to be legible without color

- Given any connection state, when rendered, then a word/label accompanies the colored dot on
  both surfaces (Web already does; TUI shows the raw status word — keep a word, just make it
  the *canonical* word) so color-blind operators and any non-color context still read it.

### As an operator, I want status words cased consistently

- Given a status word (agent status or connection state), when rendered across surfaces, then
  the casing follows one documented rule (resolves the Web Title-Case vs TUI/CLI lowercase
  split) — coordinated with DH-0100 so the two tickets don't set conflicting rules.

## Functional Requirements

- Define the canonical connection state set + labels + color semantics in
  `docs/design/style-guide.md` (extend §1/§6). Reconcile the two current state sets: map the
  TUI's `error` and the Web's `reconnecting` into one shared model. Recommended shared set:
  `connecting` (initial), `live` (open), `reconnecting` (dropped, resuming), `disconnected`
  (given up / fatal) — with reconnecting styled amber+animated, not red.
- Align `src/tui/render.ts` (`headerRows`/`CONNECTION_COLOR` + the connection label words)
  and `src/web/client/format.ts` (`CONNECTION_LABELS`) to that set. If the TUI genuinely
  can't distinguish `reconnecting` from `error` today because its SSE client
  (`src/tui/`/`src/web/client/sse.ts`) doesn't surface a reconnect state, that's the real gap
  to close — the reconnect state exists in the protocol (DH-0024); wire it through so the TUI
  can show `reconnecting` like the Web does.
- Color semantics per design guide: live→green, connecting/reconnecting→amber (+ pulse/
  spinner), disconnected→red. TUI uses SGR `32`/`33`/`31`; Web uses the matching `--status-*`
  / `--danger` vars (already the case for the Web).
- Casing rule recorded once (coordinate with DH-0100) and applied on both surfaces.
- 100% coverage on changed code; assert the label vocabulary matches the design guide on both
  surfaces (a shared expected-label table asserted in each surface's tests prevents future
  drift).

## Assumptions

- This is presentation + state-vocabulary alignment; the underlying reconnect/resume behavior
  (DH-0024) is not being changed, only surfaced consistently. If wiring `reconnecting` through
  to the TUI turns out to need a real SSE-client behavior change (not just a label), that part
  coordinates with the owner of `src/tui/sse.ts` and may split out.

## Risks

- If the TUI's `error` state actually fires in cases the Web would call `reconnecting`, naive
  relabeling could hide a genuine fatal error as a benign "reconnecting…". Before collapsing
  states, confirm what actually drives the TUI `error` vs the Web `reconnecting` in their
  respective SSE clients — this is a semantics check, not just a string swap.
- Connection state is asserted by TUI/Web tests and e2e reconnect scenarios (DH-0058/0024) —
  update them in the same round.

## Open Questions

- Do we keep a distinct `error` state at all, or fold it into `disconnected`? Depends on
  whether the operator would *do* something different — recommend one terminal "disconnected"
  state unless the SSE clients expose a meaningful difference. Design-crew + Mary/Susan call
  during refining.
- Casing: settle jointly with DH-0100 (don't let the two tickets pick different rules).

## Notes

> [!NOTE]
> Filed 2026-07-16 by Muriel (design crew) from the cross-surface survey. The connection pill
> is the highest-stakes small indicator in the product — it's the operator's only signal that
> a long unattended run is still attached — and it currently speaks two dialects. Relates to
> DH-0024 (reconnect behavior) and DH-0100 (status vocabulary/casing).
