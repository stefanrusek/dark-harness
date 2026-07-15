# Handoff: CI / Release

**Addressed to:** the CI/Release domain lead.
**Owner directory:** `.github/workflows/` (per `CLAUDE.md` §3).
**Status:** OPEN — first round.

---

## Context

Read `CLAUDE.md` §5 (gates) and `HANDOFF.md` §10–11 before starting. This domain wires the
gate commands already defined in `package.json` into GitHub Actions, and sets up the
tag-driven cross-compiled release pipeline.

You do not need every other domain's code to be finished to build the workflow files
themselves — the gate commands (`bun run typecheck` / `lint` / `test:coverage` / `e2e`)
already exist and run cleanly against the current scaffold. Wire the YAML now; it'll just
have more to check as other domains land.

## Scope

1. **CI workflow** (on PRs and pushes to `main`):
   - `bun install --frozen-lockfile`
   - `bun run typecheck`
   - `bun run lint`
   - `bun run test:coverage` — must fail the build if coverage drops below 100% on
     changed/new code (Bun's coverage reporter output — check `bun test --coverage`'s exit
     behavior/flags for a hard threshold, or post-process its output; document whichever
     approach you use).
   - `bun run e2e` (once the E2E domain lands real e2e tests — until then this step running
     against an empty/near-empty `e2e/` suite is fine, don't block CI setup on it).
   - Run on a matrix if needed for cross-platform confidence, but keep it simple for v0.1 —
     Ubuntu runner is sufficient for the gate; cross-compilation is a separate release-time
     concern (below).

2. **Release workflow** (triggered on `v*` tag push):
   - Run the full gate (same as CI).
   - Cross-compile Bun binaries via `bun build --compile` for: linux-x64, linux-arm64,
     macos-x64, macos-arm64, windows-x64 (`--target` flag per platform — check current Bun
     cross-compile target names, they're versioned).
   - Generate a changelog from conventional commits (a GitHub Action for this is fine —
     pick a maintained one, document your choice).
   - Attach binaries + changelog to a GitHub Release.
   - Publish to npm so `bunx dark-harness` works — this needs `NPM_TOKEN` as a repo secret;
     **you do not have the authority to create or set that secret** — note in your status
     log that it's required and route the actual secret-provisioning to the owner. The
     workflow should reference `secrets.NPM_TOKEN` and fail clearly if it's absent, not
     silently skip publishing.

## Constraints

- Stay inside `.github/workflows/`. If a gate command itself needs to change (e.g. a new
  script in `package.json`), that's a request to the coordinator, not a silent edit —
  `package.json` scripts are effectively part of the shared contract other domains rely on.
- Don't touch repo settings (branch protection, required-checks configuration) — that's
  owner authority (`CLAUDE.md` §6), not something a workflow YAML file does anyway, but flag
  in your status log if you think a required-check rule should be turned on once this
  workflow exists.

## Gates

This domain's own "gate" is: the workflow YAML is syntactically valid and, when run against
the current repo state, actually executes the intended steps (dry-run reasoning is
acceptable if you can't literally trigger a GitHub Actions run from here — say so).

## Definition of done (this round)

- `.github/workflows/ci.yml` exists, runs on PR/push to `main`, wired to the real gate
  commands.
- `.github/workflows/release.yml` exists, triggered on `v*` tags, does the cross-compile +
  GitHub Release + npm publish sequence, with the `NPM_TOKEN` gap called out explicitly.
- Status log states what's simulated/unverified vs. what you could confirm actually runs.

## Status log

_(Append dated entries here. Status supersedes.)_

### 2026-07-15 — Nightingale (CI/Release domain lead) — first round complete

**Housekeeping note first:** my worktree branch (`worktree-agent-afe0e7157d12a4287`) was
created before the bootstrap/handoff commits (`13d3d89`, `a975c25`) landed on the
coordinator branch — I only had `HANDOFF.md`/`METHODOLOGY.md`/`LICENSE` at session start,
no `CLAUDE.md`, no `docs/`, no `src/`. It was a clean fast-forward (my branch was a strict
ancestor of `claude/coordinator-onboarding-kab9ls`), so I fast-forwarded to `8a2bffd` before
starting. Flagging in case the worktree-provisioning step needs a fix so future leads don't
start from a stale base.

**What I built** (all inside `.github/workflows/`, as scoped):

- `gate.yml` — reusable workflow (`on: workflow_call`) with the actual gate logic:
  checkout, `oven-sh/setup-bun@v2` pinned to `1.3.11` (the version I tested against),
  `bun install --frozen-lockfile`, typecheck, lint, coverage, coverage-completeness, e2e.
  `ci.yml` and `release.yml` both call it so the two paths can't drift apart.
- `ci.yml` — triggers on `pull_request` and `push` to `main`, calls `gate.yml`.
- `release.yml` — triggers on `v*` tag push. Jobs: `gate` (calls `gate.yml`) →
  `build` (5-way matrix, cross-compiled from a single `ubuntu-latest` runner) →
  `release` (changelog + `gh release create`) → `publish-npm` (`bun publish`).

**Coverage hard-gate — two-layer design, both verified locally against this repo:**

1. `bun test src --coverage` does not itself fail the process below 100% (it just
   reports). Bun's own hard-threshold mechanism is a `bunfig.toml` `coverageThreshold`
   entry, but that file lives at repo root, outside `.github/workflows/`, and the handoff
   says package.json/shared-contract-adjacent changes are a request, not a silent edit —
   so instead the workflow parses the `bun test --coverage --coverage-reporter=text`
   text summary's `All files` row itself and hard-fails if functions or lines are below
   `100.00`. Confirmed both directions: passes at 100%, fails (exit 1) when I temporarily
   added an uncovered function and reverted it.
2. **Bigger finding, verified via Bun's own docs (fetched live) and reproduced locally:**
   Bun's coverage "only tracks files that are loaded" during the test run — a `src` file
   that no test imports (directly or transitively) is *silently omitted* from the report,
   not shown at 0%. I proved this against the real repo: `src/contracts/{commands,config,
   events,index,log}.ts` currently have **zero test coverage** and don't appear in bun's
   coverage table at all, yet `bun test src --coverage` reports "100.00% / 100.00%"
   because the only existing test (`exit-codes.test.ts`) only imports `exit-codes.ts`.
   So the naive threshold check alone would let CI go green with untested files sitting
   in `src/` indefinitely — a real hole in the "100% coverage is a gate, not a target"
   invariant (CLAUDE.md §5). I closed this **within my own directory** by adding a second
   gate step that diffs the set of files bun's coverage table actually lists against every
   real file under `src/` (via `git ls-files`) and hard-fails listing anything missing.
   **Consequence: this makes CI red right now** against the current repo state (those 5
   contracts files), and I checked — no current domain handoff (`core.md`, `server.md`,
   `tui.md`, `web.md`, `prompt-docs.md`) tasks anyone with testing `src/contracts/`
   itself; it's referenced everywhere as "already landed," imported but not tested.
   I did **not** add a test file there myself (outside my scope — contracts changes need
   architect sign-off per CLAUDE.md §6, and even a test-only addition is someone else's
   directory). **Verified, concrete one-file fix**, in case it helps whoever picks this
   up: a single `src/contracts/index.test.ts` that imports `./index.ts` (the barrel that
   re-exports everything) and asserts something trivial makes all 6 files show
   100%/100% — I tested this exact fix locally and confirmed it, then reverted it before
   committing. **Requesting the coordinator route this** — either a quick add to an
   existing domain's queue, or its own line item — rather than me forking into
   `src/contracts/`.

**Changelog generation — chose a hand-rolled script over a third-party action.** The
handoff allows either ("a GitHub Action for this is fine — pick a maintained one" or
implicitly, generate it yourself). I could not verify a third-party action's default
config/behavior without a live Actions run, so I wrote and **tested a small
awk/bash script directly against this repo's real git history** (including the
discovery that none of the 5 existing commits actually use Conventional Commits syntax —
worth the fleet adopting that discipline going forward for the changelog to bucket
usefully). It groups `feat/fix/perf/refactor/docs/test/build/ci/chore/revert` commits
into sections and puts everything else under "Other Changes" so the notes are never
empty even before that discipline is adopted. Verified: first-release case (no prior
tag), tagged-range case, and conventional-commit grouping including a `feat!:` breaking
-change prefix — all produced correct output in local test runs (transcripts in my
session, not persisted as files).

**Cross-compilation — verified for real, not just reasoned about.** `bun build --compile
--target=<t>` for `bun-linux-x64`, `bun-linux-arm64`, `bun-darwin-x64`, `bun-darwin-arm64`,
`bun-windows-x64` all succeeded locally against a trivial entrypoint on this (linux-x64)
machine — Bun downloads the needed cross-compile toolchain on demand, so the release
matrix doesn't need per-OS runners. Also confirmed Bun doesn't double-append `.exe` if
the `--outfile` already ends in `.exe`. `./src/cli.ts` doesn't exist yet (Core domain not
landed), so the actual compile-the-real-entrypoint step is unverified against real
content — only the target-flag mechanics are proven.

**npm publish — verified packaging mechanics, flagged a real packaging-shape gap.**
`bun publish --dry-run` against the current `package.json` (with a placeholder
`dist/dh`) packs correctly. Confirmed `bun publish` respects `${NPM_TOKEN}`
interpolation in a `.npmrc` written at publish time (`//registry.npmjs.org/:_authToken=
${NPM_TOKEN}`), which is the mechanism the workflow uses. **Known v0.1 limitation,
flagged rather than fixed:** `package.json`'s `bin` field points at a single binary, so
as configured the published npm package only contains the **linux-x64** build —
`bunx dark-harness` won't work on macOS/Windows via npm (the GitHub Release binaries are
fine on all 5 platforms; only the npm path is narrowed). Real fix is a packaging-shape
decision (per-platform `optionalDependencies` packages à la esbuild/swc, or a postinstall
downloader hitting the GitHub Release assets) that touches `package.json`, outside
`.github/workflows/` — flagging as a request to Core/the coordinator, not forking it.

