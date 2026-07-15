# ADR 0004: Plaintext/air-gap default, opt-in bearer token + TLS

**Status:** Accepted (amended 2026-07-14, per HANDOFF.md Addendum B; amended 2026-07-15, SSE
transport clarification — see bottom)

## Context

Dark Harness's permission model is "everything is allowed, always" (no approval prompts) —
this is a deliberate simplification for the dark-factory use case, but it means the network
boundary is the only real security control. Some operators need more than air-gapping alone
(e.g. a shared network, a server reachable beyond a single trusted host) without wanting a
full auth/user-account system.

## Decision

**Default remains plaintext HTTP with no auth.** Securing `dh` is primarily the operator's
job; docs steer toward air-gapped deployment (containers, private networks, SSH tunnels,
reverse proxies).

Two independent, opt-in protections via a `security` block in `dh.json`:

```json
{
  "security": {
    "token": "$(DH_TOKEN)",
    "tls": { "cert": "/path/to/cert.pem", "key": "/path/to/key.pem" }
  }
}
```

- **Bearer token** (`security.token`): when set, every request — POSTs and SSE connections
  alike — must carry `Authorization: Bearer <token>` or gets `401` with no further
  information. Constant-time comparison. Never logged (redacted from session logs and error
  output). Clients supply their own token via their own `dh.json`.
- **TLS** (`security.tls`): cert/key paths serve HTTPS directly on the same single port via
  Bun. Clients connect with `https://` when the target uses TLS.

Independent flags: token without TLS, TLS without token, both, or neither. No mTLS, no
per-agent scopes, no user accounts — explicitly out of scope for this version.

## Consequences

- Permissions stay unconditionally open (no approval-prompt system to build); the token is
  purely a network-admission control, not an authorization/scoping system.
- E2E coverage must include the security matrix: unauthenticated rejection (POST and SSE),
  authenticated happy path, and a self-signed-cert TLS round trip (CLAUDE.md §5).
- README security section must state the default plainly and name air-gapping as the
  strongest posture even with token/TLS available.

## Amendment 2026-07-15 — no client uses native `EventSource`

**Trigger:** the Server domain (Radia) implemented the bearer-token rule above correctly,
then flagged that it's unsatisfiable by a browser client using the native `EventSource`
API — `EventSource` cannot set custom headers, so it cannot send
`Authorization: Bearer <token>`. Escalated per CLAUDE.md §6 trigger 4 rather than resolved
unilaterally; decided by the architect-on-call (Fable).

**Decision:** every client's SSE connection — web and console alike — is established via a
manually-parsed `fetch()` request carrying the same `Authorization: Bearer <token>` header
used for POST commands, not the browser's native `EventSource`. Reconnection is
client-implemented (backoff + resume via `Last-Event-ID`, already required by ADR 0002) —
`EventSource`'s automatic reconnection is given up in exchange for header support. **No
token material may ever appear in a URL/query string** — that was considered and rejected
explicitly (query strings leak into proxy/server access logs and browser history, which
directly contradicts "never logged" above; server-side redaction can't reach an
intermediate proxy's logs).

**Consequences:**
- The original bearer-token rule (§ above) is unchanged — this amendment is a clarification
  of *how* clients satisfy it, not a relaxation of it.
- The web UI's SSE handling now matches the console TUI's (both hand-parse
  `text/event-stream`), rather than diverging by client type — one code pattern, not two.
- `docs/handoffs/web.md` is updated to reflect this as a locked constraint, not an open
  implementation choice.
