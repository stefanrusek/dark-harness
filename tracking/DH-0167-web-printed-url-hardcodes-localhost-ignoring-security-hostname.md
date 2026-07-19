---
spile: ticket
id: DH-0167
type: bug
status: ready
owner: stefan
resolution:
blocked_by: []
created: 2026-07-18
relations:
  depends_on: []
  relates_to: [DH-0166]
  supersedes: []
implementation:
  - repo: dark-harness
---

# DH-0167: --web printed URL hardcodes localhost, ignoring security.hostname

## Summary

src/web/server.ts's serveWebUi() returns url: `http://localhost:${port}` unconditionally (line ~214), even when options.hostname (sourced from dh.json's security.hostname, DH-0022) is set to a real bind address. Result: 'dh: web UI ready at http://localhost:<port>.' prints a URL that doesn't work from any other machine, and is misleading even locally once security.hostname is a non-loopback address — the operator has to already know the real bind host to reach it. Fix: url should reflect options.hostname when set, falling back to localhost only when unset (matching the same 0.0.0.0-default-but-opt-in-hostname pattern already used elsewhere, e.g. src/cli.ts's boundHost computation for --server mode, around line 1307). Scoped, narrow, non-architectural — no ADR/security-posture implications, safe to implement directly.

## User Stories

### As a TODO, I want TODO

- Given TODO, when TODO, then TODO.

## Functional Requirements

- TODO

## Assumptions

## Risks

## Open Questions

## Notes
