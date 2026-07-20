// DH-0146 root cause + fix. Ink (see node_modules/ink/build/ink.js `onRender`) checks a
// module-level `isInCi` constant from the `is-in-ci` package: when it is true, Ink stores each
// rendered frame in `this.lastOutput` and returns WITHOUT writing it to stdout — the frame is
// only flushed on `unmount()`. That behavior is intentional (CIs render ANSI-erase sequences
// badly, so Ink emits just the final frame on exit), but it means a test that mounts the TUI
// and asserts on rendered content *without unmounting first* sees only the synchronous startup
// preamble in CI, never the rendered frame. This is why `src/tui/app.test.ts` failed only in
// real GitHub Actions CI (where `process.env.CI` is set) and never reproduced locally, or even
// in a close Linux/Docker repro that didn't set `CI` — the failure is deterministic on the env
// var, not a timing/scheduling race. (Reproduce locally with `CI=true bun test src/tui/app.test.ts`.)
//
// `is-in-ci` computes its boolean once, at import time, as
//   env.CI !== '0' && env.CI !== 'false' && ('CI' in env || 'CONTINUOUS_INTEGRATION' in env
//     || some CI_-prefixed key)
// Deleting `CI` and `CONTINUOUS_INTEGRATION` makes that expression false on GitHub Actions
// (which is the environment that triggered this bug — it sets `CI=true` and no `CI_`-prefixed
// or `CONTINUOUS_INTEGRATION` var), forcing Ink into its normal interactive rendering path (the
// same path every local test run already uses), so mounted frames are actually written to the
// test's fake stdout and the wiring assertions can observe them.
//
// This module MUST be imported (for its side effect) before anything that transitively imports
// Ink (i.e. before `app.ts`), because ESM evaluates a module's imports in source order and
// `is-in-ci` snapshots the env at its own load time. It is safe under DH-0149's per-file process
// isolation: each test file runs in its own `bun test` OS process, so mutating this process's
// env cannot affect any other test file, and the real CI env of the job is untouched for every
// non-TUI file.

function clearCiEnvForInteractiveInkRender(): true {
  // `delete`, not `= undefined` — assigning `undefined` to a `process.env` key coerces to the
  // string "undefined", which `is-in-ci` still counts as CI-present via `'CI' in env`.
  delete process.env.CI;
  delete process.env.CONTINUOUS_INTEGRATION;
  return true;
}

// The env-clearing runs as this initializer evaluates on import. Wrapped in `Object.freeze` per
// the repo's no-module-scope-side-effects lint rule's sanctioned escape hatch — the actual work
// lives inside the function above (function bodies are exempt); this is the module-load trigger.
export const ciEnvClearedForInteractiveInkRender = Object.freeze(
  clearCiEnvForInteractiveInkRender(),
);
