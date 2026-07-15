---
spile: ticket
id: DH-0023
type: bug
status: draft
owner: stefan
resolution:
blocked_by: ["owner triage: needs input before dispatch (ticket-triage-workflow bucket B)"]
created: 2026-07-15
relations:
  depends_on: []
  relates_to: []
  supersedes: []
implementation:
  - repo: dark-harness
---

# DH-0023: The client-served web UI's own HTTP port leaks the bearer token with no auth, plus missing CORS/CSP/clickjacking hardening

## Summary

`src/web/server.ts` exposes `GET /api/config` with no auth check at all, returning
`{ baseUrl, token }` in plaintext JSON — the same bearer token ADR 0004 says must never be logged
or leaked. Any process/user/webpage that can reach this port (which has no `security` config
option of its own) obtains the full admission token to the real `dh --server`, completely
defeating the token protection for anyone who can reach the *web* port even without direct access
to the *server* port. Compounding this: the real `dh` server's CORS is `access-control-allow-origin:
"*"`, which — in the default no-token posture — means any web page the operator's browser visits
can issue cross-origin `fetch()` POSTs (`send_message`/`stop_agent`/`download_logs`) against
`localhost:4000`, something same-origin policy would otherwise block; there's no `Host` header
validation to guard against DNS rebinding; and the web client ships no CSP or `X-Frame-Options`,
so (while there is currently no XSS sink — confirmed by both the TUI/Web sweep and the security
audit, all rendering uses `textContent`/`createTextNode`) there's no defense-in-depth against a
future regression, and the UI can currently be iframed/clickjacked by an attacker page.

## User Stories

### As an operator using a token-protected `dh --server`, I want the web UI to not leak that token to anyone who can merely load the web UI's own page

- Given `security.token` is configured, when the web-serving process hands the token to its own
  client, then that hand-off is not reachable by an arbitrary unauthenticated caller of the web
  port.

### As an operator, I want the default (no-token) posture to not let any browser tab I have open drive my local `dh` session

- Given the default no-auth posture, when a page on an unrelated origin issues a cross-origin
  request to the local server, then it is not treated as same-privilege as a same-origin request
  (CORS/Host-header hardening).

### As an operator, I want the web UI to resist clickjacking even though no live XSS exists today

- Given the web UI is served, when responses are returned, then `X-Frame-Options`/CSP
  `frame-ancestors` prevents it from being iframed by another origin.

## Notes

> [!NOTE]
> Source: TUI/Web domain sweep finding #24 (token leak — the sweep author explicitly recommended
> escalating this one to the architect, per CLAUDE.md §6.4) and the Security audit findings #1
> (same token-leak finding, independently discovered), #2 (CORS drive-by risk), #3 (no DNS-rebinding
> guard), #6 (no CSP), #7 (no clickjacking protection), #8 (token held safely in memory only —
> confirmed clean, no action needed there). This is a cluster of related web-surface hardening gaps
> that likely need one coordinated Server+Web fix and an architect decision on the token hand-off
> design specifically.
