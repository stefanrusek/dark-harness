---
spile: ticket
id: DH-0150
type: bug
status: closed
owner: stefan
resolution: done
blocked_by: []
created: 2026-07-17
relations:
  depends_on: []
  relates_to: [DH-0149]
  supersedes: []
implementation:
  - repo: dark-harness
---

# DH-0150: DH-0149 follow-up: per-file lcov merge inflates LF with comment-line pollution, replace lcov -a with max-LH-part merge

## Summary

scripts/test-isolated.ts merges per-file lcov.info parts via lcov -a --ignore-errors empty, which assumed Bun's lcov output is standard, execution-independent data. Fable (architect) reproduced and root-caused: Bun's line coverage is execution-path-dependent -- a function a given test file never executes gets marked with a DA record for every physical line including comments, while a function it does execute gets clean, comment-free JSC basic-block data. lcov -a's union takes the worst (most comment-polluted) view per file across all merged parts, inflating LF and dropping merged coverage from 99.77% (old shared-process ground truth) to 87.53%, even though LH (actual hit lines) is identical between the two approaches. Validated fix: per source file, take the DA line-set from the part with the MAXIMUM LH (most executed, cleanest data), then union hit-status onto that fixed line-set across all parts referencing the file. Prototyped against all 139 files: 99.75% vs 99.77% ground truth, a 2-line-of-14886 discrepancy. This also fixes the separate, previously-known problem of type-only files (src/contracts/commands.ts etc.) disappearing from the merged report entirely, since a from-scratch merge can preserve LF:0 SF: records instead of lcov -a silently dropping them.

## User Stories

### As the coverage gate, I want the merged lcov report's line totals to match reality, not be inflated by comment-line pollution

- Given the 121 per-file lcov.info parts produced by `scripts/test-isolated.ts --coverage`,
  when they are merged, then the merged `coverage/lcov.info`'s total line coverage matches the
  old shared-process ground truth (`bun test src --coverage --parallel=1`) to within a couple
  of lines out of ~14900 — proven by comparing the merged total against a fresh ground-truth
  run on the same tree.
- Given a source file touched by multiple test files with differing execution depth (e.g.
  `src/agent/loop.ts`, touched by `loop.test.ts`, `runtime.test.ts`, `cli.test.ts`,
  `resume.test.ts`), when merged, then its reported LF matches the line count from whichever
  part executed it most (max LH), not the inflated comment-polluted count from whichever part
  barely touched it.
- Given a pure type-only file (e.g. `src/contracts/commands.ts`) whose only per-file part
  reports `LF:0`, when merged, then its `SF:` record is preserved in the merged output (not
  silently dropped), so `gate.yml`'s completeness check (`grep ^SF:` vs `git ls-files`) still
  sees it.

## Functional Requirements

1. Replace `scripts/test-isolated.ts`'s coverage-merge step (currently
   `lcov --ignore-errors empty -a <part1> -a <part2> ... -o coverage/lcov.info`) with a small
   custom merge function, per Fable's validated design:
   - Parse every `coverage/parts/*/lcov.info` into a per-source-file map of
     `{ lh, daMap: Map<lineNumber, hitCount> }`.
   - For each source file appearing in any part, select the **DA line-set from the part with
     the maximum LH** for that file as the authoritative set of instrumentable lines (most
     executed = cleanest, comment-free JSC basic-block data).
   - A line counts as hit if `DA > 0` in **any** part that references the file, restricted to
     that authoritative line-set.
   - Emit standard lcov output (`SF:`/`DA:`/`LF:`/`LH:`/`end_of_record`) to
     `coverage/lcov.info`, **including `LF:0` records** for files with zero executed lines
     anywhere (do not drop them, unlike `lcov -a`).
2. Keep using the real `lcov` CLI only for the final human-readable summary
   (`lcov --summary coverage/lcov.info`) — the merge itself is now bespoke, per Fable's
   explicit sign-off reversing DH-0149's original "standard lcov CLI, no bespoke merge code"
   assumption (see Notes).
3. No changes needed to `gate.yml` — its `LINES_PCT`/`LF`-based awk sum and the `^SF:`
   completeness check are both format-compatible with the new merge's output shape.
4. No changes needed to child-process invocation in `scripts/test-isolated.ts` — the
   pollution is inherent to Bun/JSC's coverage instrumentation, not something a spawn-time
   flag can avoid; the fix belongs entirely in the merge step.

## Assumptions

- Bun's lcov `DA:` records are internally consistent within one part (i.e. a part's own
  reported LH genuinely reflects how much of that file it executed) — verified true by Fable
  across the prototype run.

## Risks

- This reverses DH-0149's stated Functional Requirement 3 assumption ("the standard `lcov`
  CLI, not hand-written merge/aggregation code"). Architect (Fable) explicitly signed off on
  this reversal — the assumption held for single-shared-process coverage but is provably false
  under per-file isolation, since Bun's LF is execution-path-dependent. DH-0149's own ticket
  text should be corrected/cross-referenced to record why, not left silently contradicted.

## Open Questions

- None blocking — fix is prototyped and validated against the full tree (99.75% vs 99.77%
  ground truth, within noise).

## Notes

> [!NOTE]
> 2026-07-17: Root-caused and fix validated by Fable (architect-on-call), dispatched
> specifically to diagnose the coverage regression discovered when merging DH-0149's
> follow-up commits. Reproduction data: orchestrated run showed 13029/14886 (87.53%), old
> shared-process ground truth showed 13029/13059 (99.77%) — identical LH (hit lines) in both,
> confirming the union of *hit* lines was always correct and only LF (instrumentable-line
> count) was inflated. Root mechanism: `src/agent/loop.ts`'s four touching test files reported
> LF ranging from 669 (its own dedicated, fully-exercising test) to 799 (`resume.test.ts`,
> which barely touches it) for the exact same physical file — the unexecuted-function fallback
> in Bun's coverage marks every physical line (including comments) as `DA:line,0`, while an
> executed function gets real basic-block data that omits comment lines. `lcov -a`'s union
> takes the worst (most polluted) LF per file, which is exactly backwards from the initially-
> suspected "take the max LF" fix — max LF is the *most* polluted view, not the most accurate.
> Prototyped fix (max-LH-part line-set, union hits) reproduces ground truth to within 2 lines
> across the whole tree. Full diagnosis transcript available on request if deeper verification
> is needed before implementation.
