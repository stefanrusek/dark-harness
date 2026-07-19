---
spile: ticket
id: DH-0123
type: bug
status: verifying
owner: stefan
resolution:
blocked_by: []
created: 2026-07-17
relations:
  depends_on: []
  relates_to: []
  supersedes: []
implementation:
  - repo: dark-harness
---

# DH-0123: dh init output doesn't look great

## Summary

Owner observation from live manual testing 2026-07-17: 'dh init output doesn't look great.' Scope clarified by owner 2026-07-17: after adding the logo and header (DH-0122, landed), `dh init` needs the same polish pass already applied to `dh doctor` -- i.e. wire `printAppHeader()` into `dh init`'s output path the same way `runDoctor` already consumes it, and bring the rest of `init`'s own output formatting (spacing, structure, wording) up to the same standard `doctor` now has, rather than treating this as an open-ended/unspecified design question.

## User Stories

### As an operator running `dh init`, I want the same application header shown by `dh doctor` and other run modes, so init's output feels consistent with the rest of the tool

- Given a user runs `dh init` in a fresh directory, when the command starts, then it prints the same `printAppHeader()` output (logo, version/build, config-status line where applicable) that `dh doctor` already prints, via the shared `src/header-info.ts` builder from DH-0122.

### As an operator running `dh init`, I want the rest of its output to read as cleanly as `dh doctor`'s output, so scaffolding a new project doesn't feel like a lesser-polished path

- Given `dh init` completes successfully, when its output is compared against `dh doctor`'s formatting conventions (spacing between sections, consistent use of color/bold, consistent success/next-steps framing), then `init`'s remaining output (the scaffold-created confirmation, any next-step guidance) matches that same standard.

## Functional Requirements

- Wire `printAppHeader()` (from DH-0122, `src/cli.ts`) into the `dh init` code path, matching how `runDoctor` already consumes it.
- Audit and polish `init`'s own output beyond the header -- spacing, structure, wording -- to match `doctor`'s current formatting conventions. Treat `doctor`'s current output as the reference/target bar, not a fresh design exercise.

## Assumptions

- `doctor`'s current formatting (post-DH-0122) is the intended reference bar for this ticket -- no new visual design needed, just consistency.

## Risks

## Open Questions

## Notes

### 2026-07-19 — implementation

Wired the shared app header into `dh init`. Note: DH-0220 landed on this branch in the
meantime and replaced the interactive-mode header path (`src/cli/run.ts` now uses
`renderHeaderA2`/`renderHeaderB` from the new `src/cli/header.ts`) — but `dh doctor`'s own
header call was untouched by that ticket and still goes through `printAppHeader`
(`src/cli/activity-feed.ts`), which itself still calls the shared `buildHeaderInfo`/
`formatHeaderLines` builders in `src/header-info.ts` (DH-0122). So the ticket's literal
ask — wire `printAppHeader()` into `init` "the same way `runDoctor` already consumes it" —
still applies verbatim; no need to reach for the new A2/B header modes (those are gated on
`RunMode`/interactive-TTY composition that `init` doesn't participate in).

Changes:
- `src/cli/activity-feed.ts`: widened `printAppHeader`'s `config` param from `DhConfig` to
  `DhConfig | null` — `header-info.ts`'s `buildHeaderInfo`/`buildConfigStatusSummary` already
  anticipated this exact "future `dh init` degenerate case" (see that file's existing
  comment), but the CLI-facing wrapper hadn't been widened to actually accept it yet.
- `src/cli/init.ts`: calls `printAppHeader(null, targetPath, io)` right after flag parsing,
  before the `fileExists`/overwrite-refusal check — same position `runDoctor` calls it in,
  before doing any work. `null` config renders the same "config: not found (<path>)" status
  line doctor shows for a genuinely missing file, which is accurate here (init hasn't written
  anything yet at that point).
- Audited the rest of `init`'s own output (the DH-0101 success-headline/dim-caveats/next-step
  block) against `doctor`'s current conventions — found it already matches the same shape
  (bold/glyph headline, dimmed detail lines, plain next-step line, same `dh: ` prefix
  discipline) from an earlier round, so no further changes were needed there beyond the
  header wiring itself.
- Updated `src/cli.test.ts`'s `dh init` describe block for the new header lines leading the
  output (both the non-TTY and TTY-styling assertions).

Gates: `bun run typecheck`, `bun run test:coverage` (100%, 140/140), `bun run e2e` (40/40,
one flaky failure on the first run — `web.test.ts`'s stream-reader race in
`e2e/support/dh-process.ts`, unrelated to this change, passed clean on immediate retry) all
green. `bun run lint` has one pre-existing, unrelated failure in `src/cli/header.test.ts`
(a formatter-only nit, present on `main` before this change too — confirmed via `git
stash`); left untouched as out of scope for this ticket.
