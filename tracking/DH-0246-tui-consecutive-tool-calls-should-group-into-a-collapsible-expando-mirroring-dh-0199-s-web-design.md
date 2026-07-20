---
spile: ticket
id: DH-0246
type: feature
status: ready
owner: stefan
resolution:
blocked_by: []
created: 2026-07-20
relations:
  depends_on: []
  relates_to: [DH-0199, DH-0136]
  supersedes: []
implementation:
  - repo: dark-harness
---

# DH-0246: TUI: consecutive tool calls should group into a collapsible expando, mirroring DH-0199's Web design

## Summary

Owner live-testing finding (2026-07-20): the TUI's TranscriptPane renders every tool-call turn individually with no grouping and no way to expand a call to see its input/result together -- DH-0199 built exactly this for the Web client (collapsed-by-default N-tool-calls expando for runs of 2+ consecutive tool turns, click/Enter/Space to expand a standalone or grouped call and see input+result, terminal-status markers always break a run) but nobody ported it to the TUI. Mirror DH-0199's design and behavior in Ink: a shared groupTranscript-style partition (reuse src/web/client/components/Transcript.tsx's groupTranscript logic/shape if it can be lifted to a framework-agnostic module both clients import, rather than re-deriving the grouping algorithm a second time), a collapsed 'N tool calls' summary row toggled by Enter/Space or a click-equivalent Ink interaction, and a detail view showing each tool call's input summary plus success/error/duration once resolved -- same wire-data constraints as DH-0199 (ToolResultEvent carries no raw output content by design, only success/failure+duration).

## User Stories

### As an operator watching a busy agent in the TUI, I want a run of consecutive tool calls collapsed into one line

- Given an agent's transcript contains 2 or more consecutive tool-call turns with no other-role
  turn (user/assistant/system, or a terminal-status marker) between them, when the transcript
  pane renders, then those turns appear as a single collapsed row labeled "N tool calls" (plus
  a failed-count suffix if any call errored), not as N separate lines. Proven by
  `src/tui/ink/TranscriptPane.test.tsx`: a run of 2+ consecutive tool calls renders as one
  collapsed group row.
- Given a tool-call group row is collapsed and focused, when the operator presses Enter/Space
  (or whatever the TUI's existing row-activation convention is — check `AgentTree`/`PickerView`
  for precedent), then it expands to reveal each grouped tool call as its own row, and
  activating it again re-collapses it. Proven by the same test file.
- Given only a single tool call occurs between two other turns (no run of 2+), when the
  transcript renders, then it renders standalone exactly as before — not wrapped in a
  one-item group. Proven by `TranscriptPane.test.tsx`.
- Given a terminal-status marker turn (DH-0130's done/failed/stopped marker) lands between two
  tool calls, when the transcript renders, then it breaks what would otherwise be one run into
  two separate groups/rows. Proven by `TranscriptPane.test.tsx`.

### As an operator inspecting one tool call in the TUI, I want to see its input and result together

- Given a tool-call row (standalone or inside an expanded group) is focused, when the operator
  activates it, then it expands in place to show its input summary and result
  (success/error + duration once resolved, or "pending…" before it has) — no navigation away
  from the transcript pane. Proven by `TranscriptPane.test.tsx`.
- Given an expanded tool-call row, when the operator activates it again, then it collapses.
  Proven by `TranscriptPane.test.tsx`.

## Functional Requirements

- Attempt to lift DH-0199's `groupTranscript` partitioning logic (`src/web/client/components/
  Transcript.tsx`) into a framework-agnostic shared module both `Transcript.tsx` (Web) and
  `TranscriptPane.tsx` (TUI) import — same precedent as `src/design-tokens.ts`'s shared
  color/status tokens. If `groupTranscript`'s current shape is too Web-coupled (DOM-specific
  types, React-specific state) to lift cleanly without a disruptive Web-side refactor, port the
  *algorithm* (maximal-run partitioning, terminal-status-marker-breaks-runs rule) into a new
  pure function in a shared location instead of duplicating the logic inline in
  `TranscriptPane.tsx` — implementer's call on exact mechanics, but no second independently-
  drifting copy of the run-partitioning rule.
- Render the collapsed "N tool calls" summary row and the expand/collapse interaction using
  Ink primitives, following this codebase's existing focus/activation convention for
  interactive transcript rows (check how `AgentTree`/`PickerView` handle row focus + Enter/Space
  activation, and match it — don't invent a new interaction pattern for just this component).
- Expand/collapse state is local per-row (not lifted into `TuiState`), matching DH-0199's Web
  design (`ToolCallRow`'s local state) — same rationale: purely a render-layer concern, no
  reducer change needed.
- The detail view shows only what the wire protocol actually carries — input summary
  (`turn.text`) and success/error + `durationMs` once resolved. `ToolResultEvent` deliberately
  carries no raw output content (`src/contracts/events.type.ts`); this ticket does not touch
  `src/contracts/` and does not need architect sign-off, matching DH-0199's own scoping.
- Terminal-status marker turns are never eligible for grouping and keep rendering via their
  existing `STATUS_TOKENS`-styled branch, unchanged.

## Assumptions

- `Turn`'s `durationMs?: number` field (added to `WebState` by DH-0199) has a TUI-side
  equivalent already, or needs an equivalent addition to `TuiState`'s `Turn` type — confirm
  during implementation; if it doesn't exist yet, this is a small additive reducer change in
  `src/tui/state.ts`, not a wire-protocol change (the underlying `tool_result` SSE event
  already carries `durationMs`, per DH-0199's own Notes).

## Risks

- Ink's focus/keyboard-activation model differs from a DOM click/keyboard handler — reusing
  DH-0199's Web interaction pattern verbatim isn't possible; match this codebase's existing Ink
  row-focus convention instead (see Functional Requirements).
- Frame-height math: an expanded tool-call detail adds rows to the transcript pane's content —
  confirm this composes correctly with `TranscriptPane`'s existing scroll-viewport windowing
  (`src/tui/scroll-viewport.ts`) rather than assuming a fixed row-height-per-turn.

## Open Questions

None blocking.

## Notes

Filed by the coordinator directly from a live owner bug report (2026-07-20) — DH-0199 built
this for Web on 2026-07-19 and explicitly scoped itself to "Web domain (Susan)"; the TUI
equivalent was never filed as a follow-up at the time.
