---
spile: ticket
id: DH-0128
type: bug
status: verifying
owner: stefan
resolution:
blocked_by: []
created: 2026-07-17
relations:
  depends_on: []
  relates_to: []
  supersedes: []
implementation:
  - repo: dark-harness
---

# DH-0128: URGENT: Web UI connecting from a separate machine loads the shell but sticks on 'Reconnecting...'

## Summary

Owner observation from live manual testing 2026-07-17: connecting to the web UI a second time from the same machine works fine, but connecting from a genuinely separate machine loads the UI shell (assets, layout) yet the connection pill never gets past 'Reconnecting...' -- the live SSE connection never establishes. Needs investigation: likely an SSE/EventSource issue specific to cross-machine access (CORS, host-binding/security.hostname interaction from DH-0022/0023, or an absolute-vs-relative URL bug similar in spirit to DH-0111's connect-web double-scheme bug). High-priority usability blocker for the core 'connect from another machine' use case this project cares about. Web domain (Susan) and/or Server (Radia) depending on root cause.

## User Stories

### As an operator running plain `dh --web` (no `--connect`), I want a browser on a different machine to actually reach the live SSE stream, not just the static shell

- Given `dh --web` bound to all interfaces (the default), when a browser on a different
  machine loads the page and fetches `/dh-config.json`, then the returned `baseUrl` names a
  host that browser can actually reach (the host it used to load the page), not `localhost`
  — proven by `src/web/server.test.ts`'s "DH-0128: cross-machine config resolution >
  rewrites a loopback targetBaseUrl's host to the Host the request actually used, keeping
  port/scheme".
- Given a browser on the *same* machine as the `dh` process, when it fetches
  `/dh-config.json`, then the returned `baseUrl` is unchanged (`localhost`) — no regression
  for the common same-machine case — proven by the same test file's "... > still resolves
  to localhost when the request itself came in on localhost (unchanged same-machine
  behavior)".
- Given `--connect <host> --web` (or any case where `targetBaseUrl` already names a
  non-loopback host), when a browser fetches `/dh-config.json`, then that host is passed
  through untouched regardless of which address the browser used to reach the web UI —
  proven by "... > leaves a non-loopback targetBaseUrl (e.g. --connect <host>) untouched
  regardless of request Host".

## Functional Requirements

- `serveWebUi`'s `/dh-config.json` handler (`src/web/server.ts`) resolves the served
  `baseUrl` per-request: if the configured `targetBaseUrl`'s hostname is `localhost` or
  `127.0.0.1`, substitute the hostname the incoming request actually used (from the `Host`
  header via `req.url`), keeping the configured scheme and port; otherwise pass the
  configured `targetBaseUrl` through unchanged.

## Assumptions

## Risks

## Open Questions

## Notes

### 2026-07-17 — root cause confirmed and fixed

Root cause matched the filer's third hypothesis (absolute-URL bug, same family as
DH-0111) rather than CORS or the DH-0022/0023 `security.hostname` bind-address work — those
were investigated and ruled out (CORS is already permissive per DH-0023, and `--web`'s
`Bun.serve` already binds all interfaces by default, so the page itself loads fine
cross-machine, matching the reported symptom of "shell loads, SSE doesn't").

The actual bug: `src/cli.ts`'s plain `--web` path (not `--connect`) always builds
`targetBaseUrl` as `` `http://localhost:${boundPort}` `` and hands it to `serveWebUi`
(`src/web/server.ts`), which served that literal string, unmodified, from
`/dh-config.json` regardless of which host the requesting browser actually used. A browser
on the same machine resolves `localhost` back to the `dh` process — works. A browser on a
different machine on the LAN loads the page fine (asset proxying doesn't care about host)
but then dials its *own* `localhost:<port>` for the SSE stream and command POSTs — nothing
listens there, so the connection pill sticks on "Reconnecting..." forever, exactly matching
the report.

Reproduced directly: started `serveWebUi` bound to `0.0.0.0`, fetched `/dh-config.json` via
this machine's LAN IP (simulating a remote browser) — confirmed the response always said
`{"baseUrl":"http://localhost:4000"}` regardless of the request's origin, before the fix.

Fix: `src/web/server.ts`'s `/dh-config.json` handler now resolves the served `baseUrl`
per-request (`resolveConfig()`) — when the configured target host is loopback
(`localhost`/`127.0.0.1`), it's rewritten to the `Host` the incoming request actually used,
keeping the configured scheme/port; a non-loopback target (e.g. `--connect <host>`'s real
remote host) is passed through untouched, since that already names a genuine remote address
unrelated to the browser's own location. Re-ran the same repro post-fix: the LAN-IP request
now gets back `{"baseUrl":"http://192.168.1.238:4000"}` — the browser can now reach the SSE
stream.

Verification (CLAUDE.md §9): three new cases in `src/web/server.test.ts` under "DH-0128:
cross-machine config resolution" — cross-machine rewrite, same-machine no-op, and
`--connect`-style non-loopback pass-through (see User Stories above for the exact case
names). `bun run typecheck` clean. `bun run lint`: 11 pre-existing errors, same as `main`
pre-change (none in `src/web/`, none introduced). `bun run test:coverage`: 2113/2113 pass,
`src/web/server.ts` at 100%/100%. `bun run e2e`: `e2e/web.test.ts` and
`e2e/connect-web.test.ts` (the two suites that actually exercise this code path) both pass
cleanly; the full `bun run e2e` run has 13 unrelated pre-existing failures in this sandbox
(tmux-PTY pane lookups, provider call-count timing races) that reproduce independent of this
change — flagging per the "no silent truncation" rule rather than claiming a fully green
`bun run e2e`.
