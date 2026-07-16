---
spile: ticket
id: DH-0050
type: feature
status: refining
owner: stefan
resolution:
blocked_by: ["architect design pass in progress (same question as DH-0001)"]
created: 2026-07-15
relations:
  depends_on: []
  relates_to: [DH-0001, DH-0037]
  supersedes: []
implementation:
  - repo: dark-harness
---

# DH-0050: No structured final-result convention beyond the `TASK_FAILED` text marker, and no machine-readable progress stream for `--job`

## Summary

The only self-report convention is the `TASK_FAILED` substring scan — success/failure is binary
and purely textual, with no structured payload (files changed, summary, artifacts) that downstream
orchestration could parse deterministically instead of scanning free text. Separately, the
standalone `--instructions --job` path's only stdout output is a single free-text dump of the final
message plus an exit code — there's no incremental, machine-readable (e.g. NDJSON) progress stream
suitable for piping into another automated tool's stdout consumer in real time, the way some
comparable CLIs' `--json` modes work.

## User Stories

### As an orchestrator consuming `dh --job` output, I want a structured final result, not just free text to scan

- Given a completed job, when it finishes, then an optional structured result block (or a
  companion file, see DH-0037's `summary.json`) is available alongside the plain-text final
  message.

### As an orchestrator, I want an option for incremental machine-readable progress on stdout

- Given `--job` with a `--json`-style flag, when the run progresses, then NDJSON events are
  emitted to stdout incrementally, not just a single dump at the end.

## Notes

> [!NOTE]
> Source: Competitive-differentiation sweep findings #12 and #16. Relates to **DH-0001** (the
> current text-marker convention this would eventually supplement/replace) and **DH-0037** (the
> `summary.json` artifact, a related but distinct deliverable — a written file vs. a live stdout
> stream).
