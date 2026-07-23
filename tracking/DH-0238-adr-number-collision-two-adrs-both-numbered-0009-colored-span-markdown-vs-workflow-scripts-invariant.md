---
spile: ticket
id: DH-0238
type: bug
status: verifying
owner: stefan
resolution:
blocked_by: []
created: 2026-07-19
relations:
  depends_on: []
  relates_to: [DH-0226]
  supersedes: []
implementation:
  - repo: dark-harness
---

# DH-0238: ADR number collision: two ADRs both numbered 0009 (colored-span markdown vs Workflow-scripts invariant)

## Summary

docs/adr/0009-markdown-colored-span-subset.md and docs/adr/0009-workflow-scripts-vs-ad-hoc-agents.md both claim ADR 0009 (both accepted 2026-07-19 from the parallel DH-0206/DH-0226 work). ADR numbers must be unique — code cites 'ADR 0009' for both (src/markdown, src/tui, src/web, src/prompt for colored spans; src/agent/tools/workflow.ts + src/agent/workflow/runner.ts for workflow). Renumber one to 0010 and update its citations. Workflow ADR has far fewer citations (2 code sites) so renumbering it is cheapest.

## User Stories

### As a maintainer, I want each ADR to have a unique number, so citations are unambiguous

- Given the Workflow-scripts ADR is renumbered from 0009 to 0010, when I grep the repo for
  `ADR 0009`, then only citations of the colored-span markdown ADR remain (verified by
  `grep -rn "ADR 0009" . --include="*.md" --include="*.ts"` returning only colored-span
  hits).
- Given the renumbered ADR file, when I open `docs/adr/0010-workflow-scripts-vs-ad-hoc-agents.md`,
  then its own title and body reference "ADR 0010", not "ADR 0009" (verified by manual
  inspection during this ticket's implementation — no automated test covers ADR prose, per
  CLAUDE.md §9's scope to executable criteria wherever a test is meaningful; this criterion
  is not code-behavior-bearing).
- Given the two code citation sites (`src/agent/tools/workflow.ts`,
  `src/agent/workflow/runner.ts`), when I grep them for "ADR", then both cite "ADR 0010"
  (verified by `grep -n "ADR 00" src/agent/tools/workflow.ts src/agent/workflow/runner.ts`).

## Functional Requirements

- Rename `docs/adr/0009-workflow-scripts-vs-ad-hoc-agents.md` to
  `docs/adr/0010-workflow-scripts-vs-ad-hoc-agents.md` via `git mv`, preserving history.
- Update the file's own title (`# ADR 0009: ...` → `# ADR 0010: ...`); no other internal
  self-references to the old number existed.
- Update citation sites in `src/agent/tools/workflow.ts` and `src/agent/workflow/runner.ts`
  from "ADR 0009" to "ADR 0010".
- Update ticket references in `tracking/DH-0213-*.md` and `tracking/DH-0226-*.md` that cite
  "ADR 0009" meaning the Workflow-scripts ADR (both the "ADR 0009" text and the
  `0009-workflow-scripts-vs-ad-hoc-agents.md` filename reference).
- Leave `docs/adr/0009-markdown-colored-span-subset.md` and all its citations
  (`src/prompt/system-prompt.ts`, `docs/roster/iris.md`, `tracking/DH-0229-*.md`, etc.)
  unchanged — it keeps ADR 0009.
- Historical/descriptive mentions of the collision itself (e.g. `tracking/DH-0235-*.md`,
  which records finding this collision, and this ticket's own summary) are left as-is since
  they describe the incident, not live citations.

## Assumptions

- 0010 is confirmed the next free ADR number: `docs/adr/` topped out at 0009 (both
  colliding files) before this change; no other ADR has claimed 0010.

## Risks

- Low risk: mechanical rename + grep-driven citation fix, no runtime behavior change, no
  contracts/wire-schema touched.

## Open Questions

(none)

## Notes

### 2026-07-19 — implementation

Renumbered `docs/adr/0009-workflow-scripts-vs-ad-hoc-agents.md` to
`docs/adr/0010-workflow-scripts-vs-ad-hoc-agents.md` (git mv, preserving history). Updated
the file's own `# ADR 0009: ...` title line to `# ADR 0010: ...`. Updated both code
citation sites (`src/agent/tools/workflow.ts`, `src/agent/workflow/runner.ts`) and the two
ticket files that cited "ADR 0009" meaning the Workflow ADR (`tracking/DH-0213-*.md`,
`tracking/DH-0226-*.md`, including their filename reference to the renamed doc). Left
`docs/adr/0009-markdown-colored-span-subset.md` and its citations (src/prompt,
docs/roster/iris.md, tracking/DH-0229) untouched — it keeps 0009 per the ticket's cheaper-
to-leave-in-place call. Verified via repo-wide grep that no remaining "ADR 0009" citation
resolves to the Workflow ADR, and no remaining "0009-workflow-scripts" filename reference
exists outside historical/descriptive mentions (DH-0235's incident record, this ticket's
own summary).
