---
spile: ticket
id: DH-0089
type: feature
status: draft
owner: stefan
resolution:
blocked_by: []
created: 2026-07-16
relations:
  depends_on: []
  relates_to: []
  supersedes: []
implementation:
  - repo: dark-harness
---

# DH-0089: No tool_call SSE event — TUI/Web can't show generic tool-call activity in the transcript

## Summary

Found while implementing DH-0065's TUI polish: the transcript can show sub-agent spawns (inferred client-side from the existing agent_spawned event) but has no way to show generic tool-call activity (Bash, Read, Edit, etc.) as it happens, because there is no tool_call SSE event in src/contracts/events.ts at all -- only the JSONL log records tool calls, and that is not streamed live. Real Claude Code style UIs show a compact 'agent is running X' indicator per tool call. This is a real contracts change (new SSE event type, emission from src/agent/loop.ts, consumption in both TUI and Web renderers) needing architect sign-off per Constitution 6.2, not something to guess at from one domain.

## User Stories

### As an operator watching a live session, I want to see what tool the agent is currently running, not just its final text output

- Given an agent turn that calls Bash/Read/Edit/etc., when the tool call happens, then
  both TUI and Web show a compact live indicator (tool name + key argument, e.g. "Bash: `bun
  test`") in the transcript at the point the call occurs, not only after the fact via the
  JSONL log.

## Functional Requirements

- New SSE event type in `src/contracts/events.ts` (e.g. `ToolCallEvent`/`ToolResultEvent` —
  exact shape is the architect's call) — additive, per ADR 0006's "extend minimally."
- `src/agent/loop.ts` emits it at tool-call time (and possibly tool-result time), alongside
  the existing JSONL log write (not replacing it).
- TUI (`src/tui/render.ts`) and Web (`src/web/client/render.ts`) both consume it to show a
  compact live indicator — reuse the styling/marker conventions DH-0065 already established
  for sub-agent spawn markers where sensible.

## Assumptions

- DH-0065's sub-agent-spawn marker (inferred from the existing `agent_spawned` event) is a
  reasonable stopgap for that one case and doesn't need to be redone once this lands — this
  ticket is about the general case (any tool call), not a replacement for that.

## Risks

- Event volume: a busy agent can call many tools quickly; consider whether this needs the
  same coalescing/throttling treatment DH-0044's streaming design already established for
  `agent_output`, to avoid flooding the SSE stream.

## Open Questions

- Exact event shape/granularity (call-start only, or call-start + call-result; full
  arguments or a truncated summary) — architect's call.

## Notes

> [!NOTE]
> Found 2026-07-16 while implementing DH-0065 (TUI visual polish) — the implementer correctly
> declined to guess at a contracts change from within a single domain and flagged it here
> instead, per Constitution §6.2.
