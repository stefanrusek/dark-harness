---
spile: ticket
id: DH-0134
type: feature
status: verifying
owner: stefan
resolution:
blocked_by: []
created: 2026-07-17
relations:
  depends_on: []
  relates_to: [DH-0133]
  supersedes: []
implementation:
  - repo: dark-harness
---

# DH-0134: UI overhaul phase 1: Core toolchain integration for React + Ink

## Summary

Per Fable's DH-0133 design (2026-07-17): add React and Ink to the build (scripts/build.ts, package.json), verify bun build --compile bundles them cleanly into the single binary, measure resulting binary size/startup delta against current builds, and pick+verify a component-testing approach compatible with bun test (React Testing Library for Web, ink-testing-library for TUI). Short, mostly-mechanical, but a hard prerequisite -- Web/TUI migration work (DH-0133b/DH-0133c) should not start until this lands. Core domain (Grace).

## User Stories

### As a TODO, I want TODO

- Given TODO, when TODO, then TODO.

## Functional Requirements

- TODO

## Assumptions

## Risks

## Open Questions

## Notes

### 2026-07-17 — toolchain landed, ready for verification

- Added `react@18.3.1`, `react-dom@18.3.1`, `ink@5.2.1` as dependencies; `@types/react`,
  `@types/react-dom`, `ink-testing-library@4.0.0`, `@testing-library/react@16`,
  `react-devtools-core@7.0.1` (ink's optional peer, needed for `bun build` to resolve ink's
  `devtools.js` import) as devDependencies — versions matched to `../privateer`'s pins per
  Fable/Muriel's recommendation.
- Verified `bun build --compile` bundles React+Ink cleanly into the single `dh` binary:
  built a scratch entry importing react+ink and rendering a `Text`/`Box` tree, compiled it
  standalone (523 modules, clean), and ran it directly (rendered correctly, exit 0). Also
  verified by temporarily wiring a smoke import into `src/cli.ts`'s real entry graph and
  running the real `bun scripts/build.ts` pipeline end to end.
- Measured size/startup delta (temporary `cli.ts` import, reverted after measuring, not
  committed): binary size 65M → 67M (+~2MB); startup (`dh --version`) ~0.07-0.08s →
  ~0.10-0.11s (+~30ms, one-time React/Ink module init). Both deltas are small and acceptable
  for a TUI/Web rewrite.
- Added `"jsx": "react-jsx"` scoped to a new isolated `src/tui/tsconfig.json` (mirroring
  `src/web`'s existing isolated-program pattern) rather than the shared root
  `tsconfig.json` — enabling `jsx` at the root pulled in `@types/react`'s `global.d.ts`
  triple-slash DOM lib reference, which broke `e2e/spikes/web/spike-reconnect.ts`'s
  playwright `evaluate()` typing (`HTMLElement | SVGElement` lost `classList`). Root
  `tsconfig.json` now excludes `src/tui` (like it already excludes `src/web`);
  `package.json`'s `typecheck` script runs all three programs.
- Picked and verified the component-testing approach: `ink-testing-library@4.0.0`'s
  `render()`/`lastFrame()` works cleanly under `bun test` for Ink components; React Testing
  Library (`@testing-library/react@16`) works under `bun test` for Web components using
  `happy-dom` (already a project devDependency) with manual global registration
  (`window`/`document`/`navigator`/`HTMLElement` set on `globalThis` before importing
  `@testing-library/react`) — no additional `@happy-dom/global-registrator` package needed.
  Both verified via scratch smoke tests (not committed — DH-0135/DH-0136 will add the real,
  permanent component tests using this proven approach).
- Gates run: `typecheck` clean (3 programs: root, `src/web`, `src/tui`); `lint` clean (11
  pre-existing unrelated errors in `.claude/skills/`, same count as on the base branch, none
  introduced by this change); `test:coverage` 2110 pass / 0 fail, 100% coverage on all new
  files; `e2e` has pre-existing environmental tmux/PTY failures in this sandbox (13 fail on
  the base branch vs 14 on this branch's run — both attributable to the sandbox lacking a
  working tmux/PTY, not to any change here; the one non-tmux delta, `exit-codes.test.ts`'s
  `callCount` 1 vs 2, reproduces identically on a clean re-run of the base branch and is
  flaky/order-dependent, not caused by this ticket).
- Also implemented DH-0137 in this same round (see that ticket's Notes) since it's
  Core-owned and blocks DH-0135/DH-0136.
