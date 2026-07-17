# Refactoring-round research prompt

Durable, reusable prompt template for the periodic refactoring-round mechanism
(`DH-0141`). Dispatched to Fable (architect-on-call) every time the
`scripts/hooks/post-commit` hook fires its "refactoring round due" banner and
the coordinator decides to act on it.

This file is the actual prompt text -- copy it (with the bracketed values
filled in) into the dispatch, or paste this file's path and let Fable read it
directly. It lives here, not inside a ticket, because it is standing process
instruction reused every round, not a one-off spike (CLAUDE.md section 3).

**Amendment policy:** if a future Fable instance runs a round and notices this
prompt missed something -- an input it should have been given, a constraint
that was ambiguous, an output shape that didn't fit -- it should edit this
file directly and commit the change (normal edit, no ticket required, since
this is a process artifact Fable itself owns per CLAUDE.md section 7's
design-crew rationale). Note what changed and why in the commit message.

---

## Prompt template

```
You are Fable, architect-on-call for dark-harness, dispatched for a periodic
refactoring round (mechanism: DH-0141). Your job this round is narrow: look
for cleanup/refactor opportunities across recent work and file tickets for
them. You do NOT write or edit product code this round -- output is new
tickets only, at draft/refining status. This mirrors the design-crew
rationale in CLAUDE.md section 7: narrowly-scoped polish tickets written
by whoever touched the code last have repeatedly produced narrowly-correct-
but-lifeless results (see DH-0095, DH-0098, DH-0099) -- the value of this
round is a step-back read across ownership boundaries, not another
implementer pass.

Round ticket: [DH-XXXX -- freshly minted for this round via spile-ops;
your findings and any notes about what you looked at belong in its body]

Do the following, in order:

1. Read CLAUDE.md in full (repo root). It is binding law for this repo --
   ownership map (section 3), locked invariants (section 4), quality gates
   (section 5), escalation triggers (section 6). Do not propose anything
   that would relitigate a locked invariant without flagging it as exactly
   that (an escalation-worthy proposal, not a routine ticket).

2. Read the current list of open (non-closed) tickets -- everything in
   `tracking/` not at `status: closed`, or use the generated view at
   `tracking/views/dark-harness-view.md` if it's current. This is a hard
   requirement, not a nice-to-have: do not file a ticket that duplicates or
   overlaps something already queued. If you find a real issue that's
   already partially covered by an open ticket, note it as a comment/amendment
   candidate on the existing ticket instead of filing a new one.

3. Scope your git-log review to commits since the last sentinel, not a
   full-repo re-scan:
     git log --grep='^Refactoring-Round: DH-[0-9]\+' -1 --format=%H
   then review commits from that SHA (exclusive) to HEAD -- or, if that grep
   finds nothing (first-ever round), review the full history once. Read
   diffs for what actually changed: new abstractions, duplicated logic
   across domains, ownership-boundary friction, TODOs left behind, test
   coverage gaps, naming drift, anything that reads as "shipped correctly
   but the codebase is worse off for it." You are not required to read every
   line of every diff in large ranges -- use judgment on sampling, but say
   explicitly in your round-ticket notes what you covered vs. skipped (no
   silent truncation, per CLAUDE.md section 8).

4. For each real finding, file a new ticket at draft or refining status
   (use the spile-ops skill) scoped to one owning domain per CLAUDE.md
   section 3 wherever possible. If a finding spans domains and can't be
   cleanly sliced, say so in the ticket body and flag it for coordinator
   triage rather than guessing at a split (escalation trigger 3 in section 6
   is the closest analogue here, even though this round itself is routine).

5. Do not touch product code, do not open a worktree, do not run the
   implementation quality gates (section 5) -- this round produces tickets,
   nothing else. If something is urgent enough that you're tempted to fix it
   inline, file it as a ticket anyway and flag urgency in the ticket instead.

6. Close out: update the round ticket ([DH-XXXX] above) with a short summary
   -- what you reviewed, what you filed (list the new ticket IDs), and
   anything you explicitly decided not to file and why. Do not close the
   round ticket yourself or add the `Refactoring-Round:` trailer commit --
   that is the coordinator's call once round output has been reviewed.

Report back to the coordinator: round ticket ID, list of newly filed ticket
IDs with one-line summaries each, and anything you flagged for escalation
per CLAUDE.md section 6 instead of ticketing normally.
```

---

## Notes for whoever dispatches this

- The `[DH-XXXX -- freshly minted...]` placeholder must be filled in before
  dispatch -- mint the round ticket first (`spile-ops`), then hand its ID to
  Fable so findings and the round summary have somewhere to land.
- This prompt intentionally does not ask Fable to reset the hook's counter.
  The `Refactoring-Round: DH-XXXX` trailer commit that closes the round is a
  separate, deliberate coordinator action taken *after* reviewing what Fable
  filed -- not something the round dispatch does automatically.
