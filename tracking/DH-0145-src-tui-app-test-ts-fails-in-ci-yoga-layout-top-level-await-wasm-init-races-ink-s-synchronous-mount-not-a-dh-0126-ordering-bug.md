---
spile: ticket
id: DH-0145
type: bug
status: refining
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

### As a TODO, I want TODO

- Given TODO, when TODO, then TODO.

## Functional Requirements

- TODO

## Assumptions

## Risks

## Open Questions

## Notes
