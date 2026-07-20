---
spile: ticket
id: DH-0141
type: feature
status: closed
owner: stefan
resolution: done
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
- **Per-round ticket, not a reused DH-0141 (resolved -- see Notes for reasoning).** Every round's sentinel trailer points at a fresh ticket minted for that round (e.g. `DH-0187`), not back at DH-0141. DH-0141 is the mechanism's own design/build ticket and closes normally once the hook+install script+template ship; it is never itself a trailer target. Each round ticket's body is the natural place for that round's Fable to leave a short "what I looked at, what I filed, what I explicitly decided not to file" note, distinct from the tickets it spawns.
- **`scripts/hooks/` and `scripts/install-git-hooks.sh` are Core-owned (resolved).** CLAUDE.md section 3 already assigns `scripts/` to Core (Grace) in full -- there is no existing carve-out for a coordinator-owned subtree under `scripts/`, and a hook that is invoked by git plumbing (not dispatched by the agent loop) is exactly the kind of build/dev tooling Core already owns (`scripts/build.ts`). No new ownership convention needed; this is a straightforward extension of an existing one.
- Hook implementation: a checked-in script `scripts/hooks/post-commit` (POSIX sh, executable bit set), NOT a raw `.git/hooks/` file (unversioned) -- plus a one-time install step `scripts/install-git-hooks.sh` that copies (not symlinks -- symlinks into `.git/hooks/` don't survive `git worktree add` cleanly and this must never activate in a worktree) `post-commit` into `.git/hooks/post-commit` for the main checkout only. The install script must refuse to run (no-op with a message) when `git rev-parse --show-toplevel` and `git rev-parse --git-common-dir`/`--git-dir` indicate the current checkout is a linked worktree rather than the main one, as a second guard beyond "just don't run the installer there."
- Threshold: starts at 15 commits, owner-confirmed 2026-07-17 ("if we had it in from the start we would have done 20 of them by now, which is not so many as to be painful"). Implemented as a single named constant/env-overridable value in the hook script (e.g. `THRESHOLD="${DH_REFACTOR_THRESHOLD:-15}"`), read once, not string-matched in multiple places.
- **Commit-counting semantics (was underspecified -- resolved):** "N commits" means commits on the main checkout's current branch **since the last commit carrying a `Refactoring-Round: DH-XXXX` trailer**, counted via `git log --grep='^Refactoring-Round: DH-[0-9]\+' -1 --format=%H` to find that commit, then `git rev-list --count <that-sha>..HEAD` (or `git rev-list --count HEAD` for the zero-sentinel case below) -- not a literal `git log -15` window. This is what makes the "several worktrees merge in a row and jump the counter past 15 in one step" behavior in the User Stories work correctly: the hook always measures distance from the last sentinel, so a burst of merges is reflected immediately on whichever commit crosses the threshold, and undercounting/overcounting from a fixed-window `-15` slice never happens.
- **Zero-sentinel-trailers-ever case (was underspecified -- resolved):** if `git log --grep` finds no commit with the trailer anywhere in history, treat the count as `git rev-list --count HEAD` (distance from the repo root) rather than erroring or silently skipping. This ticket (or the round-0 commit that ships the hook) is expected to be the first sentinel, so in practice this path fires once, at or near hook installation, and should not be treated as a special/rare edge case to under-test -- it is the *first* real invocation.
- **Banner wording/format (was underspecified -- resolved):** printed to stderr only, must not resemble normal git output (so it isn't scrollback-lost), suggested format below -- exact copy is an implementation call but the shape (count, threshold, both trailer commands) is not:
  ```
  ================================================================
  REFACTORING ROUND DUE: 17 commits since the last Refactoring-Round trailer (threshold: 15)
  Dispatch Fable using docs/design/refactoring-round-prompt.md to review recent history and file cleanup tickets.
  Close the round with a commit carrying: Refactoring-Round: DH-XXXX
  ================================================================
  ```
  Below-threshold case prints nothing (silence, per User Stories' "exact silence... is an implementation call" -- resolved in favor of silence to keep normal commits quiet).
- Notification channel: stderr only for now, no Slack/SlackBus posting -- owner decision 2026-07-17, revisit only if a real miss happens (this project's standing "defer speculative hardening" convention).
- **Refactoring-round research prompt template:** lives at `docs/design/refactoring-round-prompt.md` (durable, reusable, cross-cutting process artifact per CLAUDE.md section 3's description of `docs/design/` -- this is not a ticket-scoped spike, it is the standing instruction set dispatched every single round, and needs to be editable in place by a future Fable without going through a ticket). The banner (above) points at this file by path so whoever dispatches Fable does not have to remember where it lives. See that file for full content; hook/install-script implementers do not need to modify it, only reference its path in the banner text.

## Assumptions

- The main checkout is the only place commits that matter for this counter happen -- worktree commits don't count until they're merged in (at which point they become commits in the main checkout's history anyway).

## Risks

- A post-commit hook cannot block a commit (it fires after the fact) -- this is purely advisory. If the coordinator (or whoever is committing) ignores the banner, nothing else enforces the round. Accepted risk per owner's stderr-only decision.

## Open Questions

Both resolved by Fable (architect-on-call), 2026-07-17 -- see Functional Requirements for the resolutions and reasoning inline. Summary:

- **Per-round ticket vs. reusing DH-0141:** resolved in favor of a fresh ticket per round. Reusing DH-0141 forever would turn one ticket into an unbounded, unstructured log of every round's findings with no way to tell "what did round 4 find" from "what did round 9 find" without archaeology, and it would never be closeable (the mechanism's own build ticket should close like any other ticket once shipped). A fresh ticket per round costs one `spile-ops` mint per round (infrequent -- threshold is 15 commits) and gives each round a clean, closeable record.
- **`scripts/hooks/` ownership:** resolved as Core (Grace), per CLAUDE.md section 3's existing blanket assignment of `scripts/` to Core. No new ownership convention was needed -- this is not a boundary case.

## Notes

### 2026-07-17 -- Fable design pass

Resolved both open design questions (see Open Questions/Functional
Requirements above), firmed up the Functional Requirements with previously-
underspecified detail (commit-counting semantics, zero-sentinel-trailer
handling, banner wording), and wrote the reusable refactoring-round research
prompt template implementers will wire the hook to point at:
`docs/design/refactoring-round-prompt.md`. Moved this ticket to `ready` --
Functional Requirements are implementer-actionable. Did not touch
implementation (hook script, install script) per this pass's design-only
scope; that is Core's (Grace's) pickup.

### 2026-07-17 -- Core implementation

Built `scripts/hooks/post-commit` (POSIX `sh`, executable) implementing the
commit-counting semantics exactly as specified: `git log --grep='^Refactoring-Round:
DH-[0-9]\+' -1 --format=%H` to find the last sentinel commit, `git rev-list --count
<sha>..HEAD` from there (or `git rev-list --count HEAD` for the zero-sentinel
bootstrap case), threshold as `DH_REFACTOR_THRESHOLD` (default `15`, read once into a
single variable). Banner (matching the ticket's suggested format) prints to stderr
only when count >= threshold; silent below threshold. The hook cannot block a commit
(fires post-commit, per the ticket's accepted risk) and always exits 0.

Built `scripts/install-git-hooks.sh`: copies (not symlinks) `scripts/hooks/post-commit`
into `.git/hooks/post-commit` and chmods it executable. Refuses to run (prints a
message to stderr, exits 0, no-op) when `git rev-parse --git-dir` resolves to a
different absolute path than `git rev-parse --git-common-dir` -- the signal that the
current checkout is a linked worktree rather than the main one, per the ticket's
guidance.

Testing (CLAUDE.md section 9 -- each User Story bullet mapped to an actual test, not
prose):
- `scripts/hooks/post-commit.test.ts` -- spawns real throwaway git repos in a temp dir
  via Bun subprocess, installs the hook, and drives real `git commit` invocations to
  exercise it end-to-end (not just eyeballed): silence below threshold with the
  zero-sentinel case, banner fires and contains count/threshold/prompt-path/trailer-
  syntax once the zero-sentinel count meets threshold, commit still succeeds (exit 0)
  when the banner fires, counter resets after a `Refactoring-Round:` trailer commit and
  re-accumulates from zero, threshold defaults to 15 when the env var is unset, and a
  burst of commits jumping straight past the threshold in one step still fires with the
  correct exact count (covers the "several worktrees merge in a row" User Story).
- `scripts/install-git-hooks.test.ts` -- spawns real git repos (and a real
  `git worktree add`) via Bun subprocess: installer copies the hook file byte-for-byte
  and makes it executable, copies rather than symlinks, refuses to run inside a linked
  worktree (exits 0, stderr mentions "worktree", neither the worktree's nor the main
  checkout's `.git/hooks/post-commit` gets written), and the installed hook actually
  fires on a real commit in the main checkout end-to-end.
- Both suites live under `scripts/` (not `src/`, so outside the `bun test src`
  100%-coverage gate scope per CLAUDE.md section 5) but are checked in and run via
  `bun test scripts` -- 10/10 passing.

Gates run: `bun run typecheck` (clean), `bun run lint` (clean for these new files --
remaining lint failures are pre-existing, in untouched files under
`.claude/skills/forked-subagent/` and `src/`, confirmed via `git status` showing them
unmodified), `bun run test:coverage` (2172/2172 passing, 100% coverage maintained,
these two files not part of that gate's scope), `bun run e2e` (36/38 passing; the 2
failures are in `e2e/web.test.ts` and `e2e/connect-web.test.ts`, both pre-existing
status-badge-casing failures unrelated to and untouched by this change).

Moving to `verifying`.
