# ADR 0009: A single allowlisted `<span style="color: …">` inline subset in the Markdown AST

**Status:** Accepted (2026-07-19, architect-on-call Fable, per CLAUDE.md §6.2 — grammar/AST
change to `src/markdown/`, governance-equivalent to `src/contracts/`). Implements DH-0206.

## Context

`src/markdown/index.ts` is the shared "dh Markdown" parser imported by both the TUI
(`src/tui/markdown-ansi.ts`) and the Web client (`src/web/client/markdown-dom.ts`). Its file
header states a load-bearing security invariant (from DH-0056):

> Raw HTML is always literal text: there is no HTML AST node type at all. That absence is the
> core security property this ticket exists for — a `<script>` tag in model output can never
> become markup in either client, because the AST has nothing that could render it as one.

The content this module renders is untrusted (model output, tool output shown in the
transcript). The zero-HTML-node design is what makes "an attacker-controlled `<script>`/
`<img onerror=…>`/`javascript:` payload can never become live markup" true *by construction*
rather than by the renderers each remembering to escape.

DH-0206 asks for one narrow capability: inline text coloring via
`<span style="color: red;">text</span>`, which today renders as literal text. Full inline
HTML is out of scope and unsafe. The question escalated to the architect is whether a single,
tightly-scoped colored-span node is an acceptable exception to "no HTML AST node type at all".

## Decision

**Accepted, as a semantic color node — not an HTML node.** We add exactly one new
`InlineNode` variant:

```ts
| { kind: "coloredSpan"; children: InlineNode[]; color: string }
```

The distinction that preserves the original invariant: this node carries **no tag name, no
attribute string, and no raw markup** — only a set of already-validated child inline nodes and
a single `color` string that has passed a strict allowlist *before the node is ever
constructed*. There is still no general HTML node type; raw HTML remains literal text. Only one
exact recognized surface syntax produces this one node, and the node is incapable of
representing anything other than "these children, in this validated color".

Recognition is fail-closed: anything that is not the exact recognized shape — any other tag,
any malformed span, any span whose color fails validation — stays literal text exactly as
today. There is no general `<…>` tag scanning of any kind.

### Grammar (parser, `src/markdown/index.ts`)

In `parseInline`, when `text[i] === "<"`, attempt to match the opening tag with a single
anchored, case-insensitive regex, then require a literal `</span>` close:

```ts
// Opening tag: <span style="color: <value>"> — flexible whitespace, single OR double quote
// (matched by backreference), optional trailing semicolon. The value char class deliberately
// excludes ; " ' ( ) < > { } so url(...), expression(...), quote-breakouts, and nested-tag
// breakouts cannot appear in the captured value at all — this is the first gate.
const COLORED_SPAN_OPEN =
  /^<span\s+style\s*=\s*(["'])\s*color\s*:\s*([^;"'(){}<>]+?)\s*;?\s*\1\s*>/i;
```

Algorithm:
1. `const m = COLORED_SPAN_OPEN.exec(text.slice(i))`. If no match, fall through (the `<`
   becomes literal text via the normal `buf += text[i]` path). No behavior change for any
   input that isn't this exact shape.
2. `const color = validateColor(m[2])`. If `null`, fall through (opening tag stays literal).
   This is the **second, authoritative gate**.
3. Find the first `</span>` after the opening tag. If none, fall through (opening tag stays
   literal — an unclosed span never styles anything).
4. `flush()`, then push
   `{ kind: "coloredSpan", children: parseInline(inner, refs), color }` where `inner` is the
   text between the opening tag and the first `</span>`. Advance `i` past the `</span>`.

**Nesting is not supported and degrades safely.** Because step 3 closes at the *first*
`</span>`, a nested `<span…>` inside is never paired (its own close was consumed by the outer
span), so `parseInline(inner, …)` leaves the inner opening tag as literal text. A stray
`</span>` with no opening is literal text (it is never recognized as an opener). This is
deterministic and injection-free; it is not required to be pretty.

### Color allowlist (`validateColor`, in `src/markdown/index.ts`)

`validateColor(raw: string): string | null` — trims, lowercases, then accepts **only**:

- **Hex:** `/^#([0-9a-f]{3}|[0-9a-f]{6})$/` → returns the lowercased `#rgb`/`#rrggbb`.
- **Named:** membership in a frozen `NAMED_COLORS` set (letters only by construction) →
  returns the lowercased name.

Everything else returns `null` (fail closed). The tag regex's value char class already blocks
`(`, `)`, `;`, quotes, and angle brackets; `validateColor` is the authoritative allowlist on
top of it. There is no path by which `url(`, `expression(`, `javascript:`, a semicolon-
separated second declaration, or any non-color token survives both gates.

Named-color allowlist (curated basic set — pure lowercase letters, all map cleanly to a
terminal color; hex covers everything outside it):

```ts
const NAMED_COLORS = new Set([
  "black", "red", "green", "yellow", "blue", "magenta", "cyan", "white",
  "gray", "grey", "orange", "purple",
]);
```

