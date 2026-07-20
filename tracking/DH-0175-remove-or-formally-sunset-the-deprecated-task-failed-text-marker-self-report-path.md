---
spile: ticket
id: DH-0175
type: bug
status: refining
owner: stefan
resolution:
blocked_by: []
created: 2026-07-18
relations:
  depends_on: []
  relates_to: []
  supersedes: []
implementation:
  - repo: dark-harness
---

# DH-0175: Remove or formally sunset the deprecated TASK_FAILED text-marker self-report path

## Summary

Proposed removal of the `TASK_FAILED` text-marker self-report path and the `"text-marker"`
arm of `OutcomeReportedBy`. **Architect decision (Fable, 2026-07-18): HELD — do NOT remove.**
The premise that the marker is a dead/superseded fallback is false in the current codebase:
the text-marker path is still the *primary, actively-taught* failure self-report mechanism,
the default `reportedBy` for any failure in `cli.ts`, and a live dependency of the e2e suite,
the Bedrock integration test, and the TUI status spikes. DH-0050's intended migration
(prompt teaching `ReportOutcome` as authoritative, `TASK_FAILED` as deprecated fallback) was
never actually completed. Removing the contract value now would break the harness's real
exit-code path. This ticket is reframed from "remove the marker" to "complete the DH-0050
migration first" — see Functional Requirements.

## Domain / owner

Core — src/agent/loop.ts + Contracts src/contracts/outcome.ts (contract change: architect-reviewed)

## User Stories

_To be written at `refining`. Not yet written because the ticket is on hold pending the
prerequisite migration below; there is no removable scope to spec against acceptance criteria
until that lands._

## Functional Requirements

**This ticket does not authorize removing the `"text-marker"` arm of `OutcomeReportedBy` or
the `TASK_FAILED` marker scan.** The architect review found the marker is not dead:

1. `src/cli.ts:1964` uses `"text-marker"` as the default `reportedBy` for every failure that
   carries no explicit reporter (`result.reportedBy ?? (result.success ? "clean-end" :
   "text-marker")`). It is the live failure default, not a legacy arm.
2. `src/prompt/system-prompt.ts` (`REQUIRED_CONTRACT`, lines ~99-118) teaches `TASK_FAILED`
   as the *mandatory primary* failure convention — "every time, no exceptions" — and does
   **not mention `ReportOutcome` at all**. So in production the marker is what the model is
   actually driven to emit; `ReportOutcome` is registered (`runtime.ts`) but untaught.
3. Live consumers that would break: `e2e/exit-codes.test.ts:56`, `e2e/bedrock-provider.test.ts:77,96`,
   the TUI spikes (`e2e/spikes/tui/spike-task-failed-status.ts`, `run-all.ts`), plus
   `src/agent/loop.test.ts` / `runtime.test.ts` / `cli.test.ts` cases that assert
   `reportedBy === "text-marker"`.

**Prerequisite before any removal work can be specced (each its own future ticket / handoff):**

- **P1 (Prompt domain, Iris):** finish the DH-0050 migration in `REQUIRED_CONTRACT` — teach
  the model to call `ReportOutcome` as the authoritative final action, and demote `TASK_FAILED`
  to an explicitly-labelled deprecated fallback. Until the prompt actually leads with the
  structured tool, the marker cannot be "the deprecated path" in anything but name.
- **P2 (deprecation window):** the `"text-marker"` value must remain a valid `OutcomeReportedBy`
  member through at least one released version after P1 lands, because logs, `summary.json`,
  and `--job --json` NDJSON already emitted in the field carry it, and downstream parsers
  (dark-factory) key on it. Contract enum values are wire truth (CLAUDE.md §4.6) — dropping a
  value is a breaking wire change, allowed only after a documented sunset, never as cleanup.
- **P3 (Core, Grace):** only once P1/P2 are satisfied does collapsing the precedence chain and
  changing the `cli.ts` default become a real, safe ticket. It must land together with updates
  to every consumer in item 3 above, not ahead of them.

## Notes

Filed by Fable during refactoring round DH-0169. Architect review completed 2026-07-18.

Original draft context: DH-0050 introduced the structured `ReportOutcome` tool intending it
to supersede the free-text `TASK_FAILED` scan, retaining the marker as a "deprecated
fallback" (`TASK_FAILED_MARKER`, precedence branch `src/agent/loop.ts:8-34,75`, and the
`"text-marker"` arm of `OutcomeReportedBy` in `src/contracts/outcome.ts:26`).

**Architect call:** the marker is not safe to remove and does not merely need a deprecation
window on top of otherwise-complete work — the superseding mechanism was never wired into the
prompt, so the "deprecated fallback" is still doing the primary job. Removing the contract
value now is a breaking wire change with no live replacement behind it. Held in `refining`
pending P1-P3. Re-escalate to architect at the point the actual contract-value removal is
specced (still a §6 item-2 change).

