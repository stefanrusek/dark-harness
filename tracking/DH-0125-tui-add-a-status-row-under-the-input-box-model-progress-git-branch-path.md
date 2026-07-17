---
spile: ticket
id: DH-0125
type: feature
status: verifying
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

# DH-0125: TUI: add a status row under the input box (model, progress, git branch/path)

## Summary

Owner request 2026-07-17, with a reference screenshot of a Claude Code status line (not asking for a full copy of everything in it): add a row under the TUI's input box showing live agent status -- model name, a progress indicator/bar, and git branch + working-directory path. Needs a design pass first to settle exactly which fields, how compact, and how it interacts with narrow terminal widths, before implementation. TUI domain (Mary).

## User Stories

### As an operator, I want a persistent status row under the composer so I can see the active model, progress, and repo location without switching views

- Given a root agent is running, when the status row renders, then it shows the agent's current model name, a spinner + elapsed-time indicator, and the git branch + working directory, all on one line directly under the composer. Proven by `src/tui/ink/StatusRow.test.tsx` ("renders model name, running elapsed indicator, and branch+cwd").
- Given a root agent has reached a terminal status (done/failed/stopped), when the status row renders, then it shows that status word instead of a running elapsed timer. Proven by `src/tui/ink/StatusRow.test.tsx` ("renders a terminal status word (not an elapsed timer) once the agent is done").
- Given the TUI process's working directory is not a git repository (or `git` is unavailable), when the status row renders, then it falls back to showing just the working directory, dimmed, with no branch name. Proven by `src/tui/ink/StatusRow.test.tsx` ("falls back to a dim placeholder for the git location when not in a git repo" and the `detectGitInfo` "reports branch: null when the git command fails" case).
- Given the status row is composed into the app tree, when any view renders, then it stays positioned directly under the root view's composer and the frame's total row count still matches the terminal height exactly (no overflow/scroll from adding this row). Proven by `src/tui/ink/App.test.tsx` ("root view: <Header> renders zero rows, <StatusRow> renders its one line — frame height matches terminal rows exactly", "tree view: ... layout still fits the frame exactly", and "<StatusRow> is positioned directly after the root view").

## Functional Requirements

- Status row shows: model name, a running/elapsed progress indicator (spinner + `formatElapsed` while `running`, else the terminal status glyph+word), and `<branch> · <cwd>` (or just `<cwd>`, dimmed, when not a git repo).
- Status coloring reuses the shared `STATUS_TOKENS` table from `src/design-tokens.ts` (no independently re-derived color mapping).
- Git branch/cwd are detected once per process via `git rev-parse --abbrev-ref HEAD` (injectable in `detectGitInfo` for testing) — not re-shelled on every redraw.
- Row is truncated (not wrapped) to stay exactly one line regardless of path length, since `App.tsx` reserves exactly one row of layout for it.

## Assumptions

- One line is enough; no attempt to reproduce the full reference screenshot's layout, just model/progress/git fields per the owner's explicit ask.

## Risks

## Open Questions

## Notes

### 2026-07-17 — implementation

Filled in `src/tui/ink/StatusRow.tsx` (previously a reserved no-op slot from DH-0136): renders model name, a spinner+elapsed indicator while running (terminal-status word otherwise, colored via `STATUS_TOKENS`), and git branch + `process.cwd()` (falls back to a dimmed cwd-only display when not in a git repo). `App.tsx` now passes `now={state.now}` through and reserves one row of layout (`STATUS_ROW_ROWS`) so the frame still fits the terminal exactly. Updated `StatusRow.test.tsx` and `App.test.tsx` (previously asserting zero-row placeholder behavior) to cover the real content and layout-fit contract.

Gates: `bun run typecheck` clean; `bun run test:coverage` 2119 pass / 0 fail, 100% coverage on `StatusRow.tsx` and `App.tsx`; `bun run lint` clean on all touched files (pre-existing failures on unrelated files confirmed present on the base branch via `git stash`); `bun run e2e` 36 pass / 2 pre-existing failures (`web.test.ts`/`connect-web.test.ts` status-badge casing, unrelated to this TUI-only change, confirmed pre-existing via `git stash`).

Moving to `verifying`.
