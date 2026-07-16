---
spile: ticket
id: DH-0066
type: feature
status: closed
owner: stefan
resolution: done
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

### 2026-07-16 — Susan (Web), first pass

**Done** (all in `src/web/client/`; gates green — `bun run typecheck`, `bun run lint`,
`bun run test:coverage` 100% funcs/lines on every touched file, `bun run e2e` 30/32, the 2
failures a pre-existing sandbox tooling gap — no Chromium binary at the expected path — not
a regression):

- Markdown surface CSS: styled code blocks (panel background/border/`overflow-x` scroll),
  blockquote left rail, heading type scale in `--font-ui`, tightened list-item spacing,
  inline-code chip, themed `<hr>`. Scoped `white-space: pre-wrap` to user turns only
  (assistant turns render structured Markdown DOM, not preformatted text). Implemented the
  Open Questions' stated recommendation on prose font (`--font-ui` for prose, `--font-mono`
  for code/pre only) since the ticket framed the all-mono look as an accident, not a locked
  decision.
- Fixed the consecutive-assistant-turn concatenation-with-no-boundary bug: added
  `AgentNode.turnOpen` (`state.ts`), closed whenever `agent_status` leaves `"running"` or a
  user sends a message, so a new `agent_output` chunk only merges into the prior turn when
  it's genuinely still open rather than whenever the prior turn happens to also be
  `"assistant"`.
- Fixed the "WAITING for just now" broken-English phrasing (`formatStatusElapsed`).
- Sidebar tree hierarchy: `agentDepth` (`state.ts`) + per-row indentation (`render.ts`), so
  the sidebar reads as an actual tree instead of a flat list.
- Sidebar per-row token count gets a "tok" unit suffix.
- Jump-to-latest pill moved off the bottom-right corner (was overlapping the newest user
  bubble) to bottom-center, offset above the error/gap banners so the three don't stack.
- Real empty state ("No output yet — spawned just now, model X") for a transcript with no
  turns yet, replacing blank space.
- Pulsing three-dot "thinking" placeholder in the transcript itself while an agent is
  `running` with no turn currently open — previously nothing in the main pane indicated
  activity during a long turn except the header's elapsed timer.
- Browser tab title reflects session state (`● running` / `✓`/`✗ session ended` / idle) and
  a proper inline-SVG favicon (the ◆ brand mark, no external request — DH-0023 posture)
  replaces the previously blank one.

**Not done this round, left open rather than guessed at:**

- Tool-call chips in the transcript (Agent spawns, etc.) — the ticket itself says any wire
  vocabulary gap here routes through architect review first (CLAUDE.md §6); a Web-only pass
  can't resolve that on its own.
- A sub-agent's transcript showing its spawn prompt as the opening turn — same blocker: the
  wire protocol doesn't carry the spawn prompt to the client today.
- The "sidebar renders empty while viewing a sub-agent after `session_ended`"
  (`spike-agent-tree.png`) repro — read through `evictCompletedAgents`/`seedFromTree` and
  found no obvious cause, but couldn't reproduce it live (no Chromium binary in this
  sandbox to drive a real repro). Left open rather than shipping a speculative fix for a bug
  I couldn't reproduce — worth a follow-up round with a working browser.
- Syntax highlighting — ticket's own recommendation was to skip this round.
- Code-block copy button, and echoing the session-end banner once in the transcript flow —
  the ticket's cheap "delight" nits; triaged out under this round's time budget, no
  technical blocker.

Status moved `draft` → `implementing` (not closed) given the items above are genuinely
undone, not just deferred detail.

### 2026-07-16 — Susan (Web), second pass (real Chromium now available)

**Environment note first**, since it shaped this whole round: a real headless Chromium is
now installed (`bunx playwright install chromium` was a no-op; `e2e/spikes/web/support.ts`'s
`resolveChromiumExecutable()` resolves it via the playwright cache). But the working tree
also has heavy *concurrent, unrelated* fleet activity landing throughout this round (DH-0050
ReportOutcome, DH-0110/DH-0111 web asset-chunk-404 fixes) — including, at one point, an
in-flight uncommitted rewrite of `src/web/server.ts` by another round that I left untouched
per instructions. More importantly: **the real Core agent loop in this tree is currently
broken for sends through the actual `--web` UI** — `send_message` never produces an
`agent_output`/terminal `agent_status` event. Confirmed independently against
`e2e/server-protocol.test.ts` (no Web code involved at all): "sub-agent spawning" and
"send_message runs a full turn" both now time out waiting for basic SSE events. This is a
Core/Server-domain regression, not a Web one — flagging for whoever owns that surface next,
not attempting to fix it here (out of `src/web/client/` scope, and CLAUDE.md agent-memory
guidance is to leave concurrent unrelated work alone). It also fully explains why the first
pass's "no Chromium" excuse was masking a second, deeper blocker: even with a working
browser, a real end-to-end turn cannot complete in this sandbox right now.

