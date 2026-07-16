---
spile: ticket
id: DH-0044
type: feature
status: refining
owner: stefan
resolution:
blocked_by: ["architect design pass in progress"]
created: 2026-07-15
relations:
  depends_on: []
  relates_to: []
  supersedes: []
implementation:
  - repo: dark-harness
---

# DH-0044: No streaming of partial model output — `agent_output` events only fire once per completed turn

## Summary

Both provider adapters call the non-streaming API variant (`messages.create` with
`MessageCreateParamsNonStreaming`; Bedrock's `ConverseCommand`, not `ConverseStreamCommand`), so
`agent_output` SSE events are emitted only once per whole completed turn, not incrementally. A long
single-turn response (a big plan, a long explanation) appears all at once in both the TUI and Web
UI rather than streaming token-by-token, unlike most comparable harnesses (including Claude Code
itself).

## User Stories

### As an operator watching a live session, I want to see model output as it's generated, not all at once when the turn finishes

- Given a long assistant turn, when it streams from the provider, then `agent_output` events are
  emitted incrementally as content arrives, and both TUI and Web render it progressively.

## Functional Requirements

- **Owner decision (2026-07-15): full scope, both providers.** Switch both Anthropic
  (`messages.create` streaming variant) and Bedrock (`ConverseStreamCommand`) adapters to
  their streaming APIs; add an incremental SSE contract addition for partial output; update
  both TUI and Web to render progressively as chunks arrive.
- Touches `src/contracts/` (new incremental event shape) — per CLAUDE.md §6.2 this needs an
  architect design pass before implementation, not a unilateral Core/Server contract edit.

## Notes

> [!NOTE]
> Source: Competitive-differentiation sweep finding #8.

> [!NOTE]
> Owner decision (2026-07-15): full streaming for both providers, not Anthropic-only. Routed
> to architect (Fable) for a design pass on the contract addition before dispatch, per
> CLAUDE.md §6.2.
