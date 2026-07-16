---
spile: ticket
id: DH-0048
type: feature
status: draft
owner: stefan
resolution:
blocked_by: ["deferred (2026-07-15): sweep-sourced, no observed fleet-ops need"]
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

> [!NOTE]
> Deferred (2026-07-15) — no evidence of a real need for fleet-level scraped metrics yet;
> sweep-sourced, same pattern as DH-0047 (deferred speculative feature, not a real request).
> Revisit if a real multi-instance fleet-ops need surfaces.
