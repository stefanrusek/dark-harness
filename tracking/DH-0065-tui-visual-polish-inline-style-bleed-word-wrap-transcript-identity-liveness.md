---
spile: ticket
id: DH-0065
type: feature
status: draft
owner: stefan
resolution:
blocked_by: []
created: 2026-07-16
relations:
  depends_on: []
  relates_to: [DH-0056, DH-0044, DH-0028, DH-0066]
  supersedes: []
implementation:
  - repo: dark-harness
---

# DH-0065: TUI visual polish: inline style bleed, word wrap, transcript identity, liveness

## Summary

Architect design review (Fable, 2026-07-16) of the TUI against four criteria — "sharp and
professional", "user vs. agent clear at a glance", "Markdown looks great" (DH-0056), and
"pops of wow". Verdict: the bones are genuinely good (stable frame discipline, correct
resize/wide-char behavior, a clean allowlist-based ANSI architecture in
`src/tui/markdown-ansi.ts`), but one real rendering **defect** (inline style bleed) makes
Markdown output look broken, character-chop word wrapping reads as unfinished, the
transcript carries almost no visual identity (a bare `> ` prefix is the only user/agent
cue), and there is not a single deliberate styling choice in the header, footer, or tree
view. Evidence below is from live captures driven through the real binary under tmux
(`e2e/spikes/tui/` harness, 100x40), not from unit tests.

## User Stories

### As an operator, I want inline Markdown styling to end where the construct ends, not bleed to end of line

The highest-priority item — a defect, not taste. Raw-ANSI capture of
`The rollout of **api-gateway v2.3.1** is *complete*. Verified \`healthz\` on all nodes.`:

```
"The rollout of [1mapi-gateway v2.3.1 is [3mcomplete. Verified [36mhealthz on all nodes.[0m"
```

Bold opens at "api-gateway" and never closes; italic and cyan stack on top. The whole
tail of every line containing any inline construct renders with cumulative styling. Same
for links: `[grafana](url)` opened `[4m[34m` and underlined-blue the entire
rest of the paragraph, including wrapped continuation rows. Cause: `serializeRow` in
`src/tui/markdown-ansi.ts` emits `sgrPrefix(p.codes)` per segment, but a segment with
*empty* codes emits no prefix at all, so the previous segment's SGR state persists.

- Given a line of mixed styled/unstyled segments, when serialized, then every style
  transition is explicit — e.g. emit `\x1b[0m` before any segment whose code set is not a
  superset of the previous segment's, or simply prefix every segment with
  `RESET + sgrPrefix(codes)` (still row-local, still allowlist-only).
- Given the existing unit tests passed while this was visibly broken, when fixing, then add
  segment-boundary assertions (bold followed by plain text in one paragraph must contain a
  reset *between* them, not only at end of row).

### As an operator, I want text to wrap at word boundaries so dense output reads professionally

Captured at 100 cols: `...a long trailing paragraph inte` / `nded to exercise...`; at 60
cols: `Promise<boolea` / `n> {`. `wrapText` (`src/tui/width.ts`) and
`wrapSegments`/`wrapPlainDim` (`markdown-ansi.ts`) all slice per codepoint with no
word-boundary awareness — every long paragraph chops words mid-syllable, which is the
single most "unfinished"-looking thing in the TUI today.

- Given a paragraph wider than the pane, when wrapped, then breaks prefer the last
  whitespace before the limit; an unbroken token longer than the row still hard-breaks
  (no infinite loop, no overflow).
- Given code-block lines (`wrapPlainDim`), when wrapped, then hard-break behavior may stay
  as-is (code is verbatim), but the continuation row should be visually distinguishable
  (e.g. keep the dim `│ ` gutter, which already happens today — verify it stays).

### As an operator, I want to tell user and agent turns apart at a glance

Plain capture shows a user turn as `> show me the deploy report` and agent turns as
unadorned text — the only cue is a two-character prefix in the same default color as
everything else. In a long scrollback this requires careful reading (review criterion 2:
fails "at a glance" today).

