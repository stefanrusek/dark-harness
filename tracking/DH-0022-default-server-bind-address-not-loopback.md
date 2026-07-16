---
spile: ticket
id: DH-0022
type: feature
status: closed
owner: stefan
resolution: done
blocked_by: []
created: 2026-07-15
relations:
  depends_on: []
  relates_to: [DH-0023]
  supersedes: []
implementation:
  - repo: dark-harness
---

# DH-0022: Add a `dh.json` field to configure the server/web bind address (default unchanged)

## Summary

Neither `src/server/server.ts` nor `src/web/server.ts` ever passes a `hostname` option to
`Bun.serve`, so both default to Bun's own default bind (`0.0.0.0`, all interfaces). Owner
decision (2026-07-15): **the default stays as-is** — `dh` most commonly runs inside a
container behind a firewall, where binding all interfaces is exactly what's needed for the
container's network to reach it, and defaulting to loopback would break that common case.
What's actually needed is an **opt-in `dh.json` config field** for operators who want to
restrict the bind address (e.g. running directly on a shared host, not in a container) —
config, not a CLI flag, per the owner's preference.

## User Stories

### As an operator who wants to restrict `dh --server`/the web UI to loopback (or a specific interface), I want a `dh.json` field to configure that

- Given a `security.hostname` field (or similarly-named — implementer's call, follow existing
  `SecurityConfig` naming conventions) set in `dh.json`, when `dh --server`/the web-serving
  process starts, then `Bun.serve` binds to that address instead of the platform default.
- Given the field is unset (the common case), when either process starts, then behavior is
  **byte-for-byte unchanged** from today — still binds all interfaces, no regression for the
  container deployment model.

## Functional Requirements

- Given the fix, when a test is added, then it pins both the unset-field (default, unchanged)
  behavior and the configured-field (custom bind address honored) behavior.

## Notes

> [!NOTE]
> Source: Server domain sweep finding #18 and Security audit finding #4 (same root cause,
> independently discovered) — originally proposed changing the *default* to loopback. Owner
> reviewed and chose config-opt-in instead, keeping the current default, given the canonical
> deployment (containerized, behind a firewall) needs all-interfaces binding to work at all.

> [!NOTE]
> Consequence for DH-0023, made explicit: since the default bind is **not** changing, that
> ticket's original token-leak-via-`/api/config` concern is only mitigated for operators who
> *affirmatively* set the new `security.hostname` field to something loopback-restricted —
> it does not resolve automatically the way it would have under the originally-proposed
> default change. The owner's reasoning (containerized/firewalled deployment is the common
> case) already accounts for this; documented here for anyone revisiting this later rather
> than silently relying on the earlier (now-superseded) reconciliation note.
