---
spile: ticket
id: DH-0217
type: bug
status: implementing
owner: stefan
resolution:
blocked_by: []
created: 2026-07-19
relations:
  depends_on: []
  relates_to: [DH-0216]
  supersedes: []
implementation:
  - repo: dark-harness
---

# DH-0217: spile-ops new_ticket.py counter is unsafe for concurrent isolated worktrees — ID collisions

## Summary

During refactoring round DH-0216, two concurrent isolated worktrees both minted `DH-0213`
independently (caught and fixed by the coordinator, who renamed the wide-char ticket to
DH-0214 — see commit `d1a1ab2`). This is a systemic gap in how `spile-ops`' `new_ticket.py`
allocates IDs, not a one-off fluke worth ignoring.

`new_ticket.py` mints an ID by reading `tracking/README.md`'s `counter:` field, computing
`counter + 1`, writing the ticket file, then bumping the counter (`read_counter()` →
`bump_counter()` in `.claude/skills/spile-ops/scripts/new_ticket.py`). The counter lives in a
tracked file. When two agents work in **separate git worktrees** (the standard parallel-domain-
lead isolation pattern — see `.gitignore`'s "isolated worktrees for parallel domain leads"
note), each has its own physical copy of `tracking/README.md` at the same counter value. Both
read the same number, both write the same `DH-NNNN` filename into their own worktree, both bump
their own counter identically. Nothing collides until the branches merge — at which point two
different tickets claim the same ID.

Note this is **not** a same-filesystem read-then-write race that a file lock or atomic
increment would fix: the two writers are physically separate files on separate checkouts that
only reconcile later via git. File locking cannot see across worktrees. The fix is either a
process convention or a worktree-aware guard, not intra-process serialization.

## User Stories

### As a coordinator dispatching a concurrent wave of ticket-filing work, I want ID minting to be collision-safe

- Given two isolated worktrees each running `new_ticket.py` against the same base counter,
  when both complete and their branches are merged, then no two tickets share the same
  `DH-NNNN` ID (either by convention that prevents the concurrent mint, or by tooling that
  refuses/warns when minting from a linked worktree).

### As an agent about to mint a ticket from an isolated worktree, I want the tooling to stop me

- Given `new_ticket.py` is invoked from a linked git worktree (not the primary checkout),
  when it runs, then it detects the worktree context (e.g. `git rev-parse --git-common-dir`
  differs from `--git-dir`) and refuses or loudly warns, directing the caller to mint from the
  coordinator's primary checkout instead.

## Functional Requirements

- Decide and document the authoritative convention: ticket minting happens only from the
  coordinator's primary checkout, never from an isolated/linked worktree. Record it in
  `tracking/README.md` and/or the spile-ops SKILL.md so it is discoverable at the point of use.
- Optionally (owner/architect call — see Open Questions) add a mechanical guard in
  `new_ticket.py` that detects a linked-worktree invocation and refuses/warns, so the
  convention is enforced rather than merely stated.
- Whatever is chosen, cover it with a test in the spile-ops test suite (the worktree-detection
  branch, if implemented; otherwise a documentation-presence assertion is not meaningful — see
  Open Questions on whether a pure-convention resolution is testable at all).

## Assumptions

- The parallel-domain-lead workflow will keep using isolated git worktrees (it is the
  project's standard isolation mechanism), so the concurrency window is real and recurring, not
  hypothetical.

## Risks

- A hard refusal in `new_ticket.py` could block a legitimate mint if the worktree-detection
  heuristic has false positives; a warning-only guard may be ignored under the same time
  pressure that caused the original collision.

## Open Questions

- Convention-only vs. tooling guard vs. both? A pure convention has no executable test to
  satisfy CLAUDE.md §9 — is that acceptable for process tooling, or should the guard be
  mandatory precisely so there is something to test?
- Is there appetite for a stronger fix (e.g. minting IDs from a monotonic source that survives
  merge, like a git-notes or timestamp-suffixed pre-ID reserved at dispatch time)? Likely
  over-engineered for the observed frequency, but worth naming.

## Notes

- This is process/coordination tooling (`.claude/skills/spile-ops/`), not a `src/` product
  domain — it does not map cleanly onto CLAUDE.md §3's ownership table. **Flagged for
  coordinator triage** to decide owner and whether the tooling guard is worth building vs. a
  documented convention alone.
- Filed by Fable during refactoring round DH-0216.
