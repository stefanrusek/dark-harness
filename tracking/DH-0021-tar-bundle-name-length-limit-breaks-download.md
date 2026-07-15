---
spile: ticket
id: DH-0021
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

# DH-0021: `buildTar` throws and kills the entire session-bundle download if any single agent's encoded id exceeds 100 bytes

## Summary

`src/server/tar.ts`'s `buildHeader` throws a `RangeError` if an entry name exceeds 100 bytes (plain
ustar, no long-name support via the prefix field or GNU/PAX extensions). `download_logs`'s
full-bundle path uses `encodeURIComponent(agentId) + ".jsonl"` as the entry name — encoding expands
many characters, so a sufficiently long or special-character-laden `agentId` pushes past 100 bytes
and throws, taking down the *entire multi-agent bundle download*, not just that one agent's file.
Agent ids are presumably short UUIDs today so this may not trigger in practice, but nothing in
`src/contracts/` guarantees that, so it's an unenforced cross-domain assumption. Related, smaller
finding in the same file: `mtimeSeconds` is computed once as "now" for every entry, discarding the
real per-file timestamp, which loses diagnostic value in the exported bundle.

## User Stories

### As an operator downloading a full session log bundle, I want one long agent id to not break the whole download

- Given an agent id whose encoded form exceeds 100 bytes, when the bundle is built, then that
  entry's name is truncated/hashed with a manifest mapping (or the ustar prefix field is
  implemented), and the rest of the bundle still downloads successfully.

## Functional Requirements

- Given the fix, when a regression test is added, then it specifically covers an agent id long
  enough to trigger the 100-byte boundary.

## Notes

> [!NOTE]
> Source: Server domain sweep findings #12 and #13. Marked `ready` rather than `draft` — this is a
> well-scoped, mechanical fix (implement ustar prefix field or truncate+manifest) with low design
> risk, unlike most of this round's tickets.
