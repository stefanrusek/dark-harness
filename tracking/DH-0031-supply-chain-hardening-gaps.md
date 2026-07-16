---
spile: ticket
id: DH-0031
type: feature
status: draft
owner: stefan
resolution:
blocked_by: ["deferred (owner decision 2026-07-15): no incident behind this, revisit near real release cut"]
created: 2026-07-15
relations:
  depends_on: []
  relates_to: []
  supersedes: []
implementation:
  - repo: dark-harness
---

# DH-0031: GitHub Actions supply-chain hardening gaps — actions pinned by tag, no artifact signing, no npm provenance

## Summary

**Deferred in full (owner decision, 2026-07-15).** This is speculative hardening against
threats with no observed incident behind them, for a project with no real release cadence
yet — the same category of call as DH-0040's deferred redaction story. Not implementing any
part of this now, including the mechanically cheap SHA-pin/permissions pieces. Revisit only
if/when real public releases are being cut and this becomes concretely relevant, or if a
real incident (compromised action, tampered artifact) is ever observed.

A cluster of standard supply-chain hardening gaps across `.github/workflows/`: third-party actions
(`actions/checkout@v4`, `oven-sh/setup-bun@v2`, `actions/upload-artifact@v4`,
`actions/download-artifact@v4`) are pinned to mutable tags, not immutable commit SHAs — a
compromised tag on any of these would silently execute in CI/release, including the release job
which has `contents: write` and produces the binaries end users download. Release artifacts get
SHA256 checksums but nothing signs them (no cosign/Sigstore/GPG) — a checksum alone doesn't prove
provenance if the release itself or an intermediate download is tampered with. The npm publish
step has no `--provenance` flag and no `id-token: write` permission, so it can't produce an npm
provenance attestation even in principle. `ci.yml`/`gate.yml` also lack an explicit
`permissions: contents: read` block (unlike `release.yml`, which scopes correctly), leaving them
on whatever the repo/org default `GITHUB_TOKEN` permission is.

## User Stories

### As a user downloading a released binary, I want cryptographic proof of provenance beyond a checksum alone

- Given a GitHub Release, when binaries and `SHA256SUMS.txt` are published, then they are also
  signed (cosign keyless signing or GPG), with the verification method documented in the README.

### As a maintainer, I want every workflow to declare least-privilege permissions explicitly

- Given `ci.yml` and `gate.yml`, when they run, then they declare `permissions: contents: read`
  explicitly rather than relying on the repo/org default.

## Functional Requirements

- Given the npm publish job, when provenance is added, then it sets `id-token: write` and passes
  `--provenance` (or bun's equivalent) so consumers can verify build provenance via npm.

## Notes

> [!NOTE]
> Source: CI/Release/E2E sweep findings #4, #5, #8, #9, #12.

> [!NOTE]
> Owner decision (2026-07-15): deferred in full, no partial/cheap-fix carve-out. This is
> speculative defensive hardening (AI-agent-analysis-sourced, no real incident behind it) for
> a project not yet cutting real releases — same category of call as DH-0040's deferred
> redaction story. Revisit if a real incident is observed or the project starts cutting
> public releases people actually rely on.
