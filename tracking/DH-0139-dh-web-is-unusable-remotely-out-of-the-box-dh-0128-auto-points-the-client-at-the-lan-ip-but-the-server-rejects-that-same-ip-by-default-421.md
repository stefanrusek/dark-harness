---
spile: ticket
id: DH-0139
type: bug
status: implementing
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

## Decision (Fable, architect-on-call, 2026-07-17)

**Auto-trust the server's own genuinely-bound addresses (option 1), scoped precisely to
addresses the server itself is actually listening on.** Not a blanket loosening, not a new
opt-in flag. See Notes for the threat-model reasoning; this section is the resulting spec.

`isAllowedHost()` gains a third source of trusted names, computed from how the server was
actually told to bind, alongside the existing `bareNames` set (`localhost`, `127.0.0.1`,
`[::1]`, plus any explicit `security.hostname`):

- If `security.hostname` is set to a **specific, narrowing** address (anything other than
  `0.0.0.0`/`::` — e.g. `127.0.0.1`, or one specific LAN IP), the bind is already narrowed to
  exactly that address by `Bun.serve`. Behavior is **unchanged**: only that address (already
  handled) is trusted. No interface enumeration needed or wanted — the operator explicitly
  chose a single address.
- If `security.hostname` is unset (the default) or explicitly `0.0.0.0`/`::` (all
  interfaces — the same effective bind Bun already defaults to), the server is genuinely
  reachable on every non-internal address of every local network interface. In that case,
  additionally trust every such address, at whatever port the server actually bound to
  (`boundPort`, already available to `isAllowedHost()`'s caller) — same
  bare-name-or-`name:port` matching the function already does for loopback.

Interface enumeration: `node:os`'s `networkInterfaces()`, filtering to `!internal` entries
(covers IPv4 and IPv6; IPv6 addresses need the existing bracket convention,
`[<addr>]`/`[<addr>]:<port>`, consistent with how `[::1]` is already handled). Compute this
once at server start (interfaces don't change mid-process in the cases this project cares
about) and pass the resulting set into `isAllowedHost()` alongside the existing arguments,
rather than resyscalling per request.

## User Stories

### As an operator running plain `dh --web` (or `dh --server`) with no `security.hostname` set, I want a browser on another device on my network to actually be able to talk to the server DH-0128 pointed it at

- Given `dh --web` bound to all interfaces (the default, `security.hostname` unset), when a
  browser on a different LAN device loads the page, DH-0128's `/dh-config.json` rewrite
  points it at the server's real LAN IP, and the browser's SSE/`fetch` calls to the API
  server carry a `Host` header equal to that same LAN IP (with the server's bound port),
  then `isAllowedHost()` accepts it (no more 421) — proven by a new
  `src/server/server.test.ts` case, e.g. "DH-0139: accepts a Host header matching one of the
  server's own bound-all-interfaces local addresses when security.hostname is unset".
- Given the same all-interfaces bind, when a request's `Host` header names an arbitrary
  third-party domain (the actual DNS-rebinding shape DH-0023 defends against — an
  attacker-controlled name whose DNS answer currently resolves to the server's address, but
  whose `Host` header still literally reads e.g. `evil.example`), then it is still rejected
  with 421 — proven by a case asserting the existing DNS-rebinding-guard behavior is
  unchanged, e.g. "DH-0139: still rejects a Host header naming an arbitrary domain even when
  that domain would currently resolve to the server's bound address".
- Given `security.hostname` explicitly set to a single narrowing address (e.g. `127.0.0.1`
  or one specific IP), when a request's `Host` header names a *different* address the server
  happens to also be reachable at (e.g. another local interface, if the OS still routes to
  it), then it is still rejected — proven by "DH-0139: an explicit narrowing
  security.hostname is not widened by interface auto-trust" — this preserves DH-0022's
  opt-in-narrowing contract unchanged.
- Given `security.hostname` explicitly set to `0.0.0.0` or `::` (an explicit, not merely
  default, all-interfaces choice), when a request's `Host` header matches any of the
  server's real bound addresses, then it is accepted — same rule as the unset-default case,
  proven by extending the first case's coverage or a dedicated case.

## Functional Requirements

- `isAllowedHost()` (or its caller in `src/server/server.ts`) accepts the set of the
  server's own genuinely-bound local addresses (computed via `node:os.networkInterfaces()`,
  `!internal` entries, IPv4 and IPv6) whenever the effective bind is all-interfaces (
  `security.hostname` unset, or explicitly `"0.0.0.0"`/`"::"`), and treats each as an
  additional trusted bare name using the existing `host === bare || host === \`${bare}:${port}\``
  matching (IPv6 addresses bracketed per existing `[::1]` convention).
- When `security.hostname` narrows the bind to one specific address, trusted names remain
  exactly `{localhost, 127.0.0.1, [::1], that address}` — unchanged from today; no interface
  enumeration performed or needed in that branch.
- Interface enumeration happens once at server start, not per-request.
- No new `dh.json` field, no new CLI flag — this changes only what `isAllowedHost()` trusts,
  not the bind behavior itself (which DH-0022 already governs).

## Assumptions

- The operator who ran `dh --web`/`dh --server` without narrowing `security.hostname` has
  already, per DH-0022's own accepted reasoning (containerized/LAN deployment is the common
  case), consented to the server being reachable from other machines that can route to it —
  auto-trusting its own bound addresses grants no *network* reachability beyond what that
  bind already grants; it only stops the Host-header check from being stricter than the
  bind itself.

