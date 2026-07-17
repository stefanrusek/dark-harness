---
spile: ticket
id: DH-0123
type: bug
status: implementing
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
