---
spile: ticket
id: DH-0149
type: bug
status: implementing
owner: stefan
resolution:
blocked_by: []
created: 2026-07-17
relations:
  depends_on: []
  relates_to: [DH-0145, DH-0146, DH-0004]
  supersedes: []
implementation:
  - repo: dark-harness
---

# DH-0149: Replace shared-process bun test with per-file process isolation orchestrator + standard lcov merge

## Summary

The gate/release CI has been blocked across the project's first release-tag attempt (v0.1.0-alpha.1) by a recurring "Cannot access 'Yoga' before initialization" crash in Ink component tests (node_modules/ink/build/dom.js's createNode, racing yoga-layout's top-level-await WASM init against Ink's synchronous mountInk()) plus a separate now-fixed Bun-version mismatch. Root cause: bun test src runs all 121 test files in ONE shared OS process, so module-load-order state bleed (which modules Bun has already resolved by the time a given file's synchronous code runs) is unpredictable machine-to-machine and CI-run-to-CI-run. DH-0145 documented directly contradictory evidence for any TUI/Web partitioning approach (isolating TUI-only crashed deterministically once; running the full mixed suite passed by accident once; a warmup fix closed the gap locally but the same crash recurred in real CI afterward). Fable (architect) was dispatched twice: first recommended shipping just the Bun-version bump as the fix (later disproven by real CI showing the Yoga crash persists at Bun 1.3.14), then produced a full corrected design after being given the contradiction and fresh CI evidence: replace the shared process entirely with a per-file test-process isolation orchestrator, since ANY partitioning scheme (not just TUI/Web) is still gambling on intra-group module order.

## User Stories

### As a maintainer running the coverage gate, I want each test file to run in its own OS process, so that module-load-order state bleed (the mechanism behind the Ink/yoga-layout crash) becomes structurally impossible rather than merely less likely

- Given the 121 `src/**/*.test.ts(x)` files, when `bun run test:coverage` runs (locally or in
  CI), then each file executes in its own `bun test <file>` OS process spawned by
  `scripts/test-isolated.ts` — proven by the orchestrator's own behavior (no two test files'
  module graphs ever share a process) and by the "Cannot access 'Yoga' before initialization"
  crash class becoming impossible to reproduce, since it depends on cross-file module
  resolution order that no longer exists.

### As the release process, I want a real GitHub Actions CI run to prove the fix, not a local or Docker repro

- Given a real GitHub Actions CI run of the gate workflow using the isolated orchestrator,
  when the full suite runs, then it passes with no `react-dom/client` module-resolution
  failures and no Ink/yoga-layout crashes — this is the release-blocking criterion. Per
  CLAUDE.md §9's integration-tier note, this can only be verified by a real CI run: local and
  Docker/Linux repro attempts have already been proven insufficient (DH-0145/DH-0146's
  history — clean local/Docker runs occurred both before and after the underlying bug was
  still present in real CI). A clean local run must NOT be treated as sufficient evidence of
  done for this ticket.

### As the coverage gate, I want per-file lcov reports merged via the standard `lcov` CLI, not bespoke merge code

- Given N per-file `lcov.info` reports from an isolated test run, when merged via
  `lcov --ignore-errors empty -a part1/lcov.info -a part2/lcov.info ... -o coverage/lcov.info`,
  then the merged file's line-coverage percentages are correct — verified by Fable via a real
  union test (complementary per-file line hits recombining to 100% in the merged output) — and
  `gate.yml`'s existing completeness check (`^SF:` vs `git ls-files`) and line-based 100%
  threshold check both pass unchanged in shape, with only the functions-percentage branch
  removed (see Functional Requirements).

## Functional Requirements

1. New script `scripts/test-isolated.ts` (Bun): enumerates all `src/**/*.test.ts(x)` files
   (glob), spawns each as its own `bun test <file> --coverage --coverage-reporter=lcov
   --coverage-dir <per-file-dir>` process via `Bun.spawn`, pool-capped at
   `os.cpus().length` (tunable via env var, default the core count). No grouping/batching of
   multiple files per process — per-file startup overhead was measured at ~12-35ms, ~3.6s
   aggregate across all 121 files, trivially absorbed by real parallelism even on a 4-core CI
   runner; a middle-ground "a few files per process" batching mode must NOT be built, since it
   would reintroduce the same class of module-order bleed at smaller scale in exchange for
   saving a couple of seconds that don't matter.
2. Exit-code aggregation: overall orchestrator exit is nonzero if any child process fails.
   Print a per-file failure summary at the end; stream failed files' stdout/stderr so CI logs
   stay actionable. `e2e/` stays entirely separate and unchanged (its own `bun run e2e` step,
   its own existing real-binary-per-test isolation).
