---
spile: ticket
id: DH-0104
type: feature
status: ready
owner: stefan
resolution:
blocked_by: []
created: 2026-07-16
relations:
  depends_on: []
  relates_to: [DH-0028]
  supersedes: []
implementation:
  - repo: dark-harness
---

# DH-0104: Unify number, cost, elapsed, and token formatting across TUI, Web, and CLI

## Summary

The same values render differently per surface: cost is 4 decimals in CLI/TUI but 2 on Web; tokens are full comma form (12,345 tok) in CLI/TUI but compact (12.3k) on Web; elapsed is 3m12s (no space, no 'just now') in TUI but '3m 12s'/'just now' on Web; unknown cost is — in CLI/TUI but /bin/zsh.00/— on Web. Pick one canonical formatting per the design-guide terminology (§4) and apply it everywhere a human sees these values.

The same underlying value renders four different ways depending on which surface you're
looking at — a small thing that quietly makes the tool feel like three tools stitched
together. Survey findings (2026-07-16):

| Value | TUI | CLI (`dh logs`/feed) | Web (`src/web/client/format.ts`) |
| --- | --- | --- | --- |
| Cost | `$0.0456` (4 dp) | `$0.0456` (4 dp) | `$0.05` (2 dp); `<$0.01`; `$0.00` |
| Unknown cost | `—` / omitted | `—` | `$0.00` or `—` (guide says `—`) |
| Tokens | `12,345 tok` (comma) | `12,345 tok` (comma) | `12.3k` (compact k/M) |
| Elapsed | `3m12s` / `1h05m` (no space) | HH:MM:SS wall-clock (feed) | `3m 12s` / `1h 05m` / `just now` |

None of these is *wrong*; they're just inconsistent, and the inconsistency is exactly the
kind of "three different tools" seam the design crew exists to remove. This ticket picks one
canonical rendering per value (recorded in design guide §4) and applies it everywhere a human
reads that value. Owners: cross-cutting — Grace (CLI), Mary (TUI), Susan (Web); coordinate so
all three land the same conventions.

## User Stories

### As an operator, I want cost shown the same way wherever I read it

- Given a known cost in an interactive/glanceable context (TUI tree/detail, Web sidebar/
  strip), when rendered, then it uses `$0.00` style with 2 decimals, and `<$0.01` for tiny
  non-zero costs.
- Given a known cost in `dh logs`, when rendered, then it keeps 4-dp precision — a deliberate,
  owner-confirmed exception for this audit-dump context, documented as such in the design
  guide, not left as an accidental divergence.
- Given an *unknown* cost (model has no pricing configured), when rendered on any surface,
  then it shows `—` (em dash) and is excluded from any total — never `$0.00`, which reads as
  "free" (web-ui-guide.md already commits to this; make it true everywhere).

### As an operator, I want token counts shown the same way everywhere

- Given a token count in glanceable chrome (TUI tree rows, Web badges/strips), when rendered,
  then it uses compact `12.3k`/`1.2M` form.
- Given a token count in a detail/log context (`dh logs`, TUI/Web detail panels), when
  rendered, then it uses the full comma form (`12,345`). One rule per context-class, applied
  identically across surfaces — the current split (comma always in TUI, compact always on
  Web) is the seam to close.

### As an operator, I want elapsed durations shown the same way everywhere

- Given an elapsed duration in the TUI and on the Web, when rendered, then spacing and the
  "just now" affordance agree (`3m 12s` vs `3m12s`, and whether sub-second reads as `just
  now` or `0s`). Pick one (`formatElapsed` in TUI vs `format.ts` on Web) and align.

### As a developer, I want one formatter per value, not one per surface

- Given the formatting rules are decided, when implemented, then each value has a single
  canonical formatter that all surfaces call (or three surface formatters that are verified
  identical by shared test vectors), so they can't silently drift apart again.

## Functional Requirements

- Record the canonical formatting rules (cost, unknown-cost placeholder, tokens, elapsed) in
  `docs/design/style-guide.md` §4 as the source of truth before changing code.
- Align `src/tui/render.ts` (`formatElapsed`, token/cost rendering),
  `src/server/log-analysis.ts` (`formatCost`/`formatDuration`), and
  `src/web/client/format.ts` (`formatTokenCount`, cost, elapsed) to those rules.
- Prefer a *shared* formatter module the three surfaces import over three hand-kept-in-sync
  copies. If the domain boundaries make a literal shared import impractical (TUI vs Web vs
  Core), the minimum bar is a shared table of test vectors asserted in each surface's tests so
  drift fails CI.
- The em-dash-not-`$0.00` unknown-cost rule and its exclusion-from-totals must hold on every
  surface (this is the one with a real correctness angle — `$0.00` misrepresents an unpriced
  model as free).
- 100% coverage on changed code; include cross-surface test vectors (same input → asserted
  identical output) so a future edit to one surface can't re-introduce the divergence.

## Assumptions

- These are display conventions only; no change to how tokens/cost are *computed* or
  accounted (DH-0028 owns usage-accounting correctness — this ticket only unifies rendering).
- The `--server` activity feed's wall-clock HH:MM:SS timestamp is a legitimately different
  thing (absolute event time, not elapsed) and stays — this ticket unifies *elapsed*
  durations, not the feed's timestamp.

## Risks

- Changing cost from 4-dp to 2-dp on the terminal surfaces could hide sub-cent differences an
  operator relied on; the `<$0.01` affordance mitigates this, but confirm no workflow depends
  on 4-dp precision in `dh logs` (if one does, document `dh logs` as the precise-audit
  exception rather than forcing 2-dp there).
- Touching three domains at once risks partial landing (two surfaces aligned, one not) — worse
  than the status quo. Coordinate as one change; the shared-test-vector requirement is the
  guard.

## Open Questions — resolved by the owner 2026-07-16

- **Cost precision**: `dh logs` keeps 4-dp as a documented precise-audit exception. TUI
  interactive views and Web use 2-dp + `<$0.01` + `—` unknown (never `$0.00`). Record both the
  general rule and the `dh logs` exception explicitly in the design guide §4 — this is now a
  deliberate two-tier rule, not an oversight to converge away.
- **Tokens**: compact `k`/`M` in glanceable chrome (TUI tree rows, Web badges/strips); full
  comma form in detail/log contexts (`dh logs`, any TUI/Web detail panel that shows precise
  usage). Same two-tier shape as the cost decision — pick per context-class, not per surface.
- **Elapsed**: spaces + `just now` affordance (`3m 12s`, sub-second reads as `just now`),
  confirmed as recommended.

## Notes

> [!NOTE]
> Filed 2026-07-16 by Muriel (design crew) from the cross-surface survey. Individually each
> divergence is trivial; collectively they're a big part of why the tool reads as un-unified.
> Flagged as the batch's most "confirm the taste call with the owner first" ticket because it
> changes numeric formats the owner looks at constantly — the rules should be his to bless.
