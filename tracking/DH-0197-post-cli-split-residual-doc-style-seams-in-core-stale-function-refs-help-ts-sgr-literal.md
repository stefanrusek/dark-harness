---
spile: ticket
id: DH-0197
type: bug
status: closed
owner: stefan
resolution: done
blocked_by: []
created: 2026-07-19
relations:
  depends_on: []
  relates_to: [DH-0174, DH-0191]
  supersedes: []
implementation:
  - repo: dark-harness
---

# DH-0197: Post-cli-split residual doc/style seams in Core (stale function refs + help.ts SGR literal)

## Summary

Cleanup follow-up from the DH-0174 cli.ts split (redone fresh against HEAD by a merge agent) and the DH-0191 SGR consolidation folded into it. The split left several doc-comment cross-references dangling (they point at function names/locations that no longer exist), and the SGR consolidation left one help.ts styling site bypassing the shared wrapSgr primitive every other CLI styling helper now routes through. Pure doc + small style cleanup, all Core-owned (src/agent, src/cli). No behavior change.

## User Stories

### As a developer reading the src/cli/ modules, I want doc-comment cross-references to point at code that actually exists

- Given `src/cli/run.ts:242`, when I read the comment "see createStandaloneRuntime's identical call above for the rationale," then it should point me at the real location — `createStandaloneRuntime` is not "above" in `run.ts`; it lives in `src/cli/agent-loop-adapter.ts`. The split moved the function out of this file but left the "above" cross-reference behind.
- Given `src/cli/deps.ts:100`, when I read "Absent, `summary.json` writing is skipped (see `runInstructionsMode`)," then it should name a function that exists — there is no `runInstructionsMode` anywhere; the summary.json logic is now inline in `cli.ts`'s `main()`.
- Given `src/agent/runtime.ts:841`, when I read "the `--job` path (cli.ts's runInstructionsMode) has no equivalent handling," then it should name a real symbol — again `runInstructionsMode` does not exist (and the `--job` path is now in `cli.ts` `main()`).
- Given `src/cli/agent-loop-adapter.ts:56` and `:61`, when I read "runMode() generates this once…" / "not through runMode()," then they should name the real caller — there is no `runMode()` function; the interactive-mode runner is `runInteractiveMode` (`src/cli/run.ts`).

### As a maintainer of the CLI styling layer, I want every SGR emission to route through the one shared primitive

- Given `src/cli/help.ts:156` (`HELP_CYAN_BOLD = "\x1b[1;36m"`) and its use at `:166` (`${HELP_CYAN_BOLD}${title}${CLI_RESET}`), when I compare it to every other CLI styling helper, then it should go through the shared `wrapSgr` primitive (`src/design-tokens.ts`, DH-0191) like the rest — instead it hand-rolls a raw escape literal plus manual `CLI_RESET` concatenation. `styling.ts`'s own header comment already flags this exact site as the one place that "composes [CLI_RESET] directly with a bespoke cyan+bold code that has no single named helper here." Routing it through `wrapSgr("1;36", title)` removes the raw literal (and the `CLI_RESET` import if that becomes its only use).

## Functional Requirements

- Fix the four dangling doc-comment references so each names a symbol/location that exists (or drop the stale clause). Files: `src/cli/run.ts`, `src/cli/deps.ts`, `src/cli/agent-loop-adapter.ts` (x2), `src/agent/runtime.ts`.
- Replace `help.ts`'s `HELP_CYAN_BOLD` raw-SGR literal with a call through the shared `wrapSgr` primitive; remove now-unused imports/constants if any fall out.
- No behavior change: `--help` output, doctor output, and all transcripts must be byte-identical. This is comment + internal-styling-plumbing only.

## Assumptions

- The DH-0191 `wrapSgr(code, text)` primitive accepts a compound `"1;36"` SGR code (it wraps `\x1b[<code>m…\x1b[0m`), so the cyan+bold header can go through it unchanged in output.

## Risks

- Very low. The one live-code change (help.ts styling) is covered by existing help-rendering tests; the byte-identical-output requirement is the guard.

## Open Questions

## Notes

- Owning domain: **Core** (Grace) — `src/agent/`, `src/cli/`. No cross-domain seam.
- Filed by the DH-0196 refactoring round (Fable). Related origin tickets DH-0174 (the split) and DH-0191 (the SGR consolidation) both still sit at `draft` in the tracker despite having landed in HEAD (commit `5caae69`) — a tracking-hygiene mismatch worth a coordinator glance, but out of scope for this cleanup ticket.
- Also considered and deliberately NOT filed this round (no silent truncation): (a) the `pruneLogDirectories` two-line call appears in both `run.ts:243` and `agent-loop-adapter.ts:188` — genuine but they sit in two distinct runtime-construction paths (interactive vs. standalone), so extracting a shared helper would be net-negative indirection; (b) `Object.freeze()` applied to string/number primitives (`styling.ts` `CLI_RESET`, `doctor.ts` `DOCTOR_*_COLOR` / `DOCTOR_VERDICT_LABEL_WIDTH`) is a no-op — harmless noise, predates the split, not worth churn; (c) a handful of styling.ts exports (`CLI_YELLOW`, `CLI_BOLD`, `cliColorize`) are only used within the module — but they read as a coherent palette API and lint does not flag them, so left as-is.
