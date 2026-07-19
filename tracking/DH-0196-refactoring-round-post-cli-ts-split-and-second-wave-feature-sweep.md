---
spile: ticket
id: DH-0196
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

# DH-0196: Refactoring round: post-cli.ts-split and second-wave feature sweep

## Summary

Third refactoring round (DH-0141 mechanism). Scoped to commits since DH-0190's closing trailer commit, covering: DH-0132 (dh --job acceptance-test prototype), DH-0142/0143/0144 (slash-command autocomplete + skill listing, new src/client-core/command-list.ts), DH-0147/0148 (--job output-mode matrix + --instructions auto-send), DH-0194 (--job prompt awareness), DH-0174 (cli.ts split into 11 src/cli/ modules, redone fresh against current HEAD), DH-0191 (SGR/status-color consolidation onto design-tokens.ts, folded into the cli.ts split), plus README updates (CI badge, new-flag documentation via DH-0195) and DH-0192/0193's design exploration. Several of these landed via careful merge-agent reconciliation of stale worktrees against a fast-moving cli.ts -- worth checking for any residual seams (leftover comments referencing old file locations, inconsistent module boundaries) now that the dust has settled.

## Round outcome (Fable, 2026-07-19)

Process ticket, not an implementation ticket — no User Stories / acceptance tests apply. Left the skeleton sections empty by design; the round's deliverable is the review + filed tickets below.

### Reviewed

- Full commit range `a3cd33d..HEAD` (prior round DH-0190's trailer to current HEAD).
- Close read of the DH-0174 split modules with the "residual-seam after stale-worktree reconciliation" lens per the round brief: `src/cli/{cli.ts (barrel/main), args, run, deps, agent-loop-adapter, styling, help, activity-feed, doctor, import-source, env-file}.ts` and `src/client-core/command-list.ts`.
- Cross-checked every filing candidate against the open-ticket board — no duplicate/overlap with DH-0174, DH-0191, DH-0195, or any other open ticket.

### Filed

- **DH-0197** (bug, draft, Core) — Post-cli-split residual doc/style seams: four dangling doc-comment cross-references left by the split (`run.ts` "createStandaloneRuntime … above"; `deps.ts` + `runtime.ts` referencing a nonexistent `runInstructionsMode`; `agent-loop-adapter.ts` x2 referencing a nonexistent `runMode()`), plus `help.ts`'s `HELP_CYAN_BOLD` raw-SGR literal bypassing the DH-0191 `wrapSgr` primitive every other CLI styling helper routes through. Pure doc + small styling-plumbing cleanup, no behavior change.

### Considered and NOT filed (no silent truncation)

- `pruneLogDirectories` two-line call duplicated across `run.ts:243` and `agent-loop-adapter.ts:188` — sits in two genuinely distinct runtime-construction paths (interactive vs. standalone); extracting a helper would be net-negative indirection.
- `Object.freeze()` on string/number primitives (`styling.ts` `CLI_RESET`; `doctor.ts` `DOCTOR_*_COLOR`, `DOCTOR_VERDICT_LABEL_WIDTH`) — no-op, harmless, predates the split.
- Unused-outside-module styling.ts exports (`CLI_YELLOW`, `CLI_BOLD`, `cliColorize`) — coherent palette API, lint clean, left as-is.
- `args.ts`, `import-source.ts`, `env-file.ts`, `activity-feed.ts`, `command-list.ts` — reviewed, found clean and internally consistent; nothing to file.

### Flagged for coordinator (not architect-escalation)

- Tracking hygiene, not a code issue: DH-0174 and DH-0191 both still show `status: draft` in the board despite having landed in HEAD (commit `5caae69`). Worth a status reconciliation. Not an escalation trigger under CLAUDE.md §6.

### Escalation

None. No finding touched a §4 invariant, `src/contracts/`, security posture, the exit-code/logging contracts, or a cross-domain boundary — all findings are single-domain (Core) routine cleanup.
