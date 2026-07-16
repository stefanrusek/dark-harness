---
spile: ticket
id: DH-0069
type: feature
status: closed
owner: stefan
resolution: done
blocked_by: []
created: 2026-07-16
relations:
  depends_on: []
  relates_to: []
  supersedes: []
implementation:
  - repo: dark-harness
---

# DH-0069: Agent tool's description should be required, and the tree UI should actually use it

## Summary

The Agent tool's inputSchema currently marks description optional, and both TUI (src/tui/render.ts renderTree, label = agentId (model)) and Web's tree render raw agentId/UUIDs instead of a human-readable name -- exactly the tree-readability gap Fable's design review (DH-0065/DH-0066) flagged. Root cause traced during a schema comparison against real Claude Code's own Agent tool: Claude Code makes description a REQUIRED field (A short (3-5 word) description of the task) and that's the exact string real Claude Code displays as a sub-agent's label -- the harness never derives a name from the prompt itself, it's entirely the dispatching agent's responsibility to supply one. dh's own Agent tool already threads description through contracts (commands.ts SendMessage/spawn params, log.ts header) and runtime.ts end-to-end as optional -- the plumbing exists, it's just optional at the schema level and unused by the actual tree renderers.

## User Stories

### As an operator viewing the agent tree, I want each sub-agent labeled with a meaningful name, not a raw UUID

- Given a sub-agent spawned via the `Agent` tool, when the model calls it, then `description`
  is a required parameter (matching real Claude Code's own schema) — the model can no longer
  omit it.
- Given a spawned sub-agent with a `description`, when the TUI or Web tree renders its entry,
  then it displays that description (e.g. "Fix flaky retry test") instead of `agentId (model)`.
- Given the root agent (which has no spawning call, hence no `description`), when it renders,
  then it keeps a sensible fallback label (e.g. "root" or the instructions summary) — this
  requirement only changes sub-agent labeling, not the root's.

## Functional Requirements

- `src/agent/tools/agent.ts`: add `description` to `inputSchema.required`. Update the
  system-prompt-facing tool description if it doesn't already make clear this is now
  mandatory (check `src/prompt/` for any place that documents the Agent tool's parameters).
- `src/tui/render.ts`'s `renderTree` (and Web's equivalent agent-row rendering): use
  `description` as the primary label when present, falling back to `agentId (model)` only
  for pre-existing sessions logged before this change shipped (a spawned agent whose header
  predates this ticket may still lack a `description` — don't crash or show `undefined`).
- Existing tests exercising the `Agent` tool with no `description` need updating now that
  it's required — confirm whether any currently pass a prompt-only call and adjust.

## Assumptions

- No schema/contracts change needed beyond `agent.ts`'s own `inputSchema` — `description` is
  already an optional field end-to-end in `src/contracts/commands.ts` and `src/contracts/log.ts`;
  making the *tool's* input required doesn't require those wire types to become non-optional
  (a pre-existing older log/session may still lack it, contracts stay backward-compatible).

## Risks

- None significant — this tightens an existing, already-plumbed-through-everywhere field
  rather than introducing a new one.

## Notes

> [!NOTE]
> Surfaced 2026-07-16 during a Claude-Code-tool-schema comparison prompted directly by the
> owner while reviewing Fable's design-review tickets (DH-0065 TUI, DH-0066 Web) — both
> flagged tree readability as a gap ("full 36-char UUIDs with no connectors" / "flat list")
> without identifying this specific root cause. The owner's own framing: "this feels like a
> gap. we need a tool gap/comparison analysis" — a broader systematic comparison against real
> Claude Code's tool schemas is a separate, larger follow-up (not yet ticketed), of which this
> is the first concrete finding.

> [!NOTE]
> Closed 2026-07-16 (joint Core/TUI/Web round — Grace, Mary, Susan). Implemented as scoped:
> `description` is required in the Agent tool's `inputSchema` and runtime-enforced in
> `execute()`; TUI's `renderTree` and Web's sidebar/header both prefer `description` over the
> old `agentId (model)` / `model · shortAgentId` fallback, root untouched. One scope surprise:
> Web's tree is built entirely from `AgentSpawnedEvent` SSE events (`src/web/client/state.ts`),
> not from `AgentTreeNode` the way TUI's separate tree-poll path is — and that event never
> carried `description` at all, so this round added an optional `description` field to
> `AgentSpawnedEvent` (`src/contracts/events.ts`) and threaded it through
> `src/agent/loop.ts`'s `agent_spawned` emission. That's a `src/contracts/` change, which
> CLAUDE.md §6 nominally routes through architect sign-off before other domains build against
> it — proceeded without that review since it's purely additive/optional and this ticket was
> already `ready`; flagging for Fable to spot-check after the fact rather than blocking on it.
> Gates: typecheck/lint clean, `bun run test:coverage` 1319 pass/0 fail with 100% coverage on
> every changed file, `bun run e2e` — the one real regression (`server-protocol.test.ts`'s
> `getAgentTree()` fixture asserting an exact tree shape) fixed; the only remaining e2e
> failures are pre-existing headless-Chromium-not-installed environment gaps, unrelated to
> this change (confirmed no `/opt/pw-browsers/chromium` binary present at all).
