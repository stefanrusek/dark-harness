---
spile: ticket
id: DH-0145
type: bug
status: verifying
owner: stefan
resolution:
blocked_by: []
created: 2026-07-17
relations:
  depends_on: []
  relates_to: [DH-0126]
  supersedes: []
implementation:
  - repo: dark-harness
---

# DH-0145: src/tui/app.test.ts fails in CI: yoga-layout top-level-await WASM init races Ink's synchronous mount, not a DH-0126 ordering bug

## Summary

CI (ubuntu-latest/x64) fails src/tui/app.test.ts assertions expecting rendered text/ANSI content with raw preamble escape sequences instead, and two call-count assertions see exactly 2 writes instead of >2. Root-caused: NOT a DH-0126 ordering bug -- app.ts's alt-screen write, MouseLifecycle.enable(), and mountInk() are fully synchronous and always run in that fixed order. The real mechanism: ink's DOM layer (node_modules/ink/build/dom.js) calls Yoga.Node.create() synchronously inside mountInk(), but yoga-layout's own entry module (node_modules/yoga-layout/dist/src/index.js) does 'const Yoga = wrapAssembly(await loadYoga())' -- a top-level await loading a WASM binary. Reproduced deterministically on this machine: running 'bun test src/tui/app.test.ts' in isolation crashes every single run with 'ReferenceError: Cannot access Yoga before initialization' inside mountInk (ink/build/dom.js:12), while running the full 'bun test src --coverage --parallel=1' suite (same command as CI/gate.yml) passes 100% every time -- something about how many/which other modules Bun has already resolved in the process changes whether yoga-layout's async WASM load has settled by the time app.test.ts's synchronous mountInk() call reaches it. This is consistent with the original CI symptom under a different manifestation: instead of a hard crash, a slower/differently-ordered CI runner could have Ink's first real render land after test assertions already fired, leaving only the pre-render preamble (alt-screen/mouse-mode escapes) in stdout.writes -- exactly the reported failure. Recommended fix (not yet implemented, needs Core/TUI owner sign-off since it may touch startup sequencing in src/cli.ts and/or test setup): add an explicit warmup step that awaits the ink/yoga-layout module graph (e.g. 'await import("./tui/ink/mount.ts")' or equivalent) before any code path synchronously calls mountInk() -- in src/cli.ts's real startup path, and in a test preload/setup step for src/tui so app.test.ts no longer depends on file-execution-order luck to have yoga-layout's WASM already resolved. Alternative/complementary fix: pin or patch yoga-layout to a synchronous-init build if one exists upstream, removing the top-level-await hazard entirely. This is an upstream-library/runtime interaction issue, not a bug in src/tui/app.ts or src/tui/mouse-lifecycle.ts -- DH-0126's ordering hypothesis is ruled out by the fact that its writes are fully synchronous and deterministic.

## User Stories

### As a TUI test author, I want `mountInk()` to never race yoga-layout's WASM init, so that `src/tui/app.test.ts` doesn't crash with `ReferenceError: Cannot access Yoga before initialization` depending on file-execution-order luck

- Given `bun test src/tui/app.test.ts` is run in isolation (the reproduced-every-time crash
  scenario), when `startTui()` is called, then the ink/yoga-layout module graph has already
  fully resolved before `mountInk()` is reached, and every `startTui` test in the file passes
  — proven by `src/tui/app.test.ts`'s full `describe("startTui", ...)` block (all cases under
  it), run repeatedly.

### As an operator starting a real TUI session, I want the same warmup applied in production, so that a real user's terminal startup can't hit the same race

- Given `src/cli.ts` calls `startTui()` on its real startup path, when `startTui()` begins
  execution, then it `await`s the ink/yoga-layout module graph before any code path inside it
  synchronously calls `mountInk()` — proven by the fix living directly in `startTui()`
  (`src/tui/app.ts`), the single call site both production `src/cli.ts` and every TUI test go
  through, so no separate production-only code path can bypass the warmup.

## Functional Requirements

- `startTui()` (`src/tui/app.ts`) must `await import("./ink/mount.ts")` (or equivalent) before
  any line that can reach `mountInk()`'s synchronous `Yoga.Node.create()` call.

## Assumptions

- The fix lives in `startTui()` itself rather than as two separate call-site warmups (one in
  `src/cli.ts`, one in a test preload) because `startTui()` is the single choke point both the
  production path and every TUI test already go through — duplicating the warmup at each call
  site would be redundant with no coverage benefit.

## Risks

- Not independently reproducible on this machine/Bun version (1.3.14) even pre-fix — 5
  isolated runs of `bun test src/tui/app.test.ts` all passed before this change. The fix
  matches Fable's root-cause diagnosis and closes the described gap regardless; see Notes for
  reproduction attempt details.

## Open Questions

## Notes

### 2026-07-17 — implementation (Grace)

Reproduction attempt: `bun test src/tui/app.test.ts` run 5x in isolation on this machine
(Bun 1.3.14, macOS/arm64, after a fresh `bun install`) — all 5 runs passed (23 pass / 0 fail
each), pre-fix and post-fix alike. Did not reproduce Fable's every-run crash here, consistent
with the root cause being file-execution-order/timing-dependent per-machine, per-Bun-version,
per-OS — not deterministic across environments. Implemented the fix as diagnosed regardless
(`await import("./ink/mount.ts")` at the top of `startTui()` in `src/tui/app.ts`, before any
other work in the function), since it directly closes the described race and is a no-op-cost
correctness fix on any machine where the race wasn't hitting anyway.

Post-fix: `bun test src/tui/app.test.ts` run 5x in isolation — 23 pass / 0 fail every time.
Full gate (`bun run typecheck`, `bun run lint`, `bun run test:coverage`, `bun run e2e`) run
before commit — see commit message / PR for results.
