---
spile: ticket
id: DH-0199
type: feature
status: closed
owner: stefan
resolution: done
blocked_by: []
created: 2026-07-19
relations:
  depends_on: []
  relates_to: []
  supersedes: []
implementation:
  - repo: dark-harness
---

# DH-0199: Web: consecutive tool calls should group into a collapsible expando

## Summary

Manual testing finding (2026-07-19, temp-manual-testing.md): consecutive tool calls with no agent/operator turn between them currently render individually in the Web transcript, making multi-tool sequences hard to scan. Wanted: group them into a collapsed-by-default expando; clicking a tool call should show both its input and output together (currently unclear/split). Web domain (Susan).

## User Stories

### As an operator watching a busy agent, I want a run of consecutive tool calls collapsed into one line, so a multi-tool sequence doesn't dominate the transcript

- Given an agent's transcript contains 2 or more consecutive tool-call turns with no other-role turn (user/assistant/system, or a terminal-status marker) between them, when the transcript renders, then those turns appear as a single collapsed expando labeled "N tool calls" (plus a failed-count suffix if any call errored), not as N separate lines. Proven by `src/web/client/components/Transcript.test.tsx`: "a run of 2+ consecutive tool calls with no turn between them renders as a collapsed group".
- Given a tool-call group is collapsed, when I click its summary line, then it expands to reveal each grouped tool call as its own row, and clicking again re-collapses it. Proven by the same test above.
- Given only a single tool call occurs between two other turns (no run of 2+), when the transcript renders, then it renders standalone exactly as before — it is not wrapped in a one-item group. Proven by `Transcript.test.tsx`: "a single tool call (no run) does not get wrapped in a group".
- Given a terminal-status marker turn (DH-0130's "Agent done/failed/stopped") lands between two tool calls, when the transcript renders, then it breaks what would otherwise be one run into two separate groups/rows — terminal-status markers are never absorbed into a group. Proven by `Transcript.test.tsx`: "a terminal-status marker breaks a run of consecutive tool calls into separate groups".

### As an operator inspecting one tool call, I want to click it and see its input and result together, so I don't have to piece together what happened from a bare one-line marker

- Given a tool-call row (standalone or inside an expanded group), when I click it, then it expands in place to show its input summary and its result (success/error plus duration once the matching `tool_result` has arrived, or "pending…" before it has) in one detail panel — no navigation away from the transcript. Proven by `Transcript.test.tsx`: "clicking a standalone tool call expands input+result detail together".
- Given a tool-call row is expanded, when I click it again (or press Enter/Space while it's focused), then it collapses. Proven by `Transcript.test.tsx`: "clicking a standalone tool call expands input+result detail together" and "Enter/Space toggles a standalone tool call's detail via keyboard".
- Given a tool call's `tool_result` resolves with `durationMs`, when its detail panel is shown, then that duration is recorded on the turn and displayed. Proven by `src/web/client/state.test.ts`: "tool_call appends a tool marker turn; a successful tool_result leaves it unchanged" (asserts `durationMs` is captured).

## Functional Requirements

- `groupTranscript` (`src/web/client/components/Transcript.tsx`) scans an agent's `Turn[]` transcript and partitions it into render items: a maximal run of 2+ consecutive `role: "tool"` turns with `terminalStatus` unset becomes one `"group"` item; every other turn (including a lone tool call, i.e. a run of exactly 1) becomes its own `"turn"` item. Grouping is render-layer only — no change to `WebState`/`AgentNode.transcript` itself.
- `ToolCallGroup` renders a group item as a `<button class="tool-group-toggle">` summary ("N tool calls", plus "(M failed)" when `M > 0`) with `aria-expanded`, collapsed (`aria-expanded="false"`) by default. Clicking toggles between collapsed (no child rows in the DOM) and expanded (each grouped turn rendered as its own `ToolCallRow`).
- `ToolCallRow` renders a single tool-call marker turn (`⚙ toolName: inputSummary`, with a trailing `✗` on error, unchanged from pre-DH-0199 text) as a clickable/keyboard-activatable (`role="button"`, `tabIndex=0`, Enter/Space) element that toggles its own `ToolCallDetail` panel. Used both for standalone tool-call turns and for each row inside an expanded `ToolCallGroup`; expand/collapse state is local to each row (not lifted to shared state).
- `ToolCallDetail` shows the turn's input summary (`turn.text`, already `"toolName: inputSummary"`) and its result: `"✓ ok"` / `"✗ error"` plus `"· <durationMs>ms"` once resolved, or `"pending…"` if the matching `tool_result` hasn't arrived yet. It does NOT show raw tool output/arguments — `ToolResultEvent` (`src/contracts/events.type.ts`) deliberately carries no output content by design (output can be huge / is the largest secret surface; full output only ever lives in the JSONL log). This is the full extent of "output" available to a Web client over the wire; no `src/contracts/` change was made or needed.
- `Turn` (`src/web/client/state.ts`) gains an optional `durationMs?: number` field, set by `handleToolResult` when it resolves a turn's `pendingToolCall` (alongside the existing `toolError` handling) — additive, no other reducer behavior changed.
- Terminal-status marker turns (`terminalStatus` set) are never eligible for grouping and always render via the pre-existing `STATUS_TOKENS`-styled branch, unchanged.
- Styling added in `src/web/client/styles.css` (`.tool-group-toggle`, `.tool-group-items`, `.tool-call-detail*`, `.turn-tool { cursor: pointer }`) follows the existing dim/subordinate `.turn-tool` treatment — grouping doesn't make multi-tool sequences visually louder than the single-call marker they replace.

## Assumptions

- "Output" in the original finding's wording means whatever result signal the Web client actually has access to (success/failure + duration) — not raw tool output content, which is out of scope for the wire protocol by existing design (`ToolResultEvent`'s doc comment) and would be a `src/contracts/` change requiring architect sign-off (CLAUDE.md §6.2) that nothing in this finding asked for.
- "No agent/operator turn between them" (the finding's phrasing) is read as: no turn of a different role, including the synthetic terminal-status marker turn — since that marker is the one event in a tool-heavy stretch an operator most needs to notice, burying it inside a collapsed group would work against the ticket's own "easier to scan" goal.

## Risks

- None identified beyond normal review — this is a client-side rendering/state change with no wire-protocol or persistence impact.

## Open Questions

- None.

## Notes

- 2026-07-19: Implemented per the Functional Requirements above. Design: render-time grouping via `groupTranscript` (no `WebState` shape change beyond the additive `Turn.durationMs`), collapsed-by-default `ToolCallGroup` expando for runs of 2+, and a per-row `ToolCallRow`/`ToolCallDetail` click-to-expand for input+result shown together — both for grouped and standalone tool calls. Deliberately did not add tool output content to the wire; `ToolResultEvent` withholding it is an existing, documented design decision (secret-surface concern), and changing it would need `src/contracts/` architect sign-off this ticket never asked for. All 4 quality gates (`bun run typecheck`, `bun run lint`, `bun run test:coverage`, `bun run e2e`) verified green locally, with 100% line/function coverage on the two changed files (`src/web/client/components/Transcript.tsx`, `src/web/client/state.ts`).
