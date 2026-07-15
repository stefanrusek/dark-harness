---
spile: ticket
id: DH-0053
type: feature
status: draft
owner: stefan
resolution:
blocked_by: []
created: 2026-07-15
relations:
  depends_on: []
  relates_to: [DH-0009]
  supersedes: []
implementation:
  - repo: dark-harness
---

# DH-0053: No model/provider fallback chains — a down or rate-limited primary model has no automatic substitute

## Summary

`dh.json`'s `models`/`provider` arrays are flat, with no notion of an ordered fallback list;
`AgentRuntime.resolveModel`/`providerFor` picks exactly one model by name with no substitution on
failure. For an unattended run, a rate-limited or temporarily-down primary model currently has no
automatic recourse beyond whatever retry behavior DH-0009 adds — there's no way to configure
"if `sonnet` is unavailable, fall back to `haiku`" or similar.

## User Stories

### As an operator, I want to configure a fallback model chain so a down/rate-limited primary doesn't kill the whole run

- Given a `ModelConfig` with an optional ordered `fallbackModel` chain, when the primary model's
  provider call fails in a way DH-0009 classifies as non-retryable-but-substitutable, then the next
  model in the chain is tried before giving up.

## Notes

> [!NOTE]
> Source: Competitive-differentiation sweep finding #4. Complements **DH-0009**'s retry/backoff
> work — retry handles transient failures on the same model; this ticket handles sustained
> unavailability by falling back to a different one.
