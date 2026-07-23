---
spile: ticket
id: DH-0239
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

# DH-0239: Refactoring round 2: verify round-1 fixes + fresh sweep (DH-0236/0237/0238 follow-up)

## Summary

Seventh refactoring round (DH-0141), round 2 of the owner's 3-round loop. Verifies DH-0236/0237/0238 landed clean and runs a fresh full-repo sweep. Findings and close-out land in this ticket body.

## Round close-out (Fable, 2026-07-19)

A refactoring round is a coordination artifact, not a code-behavior ticket, so it carries no
User Stories / Functional Requirements of its own — the User-Story→test discipline (CLAUDE.md
§9) applies to the implementation ticket it files (DH-0240), tracked separately.

This round had a narrower brief than a normal round: round 1 (DH-0235) already swept the whole
PR#10 wave; its three findings landed as small mechanical fixes. Round 2's job was (1) verify
those fixes landed clean with no loose ends, and (2) a deeper pass on the areas round 1
explicitly only *spot-checked* (MCP-OAuth, README hero/social, TUI/markdown fixes).

### Part 1 — round-1 fixes verified clean

- **DH-0236** (delete `DH_ASCII_LOGO` / `DH_ASCII_LOGO_COMPACT`): grep across `src/`, `README.md`,
  and all `*.ts`/`*.md` (excluding the historical `tracking/`/`docs/roster/` record) finds **zero**
  live references to the deleted constants — no orphaned comment, doc, or README mention. Clean.
- **DH-0237** (`OUTPUT_FORMAT_SECTION` split out of `REQUIRED_CONTRACT`): the extraction reads
  well. New constant has an accurate doc comment; both the default path (`BASE_PROMPT`) and the
  override path (`loadSystemPrompt`) append `REQUIRED_CONTRACT` **then** `OUTPUT_FORMAT_SECTION`
  in the same explicit order; the module header, the two constants' doc comments, and the
  `loadSystemPrompt` comment all now describe the two-constant shape correctly. No stale
  "TASK_FAILED only" wording left behind. Clean.
- **DH-0238** (ADR 0009/0010 renumber): both files exist (`0009-markdown-colored-span-subset.md`,
  `0010-workflow-scripts-vs-ad-hoc-agents.md`) with no collision. Every code citation resolves to
  the right decision — all `src/markdown/`, `src/tui/markdown-ansi.ts`, `src/web/client/markdown-dom.ts`
  cite **ADR 0009**; `src/agent/tools/workflow.ts` + `src/agent/workflow/runner.ts` cite **ADR 0010**;
  the workflow ADR's own body consistently references itself as 0010 and "invariant 8". No dangling
  "ADR 0009" pointing at the workflow meaning. Clean.

### Part 2 — deeper pass on round-1's spot-checked areas

- **MCP OAuth (DH-0057):** found two real dead-code items → filed **DH-0240** (see below).
  Otherwise well-factored: expiry math centralized, secrets-never-logged consistent, error→result
  mapping clean, coverage exercises status/begin/complete + CSRF state-mismatch + already-authed +
  client_credentials paths.
- **Markdown colored-span (DH-0206):** clean. The color **allowlist** is single-sourced
  (`NAMED_COLORS` + `validateColor`, `src/markdown/index.ts:557-585`) and runs at parse time, so
  both renderers receive an already-validated color. The TUI's `NAME_TO_SGR` is a distinct concern
  (name→ANSI-16 mapping, not an allowlist); the Web side just assigns `style.color`. No grammar or
  allowlist duplication across the three files.
- **TUI/markdown fixes DH-0230/0231/0232:** clean. DH-0230 (mouse chunk-boundary) and DH-0231
  (input wrap) are tidy well-tested commits; DH-0232 added regression tests only and correctly
  documented that no production change was needed (already covered by DH-0065). No leftover cruft.
- **README hero/social (DH-0227/0228):** no stale references to deleted constants or removed
  features; nothing to file.

### Filed

- **DH-0240** (bug, draft, Core / `src/agent/mcp/`) — two dead-code items from DH-0057: an unused
  `resourceMetadataUrl?` field on `StoredMcpAuth` (declared, never read/written), and an
  unreachable `alreadyAuthenticated: true` on the `client_credentials` begin return (the tool
  handler branches on `grant` first and returns before ever reading it). The ticket explicitly
  fences off the *other*, live `alreadyAuthenticated` on the `authorization_code` return so a fix
  doesn't over-delete. Optional co-located note: façade `status/begin/complete` vs manager
  `authStatus/beginAuth/completeAuth` naming drift, only if the code is touched anyway.

### Considered and deliberately NOT filed

- **`NAMED_COLORS` ↔ `NAME_TO_SGR` sync hazard:** the parser allowlist (12 names, `markdown/index.ts`)
  and the TUI's name→SGR map (same 12 names, `markdown-ansi.ts`) must agree, but an existing test
  (`markdown-ansi.test.ts:198-206`) and the `NAME_TO_SGR` doc comment **already acknowledge this in
  code** and pin the fail-soft behavior: an allowlisted name with no SGR entry degrades to plain
  text by design, referencing ADR 0009. Adding a sync-enforcing guard would relitigate an
  acknowledged decision, not fix a defect — same category as DH-0235's "not filed" list.
- **Round 1's own already-declined items** (BRAND vs STATUS_TOKENS coexistence, `chooseHeaderMode`,
  the Workflow prompt example, duplicate logging prose) — re-confirmed still not worth reopening; no
  new evidence.

### Coverage note (no silent truncation, §8)

Only three code commits exist since round 1's sentinel (the DH-0236/0237/0238 fix commits themselves)
— those were read in full. The "fresh sweep" was therefore the deeper re-review of the four
spot-checked areas above rather than a new commit range. `TODO`/`FIXME`/`@ts-ignore` scan across
`src/` surfaced only justified `biome-ignore` pragmas (each with an inline rationale) — nothing to file.

### Escalation

- Nothing tripped a §6 escalation trigger. DH-0240 is a routine Core-domain dead-code cleanup.

## Notes

- No product code touched this round (refactoring rounds produce tickets only).
