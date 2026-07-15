---
spile: ticket
id: DH-0033
type: bug
status: closed
owner: stefan
resolution: done
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

## Resolution

Closed 2026-07-15 (Hedy, E2E). `e2e/support/mock-provider.ts` gained an error-injection mode:
`MockTurn.error` (status + JSON body, or a literal `rawBody` for a malformed non-JSON
response), with `errorTurn(status, body?)` and `malformedTurn(rawBody?)` shorthands. The
server now responds with the scripted status/body instead of a completion when a turn has
`error` set.

Five new scenarios in `e2e/exit-codes.test.ts` drive the real compiled binary against this:
a 429, a 500, a malformed-200-body response, and a mid-multi-turn failure (a successful
tool_use turn followed by a 529 on the resume call) — every one asserts exit code `>= 2`
(`ExitCode.HarnessError`), confirming the harness never raw-crashes on a provider failure.

**Real discovery made possible by actually exercising this end-to-end** (not assumed going
in): DH-0009 (provider retry/backoff/error taxonomy) is still open — neither adapter
implements its own retry — but the underlying `@anthropic-ai/sdk` client already retries
retryable HTTP statuses (429/5xx) up to its own default `maxRetries` (2) before the adapter
ever sees a rejection. So `provider.callCount` for a single retryable-status failure is
really 3 (1 initial + 2 SDK retries), not 1 — this ticket's dependency on DH-0009 turned out
to be softer than assumed: real retry behavior already exists today, just at the SDK layer
rather than a harness-classified one. The malformed-200-body case isn't retried (no bad
status to trigger it) — genuinely one call. Once DH-0009 lands its own harness-level
retry/classification (which may also reconfigure `maxRetries`), these call-count assertions
should be revisited — flagged inline in the test file; that revisit is Core's call.

The mock's "under-scripted tests don't hang, but don't obviously fail loudly either"
footgun (this ticket's second observation) is unchanged this round — every new test scripts
exactly as many turns as the scenario needs and asserts `callCount`, so it doesn't surface
here, but a dedicated fix (e.g. throwing instead of repeating the last turn past the
scripted length) is still open if a future round wants it.
