---
spile: ticket
id: DH-0216
type: bug
status: draft
owner: stefan
resolution:
blocked_by: []
created: 2026-07-19
relations:
  depends_on: []
  relates_to: []
  supersedes: []
implementation:
  - repo: dark-harness
---

# DH-0216: Refactoring round: post-P0-fixes and Workflow/self-awareness feature sweep

## Summary

Fourth refactoring round (DH-0141 mechanism). Scoped to commits since DH-0196's closing trailer, covering: DH-0211 (Escape stops agent), DH-0210 (real --import/resume tool-block bug fix), DH-0212/0214 (TUI spike suite triage + genuine wide-char rendering bug), DH-0166 (P0 loopback bind fix, re-derived twice against a fast-moving cli.ts/client-core structure), DH-0213 (Workflow tool research), DH-0215 (agent self-awareness -- session/agent id + log path in system prompt). Several of these landed via stale-worktree re-derivation against heavily-restructured code (the cli.ts split, the sse-client.ts deletion) -- worth checking for residual seams the same way DH-0196 did after the first wave of that. Also worth checking: a ticket-ID collision occurred this round (two isolated worktrees both minted DH-0213 independently) -- the spile-ops minting process may need a documented convention or safeguard for high-concurrency dispatch waves, worth a process-level finding if a clean product fix doesn't cleanly apply.

## Round close-out (Fable, 2026-07-19)

### Reviewed

- All commits `9be46ff..HEAD` (DH-0196's trailer to now).
- Landed product code this round: **DH-0210** (resume fold fix, `src/agent/resume.ts`),
  **DH-0212** (TUI spike-suite triage, tests only), **DH-0215** (agent self-awareness,
  `src/prompt/system-prompt.ts` + `src/agent/runtime.ts`). DH-0166, DH-0211, DH-0214 are
  `ready` but **not yet implemented**; DH-0213 is `draft` research only. So the actual
  merge-surgery surface was narrower than the round brief implied.
- Read for residual merge seams: `src/agent/runtime.ts`, `src/cli/run.ts`,
  `src/client-core/sse-transport.ts`, `src/agent/resume.ts`, `src/prompt/system-prompt.ts`.
  No stale line-number doc refs, no leftover TODO/FIXME/dead code, no merge artifacts. The
  DH-0215 fallout was already cleaned in-round: `a45b5c7` removed the dead pre-DH-0173
  `providerFor()`, and `699f761` removed two scratch fixtures (`markdown-test.md`,
  `planets_data.md`) that a broad `git add -A` swept in. Both already fixed — nothing to file.
- **resume.ts sibling-bug check (round brief item):** examined `foldEventsToMessages` for the
  same class of asymmetry DH-0210 fixed (one branch flushing, a sibling not). The three
  content branches (`message`, `tool_call`, `tool_result`) are now flush-symmetric — the
  `tool_call` branch's new `flushResults()` closed the gap and no analogous unflushed sibling
  remains. **No sibling bug to file.**

### Filed

- **DH-0217** (bug, draft) — spile-ops `new_ticket.py` counter is unsafe for concurrent
  isolated worktrees; the DH-0213 double-mint is a systemic gap. Flagged for coordinator
  triage (process tooling, not a `src/` domain).
- **DH-0218** (bug, draft) — `renderSelfInfoSection` signature accreted a defaulted
  `buildInfo` + three all-or-nothing trailing optionals across DH-0094/0194/0215; bundle the
  self-identity fields into one typed object. Owner: Prompt (Iris). Small/low-priority.

### Considered and deliberately NOT filed (no silent truncation, CLAUDE.md §8)

- The `git add -A` scratch-file sweep (`699f761`): already fixed in-round, and hard to guard
  mechanically without an over-broad root-`.md` gitignore. One-off discipline slip, not worth
  a ticket.
- DH-0166's `0.0.0.0` default bind in `src/cli/run.ts`: already covered by DH-0166 (ready),
  not a new finding.

### Assessment: is the ticket-ID collision race real or a fluke?

**Real, worth hardening — see DH-0217.** It is a genuine structural gap, not a fluke: the
counter is a tracked file, so two isolated worktrees at the same base counter each mint the
same ID independently and only collide at merge. Crucially it is **not** a same-filesystem
read-then-write race — a file lock or atomic increment would not help, because the writers are
physically separate checkouts. The right fix is a documented convention (mint only from the
primary checkout) and/or a worktree-detection guard in `new_ticket.py`.

## Notes

- Nothing this round tripped a CLAUDE.md §6 escalation trigger beyond DH-0217's ownership
  ambiguity (process tooling doesn't map onto §3), which is flagged on that ticket for
  coordinator triage rather than architect arbitration.
- Round left open for the coordinator to close per standing authorization (PLAYBOOK.md §7.1);
  `Refactoring-Round:` trailer intentionally not added by Fable.
