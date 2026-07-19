---
spile: ticket
id: DH-0223
type: bug
status: closed
owner: stefan
resolution: done
blocked_by: []
created: 2026-07-19
relations:
  depends_on: []
  relates_to: [DH-0220]
  supersedes: []
implementation:
  - repo: dark-harness
---

# DH-0223: chooseHeaderMode is exported and unit-tested but never called at runtime

## Summary

DH-0220 added chooseHeaderMode(isServer,isWeb) to src/cli/header.ts with tests, but src/cli/run.ts branches on the run mode directly and only references chooseHeaderMode in a comment ('exists for the multi-branch local/server case'). It has no runtime caller — a dead abstraction carrying its own 100%-covered tests. Either wire run.ts's header-mode selection through it (single source of truth for A2-vs-B gating) or delete it and its tests. Owner: Core.

## User Stories

### As a Core maintainer, I want no exported function in the codebase that only tests call

- Given `src/cli/header.ts` and `src/cli/run.ts`, when reading the header-mode selection code, then either `run.ts` actually calls `chooseHeaderMode` to pick a header, or `chooseHeaderMode` does not exist.

## Functional Requirements

- Resolution: deleted `chooseHeaderMode` (and its dedicated test block) from `src/cli/header.ts`/`src/cli/header.test.ts`. `run.ts`'s five header-selection call sites (`--connect --web`, `--connect`, `--server`, local `--web`, local TUI) are separate, statically-resolved branches on `mode.kind`/`mode.web` — each already knows unconditionally which header it wants, so a runtime call to `chooseHeaderMode(isServer, isWeb)` at any one of them could only ever return one constant value. Wiring it in would be a no-op call, not real gating, so deletion was the honest fix rather than forcing awkward plumbing.

## Assumptions

## Risks

## Open Questions

## Notes

### 2026-07-19

Chose deletion over wiring (see Functional Requirements): `run.ts`'s five call sites already
pick their header statically, so `chooseHeaderMode` could never gate anything real there.
Deleted the function and its test block; cleaned up the stale comment in `run.ts` that
referenced it. Gates: `typecheck`/`lint` clean on the touched files (pre-existing, unrelated
failures elsewhere confirmed via `git stash` before/after — `header.test.ts:93` formatting,
an `exactOptionalPropertyTypes` error, and other agents' concurrently in-flight files);
`bun test src --coverage` 100% on `src/cli/header.ts` (run.ts's own diff is comment-only);
`bun run e2e` has one pre-existing unrelated failure (`web.test.ts`'s `stream.getReader`),
also confirmed present at HEAD before this change via `git stash`. Trivial mechanical
fix — closing directly rather than routing through a separate verifying step.
