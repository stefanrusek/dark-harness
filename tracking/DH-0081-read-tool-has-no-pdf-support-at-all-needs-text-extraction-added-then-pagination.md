---
spile: ticket
id: DH-0081
type: feature
status: refining
owner: stefan
resolution:
blocked_by: ["architect design pass in progress (dependency evaluation)"]
created: 2026-07-16
relations:
  depends_on: []
  relates_to: []
  supersedes: []
implementation:
  - repo: dark-harness
---

# DH-0081: Read tool has no PDF support at all — needs text extraction added, then pagination

## Summary

Split from DH-0073 (owner decision 2026-07-16): dh's Read tool has zero PDF awareness today -- no detection, no text extraction, nothing. Real Claude Code's Read tool supports paginated PDF reading (a 'pages' range parameter, required guidance above ~10 pages). Unlike DH-0073's Jupyter-notebook half (which is straightforward -- .ipynb is just JSON, no new dependency needed), this requires adding real PDF text extraction from scratch first, which raises a genuine single-binary-compilation dependency question (Constitution 2, bun build --compile) before pagination is even relevant.

## User Stories

### As an agent working with reference PDFs, I want Read to extract real text content, and to page through large PDFs

- Given a PDF file, when Read is called on it, then it returns real extracted text content
  (not a binary-refusal error, which is presumably what happens today given no PDF handling
  exists).
- Given a PDF over some page-count threshold (real Claude Code requires it above ~10 pages),
  when Read is called without a `pages` parameter, then it's guided to specify a page range,
  matching real Claude Code's behavior; when `pages` is given, only that range is extracted.

## Functional Requirements

- `src/agent/tools/read.ts`: add PDF detection (magic bytes: `%PDF-`) and real text
  extraction — this is genuinely new capability, not a tweak, and needs its own dependency
  decision (see Open Questions).
- Add a `pages` parameter (range syntax matching real Claude Code's own Read tool shape)
  once extraction exists, with the same required-above-N-pages guidance real Claude Code
  gives.

## Assumptions

- Split from DH-0073 (owner decision, 2026-07-16) specifically because this is a
  from-scratch capability addition, not a parity tweak — worth scoping/estimating
  separately from the Jupyter-notebook half.

## Risks

- PDF text-extraction quality varies significantly by library choice; "good enough" text
  extraction, not perfect layout fidelity, is the realistic bar.
- A real dependency is very likely required (no pure-Bun-native PDF parser is assumed to
  exist) — this is where the single-binary-compilation goal (Constitution §2, `bun build
  --compile`) gets a real test, similar to DH-0002's `@modelcontextprotocol/sdk` precedent
  (a justified dependency for a genuinely hard-to-hand-roll format), but PDF parsing quality
  varies more by library than MCP's protocol-correctness concern did — needs real evaluation,
  not just "pick one."

## Open Questions

- Which PDF-parsing library (if any) bundles cleanly through `bun build --compile` while
  giving acceptable text-extraction quality? Needs a real spike/evaluation before committing.
- Does this need architect review given the dependency-and-single-binary-compilation
  question (similar in shape to DH-0002's MCP SDK decision)? Recommend yes.

## Notes

> [!NOTE]
> Split from DH-0073 (owner decision, 2026-07-16) — the owner asked directly whether dh
> already had PDF support (it doesn't) and concluded the Jupyter and PDF halves of DH-0073
> deserved separate tickets given how different in scope/risk they actually are.
