---
spile: ticket
id: DH-0168
type: feature
status: ready
owner: stefan
resolution:
blocked_by: []
created: 2026-07-18
relations:
  depends_on: []
  relates_to: [DH-0166, DH-0167]
  supersedes: []
implementation:
  - repo: dark-harness
---

# DH-0168: --web hardcodes a random port instead of an operator-chosen one

## Summary

Both web-serving call sites in `src/cli.ts`'s `runInteractiveMode` (`dh --web` local, and
`dh --connect <host> --web`) hardcode `port: 0` on the `serveWebUi(...)` call — the web UI's
own static listening server always lands on an OS-assigned random ephemeral port, and there
is no flag or config to pin it. Raised as an open question during manual test-build
verification (2026-07-18).

**Architect decision (Fable, 2026-07-18 — CLAUDE.md §6 escalation):** make it pinnable via a
new **`--web-port <N>`** CLI flag, **defaulting to `0` (random)** so the common case is
byte-for-byte unchanged. Rationale and rejected alternatives below.

### Why pin at all (the real use cases)

Random is genuinely fine for the canonical `dh --web` flow — an operator starts it, copies the
printed URL, opens it once, and the port never needs to be spoken again. Pinning matters only
when *something other than that one operator* needs to know the port ahead of time:

1. **Container port mapping** — the strongest case, and directly on HANDOFF.md's canonical
   containerized deployment. `docker run -p 8080:8080 …` (or a compose `ports:` entry) has to
   name the container's listening port *before* the process starts; you cannot map a port the
   process picks at random. Today `dh --web` in a container is effectively unmappable.
2. **Reverse proxy / firewall rules** — an nginx/caddy `proxy_pass` target or a firewall
   allow-rule is written against a fixed port. A random port can't be proxied or allow-listed.
3. **Bookmarking a stable URL** — an operator who re-runs `dh --web` on the same host and wants
   `http://host:PORT` to stay put across restarts.

These are real but not the *common* case, which is why the default stays random.

### Why a dedicated `--web-port` flag (and not `--port`, and not a `dh.json` field)

- **Not `--port`.** `--port` is deliberately scoped, per the standing judgment call in
  `runInteractiveMode`'s doc comment (docs/handoffs/core.md Round 2), to `--server`'s listen
  port and `--connect`'s *remote target* port — never to a locally-started service's own bind
  port. Overloading it for the web static server would relitigate that decision and, worse,
  would collide in `dh --connect <host> --web`, where `--port` already means the remote
  server's port and the local web server needs a *separate* number. A distinct flag cleanly
  disambiguates the two ports that mode legitimately has.
- **A flag, not a `dh.json` field.** This mirrors `--server`'s `--port` (flag-only, default
  4000): the listen port of a served endpoint is an invocation-time choice, and for the
  container case it is chosen at `docker run`/compose time right alongside the `-p` mapping —
  exactly where a flag lives naturally. DH-0022 chose *config* for the bind **address** on the
  different reasoning that a bind address is a deployment-environment property that should
  travel with the image; a port pinned to match a `-p` mapping is not. A `dh.json`
  `web.port` field is a deferred, additive option if a concrete "port must travel with the
  config" ask ever appears — not built now (no incident/ask behind it).

## User Stories

### As an operator running `dh --web` in a container, I want to pin the web UI's listen port so I can `-p`-map it

- Given `dh --web --web-port 8080`, when the web UI server starts, then `serveWebUi` binds
  port `8080` and the printed `web UI ready at <url>` URL carries `:8080`.

### As an operator, I want the default behavior unchanged when I don't pass `--web-port`

- Given `dh --web` with no `--web-port`, when the web UI server starts, then it is called with
  `port: 0` exactly as today (random ephemeral port) — behavior byte-for-byte unchanged.

### As an operator running a web client against a remote server, I want to pin the local web port independently of the remote target port

- Given `dh --connect host --port 4000 --web --web-port 8080`, when the process starts, then
  the client dials the remote server on `4000` and the locally-served web UI binds `8080` — the
  two ports are independent, neither overriding the other.

### As an operator, I want `--web-port` rejected when it can't apply, and rejected for a nonsense value

- Given `--web-port` passed without `--web` (e.g. `dh --web-port 8080`, or `dh --server
  --web-port 8080`), when flags are parsed, then `dh` exits with a `CliUsageError`
  ("`--web-port` requires `--web`") rather than silently ignoring it.
