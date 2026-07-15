---
spile: ticket
id: DH-0052
type: bug
status: draft
owner: stefan
resolution:
blocked_by: []
created: 2026-07-15
relations:
  depends_on: []
  relates_to: [DH-0032]
  supersedes: []
implementation:
  - repo: dark-harness
---

# DH-0052: Windows console/TUI support is unverified — no Windows-specific console-mode handling found, and no Windows execution anywhere in CI

## Summary

`src/tui/` is an alt-screen ANSI TUI with no Windows-specific console-mode handling visible (e.g.
enabling VT100 processing via `SetConsoleMode`, or accounting for raw-mode/TTY differences between
`cmd.exe`/legacy PowerShell and Windows Terminal), and Bun's own raw-mode/TTY support on Windows is
known to be uneven. Combined with **DH-0032** (the windows-x64 release binary is never executed
anywhere in CI), this is a real but currently unverified-in-depth risk: the TUI may or may not work
correctly for a Windows operator, and nothing would catch a regression either way.

## User Stories

### As a Windows operator, I want the console TUI to work correctly in a standard Windows terminal

- Given Windows Terminal or `cmd.exe`, when running `dh` interactively, then the alt-screen TUI
  renders and accepts input correctly, verified by at least a manual (and ideally automated) check.

## Notes

> [!NOTE]
> Source: Competitive-differentiation sweep finding #19 (explicitly flagged as lower-confidence
> than other findings — absence of Windows-specific accommodation was observed, not a confirmed
> live failure). Overlaps with **DH-0032**'s "Windows binary never executed in CI" — that ticket
> covers the release-pipeline testing gap; this one covers the TUI's own Windows-specific
> console-mode correctness question.
