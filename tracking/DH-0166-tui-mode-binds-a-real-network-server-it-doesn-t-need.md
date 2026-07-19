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

**Escalated to P0 (2026-07-19) — confirmed severe, not just unnecessary.** Reproduced live: with
`security.hostname` set to a specific interface IP, plain `dh` (local TUI, no flags) doesn't
just open an unnecessary socket — the TUI **completely fails to connect to its own server**
and hangs in an infinite `connecting…`/`reconnecting…` loop with `request failed: Unable to
connect. Is the computer able to access the url?`, permanently unusable. Root cause confirmed:
`Bun.serve({ hostname: <specific-IP> })` binds *only* that interface, not also loopback —
while the TUI's own internal SSE client hardcodes `http://localhost:${boundPort}`
(`src/cli/run.ts`'s `baseUrl`). So the moment an operator sets `security.hostname` for
*any* reason (e.g. to make `--web` reachable from another machine, DH-0182's whole point),
every subsequent plain `dh` invocation — the single most common usage — silently breaks with
no actionable error message. This is not a theoretical hardening gap; it's an active,
easily-triggered usability bug with an opaque failure mode. Directly informs the "should
local/TUI-only mode bind loopback-only regardless of `security.hostname`" candidate direction
above — this incident is strong evidence that answer is yes.

## User Stories

### As an operator running plain `dh`, I want it to always work regardless of any `security.hostname` I've configured for `--web`/`--server` use

- Given `dh.json`'s `security.hostname` is set to any value (a specific LAN IP, etc.), when
  the operator runs plain `dh` (no `--web`/`--server`/`--connect`), then the TUI connects
  successfully and never enters an infinite reconnect loop — local/TUI-only mode is
  unaffected by a setting whose entire purpose is remote reachability.

### As an operator, if a genuine bind failure does occur, I want a clear error, not a silent infinite retry

- Given the TUI's internal SSE connection to its own server fails for any reason, when the
  failure is not transient, then the TUI surfaces a clear, actionable error (not just an
  endless "reconnecting…" spinner with a barely-visible one-line status message) after a
  reasonable number of retries.

## Functional Requirements

- Local/TUI-only mode's internal server bind must be loopback-only (`127.0.0.1`), always,
  regardless of `security.hostname` — that config field should only ever apply to
  `--server`/`--web` modes where remote reachability is the actual intent.
- The TUI's own internal SSE client (`baseUrl` in `src/cli/run.ts`) should match whatever
  address the internal server actually bound to — don't hardcode `localhost` independently
  of the bind decision; derive both from the same source of truth so they can't drift apart
  like this again.
- Consider a retry-count/time cap on the TUI's reconnect loop that surfaces a real error
  message instead of retrying forever — even after this specific bug is fixed, a *different*
  future connectivity failure would hit the same silent-infinite-loop UX otherwise.

## Assumptions

- `--server`/`--web`/`--connect --web` modes' use of `security.hostname` for real remote
  reachability is unaffected by this fix — only the local/TUI-only path changes.

## Risks

- Low technically (this is a bug fix, not a new capability), but it's the security-posture
  invariant itself (ADR 0003) that requires architect review before landing, per the original
  escalation reason above — that hasn't changed just because severity is now confirmed higher.

## Open Questions

## Notes

Reproduced by the coordinator (2026-07-19) against the repo's own local `dh.json` (which had
`security.hostname` pinned to a stale LAN IP from earlier cross-machine web-UI testing) —
immediate local workaround applied (nulled the field in the untracked, gitignored local
`dh.json`) to unblock testing, but that's a workaround, not a fix; the underlying bug stands.
