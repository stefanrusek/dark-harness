---
spile: ticket
id: DH-0014
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

# DH-0014: `Read` tool buffers the entire file into memory before any size/line limiting applies

## Summary

`src/agent/tools/read.ts` calls `new Uint8Array(await file.arrayBuffer())` — reading and decoding
the whole file — before the binary-sniff check and the `offset`/`limit` line-slicing logic run. A
multi-GB file (a log, a dataset, a build artifact) an autonomous agent stumbles into in an
unfamiliar repo gets fully buffered and UTF-8-decoded regardless of what `limit` was requested,
which is a plausible resource-exhaustion vector precisely because the agent is operating
unattended and may not know in advance what it's about to read.

## User Stories

### As an operator, I want the Read tool to refuse or stream large files rather than fully buffering them

- Given a file far larger than any reasonable `limit`/`offset` window, when `Read` is called, then
  it samples/streams only the needed byte range, or refuses with a clear, actionable error, instead
  of buffering the whole file first.

## Functional Requirements

- Given the existing binary-sniff behavior, when a size cap is added, then the cap check happens
  before the full read, not after.

## Notes

> [!NOTE]
> Source: Core domain sweep finding #7.