## Risks

- Browser-driven CSRF-shaped abuse against a no-token, all-interfaces `dh --web`: a
  malicious page loaded by any browser that can route to the server's LAN IP could now issue
  `fetch()` calls directly to that IP (matching `Host`) and get past the guard, where before
  it hit 421. This is a narrow, already-largely-accepted risk, not a new one: CORS is
  already permissive by design (DH-0023's own reasoning — the bearer token, not Origin, is
  the real admission control), the default posture is explicitly no-auth (CLAUDE.md §4.3),
  and a non-browser client (curl, a script) could already reach the same endpoint with an
  arbitrary `Host` header today — this change only closes the gap for *browser* JS callers
  down to what non-browser callers already had. Mitigation is unchanged and already
  documented: set `security.token` (and/or narrow `security.hostname`) for any deployment
  that isn't air-gapped/trusted-network.

## Open Questions

(none — decision is settled; see Notes for the full reasoning an implementer would otherwise
have to reconstruct.)

## Notes

### 2026-07-17 — Fable, architect-on-call: decision and reasoning

**Read first:** `src/server/server.ts`'s `isAllowedHost()` doc comment (DH-0023) states the
threat model precisely: "A page on an attacker-controlled domain whose DNS answer flips to
a loopback address mid-session can still get the victim's browser to issue requests that
carry the attacker's original `Host` header — CORS/Origin checks alone don't catch this,
since the browser considers it a same-origin request to 'evil.example'." The defense is:
reject any `Host` header that isn't one of a small set of names the server itself actually
answers to.

**Why auto-trusting the server's own bound addresses does not reopen that attack:** the
DNS-rebinding trick works specifically because the attacker's page runs at a URL whose
*hostname* is the attacker's own domain (`evil.example`) — the browser's `fetch`/`XHR`/form
machinery sets `Host: evil.example` regardless of what IP DNS resolves that name to at
request time. Auto-trusting "any address the server is genuinely listening on" never adds
`evil.example` to the trusted set — that string is never one of the server's own bound
addresses, no matter what DNS says about it. The rebinding attack is defeated by the same
mechanism as before: the check is on the literal `Host` string, not on which IP the
connection actually landed on, and an arbitrary attacker domain is never going to literally
equal one of the server's real local addresses. This is exactly why the FR's second User
Story (reject `evil.example` even though it "would currently resolve" to the server) is the
load-bearing regression test — it's the case that proves the loosening is scoped correctly.

**Why this doesn't hand out new *network* reachability:** DH-0022 already decided, with the
owner's explicit sign-off, that the *default* bind stays all-interfaces (0.0.0.0) precisely
because the common deployment (containerized, behind a firewall) needs LAN/container-network
reachability to work at all — narrowing to loopback was the rejected alternative. That
decision already means: any device that can route a TCP packet to the server's real address
can open a connection to it today. `isAllowedHost()`'s current strictness doesn't prevent
that connection — it only makes the *application layer* refuse to answer once the Host
header doesn't match a hardcoded loopback name, an accidental side effect of a check that
was designed for a different purpose (DNS rebinding), not a deliberate access-control
boundary on top of DH-0022's bind decision. DH-0139's actual symptom — the browser DH-0128
correctly pointed at the server's real LAN address gets rejected by the server's own check —
is proof the current strictness is *stricter than DH-0022's own bind decision intended*, not
evidence that the strictness was doing useful access control. Trusting the server's own
bound addresses brings the Host check back in line with what DH-0022 already decided should
be reachable, no further.

**Why the "explicit opt-in only" alternative (option 2) was rejected as the primary fix:**
it would leave the out-of-the-box `dh --web` experience broken for the exact "connect from
another machine" use case the owner has repeatedly called out as core to this project (see
DH-0128's own summary, and tonight's manual test) — the operator would have to already know
their own machine's LAN IP and hand-edit `dh.json` before the feature DH-0128 just fixed
actually works. A better 421 error message would make the workaround discoverable, but
wouldn't fix the actual defect: the server rejecting a request whose `Host` names an address
it is, in fact, listening on and was told to listen on. Better-error-message work has been
considered and folded in implicitly — since option 1 removes the 421 in the affected case
entirely, no separate error-message ticket is needed for this specific scenario. (An
implementer who spots other still-unclear 421 causes, e.g. a genuinely narrowed
`security.hostname` that legitimately doesn't match, is free to improve that message
separately — not blocking on this ticket.)

**Why not a distinct new flag ("LAN mode", option 3):** that would ask the operator to
understand and opt into a second concept (an explicit LAN-trust toggle) on top of the
`security.hostname` config DH-0022 already exposes, for behavior that — per the reasoning
above — is already implied by DH-0022's own bind decision when left at its default. Adding a
second knob that only reiterates "yes, I meant all interfaces" would be redundant complexity
without closing any gap the existing knob doesn't already close (an operator who *does* want
strict loopback-only behavior still has `security.hostname: "127.0.0.1"`, fully unaffected by
this change — see the third User Story).

Status: moved to `ready` — the decision, FRs, and Given/When/Then coverage above are
sufficiently detailed for the Server domain (Radia, `src/server/server.ts` — `isAllowedHost`
and its caller) to implement without further judgment calls. No web-side change is needed;
DH-0128's `/dh-config.json` rewrite already does the right thing, it was only the server's
own check that was out of step with it.
