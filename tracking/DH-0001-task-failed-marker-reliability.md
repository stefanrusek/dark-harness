---
spile: ticket
id: DH-0001
type: bug
status: ready
owner: stefan
resolution:
blocked_by: []
created: 2026-07-15
relations:
  depends_on: [DH-0050]
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
  - **Answered 2026-07-15 (architect, Fable):** a structural mechanism is needed — prompt
    wording is tapped out (round 5 maximized it) and cannot fix the underlying property that
    a forgotten marker is indistinguishable from success. See the Design section in
    **DH-0050** and the status-log entry below.

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

### 2026-07-15 — Architect design pass (Fable)

Decision made; escalation resolved. **DH-0050's structural mechanism subsumes this ticket's
open question** — the full design (contract, tool schema, loop semantics, NDJSON stream,
ADR 0006 amendment text, domain assignment) lives in DH-0050's Design section. What lands
here is the bug-fix slice, summarized:

- New built-in **`ReportOutcome` tool** (`src/agent/tools/report-outcome.ts`, name constant
  in `src/contracts/outcome.ts`), registered only for non-interactive runtimes. A valid call
  (`status: "success" | "failure"`, optional summary/filesChanged/artifacts) is the
  authoritative self-report; the turn it lands in is terminal.
- **Missed-call nudge — the part that actually fixes this bug's shape:** if a non-tool-use
  turn ends with no `ReportOutcome` recorded (and not `max_tokens`-truncated), `loop.ts`
  injects one synthetic reminder turn demanding the call. The gemma-4-31b failure mode
  (honest prose admission, missing signal) becomes *detectable and recoverable* instead of
  silently scoring as success — that property, not "models remember tools better," is why
  this beats any further prompt strengthening. It also rides a stronger channel: the tool
  schema travels in every request's `tools` slot, and any model able to operate dh at all
  has already proven it can call tools (gemma called Bash/Read fine; it only dropped a
  free-text token).
- **`TASK_FAILED` scan retained as deprecated fallback** after the nudge — no model or e2e
  fixture behaves worse than today; Iris's round-5 prompt work keeps its value as the
  fallback's teaching text (her `REQUIRED_CONTRACT` gets rewritten to lead with
  `ReportOutcome`, marker demoted to fallback — Prompt task in DH-0050).
- **ADR 0006 exit-code values unchanged** (0/1/2+); only the detection mechanism is amended
  (amendment text in DH-0050, applied by the coordinator when Core's round lands).

Ownership: Core (Grace) implements the tool + `loop.ts` changes per DH-0050's Design;
Prompt (Iris) the `REQUIRED_CONTRACT` rewrite; E2E (Hedy) the fixture/exit-code coverage.

Status → `ready` (back from `implementing` — deliberate, advisory-lifecycle jump: the
round-5 prompt strengthening is committed, but the actual fix is now a fresh, fully-specced
implementation task). `blocked_by` cleared — the architect decision it was blocked on is
this entry. Ticket stays open past implementation for the piece no gate can cover: a live
re-test against gemma-4-31b or a comparable small local model to confirm the nudge+tool
path closes the observed failure.
