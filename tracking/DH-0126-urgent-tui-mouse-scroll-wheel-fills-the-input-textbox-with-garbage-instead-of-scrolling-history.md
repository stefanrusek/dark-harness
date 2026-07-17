---
spile: ticket
id: DH-0126
type: bug
status: verifying
owner: stefan
resolution:
blocked_by: []
created: 2026-07-17
relations:
  depends_on: []
  relates_to: [DH-0133, DH-0136]
  supersedes: []
implementation:
  - repo: dark-harness
---

# DH-0126: URGENT: TUI mouse scroll wheel fills the input textbox with garbage instead of scrolling history

## Summary

Owner-flagged HUGE problem from live manual testing 2026-07-17: using the mouse scroll wheel in the TUI dumps garbage characters into the input textbox instead of scrolling the history/transcript window. The history window fills up fast during real use and currently has no way to scroll it at all. Two things needed: (1) stop scroll-wheel input from being captured/echoed into the text input, (2) implement real scroll support for the transcript/history pane. High-priority usability blocker, TUI domain (Mary).

## User Stories

### As a TODO, I want TODO

- Given TODO, when TODO, then TODO.

## Functional Requirements

- TODO

## Assumptions

## Risks

## Open Questions

## Notes

> [!NOTE]
> Fable's revised DH-0133 design (2026-07-17, after reviewing `../privateer`, a sibling Ink
> TUI project) found privateer has already solved this exact bug, in production, under Ink:
> a raw `process.stdin.on('data', ...)` listener running alongside Ink's `useInput`, an
> SGR-1006 mouse-sequence parser (`src/input/mouse.ts`), and an `isLeakedMouseInput()` guard
> that drops mouse-escape fragments before Ink's stripped-ESC input parser can misread them
> as keystrokes -- privateer's own comments describe the exact failure mode this ticket
> reports (digits from a leaked sequence misread as accelerator keystrokes). Also a reusable
> scroll-viewport module (`src/ui/scroll-viewport.ts`) for the transcript-pane half of this
> ticket. This substantially lowers this ticket's risk/effort once DH-0136 lands -- it's a
> known pattern to port, not protocol work to invent from scratch. Not split into an urgent
> standalone fix (as originally considered) since the working solution is Ink-shaped and
> wouldn't transfer to the current hand-rolled ANSI renderer -- stays fully blocked on
> DH-0136, per the owner's original call that this ticket's implementation would be redone
> after the UI overhaul regardless.

> [!NOTE]
> **2026-07-17 — implemented, verified against the real compiled binary.** Ported
> `../privateer`'s SGR-1006 mouse parsing (`src/tui/mouse.ts`) and mouse-mode lifecycle
> (`src/tui/mouse-lifecycle.ts`), and added a small `scroll-bus` (`src/tui/ink/scroll-bus.ts`)
> that `app.ts`'s raw `stdin.on("data", ...)` listener uses to forward wheel-scroll deltas to
> whichever `<TranscriptPane>` is currently mounted (root or agent-detail view) — the offset
> itself stays local component state, per `scroll-viewport.ts`'s existing "controller stores
> just the offset" design, so `state.ts`/`types.ts` needed no reducer changes.
>
> Root cause confirmed: `keys.ts`'s `parseKeys` has no notion of the `ESC [ < ... M` SGR
> introducer, falls through its "unrecognized CSI" branch, consumes only the first 3 bytes as
> `unknown`, then reads the sequence's remaining digits/semicolons back out as literal `char`
> keystrokes — landing straight in the composer. Fix: `app.ts`'s stdin handler now runs
> `parseSgrMouseChunk` first (routing `scrollUp`/`scrollDown` events to the scroll bus,
> ±3 lines per notch) and strips every matched (plus any trailing partial) SGR sequence via
> `stripSgrMouseSequences` before the remainder reaches `parseKeys`.
>
> **Manual tmux verification (real PTY, real compiled binary):** built `dh` via
> `bun run build`, ran it against a minimal mock Anthropic-compatible SSE endpoint inside a
> real `tmux` session (mouse mode on), sent a message to populate the transcript with 60 lines
> of content, then injected literal SGR-1006 byte sequences via `tmux send-keys -H` (e.g.
> `1b 5b 3c 36 34 3b 31 30 3b 35 4d` = scroll-up at (10,5)) — the exact bytes a real terminal
> sends for a wheel notch. Confirmed: (1) the visible transcript window shifted by 3 lines per
> notch on both scroll-up and scroll-down, clamping correctly at top/bottom; (2) the composer
> stayed empty/clean after repeated scroll events — no leaked escape-sequence garbage; (3)
> typing and sending a message immediately after scrolling still worked normally.
>
> **Test discipline:** `bun test src/tui` — 400 pass, 0 fail. New coverage: `mouse.test.ts`,
> `mouse-lifecycle.test.ts`, `ink/scroll-bus.test.ts`, new `TranscriptPane.test.tsx` scroll
> cases, and two new `app.test.ts` integration tests — one asserting the mouse-enable/disable
> escape sequences are written on startup/quit, one reproducing the exact garbage-into-composer
> regression scenario end-to-end through `startTui`. 100% coverage on every new file;
> `src/tui/app.ts` at 99.42% (one pre-existing uncovered line, unrelated to this change).
> `bun run typecheck` clean. `bun run lint` clean for `src/tui`/`src/tui/ink` (one pre-existing,
> unrelated failure in `src/web/client/markdown-dom.test.ts`, confirmed present on a clean
> stash of this same branch — Web domain, not touched here). `bun test src --coverage`: 2145
> pass; 3 pre-existing unrelated failures (`AnthropicProvider` tests erroring on missing
> `ANTHROPIC_API_KEY` in this shell environment, not caused by this change).
