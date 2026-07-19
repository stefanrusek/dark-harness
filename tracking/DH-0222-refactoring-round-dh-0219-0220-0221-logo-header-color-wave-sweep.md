---
spile: ticket
id: DH-0222
type: bug
status: closed
owner: stefan
resolution: done
blocked_by: []
created: 2026-07-19
relations:
  depends_on: []
  relates_to: []
  supersedes: []
implementation:
  - repo: dark-harness
---

# DH-0222: Refactoring round: DH-0219/0220/0221 logo+header+color wave sweep

## Summary

Fifth refactoring round (DH-0141 mechanism), scoped to commits d40df18..HEAD (DH-0216's trailer to now). Focus: the DH-0219 monogram / DH-0220 dual-mode startup header / DH-0221 truecolor-palette wave that superseded the DH-0192/0193/0198 diamond direction, plus the merge-fallout and markdown/web fixes in the same range. Findings and close-out land in this ticket body.

## Round close-out (Fable, 2026-07-19)

### Reviewed

- All 23 commits `d40df18..HEAD` (DH-0216's trailer to now).
- **Wave focus (dispatch brief):** DH-0219 (DH monogram logo), DH-0220 (dual-mode startup
  header + `styleDhPrefix` extension), DH-0221 (truecolor BRAND palette + `detectColorLevel`).
  Read the full diffs of `src/design-tokens.ts`, `src/cli/color-context.ts`, `src/cli/header.ts`,
  `src/prompt/banner.constant.ts`, `src/cli/run.ts`, `src/header-info.ts`,
  `src/cli/activity-feed.ts`, and the Web `LogoMark`/`AppHeader`/`index.html` changes.
- **Superseded diamond direction:** checked for leftover dead code. The `◆` glyph is gone from
  live product surfaces; remaining "diamond" mentions are all in docs (`social-preview-prompt.md`,
  `muriel.md`, `logo.svg` header comment, `index.html` provenance comment) — historical record,
  not dead code. Nothing to file there.
- **Second-palette check (DH-0221):** the coexistence of `BRAND` and `STATUS_TOKENS` is
  explicitly documented as deliberate in `design-tokens.ts` ("the two tables coexist here but
  are never merged") — respected, not relitigated. But it surfaced a real cross-surface
  inconsistency (see DH-0225).
- **Merge-fallout / markdown / web fixes in range** (DH-0199–0208, DH-0203–0205, DH-0211,
  DH-0214, DH-0218): spot-checked; these are self-contained bug fixes with their own tests. No
  residual seams worth a ticket. DH-0218 already reworked `renderSelfInfoSection` into a typed
  options object this range — the accretion finding from the prior round is closed.
- **Coverage note (no silent truncation, §8):** read the wave diffs in full; sampled the
  non-wave merge-fallout commits rather than reading every line.

### Filed

- **DH-0223** (bug, draft, Core) — `chooseHeaderMode` is exported and 100%-covered by tests but
  has no runtime caller; `run.ts` selects the header mode inline and only name-drops it in a
  comment. Wire it in or delete it + its tests.
- **DH-0224** (bug, refining) — the DH-0219/0220 rebrand only reached the `run.ts` startup
  header; `dh doctor`, `dh init`, the TUI empty-state, and the Web `AppHeader` still render the
  pre-rebrand `DH_ASCII_LOGO`/`_COMPACT` figlet via `formatHeaderLines`. Two coexisting product
  identities. **Spans Core + TUI + Web — cannot be cleanly sliced to one §3 owner; flagged for
  coordinator triage** (escalation-trigger-3 analogue). Also notes the stale `Header.tsx:10`
  TODO.
- **DH-0225** (bug, draft, Design/Muriel) — the startup header's ok/health `●` uses
  `BRAND.harnessGreen` (#9ECE6A) while the status dots use `STATUS_TOKENS` greens (#35c469 /
  #4f8cff) for the same glyph; "green/ok/live" renders three ways across surfaces. Routed to
  Design for the call rather than an implementer, because a naive "reconcile" would collide with
  the documented deliberate-coexistence decision.

### Considered and deliberately NOT filed

- **Merge BRAND into STATUS_TOKENS:** explicitly a locked design decision in `design-tokens.ts`
  — not relitigated. DH-0225 is scoped to the *semantic consistency of the live/ok dot*, not to
  merging the tables.
- **The `_  _` `DH_ASCII_LOGO` itself:** not dead — still the source for `dh doctor`/`init`/TUI
  empty-state. Its fate is folded into DH-0224 (whether secondary surfaces adopt the monogram),
  not a separate ticket.
- **Doc-level "diamond" mentions:** historical/provenance record, correctly retained.

### Escalation

- DH-0224's cross-domain slicing is flagged on the ticket for coordinator triage (does not map
  cleanly onto one §3 owner). Nothing else tripped a §6 trigger.

## Notes

- No product code touched this round (refactoring rounds produce tickets only).
