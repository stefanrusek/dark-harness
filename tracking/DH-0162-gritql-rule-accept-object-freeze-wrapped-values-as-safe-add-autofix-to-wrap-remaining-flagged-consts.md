---
spile: ticket
id: DH-0162
type: feature
status: closed
owner: stefan
resolution: done
blocked_by: []
created: 2026-07-18
relations:
  depends_on: []
  relates_to: [DH-0161]
  supersedes: []
implementation:
  - repo: dark-harness
---

# DH-0162: GritQL rule: accept Object.freeze()-wrapped values as safe, add autofix to wrap remaining flagged consts

## Summary

Owner decision, generalizing beyond the new Set()/Map() case DH-0161's pilot found: any top-level const/let initializer that is not already a primitive literal or an as-const literal must be wrapped in Object.freeze(...) to be considered safe -- this covers new Set([...]), new Map([...]), plain object/array literals without as-const, and any other non-obviously-inert expression, uniformly, without needing per-pattern special-casing in the rule. Critically: implement this as a GritQL autofix (rewrite), not just a diagnostic, so 'bunx biome check --write .' mechanically wraps every remaining flagged top-level value in Object.freeze(...) across all ~55 still-flagged files in one pass, rather than requiring file-by-file manual triage like DH-0161's pilot did for config/validate.ts. Verify Object.freeze()'s actual runtime semantics are acceptable for this use (it does NOT deep-freeze or prevent Set/Map internal mutation via .add()/.delete() -- only prevents reassigning/reconfiguring the const binding's own object properties -- confirm this is still an acceptable safety signal for the rule's purpose, or flag if it's not, before treating this as done).

## User Stories

### As a TODO, I want TODO

- Given TODO, when TODO, then TODO.

## Functional Requirements

- TODO

## Assumptions

## Risks

## Open Questions

## Notes

> [!NOTE]
> 2026-07-18: Implemented and verified.
>
> **Object.freeze() empirical finding (per the Summary's ask):** confirmed via a real Bun
> script — `Object.freeze(new Set(["a"]))` does NOT prevent `.add()`/`.delete()`; freeze only
> locks the frozen object's own enumerable properties, not Set/Map internal slots. `.add()`/
> `.delete()`/`.set()` all still succeed after freezing. Accepted anyway per the owner's
> design as a lint-satisfying convention/intent signal for Set/Map specifically, not a
> runtime mutation guarantee — documented honestly in the rule's commit message, not hidden.
>
> **Rule change:** `no-module-scope-side-effects.grit` now accepts `Object.freeze($_)` (and
> `Object.freeze<$_>($_)`, needed for cases requiring an explicit type argument to keep
> literal-type narrowing/contextual typing through the freeze) as an additional safe
> initializer form, alongside primitive literals and `as const` object/array literals. Added
> a `fix_kind="safe"` rewrite (`$val => Object.freeze($val)`) so `bunx biome check --write .`
> mechanically applies it.
>
> **Fixture verification (before touching the real tree):** a throwaway `src/dh0162-fixture.ts`
> with already-safe consts (`Object.freeze(new Set(...))`, `as const`, primitives) and
> not-yet-safe ones (`new Set(...)`, plain object/array literals) confirmed: already-safe
> consts stay unflagged, unsafe ones get flagged with a suggested fix, and `--write` produces
> exactly `Object.freeze(...)`-wrapped output that then re-checks clean. Fixture deleted
> before committing.
>
> **Real-tree mechanical pass:** `bunx biome check --write .` touched 55 files. Warnings:
> 98 -> 2 (both pre-existing/out of scope: `banner.constant.ts`'s computed-template-literal
> violation of the separate constant-file-restrictions rule, and an uninitialized top-level
> `let` in `web/server.ts` this rule's initializer-based check doesn't cover).
>
> **Two real runtime regressions found and fixed** (this is exactly why the ticket asked for
> empirical verification, not just a lint-green pass):
> - `src/tui/mouse.ts` (3 consts) and `src/config/interpolate.ts` (1 const): a global/sticky
>   `RegExp` mutates its own `lastIndex` during `.replace()`/`.exec()` — freezing the RegExp
>   object makes that a hard throw in strict mode. Caught by `bun run test:coverage` (mouse
>   and interpolate test failures). Reverted to unfrozen with a `biome-ignore lint/plugin`
>   comment explaining why.
> - `src/agent/tools/read.ts`'s `PDF_MAGIC`: `Object.freeze()` on a `Uint8Array` throws
>   immediately at module load — TypedArray integer-indexed elements can't be made
>   non-configurable per spec. Same fix pattern.
>
> Also hand-fixed ~15 `tsc` errors the wrap introduced (Object.freeze() loses contextual
> typing for object literals unless the target type is threaded through explicitly): added
> `Object.freeze<Tool>(...)` explicit type args to the 22 built-in tool definitions, and
> widened a handful of declared `Array<T>`/mutable types to `readonly T[]`/`ReadonlyArray<T>`
> where callers never mutated them (`ALL_TOOLS`, `HELP_USAGE_ITEMS`/`HELP_FLAG_ITEMS`,
> `renderingFixtures`, `PATTERNS` in redact.ts, `COMBINING_RANGES`/`WIDE_RANGES` in width.ts).
>
> **Spot-checked** diffs across `src/cli.ts`, `src/config/build-info.ts`,
> `src/agent/providers/bedrock.ts`, `src/format.ts`, `src/tui/mouse.ts`, `src/tui/sse-parser.ts`,
> `src/web/server.ts` — all mechanical, correctly formatted, no logic changes beyond the
> `Object.freeze(...)` wrap (or its narrow reversal in the two regression cases above). Noted
> `web/server.ts`'s `assetCache` (a `Map` mutated at runtime via `.set()`) stays functionally
> correct after freezing, per the empirical Set/Map finding above.
>
> **Full verification:** `bun run typecheck` clean. `bun run lint` 98 -> 2 warnings (both
> pre-existing/out of scope, not new). `bun run test:coverage` 125/125 (99.76%). `bun run e2e`
> 35/38 — the 3 failures are headless-browser `waitForSelector` timeouts, reproduced
> identically on the unmodified base commit via `git stash` before re-running e2e, confirming
> they are pre-existing/environmental, not a regression from this change.
>
> Commits: `d6242d5` (rule change + autofix), `bc8b7cf` (mechanical pass + regression fixes).
>
> **Coordinator follow-up (2026-07-18):** the reported 2 remaining warnings were fixed
> directly rather than left open: `banner.constant.ts`'s `DH_ASCII_LOGO` had its
> template-literal-plus-`.replace()` computation replaced with the already-trimmed literal
> hardcoded directly (verified byte-identical output via a real comparison script).
> `web/server.ts`'s `innerServer` (a genuine lazy-singleton, uninitialized until first use —
> `Object.freeze()` doesn't apply and would defeat its purpose) got an explicit
> `biome-ignore lint/plugin` exception, same class as `test-dom.ts`'s earlier one. `bun run
> lint` now reports zero warnings and zero errors. Commit: `ac4fe50`.
>
> **All three GritQL rules flipped from `warn` to `error`** (commit `055f18e`) — the final
> step of the overhaul. `bun run lint` confirmed at exit 0, zero errors, zero warnings, at
> error severity. `bun run typecheck` clean, `bun run test:coverage` 125/125 (99.76%),
> `bun run e2e` 35/38 (same confirmed pre-existing local-only flake). This closes the
> owner's original goal: "complete the biome + lint overhaul migration. lint must have no
> warnings or errors when you finish."
