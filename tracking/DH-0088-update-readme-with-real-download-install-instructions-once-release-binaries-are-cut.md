---
spile: ticket
id: DH-0088
type: feature
status: draft
owner: stefan
resolution:
blocked_by: ["waiting on a real release/binary to exist before this can be written accurately"]
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
