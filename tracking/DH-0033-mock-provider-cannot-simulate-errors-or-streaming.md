---
spile: ticket
id: DH-0033
type: bug
status: ready
owner: stefan
resolution:
blocked_by: []
created: 2026-07-15
relations:
  depends_on: [DH-0009]
  relates_to: []
  supersedes: []
implementation:
  - repo: dark-harness
---

# DH-0033: The e2e mock provider can't simulate provider errors or streaming, so the harness's failure-handling path is completely untested end-to-end

## Summary

`e2e/support/mock-provider.ts` implements only non-streaming `/v1/messages` responses with no way
to script a 429/500/timeout/malformed-JSON response — grepping the file shows only a 404 fallback
for a wrong path/method, never a scripted failure. This means the harness's real behavior under an
upstream provider failure (whatever DH-0009 ends up implementing for retry/backoff/error
classification) has **zero** e2e coverage — it can only ever be unit-tested. The mock also has no
tool_use round-trip beyond a single scripted call per turn with a "repeat last turn forever"
fallback, which is a latent test-quality footgun (under-scripted tests don't hang, but also don't
obviously fail loudly).

## User Stories

### As a maintainer, I want e2e coverage that proves the harness's real behavior when the provider returns an error

- Given the mock provider, when it's extended with an error-injection mode (non-200 status,
  malformed body, or a mid-multi-turn failure), then e2e tests can assert the harness's actual
  exit-code/retry/log behavior under those conditions, not just under happy-path mocked turns.

## Functional Requirements

- Given the DH-0009 retry/backoff work lands, when it does, then this mock-provider extension is
  the dependency that makes it e2e-testable, not just unit-testable.

## Notes

> [!NOTE]
> Source: CI/Release/E2E sweep findings #18 and #19. Depends conceptually on **DH-0009** (the
> retry/error-taxonomy work this test infrastructure would exercise) — sequencing-wise, this ticket
> and DH-0009 should probably land together.
