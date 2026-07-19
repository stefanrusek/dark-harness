---
spile: ticket
id: DH-0178
type: bug
status: draft
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

