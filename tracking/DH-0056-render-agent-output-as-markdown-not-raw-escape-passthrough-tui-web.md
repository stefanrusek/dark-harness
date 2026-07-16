---
spile: ticket
id: DH-0056
type: feature
status: ready
owner: stefan
resolution:
blocked_by: []
created: 2026-07-15
relations:
  depends_on: []
  relates_to: [DH-0025]
  supersedes: [DH-0025]
implementation:
  - repo: dark-harness
---

# DH-0056: Render agent output as Markdown, not raw escape passthrough (TUI+Web)

## Summary

Supersedes DH-0025's original ANSI-sanitization story. Instead of trying to allowlist/strip a stream of untrusted raw escape bytes, treat agent output as Markdown: the system prompt instructs models that all text output is Markdown, and each client owns rendering it -- TUI converts Markdown to ANSI using only a small, client-controlled set of safe SGR codes (color/bold/etc, never OSC/cursor/DA-DSR sequences), Web converts Markdown to sanitized HTML. Since neither renderer ever passes model-authored escape bytes through verbatim, the entire class of terminal-hijack/clipboard-injection/input-injection attacks described in DH-0025 becomes structurally impossible rather than defended-against by a blocklist. Real UX upgrade too (actual formatted output) alongside the security fix.

## User Stories

### As an operator, I want agent output rendered in my terminal/browser to never be able to hijack terminal state, elicit unwanted terminal responses, or write to my clipboard

- Given the system prompt instructs the model that all text output is Markdown, when the TUI
  renders a turn, then it parses that Markdown itself and emits ANSI only from a small,
  client-controlled allowlist (color/bold/italic/code-span/list/heading styling) — never
  passing any byte of the model's own raw text through as a literal escape sequence.
- Given the same for Web, when a turn renders, then Markdown is converted to sanitized HTML
  (escaping raw HTML in the source rather than interpreting it) and inserted safely — no
  `innerHTML` on unsanitized content, preserving the existing "no XSS sink" property
  (confirmed clean today via `textContent`/`createTextNode`, per the TUI/Web security sweep).
- Given a model doesn't comply with the Markdown-output instruction and emits raw control
  bytes anyway, when either client renders it, then those bytes are still neutralized as a
  defensive fallback (strip C0 controls / ESC sequences from the raw text before Markdown
  parsing even begins) — the instruction is the primary defense, not the only one.

### As an operator, I want agent output to actually look nice, not just be safe

- Given a response containing headings, bold/italic text, inline code, code blocks, or
  lists, when rendered, then each client shows real visual formatting appropriate to its
  medium (ANSI styling for TUI, real HTML elements for Web) instead of raw Markdown syntax
  characters.

## Functional Requirements

- Given any Markdown construct the parser doesn't recognize, when rendering, then it degrades
  gracefully to plain text rather than erroring or corrupting the frame.
- Given the DA/DSR terminal-response-eliciting sequences DH-0025 specifically flagged (a
  terminal query whose reply gets written back into the app's own stdin as if it were a
  keystroke), when the defensive fallback strips raw escapes, then these are explicitly
  covered, not just generic "control characters."

## Design (architect pass — Fable, 2026-07-15)

This section is the implementable spec. It replaces the former Assumptions and Open
Questions sections; where an assumption was confirmed or adjusted, that's noted inline.

### D1. Markdown subset ("dh Markdown")

Zero dependencies — no Markdown package exists in `package.json` today and none is added.
A full CommonMark implementation is explicitly out of scope (confirmed from the original
assumption); the subset below is what models reliably produce and is small enough to parse
in ~300 lines with 100% coverage.

**Block constructs:**

- Paragraphs. *Deliberate CommonMark deviation:* single newlines inside a paragraph are
  preserved as line breaks, not soft-wrap-joined — transcripts render line-for-line today
  and re-flowing streamed agent output would be surprising.
