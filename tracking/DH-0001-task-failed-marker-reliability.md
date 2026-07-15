---
spile: ticket
id: DH-0001
type: bug
status: implementing
owner: stefan
resolution:
blocked_by: ["owner/architect decision needed on structured self-report mechanism (same question as DH-0050)"]
created: 2026-07-15
relations:
  depends_on: []
  relates_to: [DH-0050]
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

## Status log

### 2026-07-15 — Prompt round 5 (Iris)

Strengthened the `TASK_FAILED` bullet in `src/prompt/system-prompt.ts`'s `BASE_PROMPT`:
restated as "every time, no exceptions", named the exact observed failure mode (writing an
honest failure admission and forgetting the marker), added a worked correct/incorrect
example, and added an explicit re-read-before-you-end-your-turn self-check. Gates
(`typecheck`, `lint`, `test:coverage`) pass, 100% coverage retained on
`src/prompt/system-prompt.ts`. Full rationale in `docs/handoffs/prompt-docs.md` Round 5
entry.

This is a real improvement to the existing mechanism, not a verified fix — no way to
re-test against a live gemma-4-31b session from this environment, and the underlying risk
this ticket already named (prompt wording may not close the gap for models that already
write an honest failure admission and simply omit one token) still applies in principle.

**Escalating rather than resolving the Open Question:** whether ADR 0006's exit-code
contract needs a less string-dependent self-report mechanism is a real design question, not
a wording gap — a structural fix (e.g. a mandatory structured "report terminal outcome" tool
call instead of scanning free text for a literal string) would touch `src/agent/loop.ts`
(Core's territory) and the exit-code contract itself, which CLAUDE.md §6 names explicitly as
architect-review territory (trigger #4). Not picking that direction unilaterally from the
Prompt domain — flagging it for the architect-on-call (Fable) / coordinator to weigh.

Leaving status as `implementing`, not closing: the prompt change is committed and gate-clean,
but neither behaviorally verified nor a full resolution of the ticket's actual open question.
Needs either (a) a live re-test against gemma-4-31b or a similar small/local model to see if
this materially helps, and/or (b) an architect decision on the structural alternative above.