- Given a user turn, when rendered by `renderTranscript` (`src/tui/render.ts`), then it
  carries a visually distinct treatment within the existing SGR allowlist — e.g. the `>`
  marker and/or user text in the accent color the Web client already uses conceptually
  (amber → yellow 33 is in the allowlist family; exact choice is Mary's), or a dim
  `you ›` / `agent ›` gutter label.
- Given consecutive assistant turns (observed live: two assistant turns concatenated as
  `...sub-agents.Root coordinated two levels of sub-agents.` with no separator — also
  reproduced on Web, so partly a shared state issue), when rendered, then adjacent
  same-role turns still show a boundary (blank line at minimum). Investigate whether the
  client merges consecutive `agent_output` into one turn across turn boundaries or the
  loop emits it that way; fix at the right layer, coordinating with Web (DH-0066).

### As an operator, I want the agent tree to read as a tree, not a UUID dump

Captured tree view:

```
> ● agent-root (mock)  [0s]  80 tok
    ● agent-896c0885-f15a-4899-baa9-f1ba25e447c2 (sub)  [0s]  40 tok
      ● agent-514d5e1f-48bf-4224-bd2a-1c36bc72ac43 (subsub)  [0s]  20 tok
```

- Given a sub-agent entry, when listed, then show `model · short-id` (Web already has
  `shortAgentId` in `src/web/client/format.ts` — mirror the convention) instead of the
  full 36-char UUID, which currently dominates every row.
- Given nesting, when rendered, then use tree connectors (`├─`/`└─`) — `dh logs`
  (`src/server/log-analysis.ts:formatNode`) already draws these; the interactive TUI
  should not look worse than the offline log dump.
- Given a finished agent, when its row shows `[0s]`-style elapsed, then the meaning should
  be status-aware: elapsed-in-current-status for running/waiting, and a static duration
  (or nothing) for done/failed/stopped — a "done" agent whose timer keeps counting up
  reads as stuck.
- Given the status glyph `●`, when colored, then also show the status word (or make the
  hint line explain glyph colors) — color-only status fails color-blind operators; Web
  solved this with label badges (`styles.css` design note "status is never color-only").

### As an operator, I want to see tool calls and sub-agent spawns in the transcript

Captured root view jumps straight from `> spawn the workers` to the final reply — the
tool_use turn that spawned two levels of sub-agents is invisible. For an agent harness
whose whole point is observing agents work, this is the largest missing "wow" and the
largest observability gap in the TUI.

- Given an assistant turn containing tool calls, when rendered, then show a dim one-line
  marker per call (e.g. `⚙ Agent(sub): "Level-2 work."` / `⚙ Bash: bun test`), kept
  visually subordinate to text output (dim SGR 2 is already in the allowlist).
- Given the SSE event vocabulary may not currently carry tool-call boundaries to clients,
  when that's confirmed, then this becomes a contracts-touching change (architect
  sign-off per CLAUDE.md §6.2) — check `src/contracts/` first and split if needed.

### As an operator, I want the chrome to look deliberately designed

Raw captures show zero SGR anywhere in the header (`Dark Harness — Root Agent — open —
20 tok`), separator, or footer hints. Everything is default-colored text.

