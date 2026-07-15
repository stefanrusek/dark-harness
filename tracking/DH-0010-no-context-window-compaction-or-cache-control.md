---
spile: ticket
id: DH-0010
type: feature
status: draft
owner: stefan
resolution:
blocked_by: ["owner triage: needs input before dispatch (ticket-triage-workflow bucket B)"]
created: 2026-07-15
relations:
  depends_on: []
  relates_to: [DH-0043]
  supersedes: []
implementation:
  - repo: dark-harness
---

# DH-0010: No context-window compaction/token-budget handling, and no prompt caching (`cache_control`)

## Summary

`runAgentLoop`'s `messages: ProviderMessage[]` grows every turn with no cap, summarization, or
windowing, and nothing reads the model's context-length limit — a long interactive session or a
turn-heavy dark-factory job will eventually exceed the context window and get a hard, uncaught
provider error rather than a graceful compaction. Separately, neither provider adapter ever sets
`cache_control` (Anthropic) or Bedrock's equivalent cache points on the system prompt / tool
definitions / stable message prefix, despite resending the same system prompt and growing history
on every turn — one of the largest cost levers for an agentic loop is unused.

## User Stories

### As an operator running a long unattended session, I want the harness to compact history before hitting the model's context limit, not crash

- Given a conversation approaching the model's context window, when the loop detects this, then it
  summarizes/prunes older turns (or fails with a clear, actionable message) rather than letting the
  provider reject the request uncaught.

### As an operator paying for tokens, I want the harness to use prompt caching where the provider supports it

- Given a system prompt + tool definitions that don't change turn to turn, when a request is sent,
  then cache breakpoints are marked so the provider can serve cached tokens at a reduced rate.

## Functional Requirements

- Given any provider that supports cache control, when caching is enabled, then usage/cost
  accounting (already wired for `cache_read_input_tokens`/`cache_creation_input_tokens`) reflects
  real cache hits, not just parses fields that are never populated because caching was never
  requested.

## Assumptions

- Not all configured providers support caching identically; this should be capability-gated per
  provider type.

## Risks

- Summarization changes model behavior (lossy); needs careful design and likely its own
  architect-level judgment call before implementation, per CLAUDE.md §6.

## Notes

> [!NOTE]
> Source: Core domain sweep finding #2 (no compaction) and Competitive-differentiation sweep
> findings #1 (compaction) and #2 (prompt caching) — independently identified by both sweeps as one
> of the highest-impact gaps for the primary "hours-long unattended" use case and its cost profile.
