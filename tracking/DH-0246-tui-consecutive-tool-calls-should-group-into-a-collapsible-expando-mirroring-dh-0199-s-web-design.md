---
spile: ticket
id: DH-0246
type: feature
status: verifying
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

### 2026-07-20 — Mary, implementation complete, moving to verifying

**Shared algorithm**: lifted `groupTranscript`/`isGroupableToolTurn`/`RenderItem` verbatim out
of `src/web/client/components/Transcript.tsx` into a new framework-agnostic
`src/transcript-grouping.ts` (generic over a structural `GroupableTurn` shape so it needs no
adapter for either client's own `Turn` type — same non-`src/contracts/` shared-module
precedent as `src/design-tokens.ts`). `Transcript.tsx` now imports it; `TranscriptPane.tsx`
imports the same module for its own grouping. No duplicated partitioning logic.

**TUI interaction pattern**: `AgentTree.tsx`/`PickerView.tsx` navigate via up/down + Enter
routed through the reducer's `selectedIndex`. `TranscriptPane` has no reducer-level notion of
grouping/expansion (deliberately — see below), so up/down/enter are instead carried by a new
`ToolFocusBus` (`src/tui/ink/tool-focus-bus.ts`), the same event-bus pattern `scrollBus`
already uses for wheel-scroll. `app.ts`'s stdin handler reclaims up/down/enter for this bus
exactly when their normal reducer meaning is otherwise a no-op: always in the "agent" view
(unhandled today), and in "root" only when the composer is empty (mirrors the existing
left-arrow-opens-tree convention) — verified this changes nothing for non-empty-input root
behavior. Focused row uses AgentTree/PickerView's own literal `"> "` gutter marker.

**Local vs. reducer state**: focus index, which groups are expanded, and which rows have
their detail open all live in `TranscriptPane`'s own `useState` (never `TuiState`), per the
ticket's explicit requirement — mirrors DH-0199 Web's `ToolCallRow`/`ToolCallGroup` local
state.

**User Story -> test mapping**:
- "run of 2+ collapses to one row" -> `src/tui/ink/TranscriptPane.test.tsx` ("a run of 2+ tool
  calls renders as one collapsed 'N tool calls' row, not N lines") and
  `buildFocusRows`/`groupTranscript` tests in the same file.
- "focused group row expands/re-collapses on Enter/Space" -> `TranscriptPane.test.tsx`
  ("activate on a focused group header expands it into member rows, and again re-collapses
  it"); real-PTY: `e2e/spikes/tui/spike-tool-call-grouping.ts`.
- "a single tool call renders standalone, not wrapped" -> `TranscriptPane.test.tsx`
  ("a lone tool call is its own focusable row, not wrapped in a group") and
  `src/tui/app.test.ts` ("a lone tool call (not part of a run of 2+) is individually
  focusable...").
- "a terminal-status marker breaks a run into two groups" -> `TranscriptPane.test.tsx`
  ("a terminal-status marker breaks a run into two separate groups").
- "activating a tool-call row shows input + result (success/error/duration, or pending…)" ->
  `TranscriptPane.test.tsx` ("detail expansion shows input summary and 'pending…'...",
  "...success + duration...", "...error + duration...") and `src/tui/app.test.ts`'s lone-call
  test (`Result: ✓ ok · 7ms`).
- "activating again collapses the detail" -> `TranscriptPane.test.tsx` ("activate toggles a
  standalone tool call's detail open and closed").
- `Turn.durationMs` assumption -> confirmed missing, added to `src/tui/types.type.ts`; wired
  in `src/tui/state.ts`'s `handleToolResult` from `ToolResultEvent.durationMs`
  (`src/contracts/events.type.ts`, always present on the event). Covered by
  `src/tui/state.test.ts`'s existing `tool_call`/`tool_result` reducer tests (updated for the
  new field) plus the detail-rendering tests above.

**Real-PTY verification**: `bun e2e/spikes/tui/spike-tool-call-grouping.ts` — boots the real
compiled binary under a real tmux PTY against a scripted mock provider (two consecutive Bash
calls), drives it with real keystrokes (Down/Enter), and checks the captured pane text. All 7
checks passed: collapses to "2 tool calls" by default (individual inputs hidden), Down+Enter
expands the group into both members' rows, Down+Enter on a member shows
"Input: Bash: echo one" / "Result: ✓ ok · <n>ms", and Enter again collapses that detail back
down. Also fixed a real bug this surfaced: `TranscriptPane`'s focus-index clamp got
permanently stuck at -1 if the transcript started empty (`Math.min(-1, len-1)` never
recovers) — fixed with a `Math.max(focusIndex, 0)` floor before the clamp; covered by a
regression test ("focus recovers to the first tool row once one appears...").

**Gates**: `bun run typecheck`, `bun run lint`, `bun run test:coverage` (100% lines, 2668+
tests), `bun run e2e` (41/41) all green. Coordinating with Susan (concurrent DH-0129 work on
`src/web/client/components/Transcript.tsx`/`Transcript.test.tsx` in the same shared
worktree) — her commit `86c1e87` picked up my `transcript-grouping.ts` lift + `Transcript.tsx`
import-swap cleanly; no conflict.
