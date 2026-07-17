---
spile: ticket
id: DH-0111
type: bug
status: verifying
owner: stefan
resolution:
blocked_by: []
created: 2026-07-16
relations:
  depends_on: []
  relates_to: []
  supersedes: []
implementation:
  - repo: dark-harness
---

# DH-0111: dh --connect --web malforms the target URL (http://http://localhost...)

## Summary

Found live while verifying DH-0110's fix: dh --connect <host> --web's connection pill gets stuck on Connecting... never reaches Live, while dh --web works cleanly with the identical asset-loading fix. Traced to src/cli.ts malforming the connect target URL as a doubled scheme (http://http://localhost:...) rather than a real bug in the just-fixed asset routing. Not yet investigated further -- filed for tracking, not dispatched (owner asked to pause new dispatches 2026-07-16).

## User Stories

### As an operator running `dh --connect <host> --web`, I want a host value that already carries a scheme to still resolve, so a pasted/guessed URL doesn't silently break the connection

- Given `dh --connect http://example.com --web`, when the client builds the remote target URL, then it dials `http://example.com:<port>` (not `http://http://example.com:<port>`) — proven by `src/cli.test.ts`'s "DH-0111: --connect --web strips an https:// scheme the caller already included" case (and the parallel console-mode case "DH-0111: --connect strips an http:// scheme the caller already included, avoiding a doubled scheme").

## Functional Requirements

- `--connect <host>`'s target-URL construction (`src/cli.ts`, `runInteractiveMode`) strips a leading `http://`/`https://` from `mode.host` before prepending the scheme it computes from `config.security?.tls`, for both console (`startTui`) and `--web` (`serveWebUi`) sub-modes.

## Assumptions

## Risks

## Open Questions

## Notes

### 2026-07-16 — root cause confirmed and fixed

Root cause matched the filer's hypothesis: `runInteractiveMode`'s `connect` branch
(`src/cli.ts`) built `targetBaseUrl` as `` `${scheme}://${mode.host}:${mode.port}` ``, where
`mode.host` is the raw `--connect <host>` CLI argument, unvalidated. Passing a value that
already includes a scheme (e.g. copy-pasted from a "web UI ready at http://..." line, or
just guessed) doubles it into `http://http://host:port`, which fails to resolve — matching
the reported symptom (web client's connection pill stuck on "Connecting...", never "Live").

Fix: strip a leading `http://`/`https://` from `mode.host` before prepending the
scheme, for both the console (`startTui`) and `--web` (`serveWebUi`) sub-modes of connect
mode.

Verification (CLAUDE.md §9): added two `src/cli.test.ts` cases exercising both sub-modes
with a scheme-prefixed `--connect` value — "DH-0111: --connect strips an http:// scheme the
caller already included, avoiding a doubled scheme" and "DH-0111: --connect --web strips an
https:// scheme the caller already included" — both assert the resulting
`targetBaseUrl`/`baseUrl` is the single-scheme form. Full suite: `bun run typecheck` clean,
`bun run lint` shows the same 9 pre-existing errors as `main` (none in `src/cli.ts`, none
introduced by this change), `bun run test:coverage` 1961/1961 pass with `src/cli.ts`'s new
lines fully covered (its two remaining uncovered lines, 819/823/827, predate this change and
are unrelated).

Note on `bun run e2e`: `e2e/connect-web.test.ts` (and, confirmed separately, plain
`e2e/web.test.ts`) both time out in this sandbox waiting on a real headless-Chromium +
mock-provider round trip, before and after this fix — an existing environment-level flake
in this worktree, not specific to `--connect` or this bug (it reproduces on non-connect
`--web` too). Not something this fix changes either way; flagging per the "no silent
truncation" rule rather than claiming full `bun run e2e` green.
