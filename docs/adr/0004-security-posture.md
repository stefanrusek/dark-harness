# ADR 0004: Plaintext/air-gap default, opt-in bearer token + TLS

**Status:** Accepted (amended 2026-07-14, per HANDOFF.md Addendum B)

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