- ATX headings `#`–`######` (space after hashes required). No setext headings.
- Fenced code blocks: ` ``` ` or `~~~`, with optional info string. **Streaming rule:** an
  unclosed fence at end-of-input is treated as closed — the still-growing last turn renders
  its partial code block as code, deterministically, on every chunk.
- Lists: unordered (`-`, `*`, `+`) and ordered (`1.` / `1)`), with nesting via 2+ spaces of
  indentation. List items may contain nested blocks (paragraph, nested list, code fence).
- Blockquotes (`> `), nestable.
- Thematic break: `---`, `***`, or `___` alone on a line.

**Inline constructs:**

- Strong `**`/`__`, emphasis `*`/`_`, strikethrough `~~`.
- Inline code: single backticks, plus `` `` … `` `` double-backtick form for literal
  backticks. Inline formatting is not parsed inside code spans.
- Links `[text](url)`. Images `![alt](url)` render as links (alt text as the link text) —
  neither client can display images.

**Explicitly not parsed — degrades to literal text** (per the Functional Requirements
graceful-degradation rule): tables (rows show as literal pipe text; future extension),
setext headings, reference-style links, autolinks, footnotes, hard-break trailing-space
semantics. **Raw HTML is always literal text** — this is a security property of the
grammar, not a degradation: the AST simply has no HTML node type, so `<script>` in model
output can never become markup in either client.

### D2. One shared parser, two renderers (decision)

**Decision: a single shared parser in a new `src/markdown/` directory, producing an AST
that TUI and Web each render with their own domain-owned renderer.** Two independent
parsers were considered and rejected:

- The ticket's own consistency requirement ("both parse the same Markdown subset
  consistently") is a drift magnet with two implementations — every grammar tweak would
  need mirrored edits and mirrored tests across two domains.
- The defensive control-byte strip (D5) must be byte-identical in both clients; sharing it
  is the only way to guarantee that, and it belongs fused to the parser (see D5).
- The 100%-coverage gate is paid once instead of twice.
- Bundle-size cost to Web is negligible (~300 lines of pure TS), and the mechanism already
  exists: the web client is bundled via Bun's HTML import and already does runtime imports
  from outside `src/web/` (`src/web/client/commands.ts` imports from
  `../../contracts/index.ts`), so a `src/`-level shared module is established practice,
  not a new precedent.
- Domain-separation concern (the reason the ticket left this open): resolved by giving
  `src/markdown/` **contracts-style governance** — it is shared truth like
  `src/contracts/`; grammar/AST changes require architect sign-off (CLAUDE.md §6.2 applies
  by extension). Ada should add a `src/markdown/` row to the CLAUDE.md §3 ownership table
  when dispatching.

**Constraints on the module:** pure ESM TypeScript, no Bun globals, no DOM globals — it
must typecheck in both TS programs (root and `src/web/tsconfig.json`) and run in both the
compiled binary and the browser bundle. No I/O, fully pure functions.

**Module contract** (`src/markdown/index.ts`):

```ts
export type InlineNode =
  | { kind: "text"; text: string }
  | { kind: "strong"; children: InlineNode[] }
  | { kind: "emphasis"; children: InlineNode[] }
  | { kind: "strike"; children: InlineNode[] }
  | { kind: "code"; text: string }
  | { kind: "link"; children: InlineNode[]; url: string };

export type BlockNode =
  | { kind: "paragraph"; children: InlineNode[] }   // children may include line breaks as text "\n"
  | { kind: "heading"; level: 1 | 2 | 3 | 4 | 5 | 6; children: InlineNode[] }
  | { kind: "codeBlock"; info: string; text: string }
  | { kind: "list"; ordered: boolean; start: number; items: BlockNode[][] }
  | { kind: "blockquote"; children: BlockNode[] }
  | { kind: "thematicBreak" };

/** Defensive control/escape strip (D5). Exported for direct testing and for plain-text
 *  call sites (e.g. user turns), pure and idempotent. */
export function sanitizeText(raw: string): string;

/** Parse dh Markdown. Applies sanitizeText() unconditionally as step zero — a client
 *  cannot forget the fallback because it cannot bypass it. */
