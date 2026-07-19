---
spile: ticket
id: DH-0166
type: bug
status: draft
owner: stefan
resolution:
blocked_by: ["needs architect (Fable) sign-off per CLAUDE.md section 6 item 4 — touches security posture"]
created: 2026-07-18
relations:
  depends_on: []
  relates_to: []
  supersedes: []
implementation:
  - repo: dark-harness
---

# DH-0166: TUI mode binds a real network server it doesn't need

## Summary

Plain 'dh' (no --web/--server) always constructs a real DhServer via deps.createServer() in src/cli.ts and passes config.security through unmodified — including an opt-in security.hostname (DH-0022), which is meant to make --server/--web reachable from other machines on the LAN. That means a TUI-only session, whose only client is the same process's own TUI, still opens a network-reachable listening socket on whatever host security.hostname names. Discovered manually: with dh.json's security.hostname set to a real LAN IP, plain TUI mode bound to that LAN IP (confirmed via lsof) rather than loopback-only. This is a security-posture question (ADR 0003 / CLAUDE.md section 4.3) — needs architect (Fable) sign-off per CLAUDE.md section 6 item 4 before any fix lands, since it touches the security posture. Candidate direction (not yet approved): local/TUI-only mode should always bind loopback-only regardless of security.hostname, since that field's purpose is remote reachability for --server/--web, not local IPC.

## User Stories

### As a TODO, I want TODO

- Given TODO, when TODO, then TODO.

## Functional Requirements

- TODO

## Assumptions

## Risks

## Open Questions

## Notes
