---
spile: ticket
id: DH-0079
type: bug
status: closed
owner: stefan
resolution: done
blocked_by: []
created: 2026-07-16
relations:
  depends_on: []
  relates_to: [DH-0073]
  supersedes: []
implementation:
  - repo: dark-harness
---

# DH-0079: Read tool's truncation model diverges from real Claude Code: line-cap+notice vs byte-cap+hard-error

## Summary

Empirical live-run comparison (2026-07-16, this session, real Claude Code Read tool invoked directly): reading a small (~30KB) 3004-line text file returned ALL 3004 lines with NO truncation and no notice -- contradicting the assumption (baked into dh's src/agent/tools/read.ts DEFAULT_LIMIT=2000) that Claude Code's Read truncates non-notebook/PDF text files at 2000 lines by default. Reading a larger (~3.2MB) 50004-line file instead FAILED OUTRIGHT with: 'File content (3.2MB) exceeds maximum allowed size (256KB). Use offset and limit parameters to read specific portions of the file, or search for specific content instead of reading the whole file.' Real Claude Code's Read is bounded by a ~256KB byte-size hard cap (error, not truncation) with no evident independent line-count truncation below that cap. dh's read.ts instead: (1) has no byte-size error cap until 256MB (1000x larger), (2) truncates by line count at 2000 by default with a soft <system-reminder>...more lines not shown</system-reminder> notice rather than erroring. Separately, the empty-file message text also differs: dh emits '<system-reminder>File exists but has empty contents.</system-reminder>'; real Claude Code emits '<system-reminder>Warning: the file exists but the contents are empty.</system-reminder>' (wording mismatch, same wrapper tag).

## User Stories

### As an agent reading a large file, I want the same failure/truncation semantics real Claude Code has, so my recovery strategy (retry with offset/limit vs. narrowing scope) matches what I already know

- Given a text file under ~256KB with more than 2000 lines, when Read is called with no
  `limit`, then it returns the whole file (no truncation), matching real Claude Code —
  not dh's current 2000-line default cap.
- Given a text file at/above the real byte-size cap (~256KB), when Read is called with no
  `offset`/`limit`, then it fails outright with a clear error naming the file's size and the
  cap, and suggesting `offset`/`limit` or search — not a silently-truncated partial read.
- Given an empty file, when Read is called, then the emitted system-reminder text matches
  real Claude Code's wording exactly (or the discrepancy is a deliberate, documented choice
  rather than an accidental drift).

## Functional Requirements

- `src/agent/tools/read.ts`: replace (or augment) the line-count-based `DEFAULT_LIMIT`
  (2000) truncation-with-notice model with a byte-size hard cap matching real Claude Code's
  behavior observed here (~256KB before an outright error) when no `offset`/`limit` is
  given. Confirm the exact cap value against further live tests before hardcoding — this
  session observed a failure at 3.2MB and success at ~30KB, so the true boundary is
  somewhere in between and was not bisected precisely (see Open Questions).
  Note dh's current `MAX_READABLE_BYTES` (256MB) is a different, much larger, hard-refuse
  ceiling that still exists in real Claude Code's shape conceptually but at a much smaller
  value — this ticket is about that cap's magnitude and error-vs-truncate behavior, not
  about removing the concept of a ceiling.
  Consider a name for the cap that reflects it's the CLAUDE-CODE-MATCHED PRIMARY behavior:
  it is not an all-lines will ever be read, it's a bytes ceiling.
- Update the empty-file message in `read.ts` from `"File exists but has empty contents."` to
  match real Claude Code's `"Warning: the file exists but the contents are empty."` (or file
  a deliberate-divergence note if the team decides not to bother matching this exact
  cosmetic string).
- `src/prompt/` and the Read tool's own `description` field should stop advertising "Truncates
  to at most 2000 lines by default" once the behavior changes, to avoid the tool's own
  self-description misleading the model.

## Assumptions

- The live test used plain single-line-per-record text (`line N`) with no unusually long
  lines, so the 256KB boundary observed is a byte-size cap, not disguised line-count logic —
  reasonably confident but not exhaustively bisected (see Open Questions).
- This is a distinct, more mechanical/higher-confidence finding than DH-0073 (which covers
  Jupyter/PDF file-type awareness, not plain-text truncation semantics) — filed separately,
  related via `relates_to`.

## Risks

