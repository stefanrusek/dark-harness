---
spile: ticket
id: DH-0214
type: bug
status: closed
owner: stefan
resolution: done
blocked_by: []
created: 2026-07-19
relations:
  depends_on: []
  relates_to: [DH-0025, DH-0212]
  supersedes: []
implementation:
  - repo: dark-harness
---

# DH-0214: TUI: precomposed accented char + extra combining mark drops the next rendered character

## Summary

Isolated from the DH-0212 triage of DH-0060's wide-char spike (e2e/spikes/tui/spike-wide-char.ts). A string containing a precomposed accented character immediately followed by an extra Unicode combining mark (e.g. 'café' + U+0301, i.e. 'café́', two accents stacked on the same e) reliably causes the TUI to drop the very next character it renders after that cluster -- confirmed via minimal repro: 'café done.' renders the full period, but 'café́ done.' renders as 'café́ done' with the trailing period silently gone. Plain single combining marks, CJK, and emoji alone do NOT reproduce it -- isolated specifically to a base char + trailing combining mark forming a 2-codepoint cluster at the same visual column. src/tui/width.ts's own charWidth/stringWidth math computes this correctly (both give width 0 for the combining codepoint), so the miscount happens somewhere downstream in the Ink/Yoga render path (src/tui/ink/*), not in the shared width module. Needs someone to trace Ink's own internal text measurement (likely its string-width dependency) against src/tui/width.ts's model for this exact class of grapheme cluster and reconcile them.

## User Stories

### As an operator viewing transcript text containing a precomposed accented character followed by an extra combining mark, I want the TUI to render every subsequent character intact, not silently drop it

- Given a transcript turn whose text contains a precomposed accented character (e.g. "é",
  U+00E9) immediately followed by an extra Unicode combining mark (e.g. U+0301 COMBINING
  ACUTE ACCENT), when the TUI renders that turn through Ink's real layout/output pipeline,
  then every character after that cluster still appears in the frame (proven by
  `src/tui/ink/TranscriptPane.test.tsx`, "DH-0214: a precomposed accented char followed by an
  extra combining mark doesn't drop the next character through Ink's real render path" — full
  `render()`/`lastFrame()` through ink-testing-library, not just the string-builder layer).
- Given the same input, when it's stripped for Ink rendering, then the extra
  zero-display-width codepoint (and any other codepoint `src/tui/width.ts`'s `charWidth`
  scores as 0 columns) is removed before reaching Ink, while ordinary text is left byte-for-
  byte unchanged (proven by `src/tui/width.test.ts`, `describe("stripInkUnsafeCombining")`:
  "removes a trailing combining mark stacked on an already-precomposed character (DH-0214)",
  "leaves text with no zero-width codepoints unchanged", "strips every codepoint charWidth
  scores as 0, not just combining marks").
- Given the original DH-0060/DH-0212 CJK+emoji+combining-mark spike scenario, when run against
  the real compiled binary in a PTY (`e2e/spikes/tui/spike-wide-char.ts`), then the frame
  still renders at the exact expected row count with no corrupted/ragged frame and the
  trailing text after the combining-mark cluster is present (re-run manually post-fix: 6/6
  checks PASS; this spike is not part of the `bun run e2e` gate, per its own header comment,
  so it's cited as manual confirmation, not the closing unit-test evidence above).

## Functional Requirements

- The TUI must strip codepoints `src/tui/width.ts`'s `charWidth` scores as 0 display columns
  (combining marks, zero-width joiners/spaces, variation selectors, BOM) from turn text before
  handing it to Ink for rendering, via a new `stripInkUnsafeCombining` export in
  `src/tui/width.ts`, applied in `src/tui/ink/TranscriptPane.tsx`'s `renderTranscript` before
  any of the three role branches (user/tool/assistant) wrap or Markdown-parse the text.
- This must stay TUI-local: `src/markdown/index.ts` is shared with the Web client (which
  renders through the browser's own text shaping and has no analogous bug), so it must not
  gain a dependency on `src/tui/width.ts`.

## Assumptions

- Stripping is an acceptable product tradeoff for this class of input (per DH-0025's own
  "not a full grapheme segmenter" scope) — a double-accented character silently loses its
  second accent rather than corrupting every character after it. No attempt is made to
  reconcile Ink's own internal `@alcalzone/ansi-tokenize`-based grid placement with
  `width.ts`'s model; Ink is a third-party dependency we don't patch.

## Risks

- Any legitimate use of stacked/decomposed combining-mark sequences or ZWJ emoji sequences in
  transcript text loses the "extra" combining codepoints when rendered in the TUI (not in the
  Web client). Judged acceptable — the alternative (patching or vendoring Ink) is out of
  scope for a UI text-rendering bug fix.

## Open Questions

## Notes

> [!NOTE]
> **2026-07-19 — root cause found and fixed.** Re-verified DH-0212's triage claim that
> `src/tui/width.ts`'s own `charWidth`/`stringWidth` math is correct for this case — it is
> (both a single decomposed combining mark and the "extra" trailing one score 0 columns).
> Reproduced the bug directly against Ink's own internals before touching any code: called
> `@alcalzone/ansi-tokenize`'s `tokenize`/`styledCharsFromTokens` (the exact functions
> `node_modules/ink/build/output.js`'s `Output.get()` uses to place characters into its fixed-
> width row buffer) on `"café́ done."` — every codepoint, including the combining mark, comes
> back as its own one-column token. `Output.get()`'s render loop advances its column cursor by
> 1 (or 2 for `fullWidth`) per token, so each combining mark drifts every following character
> one column right; once the drift pushes trailing characters past the row's declared width,
> they're silently dropped from the frame. This reproduces even for a *single* combining mark
> in a decomposed sequence (tested directly), not only the "double accent" case — visibility
> in practice just depends on whether the drift happens to push content past the row edge
> before rendering, which is why the earlier DH-0060 spike's lone combining-mark case didn't
> visibly break while the "double accent" case reliably does. Confirmed the actual drop via a
> real `ink-testing-library` `render()` of `TranscriptPane` (not just `renderTranscript`'s
> string output) before writing any fix: `"café́ done."` rendered as `"café́ done"` — the
> trailing period gone. Root cause: a genuine model mismatch between `width.ts`'s per-
> codepoint display-width math (correct) and Ink's own internal grid-placement layer (which
> gives every codepoint, zero-width or not, its own column) — confirmed downstream of
> `width.ts`, in `src/tui/ink/*`/Ink itself, per the ticket's own hypothesis. Fix: added
> `stripInkUnsafeCombining` to `src/tui/width.ts` (strips any codepoint `charWidth` scores as
> 0) and applied it in `src/tui/ink/TranscriptPane.tsx`'s `renderTranscript`, once per turn,
> before any wrap/Markdown pipeline runs — covers all three role branches uniformly.
> Deliberately kept out of the shared `src/markdown/index.ts` (`sanitizeText`/`parseMarkdown`)
> since that module is also used by the Web client, which has no such bug (real browser text
> shaping, not a manual grid). Added a regression test exercising Ink's real render path
> (`TranscriptPane.test.tsx`) plus unit tests for the new primitive (`width.test.ts`). All
> four quality gates green locally: `bun run typecheck` clean; `bun run lint` fails, but
> identically on a clean stash of this same worktree before any change (a pre-existing
> `biome.json` `include`-vs-`includes` config/version mismatch unrelated to this ticket, not
> introduced or touched here); `bun run test:coverage` 2180 pass / 0 fail, both changed files
> (`src/tui/width.ts`, `src/tui/ink/TranscriptPane.tsx`) at 100%/100% (repo-wide 99.00%/99.82%
> is pre-existing gaps in unrelated `app.ts`/`state.ts`, untouched by this change); `bun run
> e2e` 38 pass / 0 fail. Also manually re-ran the original DH-0060 spike
> (`e2e/spikes/tui/spike-wide-char.ts`, real compiled binary + tmux PTY, not part of the `e2e`
> gate) post-fix: 6/6 checks PASS, with the double-accented input now rendering as plain
> "café" (extra accent silently dropped, no corruption) and "done." fully intact. Moving to
> `closed`.
