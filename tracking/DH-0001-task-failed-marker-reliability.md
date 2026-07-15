---
spile: ticket
id: DH-0001
type: bug
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

# DH-0001: `TASK_FAILED` marker is not reliably emitted despite being taught

## Summary

ADR 0006's exit-code contract depends on the model including the literal text `TASK_FAILED`
in its final response when it cannot complete its instructions — a convention Prompt round 3
added to the system prompt. Confirmed live with gemma-4-31b: given a genuinely impossible
task, the model correctly stated in plain English that it could not complete it, but never
emitted the marker, so `dh` reported exit code 0 (success) for a self-acknowledged failure.

## User Stories

### As an operator running an unattended (`--job`) task, I want the exit code to reflect the model's own assessment of whether it succeeded

- Given a model that explicitly states in its final response that it could not complete the
  instructions, when it does not include the `TASK_FAILED` marker, then `dh` currently
  reports exit code 0 (success) — incorrect.
- Given the same scenario, when the fix lands, then `dh` reports a non-zero exit code
  consistent with the model's own stated outcome.

## Functional Requirements

- Given any self-reported failure in the model's own words, when the final turn ends with
  no tool call, then the harness's success/failure determination must not rely solely on the
  presence of an exact literal string the model may not reliably produce.

## Assumptions

- This was tested against one local model (gemma-4-31b); reliability with Anthropic-hosted
  Claude models is unverified and may differ.

## Risks

- Strengthening the prompt further may still not close the gap for smaller/local models —
  this may need a structural fix (a different self-report mechanism), not just wording.

## Open Questions

- Is a stronger prompt (more repetition, different phrasing/placement) sufficient, or does
  ADR 0006's exit-code contract need a less string-dependent self-report mechanism?

## Notes

> [!NOTE]
> Not a code bug in the strict sense — `loop.ts`'s detection logic and Prompt round 3's
> system-prompt addition both work as designed; the gap is in real-world model reliability
> following the convention.