3. Coverage merge: after all per-file `lcov.info` parts are collected, run
   `lcov --ignore-errors empty -a <part1> -a <part2> ... -o coverage/lcov.info` (the standard
   GNU `lcov` CLI, not hand-written merge/aggregation code). `--ignore-errors empty` bypasses
   lcov 2.x's "functions: no data found" error caused by Bun's lcov output only emitting
   summary `FNF:`/`FNH:` records with no per-function `FN:`/`FNDA:` coverpoints — function data
   is genuinely non-mergeable across processes with this input and is correctly dropped, not
   worked around with custom math.
4. `gate.yml`'s existing 100%-coverage threshold check must drop its `FUNCS_PCT`/`FNF`-based
   branch (function data no longer present in the merged file) and keep the
   `LINES_PCT`/`LF`-based check verbatim. Justification: Bun marks a function "hit" via its
   definition line executing, so 100% line coverage already implies 100% function coverage in
   Bun's own instrumentation model — the function check was redundant at this gate's 100%
   threshold regardless. The existing completeness check (`grep ^SF:` vs `git ls-files`)
   requires no changes.
5. Wiring — this REPLACES the shared-process run as the one true path, not an optional
   parallel mode: `package.json`'s `test` and `test:coverage` scripts repoint to the
   orchestrator (`test` without `--coverage`, `test:coverage` with it). `gate.yml`'s coverage
   step calls the orchestrator instead of the inline `bun test src ...` one-liner, and the
   runner setup must install the `lcov` CLI (e.g. `sudo apt-get install -y lcov` on
   `ubuntu-latest`).
6. Follow-up, explicitly NOT required to close this ticket: once the isolated path is proven
   green in real GitHub Actions CI, `src/web/client/test-dom.ts` can be simplified back to its
   original install-once-at-module-load design (no refcounted `beforeAll`/`afterAll` needed,
   since no TUI test file ever shares a process with a web-component test file under this
   model), and GitHub Copilot's PR #9 (`src/test-process-lock.ts`, the refcounted `test-dom.ts`
   refactor) can be closed without merging — it solves a shared-process problem that no longer
   exists under this design. Owned by Susan (Web) + Mary (TUI) as a separate pass.

## Assumptions

- Bun's `--coverage-reporter=lcov` output is standard-enough lcov syntax for the real `lcov`
  CLI to merge (verified true by Fable for line records; false only for function records, per
  Functional Requirement 3).
- `os.cpus().length`-capped concurrency is safe on GitHub Actions' `ubuntu-latest` runners
  (typically 4 cores) without hitting resource limits — not yet verified in real CI, only
  reasoned about locally (14 cores). Watch the first real CI run for this.

## Risks

- This changes the core test-running mechanism for both local dev (`bun run test:coverage`)
  and CI, not just one ticket's narrow workaround — real CI verification is mandatory before
  treating this as done, since real GitHub Actions CI is the only environment that has ever
  reproduced the underlying failure (DH-0145/DH-0146). A clean local run is not evidence of
  done for this ticket specifically.
- If `lcov --ignore-errors empty` behaves differently on the CI runner's `lcov` version than
  the locally-verified 2.5, the merge step may need adjustment — check the installed version
  in CI matches or is compatible.

## Open Questions

- None blocking — design is fully settled per Fable's dispatch. Sequencing below is the only
  remaining coordination point.

## Notes

> [!NOTE]
> 2026-07-17: Ownership split per CLAUDE.md §3 domain map — Grace (Core, owns `scripts/`)
> implements `scripts/test-isolated.ts` and repoints `package.json`'s `test`/`test:coverage`
> scripts. Nightingale (CI/Release, owns `.github/workflows/`) wires `gate.yml` to call the
> orchestrator, installs the `lcov` CLI on the runner, and edits the 100%-coverage threshold
> check to drop the functions branch. Susan (Web) and Mary (TUI) do the `test-dom.ts`
> simplification and PR #9 closure as an explicit follow-up once CI is proven green — not
> required for this ticket's core release-unblock.
>
> Recommended sequencing (from Fable): (1) land the orchestrator + package.json repoint +
> gate.yml wiring together as one implementation pass; (2) push to a live PR and watch real
> GitHub Actions CI — the only environment that has ever reproduced the failure, so this is
> the actual verification, not a formality; (3) only after CI is green on the isolated path,
> do the `test-dom.ts`/PR #9 cleanup follow-up; (4) re-attempt the `v0.1.0-alpha.1` tag.

