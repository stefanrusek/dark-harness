---
spile: ticket
id: DH-0010
type: feature
status: refining
owner: stefan
resolution:
blocked_by: ["architect design pass in progress"]
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

### As an operator, I want to explicitly enable or disable context-window compaction via config

- Given `dh.json`, when a `compaction: { enabled: boolean }`-shaped setting (implementer's call on
  exact field name/shape, consistent with existing config conventions) is set, then compaction only
  runs if explicitly enabled — the owner wants this as an explicit on/off switch, not an
  always-on background behavior with no opt-out.

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

> [!NOTE]
> Owner decision (2026-07-15): queue both compaction and caching now. **DH-0043 closed as
> superseded by this ticket** (it was a strict subset — prompt caching only — filed
> independently by a different sweep pass). Compaction specifically is a lossy,
> behavior-changing design decision (per this ticket's own Risks section) — routed to
> architect (Fable) for a design pass before implementation, per CLAUDE.md §6.1. Caching
> (cache_control/cache points) is a pure win with no behavior change and could ship
> independently/sooner if the architect's design separates the two cleanly.
