---
spile: ticket
id: DH-0022
type: bug
status: draft
owner: stefan
resolution:
blocked_by: ["owner triage: needs input before dispatch (ticket-triage-workflow bucket B)"]
created: 2026-07-15
relations:
  depends_on: []
  relates_to: [DH-0023]
  supersedes: []
implementation:
  - repo: dark-harness
---

# DH-0022: `Bun.serve()` never sets `hostname`, so `dh --server` defaults to binding all interfaces, not loopback

## Summary

Neither `src/server/server.ts` nor `src/web/server.ts` ever passes a `hostname` option to
`Bun.serve`, so both default to Bun's own default bind (`0.0.0.0`, all interfaces) rather than
`127.0.0.1`. Given ADR 0004's plaintext-by-default, no-auth posture and its explicit framing that
"air-gapping remains the primary posture," a server that silently listens on every network
interface by default materially widens the real-world blast radius of that documented posture: any
device on the same network segment can reach an unauthenticated `dh --server` instance, not just
the local machine. This isn't itself a violation of the plaintext/no-auth ADR (which is about the
wire, not the interface) but interacts with it in a way ADR 0004 never actually discusses or pins
down, and no test in `server.test.ts` asserts/pins the bind address. Independently confirmed by
both the Server domain sweep and the security audit as one of the highest-impact findings.

## User Stories

### As an operator running `dh --server` on a shared network, I want the default bind to be loopback-only unless I explicitly opt into wider exposure

- Given no explicit `--host`/config override, when `dh --server` starts, then it binds to
  `127.0.0.1`/`localhost` by default.
- Given an operator genuinely needs LAN/remote exposure (e.g. for `--connect` from another host),
  when they want that, then an explicit flag/config opts in, and the choice is documented.

## Functional Requirements

- Given the fix, when a test is added, then it pins the default bind address so a future
  regression is caught.

## Risks

- This is a security-posture-adjacent change (default network exposure). Per CLAUDE.md §6 trigger
  4, this should get architect sign-off before implementation, not be decided unilaterally by a
  domain lead.

## Notes

> [!NOTE]
> Source: Server domain sweep finding #18 (explicitly flagged as "the single most impactful
> finding in this sweep... should likely be escalated") and Security audit finding #4 (same root
> cause, independently discovered). Both sweeps agree this warrants an architect decision, not a
> routine fix.

> [!NOTE]
> Reconciled with DH-0023 (2026-07-15): that ticket's token-leak concern (`/api/config` handing
> the bearer token to any caller of the web port) is the *same root cause* as this ticket, not
> an independent issue — `src/web/server.ts`'s `Bun.serve()` has the identical missing-`hostname`
> bug. Fixing this ticket's default bind (loopback) resolves that half of DH-0023 too; DH-0023
> was trimmed to just its genuinely independent CORS/Host-header/CSP/clickjacking scope.
