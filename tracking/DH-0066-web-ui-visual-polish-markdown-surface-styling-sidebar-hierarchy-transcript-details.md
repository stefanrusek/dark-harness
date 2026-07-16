---
spile: ticket
id: DH-0066
type: feature
status: draft
owner: stefan
resolution:
blocked_by: []
created: 2026-07-16
relations:
  depends_on: []
  relates_to: [DH-0056, DH-0044, DH-0023, DH-0065]
  supersedes: []
implementation:
  - repo: dark-harness
---

# DH-0066: Web UI visual polish: Markdown surface styling, sidebar hierarchy, transcript details

## Summary

Architect design review (Fable, 2026-07-16) of the Web UI against the four review criteria.
The shell is in genuinely good shape — the dark "factory floor at night" palette
(`src/web/client/styles.css`) is handsome and intentional, user/agent turns are clearly
distinguishable (right-aligned amber bubbles + `YOU`/`AGENT` labels vs. left-aligned panel
cards — criterion 2 passes), status is never color-only, and motion is restrained with a
`prefers-reduced-motion` escape. The big gap is that DH-0056's Markdown renderer emits real
`<h1>`/`<pre><code>`/`<blockquote>`/`<ul>` DOM (verified via live DOM dump) but
**`styles.css` contains zero rules for any of them** — everything renders with browser
defaults inside a 13px monospace `pre-wrap` container, so a fenced code block is visually
indistinguishable from prose and lists are double-spaced. That plus a flat, UUID-truncated
sidebar "tree" and a few concrete layout nits are what stand between this and a
portfolio-quality screenshot. Evidence: `e2e/spikes/web/REPORT.html` PNGs plus fresh
dark/light captures via `e2e/spikes/web/explore-design-review.ts` (committed with this
review).

## User Stories

### As an operator, I want rendered Markdown to look designed, not browser-default

Live dark-mode capture (`explore-md-dark.png`): the `language-typescript` code block has no
background, border, padding, or highlighting — its only distinction from surrounding prose
is indentation; the blockquote "Note: one canary node..." shows no left rail or tint, just
an indent; `h1`/`h2` are browser-default-sized bold monospace; every list item is wrapped
in `<p>` (loose-list AST) so lists render double-spaced and huge. `markdown-dom.ts` is
correct and safe; the styling layer simply never shipped.

- Given an assistant turn, when it contains `<pre><code>`, then the block gets a distinct
  treatment: panel-contrast background (`--bg` on `--panel-raised` or similar), 1px
  `--border`, `--radius-sm`, padding, `overflow-x: auto`, and a smaller mono size; the
  `language-*` class is already emitted — an (inline, CSP-safe, no-CDN per DH-0023)
  syntax-highlighting pass is optional stretch, not required.
- Given a blockquote, when rendered, then a 3px left rail in `--border-strong` (or dim
  accent) with `--text-dim` text — the standard quote affordance.
- Given headings, when rendered inside `.turn-text`, then a deliberate type scale in the
  UI font (`--font-ui`), with margins that don't inherit browser defaults (first-child
  heading should not add top whitespace inside the bubble).
- Given prose paragraphs and list items, when rendered, then use `--font-ui` at ~14px for
  readability, keeping `--font-mono` for `code`/`pre` only — or, if the all-mono terminal
  aesthetic is a deliberate identity choice, tighten it (smaller list `<p>` margins,
  consistent line-height) so it reads chosen rather than default. Owner taste call —
  flagged in Open Questions.
- Given `.turn-text`'s `white-space: pre-wrap` (needed for plain-text user turns), when an
  assistant turn renders Markdown DOM, then pre-wrap must not apply to element-structured
  content (scope it to `.turn-user .turn-text`, keep `pre` for code blocks).
- Given inline `code`, when rendered, then a subtle background chip (padding 1px 4px,
  radius, `--panel-raised`) — today it's font-only and disappears in mono-everything
  context.
- Given `<hr>`, when rendered, then a themed 1px `--border` rule, not the browser default
  inset border.

### As an operator, I want the sidebar to show the agent hierarchy, not a flat list

Live DOM dump of `.sidebar-tree` with a 3-level spawn chain: three sibling `<li>` rows —
`root`, `sub · agent-64…`, `subsub · agent-98…` — with no depth information at all.
`renderSidebar` (`src/web/client/render.ts`) iterates `orderedAgents(state)` flat. The
overnight `spike-agent-tree.png` is worse: viewing a sub-agent, the sidebar rendered
completely empty (no rows at all) — reproduce and fix or explain.

- Given nested agents, when the sidebar renders, then indent rows by depth (padding-left
  per level and/or a connector glyph), so parent/child reads instantly — this is the
  product's signature "agent tree" (HANDOFF §9) and currently isn't one.
- Given a sub-agent label `sub · agent-64…`, when rendered at 280px sidebar width, then
  prefer `model` + tooltip/title with the full id; the truncated UUID fragment spends the
  row's space on entropy no human reads.
- Given the per-row token count (`80`, `40`, `20` bare numbers), when rendered, then add
  the unit (`80 tok`) or a title attribute; bare integers next to "just now" read as
  mystery numbers.
