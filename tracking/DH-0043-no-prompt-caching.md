---
spile: ticket
id: DH-0043
type: feature
status: closed
owner: stefan
resolution: superseded
blocked_by: []
created: 2026-07-15
relations:
  depends_on: []
  relates_to: [DH-0010]
  supersedes: []
implementation:
  - repo: dark-harness
---

# DH-0043: No prompt caching — one of the largest cost levers for an agentic loop is unused

## Summary

Neither provider adapter ever sets `cache_control` (Anthropic) or Bedrock's equivalent cache
points on the system prompt, tool definitions, or a stable message prefix, despite the loop
resending the same system prompt and a growing history on every turn. The wire plumbing to
*account* for cache hits already exists (`cache_read_input_tokens`/`cache_creation_input_tokens`
are parsed and threaded into usage/cost logging) — caching itself, the actual request-side
opt-in, is simply never requested. This is called out by the competitive-differentiation sweep as
one of the highest-impact cost levers missing relative to comparable harnesses.

## User Stories

### As an operator, I want the harness to use prompt caching wherever the provider supports it, to reduce cost on repeated system-prompt/tool-definition tokens

- Given a system prompt and tool definitions that don't change turn to turn, when a request is
  sent, then cache breakpoints are marked so the provider serves cached tokens at reduced cost.

## Notes

> [!NOTE]
> Source: Competitive-differentiation sweep finding #2. This is a near-duplicate of half of
> **DH-0010** (which bundles context-compaction and cache-control together from the Core sweep's
> framing) — filed as its own ticket too since the competitive sweep treated it as a standalone,
> high-priority item; the two tickets should likely be resolved together or one closed as
> superseded once scoped.
