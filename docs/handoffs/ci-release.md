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
