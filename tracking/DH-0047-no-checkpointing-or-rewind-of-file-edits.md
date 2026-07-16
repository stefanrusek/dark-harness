---
spile: ticket
id: DH-0047
type: feature
status: draft
owner: stefan
resolution:
blocked_by: ["deferred (owner decision 2026-07-15): sweep-sourced idea, not a real requested need"]
created: 2026-07-15
relations:
  depends_on: []
  relates_to: [DH-0038]
  supersedes: []
implementation:
  - repo: dark-harness
---

# DH-0047: No checkpointing/rewind of file edits — an off-the-rails unattended run has no automatic rollback

## Summary

`src/agent/tools/edit.ts`/`write.ts` mutate files directly with no snapshot/undo mechanism — no
git-stash-style checkpoint before a destructive edit, and no "rewind to before turn N" capability.
Combined with the lack of session persistence (DH-0038), an unattended run that goes off the rails
leaves no automatic way to roll back its file changes short of the operator's own git discipline
(which, for a dark-factory run explicitly working on an unfamiliar repo, may not exist yet).

## User Stories

### As an operator, I want a way to roll back an unattended run's file changes if it went off the rails

- Given a run that made a series of edits, when the operator wants to undo them, then an
  auto-commit-per-turn or shadow-worktree checkpointing mechanism (config-gated) makes this
  possible without relying on the agent's own git usage.

## Notes

> [!NOTE]
> Source: Competitive-differentiation sweep finding #7.

> [!NOTE]
> Owner decision (2026-07-15): deferred in full. This was a gap-analysis-sourced idea, not
> something the owner has ever wanted or asked for — no real need behind it. Not queuing
> design or implementation work; revisit only if a real operator need for rollback surfaces.
