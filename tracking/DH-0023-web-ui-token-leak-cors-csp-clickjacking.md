---
spile: ticket
id: DH-0023
type: bug
status: ready
owner: stefan
resolution:
blocked_by: []
created: 2026-07-15
relations:
  depends_on: [DH-0022]
  relates_to: []
  supersedes: []
implementation:
  - repo: dark-harness
---

# DH-0023: Web UI CORS/Host-header/CSP/clickjacking hardening

## Summary

This ticket originally also covered `/api/config` handing the bearer token to any caller of
the web port with no auth check. On review with the owner: `security.token` comes from the
operator's own `dh.json`/env config — the operator already possesses it, so the web-serving
process relaying it to its own browser client isn't a leak of a secret the operator lacks.
The real severity question was *who else can reach that endpoint* — confirmed
`src/web/server.ts`'s `Bun.serve()` has the exact same missing-`hostname`/binds-all-interfaces
bug as `src/server/server.ts` (DH-0022), not an independent issue. Once DH-0022 fixes the
default bind to loopback, `/api/config`'s exposure shrinks to "other processes on the same
machine" and doesn't need a separate fix — **that part of this ticket is resolved by fixing
DH-0022, not by anything here.**

What remains, grouped together as one related "web-surface hardening" set (per Spile's
own convention of one ticket per feature/related-story-group, not one ticket per story):
CORS, Host-header validation, and CSP/clickjacking protections. These matter even on
loopback-only binding, since they're about a malicious page in the *operator's own browser*
reaching into `localhost`, not about network reachability — genuinely independent of
DH-0022.

## User Stories

### As an operator, I want the default (no-token) posture to not let any browser tab I have open drive my local `dh` session

- Given the default no-auth posture, when a page on an unrelated origin issues a cross-origin
  request to the local server, then it is not treated as same-privilege as a same-origin
  request (CORS should not be `*` for a mutating API; add `Host` header validation to guard
  against DNS rebinding).

### As an operator, I want the web UI to resist clickjacking even though no live XSS exists today

- Given the web UI is served, when responses are returned, then `X-Frame-Options`/CSP
  `frame-ancestors` prevents it from being iframed by another origin.

## Functional Requirements

- Given the fix, when a test is added, then it pins the CORS header value and the presence of
  CSP/`X-Frame-Options`, so a future regression is caught.

## Notes

> [!NOTE]
> Source: TUI/Web domain sweep finding #24 and Security audit findings #2 (CORS drive-by
> risk), #3 (no DNS-rebinding guard), #6 (no CSP), #7 (no clickjacking protection), #8 (token
> held safely in memory only — confirmed clean, no action needed there). The token-leak half
> of the original finding (#1 in both sweeps) is resolved by DH-0022, not tracked here — see
> that ticket's Notes for the reconciliation. No live XSS sink exists today (confirmed by both
> sweeps — all rendering uses `textContent`/`createTextNode`), so this is defense-in-depth,
> not an active exploit path.
