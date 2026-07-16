---
spile: ticket
id: DH-0100
type: feature
status: ready
owner: stefan
resolution:
blocked_by: []
created: 2026-07-16
relations:
  depends_on: []
  relates_to: [DH-0065, DH-0066, DH-0029, DH-0028]
  supersedes: []
implementation:
  - repo: dark-harness
---

# DH-0100: Adopt one canonical agent-status color/glyph/word model across TUI, Web, and CLI

## Summary

The five agent statuses render with three different color schemes across surfaces: TUI/CLI-logs use yellow=running, cyan=waiting, gray=stopped while the Web uses blue=running, amber=waiting, violet=stopped; only done/failed agree. Status-word casing also diverges (Web Title Case, TUI/CLI lowercase). Adopt the single canonical status model in docs/design/style-guide.md §1 so a status looks like the same idea everywhere.

This is the **foundational** ticket of the design-crew batch: it makes "a status looks the
same everywhere" true in code, which every other polish ticket then leans on. The canonical
model is `docs/design/style-guide.md` §1 (status table), §2.3 (hue map), §3 (glyphs). Where
this ticket and the current code disagree, the style guide is the target and the code is the
gap.

Current reality (from the 2026-07-16 UX survey):

| status | TUI (`src/tui/render.ts` STATUS_COLOR) | CLI logs (`src/server/log-analysis.ts` STATUS_COLOR) | Web (`styles.css` `--status-*`) |
| --- | --- | --- | --- |
| running | `33` yellow | `33` yellow | blue `#4f8cff` |
| waiting | `36` cyan | `36` cyan | amber `#f5a524` |
| done | `32` green | `32` green | green `#35c469` ✓ |
| failed | `31` red | `31` red | red `#f2545b` ✓ |
| stopped | `90` gray | `90` gray | violet `#9a7bd1` |

Only `done`/`failed` already agree. `running` and `waiting` are effectively swapped-and-
rehued between the terminal surfaces and the Web, and `stopped` is gray in the terminal but
violet on the Web. The Web palette is the authoritative *hue intent* (design guide §2.1);
the terminal surfaces approximate it within the SGR allowlist per the §2.3 hue map.

## User Stories

### As an operator switching between the TUI and the Web UI, I want a status to look like the same thing in both

- Given an agent in `running`, when I see it in the TUI tree/detail and in the Web sidebar,
  then both read as blue (TUI SGR `34`, Web `--status-running #4f8cff`) — not yellow in one
  and blue in the other.
- Given an agent in `waiting`, when rendered on either surface, then both read as amber/
  yellow (TUI SGR `33`, Web `--status-waiting`).
- Given an agent in `stopped`, when rendered on either surface, then both read as the
  "stopped" hue (TUI SGR `35` magenta, Web violet `--status-stopped`) — never gray, which
  reads as unstyled/unknown.
- Given `done`/`failed`, when rendered, then they stay green/red on both (already correct —
  do not churn).

### As a color-blind operator, I want every status legible without relying on color

- Given any status on any surface, when rendered, then it carries the status *word* in
  addition to the colored `●` glyph (design guide §1 "never color-only"). The TUI tree
  already shows the word next to the glyph (DH-0065); verify it survives the recolor, and
  that CLI `dh logs`' status label and the Web badge continue to show the word too.

### As an operator, I want status wording to be consistent across surfaces

- Given a status word rendered anywhere, when shown, then a single casing convention is used
  (resolve the current split: Web Title Case `Running` vs TUI/CLI lowercase `running`). Pick
  one in the design guide (recommend lowercase for the terminal's raw/log character and
  Title Case only in the Web badge if that's deliberate — but state the rule explicitly so
  it stops being incidental).
- Given `dh logs`' unique `running (no terminal event seen)` qualifier, when reconciling,
  then keep the honest caveat (it's a real offline-log distinction the live surfaces can't
  make) but confirm it's intentional and documented, not an accidental third vocabulary.

## Functional Requirements

- The canonical status→(SGR, hex, glyph, word) mapping lives in `docs/design/style-guide.md`
  §1; this ticket changes code to match it. Any future status must be added there first.
- `src/tui/render.ts` `STATUS_COLOR`: `running`→`34`, `waiting`→`33`, `stopped`→`35`;
  `done`→`32`, `failed`→`31` unchanged. This is Mary's (TUI) change.
- `src/server/log-analysis.ts` `STATUS_COLOR`: same remap. This is Grace's (Core/CLI) change
  — coordinate so both terminal surfaces land the same table in the same round (a half-done
  reconciliation is worse than none).
- No Web CSS color change is required (the Web palette is the target) — but Susan verifies
  the Web `--status-*` values match the guide's §1 table exactly and that `stopped` still has
  a rule (DH-0029 regression guard).
- Terminology/casing decision is recorded in the design guide §4 and applied on every surface.
- Coverage per CLAUDE.md §5 on changed code; keep DH-0029's "stopped is never gray/default"
  regression assertions and add equivalent TUI/CLI ones if absent.

## Assumptions

- Blue (`34`) is available and legible on the default terminal themes operators use; if a
  particular terminal renders `34` too dark, bright blue `94` is the allowed fallback (still
  in the DH-0056 allowlist) — a rendering judgment for Mary/Grace, not a new decision.
- No SGR allowlist extension is needed — every target code (`31`–`36`, `90`/`94`) is already
  allowed.

## Risks

- Recoloring changes strings/attributes that TUI e2e spikes and Web tests may assert on
  (status color codes, badge classes). Update those in the same round — DH-0065 hit exactly
  this class of breakage.
- Splitting the two terminal changes across two owners (Mary/Grace) risks a window where the
  TUI and `dh logs` disagree with each other. Land them together or in immediate succession;
  the coordinator should treat this as one reconciliation, not two independent tickets.

## Open Questions

- Final casing rule: lowercase everywhere, or lowercase in terminal + Title Case in the Web
  badge? (Recommend the design crew decide and record it; leaning: keep each surface's
  current casing but *document* it as intentional, since Title Case badges are a legitimate
  Web idiom and lowercase suits the terminal — the real bug is the *color* divergence, not
  the casing.)

## Notes

> [!NOTE]
> Filed 2026-07-16 by Muriel (design crew) from the first cross-surface UX survey. This is
> the keystone of the batch — DH-0101/0102/0104/0105 all assume the §1 status model holds.
> The Web `styles.css` comment claims `stopped` was made "consistent with the TUI"; in fact
> it only made stopped *have a color* — the hues never matched. This ticket closes that gap
> for real.