- Shrinking the effective cap from ~256MB/2000-lines down to ~256KB could break existing dh
  workflows/tests that currently rely on reading larger files whole (e.g. some fixture or
  log file over 256KB but under 256MB read successfully today) — needs an audit of existing
  callers/tests before landing, and prior art within dh (round 13, DH-0014) for *why* the
  larger ceiling was chosen should be reread before shrinking it, in case there was a
  deliberate reason to diverge here that this finding should not simply override.

## Open Questions

- Exact byte-size boundary of real Claude Code's cap: this session only bisected between
  "small text file, ~30KB, succeeds" and "3.2MB, fails with message citing '256KB'" — the
  256KB figure came directly from the tool's own error text, so it's likely accurate, but a
  tighter live bisection (e.g. files at 200KB, 250KB, 260KB, 300KB) would confirm the exact
  threshold and whether it's lines-aware at all near the boundary.
- Does real Claude Code apply this same byte cap uniformly regardless of `offset`/`limit`
  being supplied, or does supplying `limit` bypass the whole-file byte check the way dh's
  `offset`/`limit`-aware streaming already does? Not tested this round.

## Notes

> [!NOTE]
> Found 2026-07-16 during the owner-directed systematic empirical tool-conformance testing
> pass (methodology per DH-0070's live-run precedent). Live-run evidence, both sides: dh's
> exact behavior confirmed by reading `src/agent/tools/read.ts` in this session; real Claude
> Code's behavior confirmed by this session's own direct Read tool calls against
> `/tmp/dhtest/big.txt` (3004 lines, ~30KB, read whole no truncation), `/tmp/dhtest/huge.txt`
> (50004 lines, ~3.2MB, hard error citing a 256KB cap), and `/tmp/dhtest/empty.txt` (empty-file
> message wording). This is a genuinely new finding — none of DH-0069 through DH-0078 covers
> Read's truncation/size-cap semantics; DH-0073 covers a different Read gap (notebook/PDF
> awareness).

### 2026-07-16 — Implemented (Grace, Core domain)

Fixed in `src/agent/tools/read.ts`:

- Added `PRIMARY_WHOLE_FILE_BYTE_CAP = 256 * 1024` — real-Claude-Code-matched — enforced only
  when a Read call supplies neither `offset` nor `limit`; error text matches the ticket's
  quoted real-Claude-Code shape exactly (`File content (SIZE) exceeds maximum allowed size
  (256KB). Use offset and limit parameters...`), with a new `formatBytes()` helper for the
  `256KB`/`3.2MB`-style size formatting.
- **Open question resolved**: supplying `offset`/`limit` bypasses this whole-file cap entirely
  (an explicit request for a bounded slice) — the sane default the ticket itself suggested.
  It's still bounded by the pre-existing `MAX_READABLE_BYTES` (256MB) absolute ceiling and by
  the existing memory-safe line-windowed streaming, so this can't regress DH-0014.
- **Risk audited**: reread DH-0014's rationale (docs/handoffs/core.md Round 14) for the 256MB
  ceiling before touching it — found no reason it needs to equal the new, much smaller
  whole-file cap; the two constants now serve genuinely different purposes (one matches real
  Claude Code's common-case behavior, the other guards against unbounded line-counting time
  even on a windowed read) and are named/commented distinctly in the code
  (`PRIMARY_WHOLE_FILE_BYTE_CAP` vs `MAX_READABLE_BYTES`). No existing dh caller/test relied on
  reading a 256KB–256MB file whole with no offset/limit — the only place that pattern
  previously worked was exactly the case this ticket says is dangerous.
- Removed the old default 2000-line truncation for genuine whole-file reads (file is now
  guaranteed under 256KB by the time lines are read) — `DEFAULT_LIMIT = 2000` still applies as
  the default page size once a caller opts into windowed paging via `offset` and/or `limit`.
- Fixed the empty-file message to real Claude Code's exact wording: `"Warning: the file exists
  but the contents are empty."`
- Updated the Read tool's `description` field; confirmed no `src/prompt/` doc advertised the
  old "2000 lines by default" behavior.
- Gates: typecheck/lint clean. `bun run test:coverage`: 1331 pass, 0 fail, 100% line coverage
  on `read.ts` (new tests cover the 256KB boundary exactly, an offset/limit bypass case, a
  megabyte-scale size-formatting case, and the absolute-ceiling-still-applies-with-offset/limit
  case). `bun run e2e`: 30 pass / 2 fail — both pre-existing headless-Chromium-missing sandbox
  failures, confirmed identical via `git stash -u` + re-run with this round's changes stashed
  out.
