---
spile: ticket
id: DH-0180
type: bug
status: draft
owner: stefan
resolution:
blocked_by: []
created: 2026-07-18
relations:
  depends_on: []
  relates_to: []
  supersedes: []
implementation:
  - repo: dark-harness
---

# DH-0180: Relocate FakeAgentLoop out of the production server entrypoint into test-only scope

## Summary

A fixture whose own doc says 'Not production code' is exported from src/server/index.ts and depended on by 5 test files.

## Domain / owner

Server — src/server/ (Radia)

## User Stories

_To be written at `refining` (draft filed by refactoring round DH-0169)._

## Notes

Filed by Fable during refactoring round DH-0169.

`src/server/fake-agent-loop.ts` — whose own doc comment says "Not production code" — is
`export { FakeAgentLoop }`'d from the domain's public `src/server/index.ts:14-16` and
imported by 5 test files across server/tui/web. It is leftover pre-Core scaffolding (stood
up before the real `src/agent/loop.ts` landed). Relocate it to a test-only location and
drop it from `index.ts`'s public surface so it doesn't calcify as a de-facto API. (The
synthetic empty constructor at fake-agent-loop.ts:33-34 is part of the coverage-gate theme
tracked in DH-0176.)