> [!NOTE]
> 2026-07-17: Implementation pass complete (acting as Grace for `scripts/test-isolated.ts` +
> `package.json`, and as Nightingale for `.github/workflows/gate.yml`), per the sequencing
> above (step 1). Status left as `implementing` — **not** moved to `verifying`/`closed`; real
> GitHub Actions CI is still required per this ticket's own acceptance criteria and has not
> run yet.
>
> **Built:**
> - `scripts/test-isolated.ts`: enumerates `src/**/*.test.ts(x)` via `Bun.glob`, spawns each
>   as its own `bun test <file>` process (`Bun.spawn`) pool-capped at `os.cpus().length`
>   (override: `TEST_ISOLATED_CONCURRENCY`), no batching. `--coverage` flag toggles per-file
>   `--coverage --coverage-reporter=lcov --coverage-dir=coverage/parts/<sanitized-file>`;
>   without it, plain `bun test <file>`. Cleans `coverage/parts/` at the start of each run.
>   Prints a per-file PASS/FAIL summary, dumps failed files' stdout/stderr, and aggregates a
>   nonzero exit if any child fails. On `--coverage` runs, merges all part `lcov.info` files
>   via the real `lcov --ignore-errors empty -a ... -o coverage/lcov.info` CLI (merge still
>   runs even if some children failed, so partial coverage isn't lost), then prints
>   `lcov --summary` as the human-readable total.
> - `package.json`: `test` → `bun scripts/test-isolated.ts`, `test:coverage` → `bun
>   scripts/test-isolated.ts --coverage`. No other scripts touched.
> - `.github/workflows/gate.yml`: added an "Install lcov" step (`sudo apt-get update && sudo
>   apt-get install -y lcov`, no prior apt-get pattern existed elsewhere in the workflows to
>   match, so this is the first one) right after "Install dependencies". The coverage step now
>   runs `bun run test:coverage` instead of the inline `bun test src ...` one-liner. The
>   100%-threshold check's `FUNCS_PCT`/`FNF`-based branch is removed entirely; only the
>   `LINES_PCT`/`LF`-based check remains, per Functional Requirement 4. The completeness check
>   (`grep ^SF:` vs `git ls-files`) was left untouched, as instructed — verified below that it
>   still works unchanged against the new merged file's shape.
>
> **Verified locally:**
> - `bun run typecheck` and `bun run lint` both clean.
> - Ran the orchestrator directly (`bun run test`): all 121 test files pass, ~8.4s wall time
>   locally (14 cores).
> - Failure-aggregation sanity check: temporarily broke one assertion in
>   `src/tui/keys.test.ts`, reran `bun run test` — orchestrator correctly reported
>   `FAIL  src/tui/keys.test.ts`, printed its captured stdout showing the specific failing
>   expectation, summarized `120/121 passed`, and exited nonzero. Reverted immediately after.
> - `bun run test:coverage`: all 121 files pass, `coverage/lcov.info` is produced and merged
>   correctly via the real `lcov` CLI (confirmed `lcov --summary` output and a manual awk sum
>   of `LH`/`LF` records agree at 12951/12979 = 99.78%).
> - Extracted gate.yml's exact `LINES_PCT` awk logic and completeness-check `comm` logic and
>   ran both directly against the orchestrator's merged `coverage/lcov.info` — both run
>   without error, i.e. the logic itself is compatible with the new merged-file shape.
> - **Important finding, not a regression from this ticket:** the merged file currently shows
>   99.78% line coverage (12951/12979), not 100%, and the completeness check currently lists 5
>   files never loaded by any test (`src/agent/mcp/__fixtures__/fake-stdio-server*.ts`,
>   `src/server/agent-loop.ts`, `src/tui/types.ts`, `src/web/client/main.ts`). I confirmed by
>   also running the *old* shared-process command directly
>   (`bun test src --coverage --parallel=1 --coverage-reporter=lcov --coverage-reporter=text`)
>   on this same tree and diffing its `coverage/lcov.info`: it produces the **exact same**
>   99.78% total and the **exact same** 5 missing files. So this gap is pre-existing on this
>   branch, unrelated to and unmasked-by the isolation change — the old shared-process gate
>   would fail on this tree too, for the same reason. Not something this ticket's scope covers
>   fixing (it's about the *mechanism*, not closing pre-existing coverage gaps); flagging for
>   the coordinator/CI to be aware of, since the gate will fail on this line either way until
>   those gaps are closed by whichever domain owns the affected files.
> - `bun run e2e`: 38/38 pass, unaffected by this change, as expected.
>
> **Not verified (per the ticket's own caveat, cannot be verified locally):** whether the
> "Cannot access 'Yoga' before initialization" Ink/yoga-layout crash is actually fixed. That
> can only be proven by a real GitHub Actions CI run — local greenness here does not
> constitute evidence either way. Coordinator: please push and watch real CI per the
> recommended sequencing above before moving this ticket past `implementing`.
>
> **Judgment calls:**
> - Used `Bun.glob`/`Glob` (Bun's built-in) rather than a third-party glob package, matching
>   the "Bun runtime/toolchain, TypeScript throughout" stack constraint (CLAUDE.md §2) and
>   avoiding a new dependency for a one-line enumeration.
> - `--coverage-dir` per file is sanitized as `file/path.test.ts` → `file__path.test.ts` (slash
>   → double-underscore) to keep one flat, readable `coverage/parts/` tree rather than nesting
>   directories that mirror `src/`'s structure.
> - No existing apt-get pattern existed in `.github/workflows/` to match for the lcov install
>   step, so I used the straightforward `sudo apt-get update && sudo apt-get install -y lcov`
>   form suggested directly in the ticket text.
