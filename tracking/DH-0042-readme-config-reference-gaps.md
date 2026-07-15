---
spile: ticket
id: DH-0042
type: bug
status: closed
owner: stefan
resolution: done
blocked_by: []
created: 2026-07-15
relations:
  depends_on: []
  relates_to: []
  supersedes: []
implementation:
  - repo: dark-harness
---

# DH-0042: README's config reference omits `options.maxTurns` and per-model pricing fields, with no automated check against `src/contracts/config.ts`

## Summary

README's config reference documents `options.defaultModel` and `options.runInBackgroundDefault`
but not `options.maxTurns` (defined in `src/contracts/config.ts`) or the optional per-model
`inputPricePerMToken`/`outputPricePerMToken` pricing fields used for cost tracking. README already
self-acknowledges (in its own "Status / deferred this round" note) that the config sample is kept
in sync by hand rather than generated/checked against the contract — a real, named maintenance
risk that could be closed with a CI check.

## User Stories

### As an operator, I want the README's config reference to document every field the contract actually supports

- Given `src/contracts/config.ts`, when README's config section is read, then `options.maxTurns`
  and the per-model pricing fields are documented alongside the fields already covered.

### As a maintainer, I want README's config sample to be checked against the contract automatically

- Given a future change to `src/contracts/config.ts`, when CI runs, then a check flags README's
  sample if it has silently drifted out of sync, rather than relying on manual diligence.

## Notes

> [!NOTE]
> Source: Docs completeness audit findings #1, #2, #3. Marked `ready` — a small, well-scoped
> documentation fix with an optional CI-check follow-on.
