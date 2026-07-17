---
spile: ticket
id: DH-0141
type: feature
status: draft
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

# DH-0141: Formalize a periodic refactoring-round mechanism

## Summary

No mechanism exists today to step back and look for cleanup/refactor opportunities across the codebase -- implementers ship narrowly-scoped work ticket by ticket, and nothing ever asks whether the codebase as a whole still makes sense. Proposal (owner design, 2026-07-17): a post-commit hook on the main checkout (NOT installed in forked-subagent worktrees -- worktrees are short-lived and merge back in) that runs git log looking for a Refactoring-Round: DH-XXXX trailer within the last N commits (N configurable, starting guess 15). If none found, print a loud advisory banner (commit still succeeds -- this cannot block, it fires post-commit) prompting the coordinator to schedule a refactoring round. Merging several implementer worktrees in a row can push the count past N in one go, which is fine/expected -- that is exactly when a round is due. When triggered, dispatch Fable (architect-on-call) -- not a narrow implementer -- with: CLAUDE.md, the current list of open tickets (so it does not propose work that duplicates something already queued), and git log since the last sentinel commit (scoped to what actually changed, not a full-repo re-scan every time). Fable's output is new tickets only (draft/refining status), never direct code edits -- this is deliberate, mirrors the design-crew rationale already in CLAUDE.md section 7 against narrowly-scoped-but-lifeless results. The round closes with one commit carrying the Refactoring-Round trailer to reset the hook's counter.

## User Stories

### As the coordinator, I want a loud stderr warning when 15 commits have passed since the last refactoring round, so I know to schedule one

- Given the main checkout's git log has 15+ commits since the last commit carrying a `Refactoring-Round: DH-XXXX` trailer (or no such trailer exists at all in history), when a new commit is made on the main checkout, then the post-commit hook prints a prominent, hard-to-miss banner to stderr naming how many commits it has been.
- Given fewer than 15 commits have passed since the last sentinel trailer, when a new commit is made, then the hook prints nothing (or an unobtrusive status line at most -- exact silence vs. quiet confirmation is an implementation call).

### As the coordinator, I want the hook to only ever run in the main checkout, never in a forked-subagent worktree

- Given a `forked-subagent` implementer is committing inside its own git worktree, when it commits, then no refactoring-round banner fires there -- the hook is not installed/active in worktrees at all.
- Given several implementer worktrees get merged into the main checkout in a row, when the merge commits land, then the counter can jump past 15 in one step and the hook still fires correctly on the commit that crosses the threshold.

### As the coordinator, I want to dispatch Fable for a refactoring round that files tickets, not code edits

- Given a refactoring round is triggered, when Fable is dispatched, then it receives CLAUDE.md, the current list of open (non-closed) tickets, and `git log` scoped to commits since the last sentinel trailer -- not a full-repo re-scan.
- Given Fable's review completes, when it reports back, then its output is exclusively new tickets at `draft`/`refining` status (never a direct code edit) -- mirrors the design-crew rationale in CLAUDE.md section 7.
- Given a refactoring round's findings have been filed as tickets, when the round is considered closed, then one commit is made carrying a `Refactoring-Round: DH-XXXX` trailer (XXXX = this ticket, or a fresh per-round ticket -- TBD in Functional Requirements) to reset the hook's counter to zero.

## Functional Requirements

- Sentinel format: a git commit message trailer `Refactoring-Round: DH-XXXX`, not a subject-line magic string -- keeps `git log --grep`/`--pretty` queryable and out of the human-readable subject.
- Hook implementation: a checked-in script (e.g. `scripts/hooks/post-commit`), NOT a raw `.git/hooks/` file (unversioned) -- plus a one-time install step (e.g. `scripts/install-git-hooks.sh`) that copies/symlinks it into `.git/hooks/post-commit` for the main checkout only.
- Threshold: starts at 15 commits, owner-confirmed 2026-07-17 ("if we had it in from the start we would have done 20 of them by now, which is not so many as to be painful"). Must be easily tunable (a constant or config value, not hardcoded string-matched in three places).
- Notification channel: stderr only for now, no Slack/SlackBus posting -- owner decision 2026-07-17, revisit only if a real miss happens (this project's standing "defer speculative hardening" convention).
- Decide ownership: which directory/domain owns `scripts/hooks/`? Likely Core (`scripts/` is already Core-owned per CLAUDE.md section 3) or a new coordinator-owned convention -- needs a call during implementation.
- Decide whether each refactoring round gets its own fresh ticket ID (so the trailer always points at a distinct per-round record) vs. reusing DH-0141 itself as the trailer target for every round -- leaning toward a fresh ticket per round (keeps history of "what did round N actually find" per round, rather than one ticket accumulating unrelated notes forever), but not yet decided.

## Assumptions

- The main checkout is the only place commits that matter for this counter happen -- worktree commits don't count until they're merged in (at which point they become commits in the main checkout's history anyway).

## Risks

- A post-commit hook cannot block a commit (it fires after the fact) -- this is purely advisory. If the coordinator (or whoever is committing) ignores the banner, nothing else enforces the round. Accepted risk per owner's stderr-only decision.

## Open Questions

- Per-round ticket vs. reusing DH-0141 as the perpetual trailer target (see Functional Requirements).
- Which domain owns `scripts/hooks/` and the install script.

## Notes
