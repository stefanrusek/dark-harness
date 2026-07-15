---
spile: ticket
id: DH-0048
type: feature
status: draft
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

# DH-0048: No telemetry/metrics endpoint for fleet-level observability

## Summary

`src/server/server.ts` exposes SSE events, command endpoints, and log download, but there is no
`/metrics` (Prometheus-text or similar) endpoint aggregating turn counts, token/cost totals,
active-agent counts, or error rates. For fleet ops running many `dh` instances/dark-factory jobs,
there is currently no way to get fleet-level stats without a live SSE subscriber per instance or
scraping JSONL logs after the fact.

## User Stories

### As a fleet operator, I want a scrapeable metrics endpoint per `dh --server` instance

- Given a running server, when `/metrics` is requested, then it returns aggregate counters (turns,
  tokens, cost, active/total agents, error counts) in a standard scrapeable format.

## Notes

> [!NOTE]
> Source: Competitive-differentiation sweep finding #14.