**NPM_TOKEN — owner-authority gap, as instructed.** `release.yml`'s `publish-npm` job
references `secrets.NPM_TOKEN` and has an explicit early step that fails loudly
(`::error::`) with a clear message if the secret is absent, rather than silently
skipping the publish step. I do not have (and did not attempt to get) authority to
create or set that secret. **Action needed from the owner:** add an npm automation
token as the `NPM_TOKEN` repository secret before the first tag push, or the
`publish-npm` job will fail (loudly, on purpose) every time.

**What I could not verify (no live Actions run possible from this environment, per
session instructions):**
- The workflows have never actually executed on GitHub Actions. Verification here is:
  YAML syntax (`python3 -c "yaml.safe_load(...)"` on all three files — pass), and
  `actionlint` (a Go-based, GitHub-Actions-schema-aware linter, including `shellcheck`
  over every embedded `run:` script) — **installed fresh in this session** (`go install
  github.com/rhysd/actionlint@latest` + `apt-get install shellcheck`) and run against
  all three files: **zero findings** after fixing one real `shellcheck` hit (`SC2035`,
  an unglobbed `cat *.sha256`, fixed to `cat -- *.sha256`).
- Action versions (`actions/checkout@v4`, `oven-sh/setup-bun@v2`, `actions/upload-
  artifact@v4`, `actions/download-artifact@v4`) are pinned to **major version floating
  tags** I'm confident exist and are stable, based on training knowledge as of ~Jan 2026.
  I attempted to verify current versions via `WebFetch` against each project's GitHub
  releases page; results were inconsistent/self-contradictory in places (e.g. a claimed
  `actions/checkout@v7` release dated 2024, which doesn't add up) — small-model page
  summarization artifacts, not something I could trust for exact pins. I did not use
  `gh`/GitHub API directly (session's proxy returned 403 — "GitHub access to this
  repository is not enabled for this session"). Recommend the owner/coordinator either
  spot-check these before the first real release, or add Dependabot for
  `github-actions` (a `.github/dependabot.yml` file — outside my directory, flagging
  rather than adding it).
- `gh release create` and `bun publish` (the real, non-dry-run paths) are unverified —
  no repo/registry credentials in this environment, and both would have real side
  effects I'm not authorized to trigger anyway.
- The e2e step is a deliberate no-op today (`e2e/` doesn't exist) and self-activates
  once the E2E domain lands `*.test.ts`/`*.spec.ts` files — untested in its "real e2e
  suite present" branch since no such files exist yet.

**Not done / explicitly out of scope, per the handoff's constraints:**
- Did not touch `package.json` (coverage threshold, npm packaging shape) or repo settings
  (branch protection / required checks) — both flagged above as requests.
- Did not create/set the `NPM_TOKEN` secret (owner authority).
- Recommend once this workflow exists and CI has run green at least once: turn on
  required-status-checks for the `Gate` check on `main` (branch protection) — owner
  authority, not something I can or should set myself.

### 2026-07-15 — Nightingale (CI/Release domain lead) — resumed, verified, committed

I am a fresh instance of this named role, picking up where the prior instance above was
stopped mid-task (uncommitted work sitting in the worktree, never committed). Status
supersedes: everything above this entry is accurate and I am not redoing it — I read it,
independently re-verified the load-bearing claims against the actual worktree (not just the
prose), and am now committing that work as-is (no code changes to the three workflow files).

**Independent re-verification performed this round (all against this worktree's real
state):**
- `actionlint` v1.7.12 (built from the Go module cache already present in the session)
  against all three workflow files: zero findings, matching the prior instance's claim.
- `python3 -c "yaml.safe_load(...)"` on all three files: parses clean.
- Reproduced the coverage-completeness finding by hand: `bun test src --coverage
  --coverage-reporter=text` reports `100.00%/100.00%` while only listing
  `src/contracts/exit-codes.ts` in its table; ran the gate step's own awk/comm logic
  against that output and confirmed it correctly flags `commands.ts`, `config.ts`,
  `events.ts`, `index.ts`, `log.ts` as missing. This is a real, currently-red gate against
  the repo as it stands — not fixed by anything that has landed elsewhere since (checked:
  no `bunfig.toml` exists on `main`, this branch, or the coordinator's current branch tip).
- `bun run typecheck` and `bun run lint`: both pass clean.
- Spot-checked cross-compilation (`bun build --compile --target=bun-windows-x64` against a
  throwaway entrypoint): succeeded. I did not re-run all 5 targets myself — trusting the
  prior instance's claim to have verified all 5, on top of my one spot check.

**Branch currency — flagged, not fixed by me.** This worktree branch
(`worktree-agent-afe0e7157d12a4287`) is now several commits behind
`claude/coordinator-onboarding-kab9ls`: the Server domain (Radia), Prompt domain (Iris),
and the CLAUDE.md §7 agent-memory/roster convention have all landed there since my branch's
base commit. I confirmed (`git diff --stat` against the coordinator tip, read-only) that
none of those commits touch `.github/workflows/` or this file, so there's no textual
conflict — but merging other domains' work into my branch is outside my directory ownership
(`.github/workflows/` only) and a scope escalation beyond this handoff; the session's
permission layer independently declined my one attempt at it, on that same reasoning. I
instead read the new §7 convention read-only (`git show
claude/coordinator-onboarding-kab9ls:CLAUDE.md`) to follow it for my own roster file
without merging code. **Requesting the coordinator (reconciler of record, per
`METHODOLOGY.md` §6) merge/rebase this branch onto the current tip** when integrating it —
I deliberately left that operation to them rather than doing it myself.

**Roster file created:** `docs/roster/nightingale.md`, per the new §7 convention — durable
identity-level notes (judgment calls, open threads) that don't belong in this per-round
status log. Read that alongside this entry if resuming this role again.

**One thing flagged, not investigated further:** partway through this round a message
appeared inline inside a tool result (not as an actual coordinator turn) directing me to
rework "SSE/EventSource" wiring against a bearer-token ADR amendment. That's Web-domain
work; nothing in `.github/workflows/` touches SSE or EventSource, and I made no code
changes in response to it. Noting it here for the record in case it recurs.

**No changes made to the three workflow files themselves this round** — the prior
instance's implementation and reasoning held up under my independent checks. Everything
listed as unverified/blocked in the entry above (live Actions run, `gh release create`,
`bun publish` real path, action-version pin currency, `NPM_TOKEN`) remains exactly as
unverified/blocked as stated there; nothing in this session changed that.

— Nightingale (she/her), CI/Release domain lead

— Nightingale (she/her), CI/Release domain lead

---

## Round 2 — OPEN — use scripts/build.ts to stamp real builds

**Addressed to:** CI/Release (Nightingale, resumed — read `docs/roster/nightingale.md` first).

Core's Round 8 (just landed) added `scripts/build.ts` — a wrapper around `bun build
./src/cli.ts --compile` that stamps real build identity (git SHA, dirty flag, release tag)
into the compiled binary via `--define`, feeding the new `client`/`build` fields on the JSONL
log header (ADR 0005's amendment). Verified working: `bun scripts/build.ts` produces a
binary whose `--version` flag and log headers show the real git SHA.

**Fix:** update `release.yml`'s compile step to invoke `bun scripts/build.ts
--target=<matrix-target> --outfile dist/<artifact> --release-tag "${{ github.ref_name }}"`
instead of calling `bun build --compile` directly. `github.ref_name` is the tag name (e.g.
`v0.1.0`) on a `v*`-triggered workflow — `scripts/build.ts` validates it starts with `v` and
exits 2 otherwise, so this should just work, but confirm against the workflow's actual
trigger context. `git rev-parse HEAD` works on a shallow checkout (the default `actions/
checkout` behavior), so no `fetch-depth` change should be needed — but verify this rather
than assume it, since a shallow clone's exact HEAD-reachability can vary.

**Gates:** the standard three (`typecheck`/`lint` are unaffected — this is a workflow YAML
change, not `src/`). Since you can't run a real GitHub Actions workflow from here, verify
what you can locally: run `bun scripts/build.ts --target=<a-real-target> --outfile
/tmp/dh-test --release-tag v9.9.9-test` by hand and confirm the resulting binary's
`--version` output shows `v9.9.9-test` as the release tag, mirroring exactly what the
workflow will invoke. Append a dated status entry here and update
`docs/roster/nightingale.md` when done.

---

## Round 2 — CLOSED — 2026-07-15 (Nightingale)

Done, with one correction to the fix as specified above: **the `=` form of the flag
(`--target=<value>`) does not work with `scripts/build.ts`.** Its hand-rolled `parseArgs`
only recognizes `--target` as a standalone argv token followed by a separate value token
(`if (arg === "--target") { i += 1; target = argv[i]; }`) — `"--target=bun-linux-x64"` never
matches that exact-equality check, so `target` stays `undefined` and bun silently falls back
to a host-arch build. I caught this only by actually running the command locally and
checking the output binary's format (`file`), not by reading the script: my first attempt
(`bun scripts/build.ts --target=bun-linux-x64 --outfile /tmp/dh-test ...`) on this
arm64 Mac produced a native **Mach-O arm64** executable instead of the requested Linux ELF
x86-64 — it "succeeded" (exit 0, plausible-looking log line) with no error, which is exactly
the kind of silent failure that would have shipped 5 identical host-arch-labeled release
artifacts had I only checked exit codes. Re-running with the space-separated form
(`--target bun-linux-x64`) produced the correct `ELF 64-bit LSB executable, x86-64 ...`
binary. Filed this as a one-line comment directly above the `run:` step in `release.yml` so
nobody "simplifies" it back to `=` later; did not touch `scripts/build.ts` itself since
`scripts/` is Core-owned (CLAUDE.md §3) and the space-separated form is a fully valid,
unambiguous way to invoke the script as written — this is a call-site fix, not a script bug
fix, so no cross-domain request is needed. Flagging here anyway in case Core wants to make
`parseArgs` accept `=` too for ergonomics; not blocking.

**What changed:** `.github/workflows/release.yml`'s `Compile ${{ matrix.target }}` step now
runs `bun scripts/build.ts --target ${{ matrix.target }} --outfile dist/${{ matrix.artifact
}} --release-tag "${{ github.ref_name }}"` instead of calling `bun build --compile`
directly, so every release artifact gets real build-identity stamping (git SHA, dirty flag,
release tag) per ADR 0005's amendment.

**Verification performed (this worktree, after fast-forwarding onto the coordinator branch
tip to pick up Core's round 8 — my branch was several commits stale, see
`docs/roster/nightingale.md` for that reconciliation):**
- `bun run typecheck` and `bun run lint`: both pass clean (workflow-YAML-only change,
  `src/` untouched).
- `python3 -c "import yaml; yaml.safe_load(...)"` (via `pip install --break-system-packages
  pyyaml`, since a bare `pip3 install pyyaml` hit an externally-managed-environment error in
  this sandbox) on `release.yml`: parses clean. `actionlint` was not available in this
  worktree (no Go module cache present here, unlike the round-1 session) — recommend a spot
  check with it before the first real release if it's available in whichever environment
  runs that check next.
- `bun scripts/build.ts --target bun-linux-x64 --outfile /tmp/dh-test --release-tag
  v9.9.9-test`: exit 0, log line `scripts/build.ts: stamped build /tmp/dh-test
  (037952c570ae, dirty, v9.9.9-test)`, `file /tmp/dh-test` reports a genuine Linux
  x86-64 ELF binary (bun downloaded the cross toolchain on demand, matching the existing
  workflow comment's claim).
- `bun scripts/build.ts --outfile /tmp/dh-test-host --release-tag v9.9.9-test` (host target,
  so it actually runs here): `/tmp/dh-test-host --version` printed `dh 0.1.0
  (037952c570aef8ceae8db0ff46102dd5ceaed6d4 dirty, v9.9.9-test)` — confirms the release tag
  and git SHA both make it end-to-end into the running binary's `--version` output, which is
  the load-bearing claim of this round.
- Confirmed the shallow-checkout claim rather than assuming it: `git clone --depth 1
  --branch <this-worktree-branch> file:///...` (forcing a real shallow clone, since Bun/git
  silently ignores `--depth` on same-filesystem local clones) — `git rev-parse HEAD` and
  `git status --porcelain` both work fine against the resulting single-commit shallow repo,
  matching what `actions/checkout@v4`'s default (no `fetch-depth: 0`) produces on the
  `build` job. No `fetch-depth` change needed, as the round-2 note suspected.
- `git diff --stat` against the fast-forwarded base shows exactly one file changed
  (`.github/workflows/release.yml`, +8/-1) — no accidental scope creep from the
  fast-forward merge.

**Open threads unchanged from round 1** (still true, re-checked file-level, not re-verified
line-by-line this round): coverage-completeness gate still red pending Contracts-domain
fix (not mine to make); action version pins still unverified live; `NPM_TOKEN` secret still
absent; npm package still linux-x64-only. See `docs/roster/nightingale.md` round-1 entry for
detail on each.

— Nightingale (she/her), CI/Release domain lead

## Round 3 (2026-07-15) — DH-0030, DH-0032, DH-0036: structured gates, real-runner smoke tests, container reference

Fresh instance, resuming this name. Worked three tickets already in `implementing`, all
verified against the actual repo/live tools rather than trusting the ticket prose, and all
closed at the end. Full detail below; identity-level residue lives in
`docs/roster/nightingale.md`.

**Branch currency:** worktree HEAD was exactly `git merge-base HEAD
claude/coordinator-onboarding-kab9ls` (zero unique local commits — the same "safe
fast-forward" situation round 2 first distinguished from round 1's real-merge case), so
`git merge --ff-only` onto the coordinator tip was clean and unambiguous. That pulled in a
large amount of other-domain work (Contracts tests, tracking/ tickets, etc.) that had
landed since this worktree's creation, none of it conflicting with `.github/workflows/`.

### DH-0030 — coverage/completeness/e2e gates: structured checks, not text-parsing / fail-open

`gate.yml`'s coverage and completeness steps used to `grep`/`awk` bun's printed ANSI
summary table (`All files | 100.00 | 100.00 |`) and its per-file path column — a format
bun could reflow on any version bump without warning. The e2e step auto-detected test
files and downgraded to `::notice` (not a failure) if none were found — reasonable while
`e2e/` was still empty, but fails *open* if it were ever emptied again by accident.

**What changed:**
- Coverage step now runs `bun test src --coverage --coverage-reporter=lcov
  --coverage-reporter=text` (keeping `text` too, for a human-readable log) and sums
  `FNH`/`FNF`/`LH`/`LF` across every `SF:` record in `coverage/lcov.info` with `awk`,
  computing the percentage itself rather than string-comparing a formatted percentage in
  the printed table.
- Completeness step now diffs the `SF:` file list from the same `coverage/lcov.info`
  against `git ls-files 'src/**/*.ts'` (minus test/`.d.ts` files) — same structured source,
  no printed-table parsing.
- E2E step now fails closed: it counts `e2e/*.test.ts`/`*.spec.ts` files first and hard
  errors (`exit 1`) if the count is zero, *then* runs `bun run e2e` — no more silent
  `::notice` downgrade path.
- Flagged, not fixed (both real, both outside `.github/workflows/`): CLAUDE.md §5 states
  the gate is "new/changed code" scoped but the step (inherited, unchanged in this
  respect) has always enforced 100% repo-wide — CLAUDE.md is coordinator-owned law, not
  something this domain edits unilaterally to match its own gate's actual behavior.

**Verification actually performed, not assumed:**
- Ran `bun test src --coverage --coverage-reporter=lcov --coverage-reporter=text` for real
  in this worktree (bun 1.3.14) and hand-executed the exact awk/comm pipeline from the new
  workflow steps against the real `coverage/lcov.info`, not just read the YAML.
- **Found the gate is currently red against real repo state, structurally** — not a
  regression from this change, and not mine to fix (both are other domains' files):
  - Coverage: `src/cli.ts` reports `FNH:38 FNF:39` in lcov (one uncovered function) — total
    function coverage is 459/460 = 99.78% (the old text-summary line agreed: `All files |
    99.96 | 100.00 |`, since 99.96% ≠ 100.00% too — so this isn't a new failure my rewrite
    introduces, both old and new correctly redden the gate here; Core-owned file, flagged
    not fixed).
  - Completeness: `src/prompt/index.ts`, `src/server/agent-loop.ts`, `src/tui/types.ts`,
    `src/web/client/main.ts` never appear in any `SF:` record — no test imports them
    (directly or transitively). Prompt/Server/TUI/Web-owned respectively; flagged not
    fixed.
  - (Round 1's originally-flagged `src/contracts/*.ts` gap has since been closed by
    whichever round added `src/contracts/index.test.ts` — confirmed those files now do
    appear with real `FNF`/`LF` counts, or `0/0` for the two files that are pure
    interface/type declarations with no runtime lines to cover.)
  - **This means `gate.yml` will currently fail a real CI run** until Core/Prompt/Server/
    TUI/Web add the missing test coverage — not something I can fix from
    `.github/workflows/`, but worth surfacing loudly rather than only in a workflow
    comment, since it blocks any real PR/release right now.
- `python3 -c "import yaml; yaml.safe_load(...)"` on `gate.yml`/`release.yml`/`ci.yml`: all
  three parse clean. `actionlint` unavailable in this session (no cached Go module build);
  same caveat round 2 flagged — recommend a pass by whoever next has it available.
- `bun run typecheck` / `bun run lint`: both clean.

### DH-0032 — real-runner smoke tests before release, on the actual shipped artifact

All 5 release targets were cross-compiled from a single `ubuntu-latest` runner with zero
execution anywhere in CI; the windows-x64/darwin-x64/darwin-arm64 binaries specifically
were never run on a matching real OS before shipping.

**What changed:** added a `smoke-test` job to `release.yml`, between `build` and `release`
(so `release` now `needs: smoke-test` instead of `needs: build` directly — a broken
cross-compiled binary now blocks the GitHub Release from being cut at all). One matrix
entry per released target, each on a GitHub-hosted runner matching that target's actual
OS/arch: `dh-linux-x64`→`ubuntu-latest`, `dh-linux-arm64`→`ubuntu-24.04-arm`,
`dh-darwin-x64`→`macos-13` (Intel), `dh-darwin-arm64`→`macos-latest` (Apple Silicon),
`dh-windows-x64.exe`→`windows-latest`. Each step downloads that target's actual `build`-job
artifact (`actions/download-artifact`, same artifact the `release` job later attaches to
the GitHub Release) and runs `dh --version`, asserting non-empty output and exit 0 — so
this satisfies the ticket's explicit functional requirement ("exercises the actual artifact
intended for release, not a separately-built native-host binary"), not just "some binary
built the same way."

**Verification actually performed:**
- Could not spin up a live `windows-latest`/`macos-13` GitHub Actions runner from this
  session — no `gh`/Actions API access here either, same constraint round 1 hit. What I
  *could* and did verify live, in this worktree (linux/arm64 host):
  - Built a real stamped binary via the exact command the `build` job runs
    (`bun scripts/build.ts --outfile /tmp/dh-smoke-check --release-tag
    v0.0.0-smoketest`), then ran the *exact* Unix smoke-test step's logic against it by
    hand: `chmod +x`, capture `dh --version` output, assert non-empty — got `dh 0.1.0
    (033dc7517bfc8... dirty, v0.0.0-smoketest)`, exit 0. This is the same shape of command
    the `smoke-test` job's Unix branch runs, just not on the specific hosted-runner labels.
  - `python3 -c "import yaml; yaml.safe_load(...)"` on the edited `release.yml`: parses
    clean, including the matrix `include:` block and the `pwsh`-conditional Windows step.
  - Read `runner.os` conditional semantics against GitHub's documented context
    (`runner.os == 'Windows'`) rather than assuming syntax — this session couldn't execute
    a `pwsh` step live, so the Windows branch is verified by careful reading + YAML
    parsing, not by execution. **Flagging for whoever next has live Actions access:** spot
    check the Windows smoke-test branch specifically on a real run before depending on it.
  - `ubuntu-24.04-arm` and `macos-13` are GitHub-hosted runner labels current as of this
    session's training/knowledge, not independently re-verified against GitHub's live
    runner-images list (no network access to GitHub's docs from this sandbox). If either
    label has since been deprecated/renamed, the job will fail loudly with an "unknown
    runner" error rather than silently skip — acceptable degradation, but worth a
    live-environment spot check before the next real tagged release.

### DH-0036 — reference Dockerfile and container/deployment doc

No shipped Dockerfile, base-image guidance, or deployment doc existed despite HANDOFF.md
naming a container as the canonical dark-factory deployment.

**What changed:** added `Dockerfile` (repo root, multi-stage: `oven/bun:1.3.14` build
stage → `debian:bookworm-slim` runtime stage carrying only `bash`+`git`+`ca-certificates`,
deliberately no `tmux` since that's only an e2e test-harness dependency), `.dockerignore`,
and `docs/deployment.md` (run-mode examples for the unattended `--instructions --job` case
and the headless `--server` case, `.dh-logs` volume-mount guidance, secret-injection
patterns for both the Anthropic and Bedrock provider shapes, and a forward-reference to
DH-0011 for the still-open signal-handling gap).

**Verification actually performed — built and ran the real container, not just read the
Dockerfile:**
- `docker build -t dh-smoke:test .` — real Docker daemon was available in this session
  (unlike some prior CI/Release rounds' sandboxes). First attempt failed for a genuine
  reason I hadn't anticipated: `scripts/build.ts`'s `gitSha()` calls `Bun.spawnSync(["git",
  ...])`, which **throws** (uncaught `ENOENT`), not just returns a non-zero exit, when
  `git` isn't on PATH at all — the base `oven/bun` image doesn't ship `git`, so the build
  stage crashed outright rather than gracefully stamping "unstamped." Fixed by installing
  `git`+`ca-certificates` in the build stage too, before `bun install`.
- Rebuilt after the fix: succeeded, logged `scripts/build.ts: stamped build /out/dh
  (unstamped)` — "unstamped" because `.dockerignore` excludes `.git` from the build
  context (intentional: no reason to ship the maintainer's git history into a Docker
  build), so `gitSha()`/`isDirty()` both fail closed to their documented "not a git repo"
  fallback rather than crashing a second time. This is expected/acceptable for a
  generically-reusable reference Dockerfile, not a live CI/release build (that path is
  `release.yml`'s own cross-compile, unrelated to this Dockerfile).
- `docker run --rm dh-smoke:test --version` → `dh 0.1.0 (unstamped)`, exit 0.
- `docker run --rm dh-smoke:test` (default `CMD ["--help"]`, no args) → printed the real
  `--help` text, confirming the image is self-documenting rather than hanging or erroring
  when run bare.
- `docker run --rm --entrypoint bash dh-smoke:test -c "git --version && which bash"` →
  confirmed both `git` and `bash` are genuinely present and on PATH in the runtime image,
  not just referenced in a comment.
- Cleaned up the test image (`docker rmi dh-smoke:test`) after verification — not left in
  this session's Docker cache.
- Did not edit `README.md` to link `docs/deployment.md` — `README.md` is Prompt-domain
  owned (CLAUDE.md §3: `src/prompt/`, `README.md` → Prompt). Flagging this as a request:
  Prompt (Iris) or the coordinator should add a link from README's security-posture /
  air-gapping section to `docs/deployment.md` so it's discoverable from the doc most
  operators will actually read first.

**Gate status this round:** `bun run typecheck`/`bun run lint` clean. `coverage-report.txt`
(a scratch file the manual coverage-gate verification produced locally) was deleted before
committing — not meant to be tracked.

**Open threads for the next instance (superseding/adding to round 1-2's list):**
1. `gate.yml` will fail on a real CI run right now: `src/cli.ts` has one uncovered
   function (Core-owned) and four files (`src/prompt/index.ts`,
   `src/server/agent-loop.ts`, `src/tui/types.ts`, `src/web/client/main.ts` — Prompt/
   Server/TUI/Web-owned respectively) are never loaded by any test. Not new, not
   introduced by this round — the old text-parsing gate would have caught the coverage
   number too (99.96% ≠ 100%), just less legibly; this round's structured check makes the
   completeness gap explicit by file name. Needs each owning domain to add coverage, not
   something CI/Release can fix.
2. DH-0032's Windows/macOS smoke-test branches are verified by reading + YAML-parsing +
   an equivalent-logic dry run on Linux, not by an actual `windows-latest`/`macos-13`
   Actions run (no live Actions access in this session). Spot-check on the next real tag
   push or whenever `gh`/Actions access is available.
3. `ubuntu-24.04-arm`/`macos-13` runner labels not independently re-verified against
   GitHub's current live runner-image list.
4. README.md doesn't yet link `docs/deployment.md` — Prompt-domain request, not applied
   here.
5. Carried forward unchanged from round 1/2 (all still true, not re-verified this round):
   action version pins unverified live, `NPM_TOKEN` secret absent, npm package
   linux-x64-only.

— Nightingale (she/her), CI/Release domain lead
