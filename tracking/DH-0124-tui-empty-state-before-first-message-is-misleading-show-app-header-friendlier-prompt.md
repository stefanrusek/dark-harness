---
spile: ticket
id: DH-0124
type: feature
status: ready
owner: stefan
resolution:
blocked_by: []
created: 2026-07-17
relations:
  depends_on: []
  relates_to: []
  supersedes: []
implementation:
  - repo: dark-harness
---

# DH-0124: TUI empty-state before first message is misleading -- show app header + friendlier prompt

## Summary

Owner observation from live manual testing 2026-07-17: the TUI's initial history-window message ('Waiting for root agent to start...') is technically true but misleading -- it's really waiting for the operator's first message, not for the root agent itself to spin up. Should instead show a lighter variant of the new application header (see sibling header ticket -- fewer dh.json settings than the full version) plus a friendly prompt inviting the first message. TUI domain (Mary), depends on the app-header ticket landing first for the shared header-building logic.

## User Stories

### As an operator opening the TUI for the first time, I want the empty history window to tell me it's waiting on *me*, not on the harness

- Given a fresh TUI session with no turns yet in the root agent's transcript, when the root view renders, then the history window shows the app's compact identity (logo + version) and a friendly prompt inviting the first message, instead of "Waiting for root agent to start…".
  Proven by: `src/tui/ink/RootView.test.tsx` — "before any turns exist, shows the app identity + an invite to send the first message, not a 'waiting' message"; `src/tui/ink/RootView.test.tsx` — "no longer implies the harness/root agent itself hasn't started".
- Given the shared `formatEmptyStateLines` builder, when it formats a `HeaderInfo`, then it returns only the compact logo and version line — no `dh.json` config-status line, since nothing about that config is relevant before a first message (and, for a `--connect`ed TUI, isn't even known locally).
  Proven by: `src/header-info.test.ts` — describe block `formatEmptyStateLines`, both cases (config present, config absent).
- Given a transcript that already has turns, when the root view renders, then the ordinary transcript rendering is shown — the new empty-state block only ever appears pre-first-message.
  Proven by: `src/tui/ink/TranscriptPane.test.tsx` — existing "windows to only the last `height` rows" and other non-empty-transcript cases, which render `renderTranscript` output rather than `emptyText`, are unchanged and still passing.

## Functional Requirements

- `header-info.ts` exports `formatEmptyStateLines(info: HeaderInfo): string[]`, returning `[logoCompact, formatVersionString(build)]` — reuses DH-0122's shared builder, adds no new data-gathering.
- `TranscriptPane`'s `emptyText` prop may contain `"\n"`-separated lines and is split into one row per line (previously always rendered as a single row).
- `RootView` builds its empty-state text via a new `buildRootEmptyText()` helper: compact logo, version line, a blank line, then a friendly prompt ("Type a message below to get started."). `AgentView`'s "(no output yet)" empty state (a different context — viewing a sub-agent, not the pre-first-message root) is unchanged.

## Assumptions

- The TUI client has no local `dh.json` to summarize (per Header.tsx's existing header comment: true even when not `--connect`ed, since the TUI only ever holds a `baseUrl`/token) — so the empty-state variant never needs a config-status line, and `buildHeaderInfo`'s `config` argument is passed `null` for this call site.

## Risks

## Open Questions

## Notes

### 2026-07-17 — implemented (Mary, TUI domain)
Implemented per this ticket's User Stories. `formatEmptyStateLines` added to `src/header-info.ts`; `TranscriptPane.emptyText` now splits on `"\n"`; `RootView.buildRootEmptyText()` composes the new content. Status moving to `verifying`.
