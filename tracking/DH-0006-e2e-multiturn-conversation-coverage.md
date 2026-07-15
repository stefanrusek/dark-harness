---
spile: ticket
id: DH-0006
type: bug
status: implementing
owner: stefan
resolution:
blocked_by: []
created: 2026-07-15
relations:
  depends_on: []
  relates_to: []
  supersedes: []
implementation:
  - repo: dark-harness
---

# DH-0006: No dedicated e2e test proves plain multi-turn conversation continuity over real HTTP

## Summary

Core's Round 5 fixed and unit-tested multi-turn conversations; the sub-agent e2e coverage
incidentally exercises two exchanges as part of testing sub-agent spawning, but no e2e test's
actual point is "a root agent, with no sub-agents involved, holds a real second conversation
exchange over real HTTP/SSE." Confirmed by grep — no such test exists. This exact behavior
was verified live, by hand, repeatedly this session (by the owner and the coordinator), but
never captured as an automated e2e scenario.

## User Stories

### As a developer changing the agent loop, I want an e2e test that fails if plain multi-turn conversation continuity ever regresses

- Given a real `dh --server` process and a real root agent, when a second `send_message` is
  sent after the first exchange completes, then the second response demonstrably references
  context from the first (proving shared conversation history, not two independent runs) —
  and a test asserts this over real HTTP/SSE, not just at the unit level.

## Functional Requirements

- Given the existing mock-provider scripting used elsewhere in `e2e/`, when this scenario is
  built, then it should follow the same conventions (real compiled binary, real HTTP/SSE)
  already established by `server-protocol.test.ts` and `build-stamp.test.ts`.

## Notes

> [!NOTE]
> This is a coverage gap, not a functional bug — the underlying behavior is known-working
> (verified by hand, and by unit tests in `src/agent/loop.test.ts`/`runtime.test.ts`). The
> ticket is specifically about closing the e2e-level blind spot.
