---
spile: ticket
id: DH-0009
type: bug
status: draft
owner: stefan
resolution:
blocked_by: []
created: 2026-07-15
relations:
  depends_on: []
  relates_to: [DH-0001]
  supersedes: []
implementation:
  - repo: dark-harness
---

# DH-0009: No provider-level retry/backoff, and no error taxonomy, for transient failures

## Summary

Both provider adapters (`src/agent/providers/anthropic.ts`, `src/agent/providers/bedrock.ts`) wrap
every SDK failure — 429/5xx/overloaded, network blips, malformed responses, bad auth — into one
generic `ProviderError` built from the raw exception message, with no retry, no backoff, and no
classification. `runAgentLoop`/`AgentRuntime.runRoot` only catch the error to check for an abort
signal or to emit `session_ended`, then rethrow. A single transient rate-limit response kills an
entire unattended dark-factory run that could otherwise run for hours — the single biggest
reliability gap for the stated "hours-long unattended" use case (per the Core domain sweep).

## User Stories

### As an operator running an unattended job, I want a transient provider error to be retried, not to kill the whole run

- Given a 429/5xx/overloaded response from the provider, when the adapter receives it, then it
  retries with bounded, jittered backoff before surfacing a harness error.
- Given a genuinely permanent error (bad auth, malformed request), when it occurs, then it fails
  immediately with no wasted retries and a clearly classified error.

### As a maintainer, I want provider errors classified so downstream logic (retry, display) can react appropriately

- Given any provider error, when it is constructed, then it carries a `kind` (`auth` | `rate_limit`
  | `overloaded` | `network` | `other`) and a `retryable: boolean`, not just an opaque message.

## Functional Requirements

- Given a retry policy, when exhausted, then the harness reports a harness-error exit code (ADR
  0006) with the classified reason visible in the JSONL log, not just a generic message.

## Assumptions

- Retry/backoff parameters (max attempts, base delay, jitter) should be configurable via `dh.json`
  but ship with sane defaults.

## Risks

- Retrying a non-idempotent-adjacent request incorrectly could waste tokens/cost if misclassified
  as retryable when it isn't (e.g. a request that partially succeeded).

## Notes

> [!NOTE]
> Source: Core domain sweep findings #1 and #15. Compounds DH-0001 (a retry-exhausted run's final
> error text could coincidentally look like a TASK_FAILED marker or vice versa — worth checking
> once both are fixed). Also flagged independently as gap #3 by the competitive-differentiation
> sweep ("no provider-level retry/backoff... every serious agent harness retries rate limits") and
> gap #4 there for model/provider fallback chains (tracked separately, see DH-0044).
