// DH-0164. Same underlying mechanism as DH-0146's `render-interactive-in-tests.ts` (read that
// file's comment for the full `is-in-ci`/Ink mechanics) but fixing production, not a unit
// test: Ink withholds writing rendered frames to stdout whenever `process.env.CI` is set,
// computing them but flushing only on `unmount()`. GitHub Actions always sets `CI=true` in the
// job environment; the real compiled `dh` binary run interactively under e2e's tmux PTY
// harness (ADR 0008) inherits it, so — even though it's genuinely attached to a real terminal
// — Ink silently rendered nothing, and every PTY e2e test timed out waiting for content Ink
// had computed but was withholding. `startTui` (src/tui/app.ts) is only ever reached for the
// real interactive TUI (headless `--job` mode never touches Ink), so a real terminal's
// presence is the only ground truth that matters here — `CI=true` is meaningless once we're
// actually attached to one.
//
// MUST be the first import in `src/cli.ts` (the actual `bun build --compile` entry point,
// per `scripts/build.ts`): `is-in-ci` snapshots the env once, at its own module-load time, and
// `src/tui/app.ts` imports `ink` (via `./ink/mount.ts`) *statically* — an earlier version of
// this fix put the `delete` call inside `startTui`'s function body, which runs far too late:
// by the time any function body executes, the whole static import graph reachable from
// `cli.ts` (including `ink`) has already been evaluated. Only a side-effecting module that is
// itself imported *before* the import that reaches `ink` is evaluated early enough — ESM
// evaluates each import statement's module fully (imports depth-first) before moving on to the
// next sibling import, so this being `cli.ts`'s first import line is what actually matters,
// not anything about `await import(...)` timing inside a function.

// DH-0244: the shared clearing body lives in `./clear-ci-env.ts`. Importing that module has
// no side effect by itself (it only defines a function) — the `delete` still runs at exactly
// this module's own load time, when the call below executes, which is what preserves this
// module's "must be `cli.ts`'s first import" guarantee described above.
import { clearCiEnvForInteractiveInkRender } from "./clear-ci-env.ts";

// The env-clearing runs as this initializer evaluates on import. Wrapped in `Object.freeze` per
// the repo's no-module-scope-side-effects lint rule's sanctioned escape hatch — the actual work
// lives inside the function above (function bodies are exempt); this is the module-load trigger.
export const ciEnvClearedForInteractiveInkRenderInProduction = Object.freeze(
  clearCiEnvForInteractiveInkRender(),
);
