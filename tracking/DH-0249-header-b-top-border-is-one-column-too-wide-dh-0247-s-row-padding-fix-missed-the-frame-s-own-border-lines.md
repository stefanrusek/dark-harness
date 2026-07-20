---
spile: ticket
id: DH-0249
type: bug
status: draft
owner: Core
resolution:
blocked_by: []
created: 2026-07-20
relations:
  depends_on: []
  relates_to: [DH-0247]
  supersedes: []
implementation:
  - repo: dark-harness
---

# DH-0249: Header B top border is one column too wide: DH-0247's row() padding fix missed the frame's own border lines

## Summary

renderHeaderB's top-border fill math over-counts by one, so the top-right corner drifts one column right of every other corner/border; DH-0247's regression test only checks rows containing the vertical bar, so it never covered this.

Found in refactoring round 4 (DH-0250). DH-0247 fixed Header B's *content-row* right
borders but left a latent off-by-one on the frame's own top border — the exact class of
bug DH-0247 was about, on a line DH-0247's regression test structurally can't see.

In `src/cli/header.ts` `renderHeaderB` (color path), the frame interior width is `width = 49`.
The separator and bottom lines produce a 51-char visible line (`├` + 49 `─` + `┤`,
`╰` + 49 `─` + `╯`), and every content `row()` is padded to the same 51-char visible width.
But the top line is built as:

```
lines.push(`  ${frame("╭─")}${nameplate}${frame(`${topFill}╮`)}`);
const topFill = "─".repeat(Math.max(0, width + 2 - visibleLen(nameplate) - 2));
```

The `╭─` prefix contributes a corner **plus one leading `─`**, but `topFill` is sized as
`width - visibleLen(nameplate)`, so the interior (leading `─` + nameplate + topFill) totals
`width + 1`, not `width`. Result: the top line is 52 visible chars vs 51 everywhere else, and
the top-right `╮` lands one column right of every other corner (`╮` at col `width+4` vs `╯`/`┤`
at col `width+3`). Confirmed by direct reconstruction (plain-text model of the same math):
top line 52 chars, separator/bottom/content rows all 51.

Why it went unnoticed: DH-0247's regression test
(`src/cli/header.test.ts`, "every framed row's right border lands at the same visible column")
filters to `lines.filter((l) => l.includes("│"))` — i.e. only content rows. The top, separator,
and bottom border lines use `╭╮├┤╰╯`, none of which contain `│`, so the test never measured
them. This is a real coverage gap, not just this one bug: the frame's *own* geometry is untested.

## User Stories

### As an operator looking at Header B, I want the whole frame — including the top border — to form a clean rectangle

- Given `dh --server`/`dh --web` starts with color enabled, when Header B renders, then the top
  line's visible width (and its `╮` corner column) equals that of the separator, bottom, and
  every content row — proven by an extended `src/cli/header.test.ts` case that includes the
  corner/separator border lines, not only `│`-bearing rows, and that fails against current code.

## Functional Requirements

- Fix `topFill`'s width math in `renderHeaderB` so the top line's total visible width matches
  the separator/bottom/content rows exactly (interior = `width`, not `width + 1`). The one-char
  overcount comes from the `╭─` prefix's leading `─` not being subtracted from `topFill`.
- Extend the DH-0247 alignment test to cover the frame's own border lines (top/separator/bottom),
  not just `│`-bearing content rows — assert all framed lines (corners included) share one visible
  width. This is the missing coverage that let the bug through; the fix is incomplete without it.

## Assumptions

- Plain (`level === "none"`) fallback is unaffected — it uses `--`/`-` rules, not box-drawing,
  so there's no corner-alignment concept there. (Note in passing: the plain path hardcodes a
  51-char rule and a `47`-based fill while the color path derives from `width = 49` — a separate
  cosmetic inconsistency, not in scope here unless the implementer wants to unify the literals.)
- Header A2 (`renderHeaderA2`) is *not* affected: it uses a `├─`/`└─` tree layout with no right
  border, so it has no analogous drift. Verified during the round — no ticket needed there.

## Risks

- None beyond the render math itself — no behavioral/data change.

## Open Questions

None.

## Notes

Owner/reviewer: purely a one-column cosmetic drift on a startup banner; low severity, but it's
a direct regression-adjacent miss from DH-0247 (same file, same week, same class of bug) and the
fix is a few characters plus a test-coverage widening, so worth closing the loop.
