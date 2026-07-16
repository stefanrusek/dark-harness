---
spile: ticket
id: DH-0081
type: feature
status: closed
owner: stefan
resolution: done
blocked_by: []
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

## Architect design (Fable, 2026-07-16)

Design pass complete. Three candidate libraries were **empirically tested** (installed
under Bun 1.3.14 / macOS arm64, run in the interpreter, then compiled with
`bun build --compile` and the resulting binary executed standalone with `node_modules`
hidden, against generated 3-page and 12-page test PDFs with Flate-compressed content
streams). This is the same shape of dependency decision as DH-0002's MCP SDK call: a
genuinely hard-to-hand-roll format justifies a real dependency — but only one candidate
survives single-binary compilation.

### Library evaluation (tested, not assumed)

| Candidate | Interpreter | `bun build --compile` standalone | Verdict |
| --- | --- | --- | --- |
| **`unpdf` 1.6.2** | extraction correct, per-page selection via `getPage(n)` works | **PASS** — 3 modules bundled, binary runs with `node_modules` removed; +2.2MB over a baseline hello-world binary (63.4MB → 65.7MB) | **Recommended** |
| `pdf-parse` 2.4.5 | works (good layout fidelity) | **FAIL** — dynamically loads `@napi-rs/canvas` (native NAPI module, unresolvable inside the compiled binary), then crashes `ReferenceError: DOMMatrix is not defined` | Disqualified |
| `pdfjs-dist` 6.1.200 (legacy/Node build) | works (warns about `standardFontDataUrl` runtime file assets) | **FAIL** — identical root cause (pdf-parse v2 wraps pdfjs; the Node legacy build polyfills `DOMMatrix`/`Path2D`/`ImageData` via optional native canvas) | Disqualified |

Also verified for `unpdf`: MIT license; **zero transitive dependencies** (pdf.js is inlined
in its "serverless" rebuild, which is precisely what strips the native-polyfill and
worker/file-asset hazards the other two trip on); corrupt input (`%PDF-` prefix + garbage)
throws a catchable `InvalidPDFException` — a clean tool-error path, no crash.

### Real Claude Code parity target (inspected directly, 2026-07-16)

- `pages` is a **string** parameter: single page `"3"` or inclusive range `"1-5"`;
  schema documents **max 20 pages per request** and "required for PDFs over 10 pages".
- Observed: the over-10-pages requirement is *soft* in real CC — a 12-page PDF read
  without `pages` succeeded, because real CC's no-`pages` path attaches the whole PDF to
  the API (vision); its `pages` path shells out to poppler's `pdftoppm` and errors when
  poppler isn't installed. **dh must not copy either mechanism** (external tool dependency;
  API-side document vision). dh extracts text locally, so dh *enforces* the >10-pages rule
  as a real requirement — a deliberate, documented parity divergence.

## Functional Requirements

1. **Dependency:** add `unpdf@^1.6.2` to `dependencies`. No other new packages.
2. **Detection** (`src/agent/tools/read.ts`): after the existing size-cap and empty-file
   checks, check the already-sniffed prefix bytes (`sniffBytes`) for the 5-byte magic
   `%PDF-` (`0x25 0x50 0x44 0x46 0x2D`) at offset 0, **before** the NUL-byte `looksBinary`
   refusal (PDFs contain NUL bytes and would otherwise be refused as binary). On match,
   branch to the PDF path.
3. **Extraction (PDF path):** read the full file (`Bun.file(...).arrayBuffer()` — the
   existing 256MB `MAX_READABLE_BYTES` cap already bounds this; pdf.js requires the whole
   buffer regardless), `getDocumentProxy(data)` from `unpdf`, then extract **only the
   selected pages** via `pdf.getPage(n)` + `getTextContent()`. Join text items into lines
   using each item's `hasEOL` flag (newline) else a single space. Wrap parsing in
   try/catch: any `InvalidPDFException`/other parse error becomes a normal tool error
   (`isError: true`) naming the file and the failure — never a crash.
4. **`pages` parameter:** add to the tool's `inputSchema` (which lives in `read.ts` — tool
   input schemas are not `src/contracts/` wire types, no contracts change):
   `pages: { type: "string", description: "Page range for PDF files (e.g. \"1-5\", \"3\"). Only applicable to PDFs. Max 20 pages per request; required for PDFs over 10 pages." }`
   - Accepted forms: `"N"` and `"N-M"` (1-based, inclusive). Reject anything else with a
     tool error showing the accepted forms.
   - Validate `1 <= N <= M <= totalPages` and span `M - N + 1 <= 20`; errors name the
     document's actual page count so the model can immediately re-range.
   - No `pages` + `totalPages <= 10`: extract all pages.
   - No `pages` + `totalPages > 10`: tool error stating the page count and requiring a
     `pages` range (dh's hard enforcement of real CC's documented guidance — see parity
     note above).
   - `pages` on a non-PDF file: tool error ("'pages' only applies to PDF files").
   - `offset`/`limit` passed for a PDF: tool error directing to `pages` (explicit beats
     silently ignoring line-oriented parameters that have no meaning here).