(Intentionally curated, not the full CSS4 keyword list: every name here has a sensible ANSI-16
mapping for the TUI, and hex handles arbitrary colors on the Web side. The set may be widened
later by a follow-up ticket if models commonly emit other keywords — widening is safe because
all CSS named colors are letters-only.)

### Web renderer (`src/web/client/markdown-dom.ts`)

Add a `case "coloredSpan"` to `renderInlineNode`:

```ts
case "coloredSpan": {
  const span = el(doc, "span");
  span.style.color = node.color;   // property assignment — the browser re-validates the value
  renderInlineNodes(doc, node.children, span);
  parent.appendChild(span);
  return;
}
```

Color is applied **only** via the `style.color` DOM property, never by building a
`style="…"` attribute string. `node.color` is already allowlisted; the CSSOM property setter is
a second line of defence (it silently ignores any value the parser somehow let through that the
browser considers invalid). No `innerHTML`/attribute-string path is introduced.

### TUI renderer (`src/tui/markdown-ansi.ts`)

Add a fixed name→SGR map (all codes already inside this module's documented 16-color
allowlist — no new escape classes, no 256/truecolor, no free-form ANSI from model input):

```ts
const NAME_TO_SGR: Record<string, string> = {
  black: "30", red: "31", green: "32", yellow: "33",
  blue: "34", magenta: "35", cyan: "36", white: "37",
  gray: "90", grey: "90", orange: "33", purple: "35",
};
```

`case "coloredSpan"` in `inlineToLines`: look up `NAME_TO_SGR[node.color]`. If found, recurse
with `[...codes, code]`. If not found (any hex value, or a name with no 16-color mapping),
recurse with `codes` unchanged — the text renders **plain (uncolored)**, never with a
constructed color. Arbitrary-hex → nearest-256/truecolor is deliberately *not* done here: this
renderer's header pins it to a 16-color foreground allowlist, and plumbing a color-level
context in is out of scope for DH-0206.

## Consequences

- The `src/markdown/index.ts` file header must be amended: raw HTML is still always literal
  text and there is still no general HTML node, but there is now exactly one recognized
  inline construct (`coloredSpan`) whose color is allowlist-validated before construction. The
  header must cite this ADR.
- The security property weakens by exactly one bounded surface: a validated color string. It
  does not open a general HTML surface, an attribute passthrough, or a second CSS property.
  Any future request to widen this (more properties, more tags, style beyond `color`) is a new
  architect escalation, not an implementer call.
- 100% coverage (CLAUDE.md §5) applies to `validateColor`, the parser branch, and both
  renderer branches, including the adversarial cases below.

## Required adversarial tests (must all degrade to literal/plain text, never to styled markup)

Parser-level (`src/markdown/index.test.ts`), each asserting **no `coloredSpan` node is
produced** (input stays `text`/literal):

1. `<span style="color: url(javascript:alert(1))">x</span>` — `(`/`)` blocked by char class.
2. `<span style="color: expression(alert(1))">x</span>` — same.
3. `<span style="color: red; background: url(x)">x</span>` — trailing `;`+second decl:
   the extra declaration is outside the single-`color` grammar; must not match.
4. `<span style="color: javascript:alert(1)">x</span>` — not a hex, not in `NAMED_COLORS` →
   `validateColor` returns null.
5. `<span style="color: red" onmouseover="alert(1)">x</span>` — extra attribute after the
   close quote; opening regex requires `\1\s*>` immediately, so it does not match.
6. `<span style="color: &quot;;alert(1)">x</span>` and a raw-quote variant — quote inside the
   value is blocked by the char class / breaks the backreference.
7. `<span style="color: red">` with no `</span>` (unclosed) — no close found → literal.
8. Stray `</span>` alone — literal.
9. Nested: `<span style="color:red">a <span style="color:blue">b</span> c</span>` — assert
   the outer span closes at the first `</span>` and the inner `<span…>` opening remains
   literal text inside it (deterministic degradation, no second styled node).
10. Valid happy paths: `red`, `#f00`, `#ff0000`, mixed case `<SPAN STYLE="COLOR: Red">`,
    single-quoted `<span style='color: blue'>`, no trailing `;`, and with trailing `;` — all
    produce one `coloredSpan` with the lowercased normalized color.
11. `<span>x</span>` (no style), `<span class="x" style="color:red">` (attribute before
    style), `<div style="color:red">` (wrong tag) — none match.

Renderer-level:

- Web (`markdown-dom.test.ts`): a `coloredSpan` produces a `<span>` whose `style.color` equals
  the validated value and whose children render inside it; assert no `style` attribute is
  built as a string / no `innerHTML` used (consistent with the file's existing no-XSS-sink
  tests).
- TUI (`markdown-ansi.test.ts`): a named color emits the mapped SGR code around the text and a
  trailing reset (row stays self-contained); a hex-valued `coloredSpan` emits the text with
  **no** color SGR code at all (plain), proving no free-form ANSI is constructed from the
  value.