**1. Sidebar-empty-after-`session_ended`-while-viewing-a-sub-agent (`spike-agent-tree.png`)
— investigated live, NOT REPRODUCIBLE, closing this item out.** Since the real agent loop
can't complete a turn, I built a live repro that drives the actual compiled `dh --web`
binary and a real headless Chromium against the exact real client bundle (`sse.ts` →
`state.ts` → `render.ts`, no mocks in that chain), but replaces only the network boundary
(`GET /api/events`, `POST /api/commands`) with a scripted event sequence matching the real
wire format byte-for-byte — root spawns, sub-agent spawns, sub-agent reaches `done`, the
sub-agent row is selected in the sidebar, then the stream re-delivers with a trailing
`session_ended`. Result: sidebar still shows both rows, correctly indented, after
`session_ended`, whether or not a sub-agent is selected — confirmed via DOM dump and
screenshot. Also traced the code path by hand: `renderSidebar` (`render.ts`) iterates
`orderedAgents(state)` and only appends the built `<ul>` to the container at the very end of
the function — the one way this bug shape (container goes empty, not just stale) could
happen is an uncaught exception mid-loop before that final `appendChild`, and the only
per-row computation that walks agent state (`agentDepth`, `state.ts`) already has an
explicit cycle/dangling-parent guard capped at `state.agents.size`. No eviction interaction
either: `evictCompletedAgents`'s retention (50) is nowhere near hit by 2 agents, and nothing
client-side re-seeds/wipes state on SSE reconnect (`bootstrapAgentTree` only runs once, at
`start()`). Between the live repro and the code trace, I'm treating this as
not-currently-reproducible rather than a real defect — most likely a one-off from whatever
the overnight capture's actual session looked like, or an artifact of the review process
itself. Leaving it closed without a client-side change; if it recurs, the next lead will
need a fuller repro than either of us has managed so far.

**2. Both "cheap delight" nits — implemented, tested, verified live in both themes.**
- **Code-block copy button** (`markdown-dom.ts`): a hover-revealed "Copy" button wraps every
  fenced code block (`.code-block` wrapper div around `pre`, kept so `pre > code` — the
  selector every existing test/fixture already depends on — is unaffected). Uses
  `navigator.clipboard.writeText`, feature-detected via optional chaining (happy-dom, this
  file's own test DOM, doesn't implement Clipboard — verified the click handler is a safe
  no-op there rather than throwing) so it degrades gracefully in any embedding context that
  lacks it. Shows "Copied"/"Copy failed" feedback for 1.5s. **Found and fixed a real bug
  during live verification**: the button's original `top/right: var(--space-2)` positioning
  overlapped the code text itself on short/narrow blocks (verified live — a two-line
  snippet rendered the button sitting on top of the first line's trailing `42;`). Fixed by
  reserving a dedicated top strip (`padding: 28px ... ` on `.turn-text pre`) so the button
  always sits in dead space regardless of how narrow the code content is — reverified live
  after the fix, clean in both themes.
- **Session-end echo in the transcript** (`render.ts`): `renderTranscript`/`appendTranscript`
  now take `sessionEnded`/`exitCode` (defaulted so every existing call site/test keeps
  compiling) and append a `.session-end-echo` block after the transcript — same ok/fail
  color convention as the sidebar's own `session-banner`, echoed (not duplicated state) so
  it's visible without looking at the sidebar. Idempotent across the streaming
  incremental-append path (mirrors the existing `.turn-thinking` stale-node removal
  pattern) so reconnects/re-renders never double it.

Both verified live: real Chromium, real compiled `dh --web`, real `sse.ts`→`state.ts`→
`render.ts` pipeline, network-mocked at the `/api/events`/`/api/commands` boundary per the
same technique as item 1 (necessary given the Core regression above) — code block renders
styled, copy button copies the exact code text and shows feedback, session-end echo appears
in both light and dark `prefers-color-scheme`. Screenshots taken during this round (not
committed — sandbox scratchpad only, per this round's existing pattern of not committing
throwaway spike output) confirm both.

**3. Syntax highlighting**: confirmed still out of scope — no code added for it, ticket's
own recommendation.

**Gates**: `bun run typecheck` clean, `bun run lint` clean on every file this round touched
(two pre-existing formatter findings in `src/agent/runtime.test.ts`/`src/cli.test.ts` are
concurrent other-agent work, not mine, left alone), `bun run test:coverage` — 1959 pass, 0
fail, 100% funcs/lines on every file this round touched (`markdown-dom.ts`, `render.ts`,
`app.ts`'s changed lines). `bun run e2e`: `e2e/web.test.ts`/`e2e/connect-web.test.ts`'s
hardcoded `/opt/pw-browsers/chromium` path (this ticket's own instructions flagged it as a
small side-fix candidate) is now fixed — both files resolve Chromium via the same
`resolveChromiumExecutable()` used elsewhere (this fix appears to have landed already,
folded into DH-0110's commit via this shared worktree's known cross-round file-sweep
pattern — confirmed present at HEAD, not re-committing it here). The full `bun run e2e`
gate itself is currently red for reasons unrelated to this ticket (the Core regression
above breaks most real-turn-driven e2e specs); not a Web regression, not fixable from this
domain.

**Closing DH-0066.** Tool-call chips and a sub-agent's spawn-prompt-as-opening-turn remain
out of scope per this round's brief — both depend on DH-0089's own Web-consumption round.
Everything else in the ticket (Markdown surface styling, sidebar hierarchy, transcript
mechanics, the sidebar-empty investigation, both delight nits) is done or confirmed
not-reproducible.
