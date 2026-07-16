---
spile: ticket
id: DH-0045
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

# DH-0045: No extended-thinking (interleaved/extended thinking blocks) support

## Summary

`ProviderContentBlock` (`src/agent/providers/types.ts`) only models `text`/`tool_use`/
`tool_result` variants — there is no `thinking`/`redacted_thinking` block type, and the Anthropic
adapter never sets `thinking: {type: "enabled", budget_tokens: ...}`. Extended thinking is a
meaningful quality lever for complex coding tasks on Claude models and is entirely absent from the
harness today.

## User Stories

### As an operator running complex coding tasks, I want the option to enable extended thinking for models that support it

- Given a model/provider that supports extended thinking, when configured, then the harness can
  request it, and thinking content is represented end-to-end (types, provider mapping, log/display
  handling) rather than being unsupported.

## Notes

> [!NOTE]
> Source: Competitive-differentiation sweep finding #9.

> [!NOTE]
> Owner decision (2026-07-15): queue now — real quality lever, not speculative. New content-
> block type/config knob/client display needs an architect design pass before implementation.
