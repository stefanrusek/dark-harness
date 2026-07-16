---
spile: ticket
id: DH-0073
type: feature
status: closed
owner: stefan
resolution: done
blocked_by: []
created: 2026-07-16
relations:
  depends_on: []
  relates_to: [DH-0046, DH-0081]
  supersedes: []
implementation:
  - repo: dark-harness
---

# DH-0073: Read tool has no Jupyter-notebook awareness, and there is no NotebookEdit equivalent

## Summary

**Scope narrowed by owner decision (2026-07-16):** the PDF half of this ticket split out to
**DH-0081** (a genuinely bigger, from-scratch capability — dh has zero PDF support today,
unlike Jupyter notebooks which are "just" JSON). This ticket covers only Jupyter-notebook
awareness. Real Claude Code's Read tool understands `.ipynb` files (returns cells with
code/text/outputs combined, not raw notebook JSON), and there is a separate NotebookEdit tool
for structured cell-level edits. dh's Read tool (`src/agent/tools/read.ts`) treats every file
as plain text/binary with no notebook awareness, and dh has no NotebookEdit tool at all.

## User Stories

### As an agent working in a data-science repo, I want to read a Jupyter notebook's cells and outputs, not raw JSON

- Given a `.ipynb` file, when Read is called on it, then the result presents cells (code/
  markdown) and their outputs in a readable form, not the raw notebook JSON as undifferentiated
  text.

### As an agent editing a notebook, I want a structured cell-edit tool instead of hand-editing notebook JSON via Edit

- Given a specific cell in a `.ipynb` file, when I want to change its source, then a
  NotebookEdit-equivalent tool lets me target that cell directly, rather than crafting an
  `old_string`/`new_string` Edit against raw JSON (fragile: whitespace/escaping in JSON
  string literals makes exact-match editing error-prone).

## Functional Requirements

- `src/agent/tools/read.ts`: add `.ipynb` detection (it's JSON — no new dependency needed)
  and cell-aware rendering (code cells, markdown cells, and their outputs presented
  readably).
- New tool: NotebookEdit-equivalent (`src/agent/tools/notebook-edit.ts` or similar) taking a
  file path, cell index/id, and new cell source; wire into `ALL_TOOLS` (Core, per
  `src/agent/` ownership in Constitution §3).
- Follow the same read-before-write guard convention (`read-guard.ts`) that Edit/Write use,
  if applicable to notebook cell edits.

## Assumptions

- This is scoped separately from DH-0046 (image/multimodal input, screenshot tool) — no
  overlap to reconcile beyond both touching `src/agent/tools/read.ts`. Notebook outputs can
  include images (matplotlib plots etc.); rendering those meaningfully likely depends on
  DH-0046's image-channel work landing — acceptable to render a placeholder for image
  outputs until then, rather than blocking this ticket on DH-0046.

## Risks

- None significant — `.ipynb` is a well-specified JSON format, no external dependency
  needed, no single-binary-compilation concern (unlike DH-0081's PDF half).

## Open Questions

- Should NotebookEdit be a wholly separate tool, or could Edit be extended with a
  notebook-aware mode? Recommend mirroring real Claude Code's separate-tool shape rather
  than inventing something new.

## Notes

> [!NOTE]
> Found 2026-07-16 during the systematic tool-schema/behavior comparison against real
> Claude Code prompted by the owner following DH-0069. Relates to DH-0046 (image/
> multimodal input) as a sibling gap in Read's file-type coverage, not a duplicate.

> [!NOTE]
> Owner decision (2026-07-16): split the PDF half out to DH-0081 — this ticket (Jupyter only)
> is straightforward enough to queue directly; DH-0081 needs its own dependency evaluation
> first.
