---
spile: ticket
id: DH-0088
type: feature
status: verifying
owner: stefan
resolution:
blocked_by: []
created: 2026-07-16
relations:
  depends_on: []
  relates_to: []
  supersedes: []
implementation:
  - repo: dark-harness
---

# DH-0088: Update README with real download/install instructions once release binaries are cut

## Summary

The README currently documents build-from-source usage. Once real GitHub Release binaries exist (multi-platform compiled dh binaries, per the CI/Release pipeline), the README needs a proper download/install section: which binary for which OS/arch, how to verify the SHA256SUMS checksum, and how it relates to the build-from-source path (kept as an alternative, not replaced). Blocked on there actually being a real release to document -- filing now so it's not forgotten once that happens.

## User Stories

### As a new user, I want to download a prebuilt binary instead of building from source

- Given a real GitHub Release exists (per the CI/Release pipeline, `.github/workflows/release.yml`),
  when a user reads the README, then a clear "Download" section names the exact asset per
  OS/arch (linux/macos/windows, x64/arm64) and how to verify it against `SHA256SUMS.txt`.
- Given the download section exists, when a user also wants to build from source (contributing,
  or a platform without a prebuilt binary), then that path remains documented as an explicit
  alternative, not replaced or removed.

## Functional Requirements

- README gets a "Download" or "Installation" section above/alongside the existing build-from-source
  instructions, naming real release asset filenames (match whatever `release.yml` actually produces
  — don't guess the naming convention, read the workflow).
- Link to the real GitHub Releases page.

## Notes

> [!NOTE]
> Filed 2026-07-16 — blocked on an actual release existing to document; not urgent, just
> don't want it forgotten once v0.1.0 (or any real tagged release) is cut.

> [!NOTE]
> 2026-07-17: written directly (no dispatch needed -- asset names/checksum filename are
> fixed in `.github/workflows/release.yml`, read directly rather than guessed). Added a
> "Download a prebuilt binary" section to the README with a per-OS/arch table (matching the
> build matrix's exact `artifact` names), `SHA256SUMS.txt` verification commands, and an
> explicit note that `bunx dark-harness`/npm install isn't usable yet (DH-0004's multi-
> platform packages aren't published pending a rescoped `NPM_TOKEN`). Also fixed the
> build-from-source `git clone` URL, which was still the `<org>` placeholder. Left the
> build-from-source path in place as an alternative per the ticket's explicit requirement.
> Status left at `verifying` rather than `closed`: the v0.1.0-alpha.1 release itself hasn't
> successfully completed yet (blocked on DH-0145), so the Releases-page link and asset
> filenames are correct per the workflow definition but not yet confirmed against a real,
> live release. Close this out once that release actually lands and the links/downloads are
> spot-checked for real.
