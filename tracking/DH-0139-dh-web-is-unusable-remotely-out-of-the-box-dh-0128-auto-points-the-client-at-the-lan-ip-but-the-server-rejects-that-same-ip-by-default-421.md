---
spile: ticket
id: DH-0139
type: bug
status: draft
owner: stefan
resolution:
blocked_by: []
created: 2026-07-17
relations:
  depends_on: []
  relates_to: [DH-0128]
  supersedes: []
implementation:
  - repo: dark-harness
---

# DH-0139: dh --web is unusable remotely out of the box: DH-0128 auto-points the client at the LAN IP, but the server rejects that same IP by default (421)

## Summary

Found live 2026-07-17 testing remote connect after DH-0128 landed: DH-0128 made /dh-config.json correctly rewrite baseUrl to whatever LAN IP the client actually used, but src/server/server.ts's isAllowedHost() (DH-0022/0023 DNS-rebinding guard) only trusts loopback names plus an explicitly-opted-in security.hostname -- so the browser's own requests to that LAN IP get rejected with a bare 421 Misdirected Request, no actionable error message. Net effect: dh --web is not actually usable from a remote device out of the box, contradicting the whole point of DH-0128's fix -- the client points somewhere the server itself refuses to answer. This is a security-posture question (CLAUDE.md 4.3, ADR 0003) -- needs an architect decision, not a quiet patch: should dh --web auto-trust the address it is actually bound to when explicitly started with --web (the operator already chose to expose it), keeping the DNS-rebinding guard's real purpose (rejecting *arbitrary* attacker-controlled Host headers, not the server's own known bind address)? Or should this stay an explicit opt-in, in which case the UX needs to give a clear, actionable error (not a bare 421) telling the operator to set security.hostname, ideally including the exact value to set. Owner unblocked manually tonight by hand-setting security.hostname to the LAN IP; this ticket is about the default experience.

## User Stories

### As a TODO, I want TODO

- Given TODO, when TODO, then TODO.

## Functional Requirements

- TODO

## Assumptions

## Risks

## Open Questions

## Notes
