---
spile: ticket
id: DH-0079
type: bug
status: draft
owner: stefan
resolution:
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
