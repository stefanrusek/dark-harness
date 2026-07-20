---
spile: ticket
id: DH-0236
type: bug
status: closed
owner: stefan
resolution: done
blocked_by: []
created: 2026-07-19
relations:
  depends_on: []
  relates_to: [DH-0235]
  supersedes: []
implementation:
  - repo: dark-harness
---

# DH-0236: Dead code: DH_ASCII_LOGO / DH_ASCII_LOGO_COMPACT unused after DH-0224 migrated every surface to the monogram assets

## Summary

After DH-0224 pointed doctor/init/TUI/Web at HEADER_B_GLYPH / HEADER_A2_WORDMARK_PLAIN, the old figlet constants DH_ASCII_LOGO and DH_ASCII_LOGO_COMPACT in src/prompt/banner.constant.ts have no remaining product consumers — only their own test file references them. Delete both (and their tests), or document why they are retained.

## User Stories

### As a maintainer, I want dead figlet constants removed so the prompt domain doesn't carry code with no product consumer

- Given `DH_ASCII_LOGO`/`DH_ASCII_LOGO_COMPACT` in `src/prompt/banner.constant.ts` have no
  consumers outside their own test file, when the codebase is grepped for
  `DH_ASCII_LOGO`, then no references remain anywhere under `src/` or `e2e/` (proven by
  `grep -rn "DH_ASCII_LOGO" src/ e2e/` returning no matches — see verification below).

## Functional Requirements

- Delete `DH_ASCII_LOGO` and `DH_ASCII_LOGO_COMPACT` from `src/prompt/banner.constant.ts`.
- Delete `src/prompt/banner.constant.test.ts` (its entire contents tested only these two
  constants).
- Leave `HEADER_A2_WORDMARK`, `HEADER_A2_WORDMARK_PLAIN`, `HEADER_B_GLYPH`, and
  `HEADER_B_TAGLINE` untouched — these are the live DH-0220/DH-0224 replacements.

## Assumptions

- DH-0224 fully migrated doctor/init/TUI/Web to the monogram-based constants, so no code
  path still renders the figlet wordmark.

## Risks

- None identified — removal is a pure dead-code deletion with no runtime consumers.

## Open Questions

- None.

## Notes

### 2026-07-19 — implementation

Verified the finding before deleting: `grep -rn "DH_ASCII_LOGO" src/ e2e/` matched only the
declarations in `src/prompt/banner.constant.ts` and their own dedicated test file
`src/prompt/banner.constant.test.ts` — no product consumer anywhere (doctor/init/TUI/Web all
already use `HEADER_B_GLYPH`/`HEADER_A2_WORDMARK_PLAIN` per DH-0224). Deleted both constants
and the test file. Ran full gate suite (typecheck, lint, test:coverage, e2e) — all green.
