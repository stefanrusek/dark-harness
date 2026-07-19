---
spile: ticket
id: DH-0166
type: bug
status: ready
owner: stefan
resolution:
blocked_by: []
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

## Architect Decision (Fable, 2026-07-19) — APPROVED, candidate direction confirmed

Signed off per CLAUDE.md §6 item 4. The candidate direction holds against ADR 0003 with no
adjustment needed; it is compatible with — arguably required by — the locked posture. Reasoning:

- **ADR 0003 never made a decision about the local same-process IPC channel being externally
  reachable.** What it locks is: plaintext HTTP + no auth *by default*, `security.token`/
  `security.tls` as opt-in, and **air-gapping as the primary boundary**. Those are all about
  the *client↔server* surface an operator deliberately exposes with `--server`/`--web`. Local/
  TUI-only mode's `DhServer` exists solely so the same process's own TUI has something to talk
  to; that it currently listens on an externally-reachable interface is an **accidental side
  effect of unconditionally forwarding `config.security`** into the local-mode server (`run.ts`
  ~L267), not a deliberate posture decision. Removing that side effect relitigates nothing.

- **Binding local mode loopback-only *tightens* toward ADR 0003's air-gap posture, never
  against it.** Note the bug is actually broader than the `hostname`-set case: with
  `security.hostname` *unset* (the common case), local mode's server today binds to **every
  interface** (`Bun.serve` default), guarded only by the Host-header allowlist (`isAllowedHost`,
  server.ts L225). Pinning local mode to `127.0.0.1` unconditionally also closes that quieter
  over-exposure. Strictly more conservative on every path — exactly the direction ADR 0003
  points.

- **No invariant flips.** `security.token`/`security.tls`/`security.hostname` retain their full
  meaning for `--server`/`--web`/`--connect --web`, where remote reachability is the operator's
  actual intent (DH-0022, DH-0182). Only the local/TUI-only path — which has no legitimate
  remote-reachability use case — stops honoring `hostname`. This is a bug fix, not a schema or
  posture change; ADR 0003 needs no amendment.

## Functional Requirements

- **[Core / Grace — the security-gated primary fix]** Local/TUI-only mode's internal `DhServer`
  must bind **loopback-only (`127.0.0.1`) unconditionally**, regardless of `security.hostname`
  (and regardless of it being unset). The `security.hostname` field applies **only** to
  `--server`/`--web`/`--connect --web` modes, where remote reachability is the actual intent.
  Concretely: in `runInteractiveMode` (`src/cli/run.ts`), the `mode.kind === "local"` path must
  not forward `security.hostname` into `deps.createServer(...)` — it must force loopback.
  (`security.token`/`security.tls`, if set, still pass through to the local server unchanged —
  only the bind interface is forced; this requirement does not touch auth/TLS.)
- **[Core / Grace]** The TUI's own internal SSE client `baseUrl` (`src/cli/run.ts` ~L378) must
  be derived from the same bind decision as the server, not independently hardcoded — so the
  client address and the bound address are a single source of truth and cannot drift apart
  again. Since local mode now always binds `127.0.0.1`, `baseUrl` targets `127.0.0.1:${boundPort}`
  by construction from that shared decision (not a coincidentally-matching `localhost` literal).
- **[TUI / Mary — secondary, NOT security-gated, independent defense-in-depth]** The TUI's
  internal-SSE reconnect loop must stop retrying forever: after a bounded number of attempts (or
  bounded time) against a non-transient failure, it must surface a clear, actionable error
  instead of an endless `reconnecting…` spinner. This is what turned the underlying bug into a
  P0 (opaque failure mode), and it guards *future* connectivity failures independently of this
  specific bind bug. It slices cleanly to the TUI domain and is **not blocked by the security
  review** — the coordinator may land it alongside the Core fix or split it into a follow-up
  ticket if it would delay the P0 bind fix.

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