- Given `--web-port 0`, `--web-port -5`, or `--web-port abc`, when flags are parsed, then `dh`
  exits with a `CliUsageError` (same positive-integer rule as `--port`). Note `0` is rejected
  at the flag boundary because the flag means "pin a real port"; the *unset* default remains
  the internal `0` sentinel.

### As an operator whose chosen web port is already taken, I want a clear failure, not a silent fallback

- Given `--web-port <N>` where `<N>` is already in use, when the web UI server tries to bind,
  then `dh` fails via the existing `runInteractiveMode` catch path ("failed to start … mode:
  …") returning a harness-error exit code (`2+`), the same way a taken `--server --port` fails
  today — it does **not** silently fall back to a random port.

## Functional Requirements

- Add `--web-port <N>` to `FLAGS_WITH_VALUES` and the `--port`-style positive-integer parse
  (reuse the exact `Number.isInteger(parsed) && parsed > 0` validation and error shape) into a
  new `CliOptions.webPort?: number`.
- Add `--web-port` to `HELP_FLAG_ITEMS` with a one-line description noting default = random and
  that it requires `--web`.
- Validate in `parseArgs` (alongside the `--json requires --job` check): `webPort` set but the
  invocation is not a web mode ⇒ `CliUsageError`.
- Thread the value to both `serveWebUi({ port: … })` call sites in `runInteractiveMode` (the
  `mode.kind === "connect" && mode.web` branch and the `mode.web` local branch), using
  `options.webPort ?? 0` so unset stays `0`. Carry it on `RunMode` (the `local` and `connect`
  variants) or via the already-plumbed config/options — implementer's call, but both web
  branches must honor it identically.
- `security.hostname` (DH-0022) and `--web-port` are orthogonal and compose: hostname sets the
  bind **address**, `--web-port` sets the bind **port**; both continue to be forwarded to
  `serveWebUi` unchanged. No precedence logic needed.
- Tests (CLAUDE.md §9 — each User Story bullet maps to a case): parse-level cases for accepted
  value, default-unset (`port: 0` preserved), requires-`--web` usage error, and invalid-value
  usage error; `runInteractiveMode`-level cases (mocked `serveWebUi`) asserting the pinned port
  reaches both the local and the `--connect --web` call sites, and that the bind-failure
  propagates as a harness-error exit. All exercisable against mocks — unit tier, no integration
  tier needed.

## Assumptions

- The web UI static server is an ordinary `Bun.serve` listener that accepts an explicit port
  the same way `--server`'s port already flows through `serveWebUi`'s `port` option — no new
  server plumbing, only a new source for the number.

## Risks

- **Low.** Purely additive: a new optional flag whose unset default reproduces today's exact
  `port: 0` behavior. The only new failure surface is "pinned port already in use," which
  reuses the existing catch/exit-code path rather than inventing one.

## Open Questions

- None blocking. Deferred (not in scope): a `dh.json` `web.port` field — revisit only on a
  concrete ask that the port must travel with config rather than the command line.

## Notes

> [!NOTE]
> **Relationship to DH-0166 and DH-0022 — independent, not a joint redesign.** All three touch
> the same bind machinery, so it's worth stating explicitly that they do *not* need to land
> together:
> - **DH-0022** (closed) governs the bind **address** (`security.hostname`); this ticket
>   governs the bind **port**. Orthogonal axes; they compose with no shared decision.
> - **DH-0166** is a *security-posture* question — should TUI-only mode open a LAN-reachable
>   socket at all — and is architect-gated on that basis. This ticket is a *convenience/
>   deployment* addition to modes that already, intentionally, serve over the network. Neither
>   depends on the other; DH-0168 can be implemented and shipped without waiting on DH-0166,
>   and vice versa.
> - There *is* an emerging coherent bind model (host ← `security.hostname`; port ← `--port` /
>   `--web-port`; local-only listeners stay loopback per DH-0166's candidate direction). Worth
>   keeping in view, but not worth blocking this small additive flag on a unified redesign.

> [!NOTE]
> **Owner-preference tension, surfaced for review.** DH-0022 recorded an owner preference for
> *config over CLI flag* for the bind address. This ticket chooses a **flag** for the port, on
> the reasoning above (parity with `--server`'s flag-only `--port`; the container-mapping case
> lives at `docker run` time, not in the image's config). Called out explicitly so the owner
> can redirect to a `dh.json` field at review if they'd rather — the decision is a defensible
> architect call, not an owner sign-off.
