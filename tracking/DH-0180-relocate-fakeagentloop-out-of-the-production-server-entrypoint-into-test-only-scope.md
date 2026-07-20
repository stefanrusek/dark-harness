---
spile: ticket
id: DH-0180
type: bug
status: closed
owner: stefan
resolution: done
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

- Given `src/server/index.ts` (the domain's public surface), when scanning its exports,
  then `FakeAgentLoop` no longer appears — proven by `bun run typecheck` succeeding after
  removing the `export { FakeAgentLoop } from "./fake-agent-loop.ts"` line, with no
  compile errors from consumers relying on the barrel export (there were none — all
  existing usages already imported the file directly by relative path).
- Given the fixture's own doc comment ("Not production code"), when it is relocated,
  then it lives under a directory name that signals test-only scope
  (`src/server/__fixtures__/fake-agent-loop.ts`, matching the existing
  `src/agent/mcp/__fixtures__/` convention) — proven by `bun run test:coverage` passing
  with `src/server/__fixtures__/fake-agent-loop.ts` still at 100%/100% coverage
  (`src/server/exit.test.ts`, `src/server/commands.test.ts`, `src/server/server.test.ts`
  updated to import from the new path and passing).

## Notes

Filed by Fable during refactoring round DH-0169.

`src/server/fake-agent-loop.ts` — whose own doc comment says "Not production code" — was
`export { FakeAgentLoop }`'d from the domain's public `src/server/index.ts:14-16`. On
inspection at implementation time, only 3 files (not 5) actually reference it —
`src/server/exit.test.ts`, `src/server/commands.test.ts`, `src/server/server.test.ts` —
and all three already imported it by direct relative path
(`import { FakeAgentLoop } from "./fake-agent-loop.ts"`), never through the `index.ts`
barrel. No TUI/Web/E2E file imports it at all currently, so removing it from the public
surface was a clean, no-consumer-impact change.

Implemented:
- Moved `src/server/fake-agent-loop.ts` → `src/server/__fixtures__/fake-agent-loop.ts`
  (mirrors the existing `src/agent/mcp/__fixtures__/` test-fixture convention), fixing its
  now-one-level-deeper relative imports (`../../contracts/index.ts`, `../agent-loop.ts`)
  and updating its header comment to note it's not part of the public surface.
- Removed the `export { FakeAgentLoop } from "./fake-agent-loop.ts"` line (and its
  preceding comment) from `src/server/index.ts`.
- Updated the 3 test files' imports to `./__fixtures__/fake-agent-loop.ts`.

Verified: `bun run typecheck` clean; `bun run test:coverage` — 2176 pass / 0 fail, 100%
line+function coverage on both the moved fixture and `src/server/index.ts`; `bun run e2e`
— 38 pass / 0 fail. `bun run lint` fails, but pre-existing and unrelated to this change
(biome.json uses an `include` key biome 1.9.4 no longer recognizes under `overrides`;
reproduces identically on `git stash` before this change) — not introduced by this ticket,
left for a separate fix.

(The synthetic empty constructor at fake-agent-loop.ts:33-34 is part of the coverage-gate
theme tracked in DH-0176, out of scope here.)

