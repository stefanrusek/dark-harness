---
spile: ticket
id: DH-0235
type: bug
status: refining
owner: stefan
resolution:
blocked_by: []
created: 2026-07-19
relations:
  depends_on: []
  relates_to: []
  supersedes: []
implementation:
  - repo: dark-harness
---

# DH-0235: Refactoring round: PR#10 wave sweep (monogram/header/palette, MCP OAuth, Workflow, colored-span markdown)

## Summary

Sixth refactoring round (DH-0141), scoped to commits a6b51c8..HEAD (DH-0222 trailer to now). Reviews the PR#10 wave and DH-0229..0234 live-testing fixes. Findings and close-out land in this ticket body.

## Round close-out (Fable, 2026-07-19)

A refactoring round is a coordination artifact, not a code-behavior ticket, so it carries no
User Stories / Functional Requirements of its own — the User-Story→test discipline (CLAUDE.md
§9) applies to the implementation tickets it files, each of which is tracked separately.

### Reviewed

- All 30 commits `a6b51c8..HEAD` (DH-0222's trailer through `63f0e66`), spanning the PR#10
  wave merge and the fresh round-2 branch start.
- **Full-diff read:** `src/prompt/system-prompt.ts` (the three-edit live-testing pass —
  DH-0206/0229/0233/0234 Output-format + Available-tools sections), `src/design-tokens.ts`
  (BRAND vs STATUS_TOKENS palette), `src/prompt/banner.constant.ts` + `src/header-info.ts`
  + `src/cli/header.ts` (monogram/figlet transition), `src/agent/workflow/runner.ts` +
  `src/agent/tools/workflow.ts` (Workflow MVP), and the two new ADRs under `docs/adr/`.
- **Spot-checked:** the MCP-OAuth (DH-0057) tests, README hero / social-preview
  (DH-0227/0228), and the TUI/markdown bug fixes (DH-0230/0231/0232). Self-contained,
  well-tested, no residual seams worth a ticket.
- **Coverage note (no silent truncation, §8):** read the wave's core src diffs in full;
  sampled the asset/README/test-only commits rather than every line.

### Filed

- **DH-0236** (bug, draft, Prompt) — `DH_ASCII_LOGO` / `DH_ASCII_LOGO_COMPACT` in
  `banner.constant.ts` are now dead: DH-0224 migrated every live surface (doctor/init/TUI/Web)
  onto `HEADER_B_GLYPH` / `HEADER_A2_WORDMARK_PLAIN`, leaving only the constants' own test file
  referencing them. This is exactly the diamond→monogram sweep DH-0224 didn't finish (the prior
  round DH-0222 correctly judged them *still live* at that time; DH-0224's own implementation
  is what orphaned them). Delete both + tests, or document the retention.
- **DH-0237** (bug, draft, Prompt) — `REQUIRED_CONTRACT` has become a grab-bag: its doc comment
  still says "TASK_FAILED convention + logging notice," but it now also embeds the entire
  `## Output format` section (markdown, colored spans, ASCII art — heavily expanded across three
  separate live-testing edits this wave) plus `## Logging`. Because `REQUIRED_CONTRACT` is
  always appended after a `config.systemPrompt` override, operators silently inherit all of that
  client-rendering guidance with no doc noting it. Extract the Output-format guidance into its
  own named constant and make the append-after-override decision explicit. (This is the
  "accreted awkwardly across three edits" concern from the dispatch brief — the *content* reads
  fine; the *structure/naming* is what drifted.)
- **DH-0238** (bug, draft, Coordinator/docs/adr) — **ADR number collision**:
  `0009-markdown-colored-span-subset.md` and `0009-workflow-scripts-vs-ad-hoc-agents.md` both
  claim ADR 0009 (both accepted 2026-07-19 from the parallel DH-0206/DH-0226 work), and code
  cites "ADR 0009" for both meanings. Renumber one to 0010 and update citations; the workflow
  ADR has the fewer citations (2 code sites).

### Considered and deliberately NOT filed

- **BRAND vs STATUS_TOKENS palette coexistence:** explicitly documented as deliberate in
  `design-tokens.ts` ("the two tables coexist here but are never merged") — respected, not
  relitigated. The one concrete same-glyph green divergence was already routed to DH-0225
  (resolved) by the prior round. Observed but not filed: `BRAND.leadOrange` (#E0AF68) vs
  `STATUS_TOKENS.waiting.webHex` (#f5a524) are both "attention orange" at different hexes, but
  leadOrange drives no status glyph, so there is no cross-surface *same-glyph* collision like
  the green had — filing it would be speculative palette-merging, not a real inconsistency.
- **`chooseHeaderMode` (DH-0223):** already resolved — it was deleted; only a historical
  comment in `run.ts` names it now. Nothing to file.
- **Workflow system-prompt example:** verified `wf.agent`/`wf.parallel`/`wf.log` and the
  `(wf, input) => any` default-export shape against `src/agent/workflow/runner.ts` — the prose
  example matches the real API, including the "failing thunk resolves to null" semantics. No
  doc drift.
- **Duplicate auto-logging prose** (`## Logging` in REQUIRED_CONTRACT vs `renderSelfInfoSection`'s
  per-agent paragraph): acknowledged in-code as intentional (DH-0215, general vs
  session/agent/path-specific). Not filed.

### Process note (spile-ops counter, DH-0217 recurrence)

Filing this round tripped the DH-0217 concurrent-worktree counter bug live: `tracking/README.md`
`counter:` was stale at 229 while tickets DH-0230..0234 already existed, so `new_ticket.py`
minted a colliding `DH-0230`. Recovered by deleting the bad file and resetting `counter:` to 234
(true max) before re-minting at DH-0235. This is direct corroborating evidence for the still-open
DH-0217 — worth prioritizing.

### Escalation

- Nothing tripped a §6 escalation trigger. DH-0238 touches `docs/adr/` but is a numbering-hygiene
  fix (renumber + citation update), not a relitigation of either decision, so it is a routine
  Coordinator ticket, not an architect escalation.

## Notes

- No product code touched this round (refactoring rounds produce tickets only).
