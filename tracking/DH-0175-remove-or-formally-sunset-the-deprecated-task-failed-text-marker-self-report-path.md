---
spile: ticket
id: DH-0175
type: bug
status: draft
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

DH-0050's structured ReportOutcome superseded the legacy TASK_FAILED marker, but the marker scan and its OutcomeReportedBy text-marker arm remain as a fallback.

## Domain / owner

Core — src/agent/loop.ts + Contracts src/contracts/outcome.ts

## User Stories

_To be written at `refining` (draft filed by refactoring round DH-0169)._

## Notes

Filed by Fable during refactoring round DH-0169.

DH-0050 introduced the structured `ReportOutcome` tool as the authoritative self-report,
but the legacy `TASK_FAILED` text-marker scan is retained as a "deprecated fallback":
`TASK_FAILED_MARKER` and its branch in the detection-precedence chain
(`src/agent/loop.ts:8-34,75,639`), plus the `"text-marker"` arm of `OutcomeReportedBy`
(`src/contracts/outcome.ts:29`). Two mechanisms for one signal; the marker path was meant
to be transitional. Decide removal vs. documented sunset so the precedence chain collapses.

**FLAGGED (CLAUDE.md §6 item 2):** removing the `"text-marker"` value from
`OutcomeReportedBy` is a `src/contracts/` change and needs architect sign-off. Also verify
no e2e mock still emits the bare marker (see DH-0115) before deleting the scan.

