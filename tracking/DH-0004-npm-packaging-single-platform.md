---
spile: ticket
id: DH-0004
type: feature
status: ready
owner: stefan
resolution:
blocked_by: []
created: 2026-07-15
relations:
  depends_on: []
  relates_to: []
  supersedes: []
implementation:
  - repo: dark-harness
---

# DH-0004: npm package only ships a single-platform binary

## Summary

`package.json`'s `bin` field points at one compiled binary, so the published npm package
only works on whatever platform it was built for — `bunx dark-harness` doesn't work
cross-platform via npm today. GitHub Release binaries are fine on all 5 targets; only the
npm distribution path is narrowed. Known since CI/Release's first round. Blocked on an
owner-facing packaging-shape decision before real implementation work can start.

## User Stories

### As a user on any supported platform, I want `bunx dark-harness` to work without me picking a platform-specific package

- Given a user on macOS/Linux/Windows (x64 or arm64), when they run `bunx dark-harness`,
  then the correct binary for their platform is fetched/used automatically.

## Functional Requirements

- Given any of the 5 released targets, when installed via npm, then the resulting package
  works without the user needing platform-specific knowledge.

## Assumptions

- None yet — the two candidate approaches (below) haven't been compared in depth.

## Risks

- Both candidate approaches add real complexity to the release pipeline; whichever is chosen
  needs its own verification pass (this project's pattern: don't trust it until proven live).

## Open Questions

- Per-platform `optionalDependencies` packages (à la esbuild/swc) vs. a postinstall
  downloader hitting the GitHub Release assets — which shape fits this project? This is the
  decision blocking the ticket.

## Functional Requirements (packaging shape)

- **Owner decision (2026-07-15): `optionalDependencies` packages, esbuild/swc-style.** One
  tiny per-platform npm package per released target (5 targets), the main `dark-harness`
  package lists them all as `optionalDependencies`; npm/bun installs only the one matching
  the current platform. No postinstall script, no network fetch at install time — works
  offline/behind registry mirrors, consistent with this project's air-gapped-friendly
  posture (CLAUDE.md §4.3). Rejected the postinstall-downloader alternative for that reason.

## Notes

> [!NOTE]
> Not urgent for local/dev use (build-from-source and the GitHub Release binaries both work
> fine today) — only the `npm i`/`bunx` distribution path is narrowed.

> [!NOTE]
> Owner decision (2026-07-15): packaging shape resolved (see Functional Requirements above);
> ready for CI/Release to implement.