- Given the overnight capture `spike-agent-tree.png` (empty sidebar while a sub-agent is
  selected, session ended), when a session has ended, then the tree should still list all
  agents — investigate whether agent rows are dropped on `session_ended`.

### As an operator, I want transcript mechanics that don't glitch

- Given the newest turn near the bottom, when the "Jump to latest" pill shows, then it must
  not overlap message bubbles — live capture `explore-tree-dark.png` shows it sitting on
  top of the `spawn the workers` user bubble (both are bottom-right anchored). Reserve
  scroll-padding or reposition (bottom-center).
- Given consecutive assistant turns, when rendered, then they must not concatenate into a
  single bubble with no boundary — live capture (light mode) shows `Root coordinated two
  levels of sub-agents.Root coordinated two levels of sub-agents.` as one bubble.
  Shared-layer issue with the TUI (DH-0065) — fix at the right layer.
- Given a sub-agent's transcript, when opened, then show what the agent was asked: the
  spawn prompt should appear as the opening turn (live capture `explore-subagent-dark.png`
  shows a lone `Level-3 leaf agent done.` card floating in an empty pane with no context).
- Given an agent with no output yet, when its transcript pane is empty, then show a real
  empty state (dim "No output yet — spawned just now, model `sub`") instead of blank
  space.
- Given the agent header's status phrase, when the status just changed, then avoid the
  broken-English `WAITING for just now` (overnight `spike-markdown.png`, all captures) —
  e.g. drop the "for" prefix when elapsed < 5s, or render `for 0s`.

### As an operator, I want to see tool calls and sub-agent spawns in the transcript

Same finding as DH-0065: the root transcript jumps from the user message to the final
reply; the `Agent` tool call that spawned two levels of workers is invisible. In the Web UI
this can be genuinely delightful: a compact tool-call chip row (`⚙ Agent → sub`,
clickable to select that agent in the sidebar) between text blocks.

- Given an assistant turn with tool calls, when rendered, then show a subdued
  chip/row per call; `Agent` spawns link to the spawned agent's transcript.
- Given the SSE event vocabulary may not carry tool-call boundaries today, when confirmed,
  then contracts changes route through architect review first (CLAUDE.md §6.2).

### As an operator, I want small moments of delight that make the tool feel alive

Already good: pulsing running-dot, fade-in-up on new turns/rows, connection pill, session
banner. Missing, in rough value order:

- Given an agent is mid-turn, when I watch its transcript, then show a lightweight
  "thinking" indicator in the transcript itself (pulsing three-dot placeholder bubble) —
  the liveness spike (`spike-liveness.png`) shows nothing anywhere in the main pane during
  a slow 8s turn except the header timer; DH-0044 (real streaming) subsumes part of this
  but a placeholder is cheap now.
- Given the browser tab, when status changes, then update `document.title` (e.g.
  `● running — Dark Harness`) and ship a favicon (currently none — the tab is anonymous;
  the ◆ brand mark as SVG favicon is trivially inlinable and CSP-safe).
- Given a code block, when hovered, then a small copy button — cheap, high-utility.
- Given session end, when exit code is known, then the existing sidebar banner is good;
  consider echoing it once in the transcript flow so it's visible without looking at the
  sidebar.

## Functional Requirements

- All styling changes are CSS/DOM-construction only, keeping the `markdown-dom.ts` "no
  innerHTML, no external fetch" properties (DH-0023 CSP posture: no CDN highlighters, no
  webfonts).
- Light theme (`prefers-color-scheme: light`) gets the same Markdown treatment — verify
  both modes with screenshots before closing.
- 100% coverage per CLAUDE.md §5 on changed TS; CSS-only changes verified by the committed
  exploration spike's screenshots.

## Assumptions

- The all-monospace transcript body is currently an accident of `.turn-text`'s single
  font-family rule, not a recorded design decision (nothing in `docs/handoffs/web.md`'s
  design notes mandates it for prose).
- `.turn { max-width: 88% }` and bubble layout stay; this ticket styles content within
  bubbles, not the conversation layout, which already works.

## Risks

- E2E and spike scripts assert on rendered text and selectors (`.turn-text`,
  `.agent-row`); sidebar-label and empty-state changes must update
  `e2e/spikes/web/*.ts` and `e2e/web.test.ts` in the same round.
- The consecutive-turn concatenation fix may live in shared state/loop code — coordinate
  with DH-0065 to avoid two divergent client-side patches.

## Open Questions

- Prose in `--font-ui` vs. committed all-mono terminal aesthetic — owner taste call; the
  review's recommendation is UI font for prose, mono for code.
- Syntax highlighting: skip (ship the styled block now) or write a tiny inline tokenizer
  for the 3-4 most common languages? Recommendation: skip in this ticket, note as future.

## Notes

> [!NOTE]
> Filed by the architect-on-call (Fable) from the 2026-07-16 design/UX review. Evidence:
> `e2e/spikes/web/REPORT.html` + `artifacts/*.png` (overnight, light mode) and fresh
> dark/light captures + DOM dumps via `e2e/spikes/web/explore-design-review.ts` (committed
> with this review; artifacts land in `e2e/spikes/web/artifacts/explore-*.png`). What
> already works and should not be churned: the palette and CSS-variable system, the
> user/agent bubble convention, status badges + dots, connection pill, reduced-motion
> support, and the accessibility work from DH-0029.
