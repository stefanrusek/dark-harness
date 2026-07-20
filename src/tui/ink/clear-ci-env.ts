// DH-0244. Shared clearing logic for the two CI-env side-effect entrypoints
// (`render-interactive-in-tests.ts` / DH-0146, and
// `clear-ci-env-for-interactive-render.ts` / DH-0164). Read either of those files' comments
// for the full `is-in-ci`/Ink mechanics and why load ordering is load-bearing.
//
// This module is deliberately inert on its own: importing it has NO side effect. Each
// entrypoint module calls `clearCiEnvForInteractiveInkRender()` itself, inside its own
// `Object.freeze(...)` module-load trigger, so that the `delete` still runs exactly when that
// entrypoint's own import position requires — this module only dedupes the function body, not
// the timing of when it runs.
export function clearCiEnvForInteractiveInkRender(): true {
  // `delete`, not `= undefined` — assigning `undefined` to a `process.env` key coerces to the
  // string "undefined", which `is-in-ci` still counts as CI-present via `'CI' in env`.
  delete process.env.CI;
  delete process.env.CONTINUOUS_INTEGRATION;
  return true;
}
