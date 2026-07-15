---
spile: ticket
id: DH-0008
type: feature
status: implementing
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

# DH-0008: Adopt (or build) a `spile-ops` skill for mechanical ticket operations

## Summary

`SPILE-SPEC.md` §"Tooling layers" names `spile-ops` as the portable skill for exactly the
mechanical work of running this tracker: scaffolding new tickets, minting IDs, transitioning
status, regenerating the view doc. Confirmed by direct experience: hand-authoring
DH-0001 through DH-0007 plus the root doc and view doc this session consumed a meaningful
chunk of coordinator context on pure formatting/mechanics — exactly the kind of well-
specified, repeatable task that should be a one-line dispatch ("create a ticket for X" /
"transition DH-0004 to refining and regenerate the view") to a skill-equipped sub-agent
instead of the coordinator writing every file by hand.

## User Stories

### As the coordinator, I want to create/update tickets and regenerate the view by dispatching a short instruction, not hand-writing files

- Given a request like "file a ticket for X, type bug, status ready," when dispatched to a
  `spile-ops`-skilled agent, then the correctly-formatted ticket file (front matter + body
  skeleton) is created, the root doc's counter is bumped, and the view doc is regenerated —
  all without the coordinator writing the file content itself.
- Given a status transition (e.g. `ready` → `implementing`), when dispatched, then the
  ticket's front matter updates and the view regenerates in the same operation, per the
  spec's "regeneration is owned by the mutation path" rule.

## Functional Requirements

- Given any ticket mutation performed through the skill, when it completes, then
  `tracking/views/dark-harness-view.md` reflects the change — never stale.

## Assumptions

- If Spile ships/publishes an actual `spile-ops` skill package upstream (per `SPILE-SPEC.md`
  ticket SPILE-0001), adopting that directly is preferable to building our own from scratch —
  check before building.

## Risks

- None significant — this is tooling for our own process, low blast radius if imperfect.

## Open Questions

- Does an upstream `spile-ops` skill already exist to adopt, or do we need to write a
  project-local one against this spec?

## Notes

> [!NOTE]
> Raised by the owner directly: "if at any point you feel like we need skills for anything...
> feel free to create a ticket... it would totally save context just to fire off a sub agent
> saying create this file/document or update this document." This ticket is exactly that.