5. **Output format:** not cat -n line-numbered (matches real CC, which returns document
   content without line numbers). Per page: a `--- Page N ---` header line followed by
   that page's extracted text; after the last requested page, a one-line notice with total
   page count and, when a subset was read, how to continue (next range). A page with no
   extractable text renders `[Page N: no extractable text — likely image-only/scanned]`.
6. **Read-guard:** still call `recordRead(ctx, absPath)` on every PDF outcome that reads
   the file, consistent with the existing branches.
7. **Tests (Core, `src/agent/tools/`):** unit tests generate (or check in) tiny fixture
   PDFs — the spike's generator produces a valid multi-page Flate-compressed PDF in ~40
   lines and can be ported to a TS test helper. Cover: magic-byte detection, whole-doc
   read ≤10 pages, >10-pages-without-`pages` refusal, `"N"`/`"N-M"` parsing, out-of-range /
   malformed / >20-span errors, corrupt-PDF error path, `pages`-on-text-file error,
   `offset`+PDF error, empty-text page notice. 100% coverage gate applies as usual.

## Assumptions

- Split from DH-0073 (owner decision, 2026-07-16) specifically because this is a
  from-scratch capability addition, not a parity tweak — worth scoping/estimating
  separately from the Jupyter-notebook half.
- **Tested vs assumed:** everything in the evaluation table above was executed, not
  assumed. Assumed (not tested): unpdf's behavior on encrypted PDFs (pdf.js throws
  `PasswordException` — the try/catch in req. 3 covers it either way); extraction quality
  on complex real-world layouts (multi-column, tables) — see quality bar below; Windows
  cross-compile (`--target bun-windows-x64`) was not exercised, but unpdf is pure JS with
  zero native/worker/file-asset loading, which is the property that breaks cross-target
  compiles.

## Text-extraction quality bar

"Good enough" for a coding agent reading a spec/design/reference PDF: correct reading
order and readable paragraphs for ordinary text PDFs. **Not** required: table/column
layout fidelity, font styling, OCR of scanned documents (image-only pages return the
explicit no-text notice instead of silently returning nothing). pdf.js (which unpdf
embeds) is the same engine Firefox uses and is the de-facto quality ceiling for pure-JS
extraction — candidates that beat it on layout (native poppler bindings) are exactly the
ones that can't survive `bun build --compile`.

## Risks

- **Binary size:** +2.2MB (measured) on a ~63MB baseline — negligible.
- **pdf.js major-version churn:** unpdf pins/inlines its own pdf.js build, so dh is
  insulated from pdfjs-dist's Node-environment regressions; the risk is unpdf itself going
  unmaintained. Mitigation: the integration surface is two functions
  (`getDocumentProxy`, per-page `getTextContent`) — swappable behind the PDF branch if
  ever needed.
- **Memory:** a PDF near the 256MB cap is fully buffered (pdf.js requirement). Bounded by
  the existing cap; the ≤20-pages-per-request rule bounds *output* size (~≤100k chars for
  dense text), not parse memory. Acceptable; do not add a second PDF-specific cap without
  evidence.
- **E2E blind spot:** the compile-survival property (the whole reason for this design) is
  only truly guarded by an e2e case that reads a fixture PDF through the **compiled**
  binary. Unit tests run in the interpreter and would not catch a future
  native-dep regression. Recommended follow-up: one small request to E2E (Hedy) adding a
  fixture-PDF read to the existing real-binary suite.

## Domain assignment

**Core (Grace) only** — `src/agent/tools/read.ts`, its tests, and the `package.json`
dependency line. No `src/contracts/` change (tool input schemas are tool-local, not wire
types). No Prompt/Server/TUI/Web touch. Optional follow-ups, not blockers: Prompt may
mention PDF support in the README feature list; E2E fixture-PDF case per the risk above.

## Open Questions

_None blocking — resolved by this design pass:_

- ~~Which PDF-parsing library bundles cleanly through `bun build --compile`?~~ →
  `unpdf@^1.6.2`, verified empirically (see evaluation table); `pdf-parse` and raw
  `pdfjs-dist` verified to **fail** compiled.
- ~~Does this need architect review?~~ → Done (this pass, 2026-07-16).

## Notes

> [!NOTE]
> Split from DH-0073 (owner decision, 2026-07-16) — the owner asked directly whether dh
> already had PDF support (it doesn't) and concluded the Jupyter and PDF halves of DH-0073
> deserved separate tickets given how different in scope/risk they actually are.
