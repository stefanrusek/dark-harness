---
spile: ticket
id: DH-0073
type: feature
status: draft
owner: stefan
resolution:
blocked_by: []
created: 2026-07-16
relations:
  depends_on: []
  relates_to: [DH-0046]
  supersedes: []
implementation:
  - repo: dark-harness
---

# DH-0073: Read tool has no Jupyter-notebook or PDF awareness, and there is no NotebookEdit equivalent

## Summary

Real Claude Code's Read tool understands .ipynb files (returns cells with code/text/outputs combined) and paginated PDF reading (a 'pages' range parameter, required guidance above 10 pages), and there is a separate NotebookEdit tool for structured cell-level notebook edits. dh's Read tool (src/agent/tools/read.ts) treats every file as plain text/binary with no notebook or PDF awareness, and dh has no NotebookEdit tool at all. This is distinct from DH-0046 (image/multimodal input + screenshot tool), which does not cover notebooks or PDFs.

## User Stories

### As an agent working in a data-science repo, I want to read a Jupyter notebook's cells and outputs, not raw JSON

- Given a `.ipynb` file, when Read is called on it, then the result presents cells (code/
  markdown) and their outputs in a readable form, not the raw notebook JSON as undifferentiated
  text.
- Given a multi-page PDF, when Read is called with a `pages` range, then only that page
  range is returned, matching real Claude Code's guidance (required above ~10 pages).

### As an agent editing a notebook, I want a structured cell-edit tool instead of hand-editing notebook JSON via Edit

- Given a specific cell in a `.ipynb` file, when I want to change its source, then a
  NotebookEdit-equivalent tool lets me target that cell directly, rather than crafting an
  `old_string`/`new_string` Edit against raw JSON (fragile: whitespace/escaping in JSON
  string literals makes exact-match editing error-prone).

## Functional Requirements

- `src/agent/tools/read.ts`: add `.ipynb` detection and cell-aware rendering; add PDF
  detection and a `pages` parameter (mirroring the shape of Claude Code's own Read tool,
  which already documents a `pages` param for PDFs in this very session's own tool
  definition).
- New tool: NotebookEdit-equivalent (`src/agent/tools/notebook-edit.ts` or similar) taking a
  file path, cell index/id, and new cell source; wire into `ALL_TOOLS` and directory
  ownership (Core, per `src/agent/` ownership in Constitution §3).
- Follow the same read-before-write guard convention (`read-guard.ts`) that Edit/Write use,
  if applicable to notebook cell edits.

## Assumptions

- This is scoped separately from DH-0046 (image/multimodal input, screenshot tool) --
  DH-0046's design doc covers image content blocks and a Screenshot tool, not notebooks or
  PDFs. No overlap to reconcile beyond both touching `src/agent/tools/read.ts`.
- Whether PDF support requires a bundled PDF-parsing library (Bun/npm dependency) versus
  shelling out is an implementation detail for whoever picks this up; flagged as an open
  question below since it affects the single-binary compilation story (Constitution §2).

## Risks

- PDF text extraction quality varies significantly by library; may need to accept
  "good enough" text extraction rather than perfect layout fidelity.
- Notebook outputs can include images/binary data (matplotlib plots etc.) -- rendering
  those meaningfully likely depends on DH-0046's image-channel work landing first.

## Open Questions

- Does PDF support pull in a new dependency, and if so, does that conflict with the
  single-compiled-binary goal (`bun build --compile`), or is a pure-JS/Bun-native parser
  available?
- Should NotebookEdit be a wholly separate tool, or could Edit be extended with a
  notebook-aware mode? (Real Claude Code keeps them separate tools; recommend mirroring
  that rather than inventing a new shape.)

## Notes

> [!NOTE]
> Found 2026-07-16 during the systematic tool-schema/behavior comparison against real
> Claude Code prompted by the owner following DH-0069. Relates to DH-0046 (image/
> multimodal input) as a sibling gap in Read's file-type coverage, not a duplicate.
