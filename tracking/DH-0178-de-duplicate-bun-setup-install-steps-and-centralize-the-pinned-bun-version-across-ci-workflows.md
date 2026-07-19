---
spile: ticket
id: DH-0178
type: bug
status: implementing
owner: stefan
resolution:
blocked_by: []
created: 2026-07-18
relations:
  depends_on: []
  relates_to: []
  supersedes: []
implementation:
  - repo: dark-harness
---

# DH-0178: De-duplicate Bun setup/install steps and centralize the pinned bun-version across CI workflows

## Summary

The checkout+setup-bun+install triplet and the hardcoded bun-version 1.3.14 are repeated across gate.yml and release.yml.

## Domain / owner

CI/Release — .github/workflows/ (Nightingale)

## User Stories

_To be written at `refining` (draft filed by refactoring round DH-0169)._

## Notes

Filed by Fable during refactoring round DH-0169.

The `Checkout` + `Set up Bun (bun-version: "1.3.14")` + `Install (--frozen-lockfile)`
triplet is repeated in `gate.yml:51-62` and twice in `release.yml` (59-65, 295-301), and
`"1.3.14"` is hardcoded in 4 places that a `gate.yml:55` comment admits must be kept in
sync with `bun.lock` by hand. Centralize via a composite action or a single pinned source.

Not a finding: the DH-0030 coverage-gate parsing fragility is already remediated
(gate.yml:107-201 uses structured lcov records). The remaining awk in `release.yml:212-251`
is inherent to hand-rolled changelog generation and lower priority.

**Routing note (NOT filed as new):** the separate finding that third-party actions are
pinned to mutable tags (`@v4`/`@v2`) rather than commit SHAs is **already covered by open
ticket DH-0031** (supply-chain hardening, which explicitly names the SHA-pin piece). Left
there; do not duplicate.

### 2026-07-18 — implementation

Added `.github/actions/setup-bun-and-install/action.yml`, a composite action wrapping the
`Checkout` + `Set up Bun` + `Install dependencies` triplet, with the bun-version pin as a
single default input (`"1.3.11"`, matching this worktree's current pin — was 1.3.11 at the
time this worktree's `gate.yml`/`release.yml` were branched; the pin the coordinator's
shared branch actually carries may differ and should be reconciled at merge time). Replaced
all three call sites — `gate.yml`'s `gate` job, `release.yml`'s `build` job, and
`release.yml`'s `publish-npm` job — with a single `uses:
./.github/actions/setup-bun-and-install` step in the same step-list position each triplet
previously occupied. `release.yml`'s `release` job's plain `actions/checkout@v4` (with
`fetch-depth: 0`/`fetch-tags: true`, no Bun setup) was left untouched — it isn't part of the
triplet this ticket targets. Verified: `yaml.safe_load` parses all three touched YAML files
cleanly, and a step-by-step diff confirms no reordering or removed steps, only the triplet
collapsing to one step per call site.

**Verification gap — flagging explicitly, not proven:** this is CI *config*; the only way to
truly prove a composite action resolves and runs correctly (action checkout path, input
defaults, `oven-sh/setup-bun@v2` receiving the input correctly, `bun install
--frozen-lockfile` running with the right cwd) is a real GitHub Actions run. That can't be
triggered from this isolated worktree. Leaving this ticket at `implementing` (not `closed`)
for exactly that reason — the coordinator should merge this commit onto the shared branch,
let a real `gate`/`release` workflow run execute against it, confirm green, and only then
close DH-0178.

