---
spile: ticket
id: DH-0063
type: feature
status: ready
owner: stefan
resolution:
blocked_by: []
created: 2026-07-15
relations:
  depends_on: []
  relates_to: []
  supersedes: []
implementation:
  - repo: dark-harness
---

# DH-0063: spile-ops skill: ID-based ticket resolution + rename-on-retitle tool

## Summary

Real friction from today's heavy usage: tickets are resolved by shelling out to ls/grep against tracking/DH-NNNN-*.md instead of a shared helper, and a ticket's filename slug is frozen at creation and never revisited, so it silently goes stale when a ticket's scope/title changes (e.g. DH-0002's file still says full-mcp-client-support after narrowing to transport-discovery only). Both fixes are purely to our project-local spile-ops skill implementation, not the upstream Spile spec itself.

## User Stories

### As an agent/coordinator working the tracker, I want to open a ticket by its ID alone, without knowing or guessing its exact filename slug

- Given a ticket ID like `DH-0028`, when any spile-ops script (or a human/agent script) needs
  its path, then a shared resolver (`resolve_ticket_path(ticket_id)` in
  `.claude/skills/spile-ops/scripts/common.py`) does the `tracking/DH-NNNN-*.md` glob once,
  in one place — no more `ls tracking | grep 0028` as a manual workaround.

### As a maintainer, I want a ticket's filename to stay honest when its title/scope changes

- Given a ticket whose H1/scope has meaningfully changed since creation (e.g. DH-0002's file
  still reads `full-mcp-client-support` after narrowing to transport-discovery only), when
  `rename_ticket.py DH-0002 "New Title"` is run, then it re-slugs the filename, does a `git
  mv`, and updates the H1 to match — called explicitly when warranted, not automatically on
  every minor rewording (that would just be noisy churn).

## Functional Requirements

- `resolve_ticket_path` must be reused by `transition.py`/`regen_view.py`'s existing internal
  lookup logic (currently each may already glob independently — consolidate to one helper),
  not just added as a new, third way to find a ticket.
- `rename_ticket.py` must refuse to run if the target slug already exists (never silently
  overwrite another ticket's file) and must regenerate the view afterward, same as the other
  two scripts.

## Notes

> [!NOTE]
> Scoped entirely to this project's local `spile-ops` skill implementation
> (`.claude/skills/spile-ops/`) — no change to the upstream Spile spec
> (`tracking/SPILE-SPEC.md`) is implied or needed; the spec doesn't mandate a frozen slug or
> manual lookup, that's just how our tooling currently works.