export function parseMarkdown(raw: string): BlockNode[];
```

Parsing the *whole* turn text on each streamed chunk (rather than incremental parsing) is
the intended usage — turns are bounded and both clients already re-render per event; the
streaming determinism rules (unclosed fence, above) make repeated whole-turn parses stable.

### D3. TUI rendering and the exact safe-SGR allowlist

New file `src/tui/markdown-ansi.ts` (Mary's domain): `BlockNode[] -> styled rows`,
integrated into `renderTranscript` for **assistant turns**; user turns stay plain text but
are passed through `sanitizeText` (they're echoed input, not Markdown). Keeps `render.ts`'s
pure `TuiState -> string[]` architecture.

**Wrapping/ANSI interaction (load-bearing):** `wrapText`'s plain-char slicing must never
see SGR bytes. The renderer works in a styled-segment domain — `{ text, style }[]` per
logical line — wraps by measuring *plain text only*, and serializes ANSI at the last step.
Every emitted row is self-contained: styles are re-opened at the start of a wrapped
continuation row and every styled row ends with `\x1b[0m`, so `tailLines` slicing and
`frameToAnsi`'s per-row `\x1b[K` framing stay row-local and no style can leak into
header/footer rows. (This segment representation is also exactly what DH-0025's remaining
grapheme-width fix needs to measure — coordinate the two, they're synergistic.)

**Exact SGR allowlist** — the *only* escape sequences this renderer may emit, kept as a
single `const` table so the allowlist is one grep-able place:

| Code | Meaning | Used for |
| --- | --- | --- |
| `0` | reset | end of every styled row / style boundary |
| `1` | bold | headings, strong |
| `2` | dim | blockquote text, code-block gutter |
| `3` | italic | emphasis |
| `4` | underline | links, h1 |
| `7` | inverse | (already in use: cursor marker) |
| `9` | strikethrough | `~~…~~` |
| `30`–`37`, `90`–`97`, `39` | standard/bright foreground, default fg | inline code (36 cyan), links (34 blue), existing status colors |

No background codes, no `38;5`/`38;2` (256/true-color) — 16-color foreground keeps every
terminal in scope, and backgrounds interact badly with `\x1b[K`. Suggested mapping (Mary's
taste prevails within the allowlist): headings bold (h1 also underlined), inline code cyan,
code blocks dim `│`-guttered, links underlined blue with the URL shown after the text as
`text (url)` — the TUI deliberately does **not** emit OSC 8 hyperlinks (see below), so the
URL must be visible.

**Excluded sequence classes and why** (these are the attack surface DH-0025/this ticket's
summary describe; exclusion is structural — the renderer concatenates only allowlist
constants, model bytes never reach output unsanitized):

- **OSC (`ESC ]`)** — OSC 52 writes to the system **clipboard** (the clipboard-injection
  attack in this ticket's summary: model output plants a payload the operator later pastes
  into a shell); OSC 0/2 set window titles (spoofing, and some terminals allow title
  *readback*, an input-injection vector). Includes OSC 8 hyperlinks: URL is
  attacker-controlled and rendering-invisible, so links stay visible-text-only.
- **DCS (`ESC P`)**, plus SOS/PM/APC — device control strings; DECRQSS elicits terminal
  *replies* (the classic xterm DECRQSS answerback injection), Sixel can draw over the UI.
- **Cursor movement / erase / scroll-region CSI** (CUP, CUU/CUD/CUF/CUB, ED, EL, DECSTBM,
  …) — rewrites arbitrary parts of the alt-screen frame: the terminal-hijack class — a
  model could overwrite the status line, forge UI chrome, or hide its own output.
- **DA/DSR (`ESC [ c`, `ESC [ > c`, `ESC [ 5 n`, `ESC [ 6 n`)** — the terminal writes its
  response to the application's **stdin as if typed**: model output becomes keystrokes into
  the TUI's own input handler (the input-injection attack DH-0025 specifically flagged).
- **Private mode set/reset (`ESC [ ? … h/l`)** — toggling alt-screen, mouse reporting, or
  bracketed paste desyncs the TUI's terminal-state assumptions (bracketed-paste toggling
  also composes with paste-based injection).
- Any other `ESC`-introduced sequence and all raw C1 bytes.

### D4. Web rendering

New file `src/web/client/markdown-dom.ts` (Susan's domain): `BlockNode[] -> HTMLElement`,
built **programmatically** in the exact style `render.ts` already uses — `createElement`
per AST node, `textContent`/`createTextNode` for every literal text span. **Never**
`innerHTML`/`outerHTML`/`insertAdjacentHTML` — this preserves the "no XSS sink" property
the TUI/Web sweep confirmed. Raw HTML in model output is inert by construction (D1: no
HTML node type exists to render).

- Element mapping: heading → `<h1>`–`<h6>`, paragraph → `<p>` (with `<br>` for preserved
  line breaks), code span → `<code>`, code block → `<pre><code>` with
  `class="language-<info>"` where info is filtered to `[a-z0-9-]` (class-attribute
  hygiene), lists → `<ul>`/`<ol start=N>`/`<li>`, blockquote → `<blockquote>`, thematic
  break → `<hr>`, strong/em/strike → `<strong>`/`<em>`/`<del>`.
- **Links:** validate with `new URL(url, …)`; allow only `http:`, `https:`, `mailto:`
  schemes — anything else (`javascript:`, `data:`, scheme-relative tricks) renders as plain
  text, not a link. Allowed links get `rel="noopener noreferrer"` and `target="_blank"`,
  href set via the property, never string-built markup.
- Integration: `buildTurnElement` renders assistant turns through the Markdown renderer;
  user turns remain `textContent` as today. The `appendTranscript` **streaming fast path
  changes**: it currently appends a raw text node to the growing last turn — with Markdown
  that's wrong (a chunk can retro-change structure, e.g. close a fence). Instead, re-parse
  the last turn's full text and rebuild its `.turn-text` via `replaceChildren` per chunk;
  new-turn appends are unchanged. One turn per event — still cheap; `TranscriptRenderState`
  keeps working as the "which turns exist" snapshot.

### D5. Defensive fallback — `sanitizeText` (shared, unbypassable)

Lives in `src/markdown/`, runs **inside `parseMarkdown` as step zero**, so both clients
inherit it identically and neither can skip it. The system-prompt instruction (D6) is the
primary defense; this is the guarantee when a model doesn't comply. Pure, idempotent.
Precisely:

1. Normalize `CRLF` → `LF`; remove remaining lone `CR`.
2. Remove **complete escape sequences** introduced by `ESC` (0x1B):
   - CSI: `ESC [` + parameter/intermediate bytes (0x20–0x3F) + one final byte (0x40–0x7E).
     **This explicitly covers the DA/DSR case DH-0025 flagged** — `ESC [ c`, `ESC [ 0 c`,
     `ESC [ > c` (primary/secondary Device Attributes) and `ESC [ 5 n` / `ESC [ 6 n`
     (Device Status Report / cursor-position report) are ordinary CSI sequences and are
     removed whole — plus all cursor movement, erase, scroll-region, and mode sequences.
   - OSC: `ESC ]` … terminated by `BEL` (0x07) or `ST` (`ESC \`) — covers OSC 52 clipboard
     writes and title set/query.
   - DCS/SOS/PM/APC: `ESC P` / `ESC X` / `ESC ^` / `ESC _` … terminated by `ST`.
   - Any other `ESC x` two-byte sequence.
   - A trailing/malformed `ESC` that heads no well-formed sequence is removed alone (its
     tail then renders as visibly-garbled but *inert* literal text — acceptable by design).
3. Remove remaining C0 controls 0x00–0x08 and 0x0B–0x1F (keeping `\n` 0x0A and `\t` 0x09),
   and `DEL` 0x7F.
4. Remove C1 codepoints U+0080–U+009F, treating the 8-bit sequence introducers — CSI
   U+009B, OSC U+009D, DCS U+0090 — exactly like their `ESC`-prefixed forms (whole-sequence
   removal). Some terminals honor 8-bit C1 controls even in UTF-8 mode; these would survive
   an ESC-only strip, so they are covered explicitly.

TUI-side note: the alt-screen frame writer already only emits whole rendered frames, so
post-sanitize text containing only printables + `\n`/`\t` cannot alter terminal state;
`\t` may be expanded to spaces by the width-math work in DH-0025.

### D6. System prompt wording

Add to `REQUIRED_CONTRACT` in `src/prompt/system-prompt.ts` (not `DISCIPLINE_PROMPT`):
the clients parse output as Markdown *unconditionally*, so the instruction must survive an
operator `systemPrompt` override — same DH-0018 rationale that put `TASK_FAILED` there.
Insert as a new section between the `TASK_FAILED` bullet and `## Logging`:

```markdown
## Output format

All plain-text output you produce is rendered as Markdown by every Dark Harness client.
Write normal Markdown: headings, **bold**, *italic*, `inline code`, fenced code blocks,
lists, blockquotes, and [links](https://example.com) get real formatting. Anything else
is shown literally: raw HTML is never interpreted, and ANSI/VT escape sequences and other
control characters are stripped before rendering — never emit them for visual effect,
they cannot work. Put anything that must be reproduced byte-for-byte (code, diffs, logs)
inside a fenced code block.
```

### D7. Domain assignment and sequencing

| Piece | Owner | Notes |
| --- | --- | --- |
| `src/markdown/` parser + `sanitizeText` + AST (D1, D2, D5) | **Mary implements** per this spec; contracts-style governance thereafter (grammar/AST changes need architect sign-off). **Susan signs off on the AST shape before Web builds against it.** | Sequenced **first** — both renderers depend on it. Pure TS, no Bun/DOM globals, 100% coverage incl. hostile-bytes tests (DA/DSR, OSC 52, 8-bit C1, split surrogates). |
| TUI renderer `src/tui/markdown-ansi.ts` + `renderTranscript` integration (D3) | **Mary** | Parallel with Web once `src/markdown/` lands. Coordinate with DH-0025's width work (shared segment representation). |
| Web renderer `src/web/client/markdown-dom.ts` + `buildTurnElement`/`appendTranscript` changes (D4) | **Susan** | Parallel with TUI. |
| `REQUIRED_CONTRACT` addition (D6) + README note that output renders as Markdown | **Iris** | Independent — can land any time. |
| E2E: mock provider emits Markdown laced with hostile escapes (DA/DSR, OSC 52, cursor moves); PTY asserts the only ESC bytes on the wire-to-terminal are allowlisted SGR; browser asserts no unexpected elements and links are scheme-filtered | **Hedy** | After TUI+Web land. |
| CLAUDE.md §3 ownership row for `src/markdown/`; dispatch/merge | **Ada** | Add alongside dispatch. |

**Visual sanity check** (per Risks): before closing, eyeball a real session in both
clients — headings, a fenced block, a nested list, a link — not just the gates.

## Risks

- This changes what operators currently see (raw text) to formatted output — worth a quick
  visual sanity check across both clients before considering this fully done, not just gate-
  passing tests.
- The `appendTranscript` fast-path change (re-render last turn per chunk instead of
  appending a text node) trades a little per-event work for correctness; if a turn grows
  pathologically large this is O(turn) per chunk — acceptable now, revisit only if profiling
  ever says otherwise.

## Notes

> [!NOTE]
> Raised directly by the owner (2026-07-15) as the proposed fix during Bucket B triage
> discussion of DH-0025's ANSI-injection story. Supersedes that story entirely; DH-0025 itself
> is trimmed to keep only its unrelated wide-character/resize/redraw technical bugs, which
> have nothing to do with Markdown rendering and can proceed independently.
>
> Architect design pass completed 2026-07-15 (Fable): Design section D1–D7 above is the
> implementable spec; former Assumptions/Open Questions folded into it. Ready to dispatch —
> sequence `src/markdown/` (Mary) first, then TUI (Mary) + Web (Susan) in parallel; Prompt
> (Iris) is independent; E2E (Hedy) last. Ada: add the `src/markdown/` ownership row to
> CLAUDE.md §3 when dispatching (see D7).