- Given the header, when rendered by `headerRows`, then style it: app name bold, view name
  plain, connection state colored by state (green open / yellow reconnecting / red closed
  — mirroring Web's connection pill), token/cost dim.
- Given the root view during a running turn, when idle-ticking (the 1s tick already
  exists), then show a small animated spinner (braille frames `⠋⠙⠹⠸...` or dot cycle) plus
  status in the header or above the input — today the root view gives no sign at all that
  the agent is thinking (liveness only visible in the tree view's elapsed counter).
- Given footer key hints, when rendered, then dim the brackets/labels so they recede
  behind content.
- Given headings below h1, when rendered (`renderBlock` heading case), then differentiate
  them from inline bold — captured h2 `What changed` is byte-identical styling to bold
  body text. Options within the allowlist: color headings (cyan/bright), or prefix `##`
  dim markers, plus keeping h1's underline.

## Functional Requirements

- All new styling stays within the DH-0056 D3 SGR allowlist (`markdown-ansi.ts` header
  comment) — no background colors, no 256/true-color, no OSC. Any allowlist extension is
  an architect call.
- Every styled row stays self-contained (reset-terminated) per the existing wrapping
  contract; no style may leak across rows into header/footer.
- 100% coverage on changed code per CLAUDE.md §5; the style-bleed fix specifically needs
  regression tests at segment boundaries.
- Visual sanity check before closing: rerun `e2e/spikes/tui/explore-design-review.ts`
  (committed by this review) and eyeball the raw-ANSI dump.

## Assumptions

- The style-bleed fix is safe to fast-track ahead of the taste items if the owner wants to
  split it out — it is a defect with a mechanical fix and clear tests.
- Word-boundary wrapping applies to prose (paragraphs, list items, headings); code blocks
  may keep hard-slicing.

## Risks

- The consecutive-assistant-turn concatenation may be loop/state-layer, not render-layer —
  fixing it only in the TUI would leave Web broken (it reproduces there). Coordinate with
  DH-0066 and, if it's in the shared event semantics, escalate per §6.
- Tree connectors + short ids change strings that e2e spikes assert on
  (`spike-agent-tree-hierarchy.ts` greps indent depths and full agent ids) — update those
  in the same round.

## Open Questions

- Spinner in the root view header vs. a status line above the input — Mary's call.
- Should user-turn text be echoed in a distinct color, or only the `>` marker? (Claude
  Code's own convention — dim/quoted user echo — is a reasonable reference point.)

## Status Log

### 2026-07-16 — Mary (TUI): style-bleed defect fixed and verified

Fixed the first, highest-priority item only (inline style bleed) per dispatch scope — the
other three items (word wrap, transcript identity, header/footer styling, liveness) are
untouched and remain open design/taste calls for the owner.

- Root cause confirmed exactly as filed: `serializeRow` in `src/tui/markdown-ansi.ts` only
  emitted `sgrPrefix(p.codes)` per segment, which is empty for an unstyled segment, so the
  previous segment's SGR state (bold/italic/color/underline) simply stayed active in the
  terminal and bled into everything after it on the row, including re-opened wrapped
  continuation segments.
- Fix: `serializeRow` now emits an explicit `RESET` before any segment that follows a
  *styled* segment (i.e. whenever `parts[i-1].codes.length > 0`), before that segment's own
  (possibly empty) SGR prefix. The first segment of a row is exempt — every row already
  starts from clean terminal state by construction. Still row-local, still allowlist-only
  (SGR 0 was already an allowed code); no change to the SGR allowlist itself.
- Added segment-boundary regression tests in `src/tui/markdown-ansi.test.ts`
  (`renderMarkdownRows — style-bleed regression (DH-0065)`): bold-then-plain, bold-then-
  plain-then-italic, link-then-trailing-text, and plain-then-bold, each asserting a RESET
  appears *between* segments, not only at end-of-row — this is exactly the class of test
  the ticket noted was missing (existing tests passed while the bug was visibly present).
- Visual verification: the ticket's `e2e/spikes/tui/explore-design-review.ts` spike is not
  actually present in this checkout despite being referenced as committed evidence, so I
  reproduced the ticket's own example directly (`renderMarkdownRows` + raw-ANSI dump) —
  confirmed `**api-gateway v2.3.1**`, `*complete*`, `` `healthz` ``, and the `[grafana](url)`
  link each now close with an explicit `\x1b[0m` immediately after their own span, with no
  bleed into subsequent plain text.
- Gates: `bun run typecheck`, `bun run lint`, `bun run test:coverage` all clean.
  `src/tui/markdown-ansi.ts` and `src/tui/markdown-ansi.test.ts` are the only files changed;
  `markdown-ansi.ts` is at 100%/100% (line/function) coverage. Full suite: 1263 pass, 0 fail.

Leaving this ticket in `draft` — still open in this ticket: word-boundary wrapping,
transcript user/agent visual identity (and the consecutive-same-role-turn boundary
question), agent tree readability (short ids/connectors/status-aware elapsed/status
labels), tool-call visibility in the transcript, and header/footer/heading chrome styling.

## Notes

> [!NOTE]
> Filed by the architect-on-call (Fable) from the 2026-07-16 design/UX review. Evidence:
> `e2e/spikes/tui/REPORT.md` (overnight verification captures) plus fresh live captures via
> `e2e/spikes/tui/explore-design-review.ts` (rich Markdown at 100x40 and 60x24, 3-level
> agent tree, raw-ANSI dumps). What already works well and should not be churned: alt-screen
> frame stability across rapid resizes, wide-char/CJK handling, the reconnect notice in the
> always-visible header, the dim `│` code-block gutter, and the pure
> `TuiState -> string[]` rendering architecture itself.
