---
spile: ticket
id: DH-0049
type: feature
status: draft
owner: stefan
resolution:
blocked_by: ["deferred (2026-07-15): reactive retry sufficient so far"]
created: 2026-07-15
relations:
  depends_on: []
  relates_to: [DH-0009]
  supersedes: []
implementation:
  - repo: dark-harness
---

# DH-0049: No rate-limit-aware request scheduling across concurrently-spawned sub-agents

## Summary

Each `ModelProvider` instance is cached per provider name (`AgentRuntime.providerFor`), but there
is no concurrency/rate-limit governor across sub-agents sharing a provider — since `run_in_background:
true` is the default and arbitrary nesting is a deliberate invariant, many parallel `Agent` spawns
can all fire concurrent requests against the same Anthropic/Bedrock account with no shared
token-bucket/semaphore, risking 429 storms that DH-0009's retry work would then have to absorb
reactively rather than the harness avoiding proactively.

## User Stories

### As an operator with many concurrent sub-agents sharing one provider account, I want the harness to throttle itself rather than trigger rate-limit storms

- Given many concurrent sub-agent requests against the same provider, when they would exceed a
  reasonable concurrency/rate ceiling, then the harness queues/throttles them rather than firing
  all at once.

## Notes

> [!NOTE]
> Source: Competitive-differentiation sweep finding #15. Complements **DH-0009** (retry/backoff for
> when a rate limit is hit) — this ticket is about avoiding triggering it in the first place under
> heavy sub-agent fan-out.

> [!NOTE]
> Deferred (owner decision, 2026-07-15): DH-0009's reactive retry/backoff has been sufficient
> in practice, no observed 429 storms. Revisit if real throttling pain surfaces.
