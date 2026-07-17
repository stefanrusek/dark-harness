---
spile: ticket
id: DH-0122
type: feature
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

# DH-0122: Every dh run should print an application header (name, logo, version/build, config status)

## Summary

Owner request 2026-07-17: every invocation of dh (TUI, --web, doctor, init, etc.) should print a consistent application header -- name, logo (see the sibling logo ticket), version/build identity, and a summary of dh.json's status: whether it exists, model count, and any settings relevant to an operator trying to connect from another process/machine (bind address, security.token presence, etc.). dh doctor 'looks good but would look better with the app header' per the owner -- this ticket covers doctor too, not just interactive start. Needs a design pass (what exactly the header contains, how it degrades for --json/non-TTY output) before implementation; likely spans Prompt (shared header-building logic) + TUI + Web + Core (doctor/init call sites).

## User Stories

### As a TODO, I want TODO

- Given TODO, when TODO, then TODO.

## Functional Requirements

- TODO

## Assumptions

## Risks

## Open Questions

## Notes

### 2026-07-17 — implemented

Added `src/header-info.ts`: shared, framework-independent builder (`buildHeaderInfo`,
`formatVersionString` — moved here from `cli.ts` — `formatConfigStatusLine`,
`formatHeaderLines`) that every surface sources the same name/logo/version/build/config-status
content from, same precedent as `src/design-tokens.ts`/`src/format.ts`.

- CLI: `printAppHeader()` (src/cli.ts) prints the header once per invocation — full logo +
  bold version line on a TTY, compact (no logo/color) off a TTY — wired into `runInteractiveMode`
  (covers local TUI, `--web`, `--server`, `--connect`) and `runDoctor` (covers `dh doctor`/
  `--check`). Config-status line reports model count, bind address (`security.hostname`),
  and whether a bearer token/TLS is required — never the token value itself.
- TUI: `src/tui/ink/Header.tsx` (`variant: "full"`) now renders a dim version/build-identity
  line inside the persistent Ink view; no config-status line there since the TUI client only
  ever knows a `baseUrl`/token (including for `--connect`ed remote servers with no local
  `dh.json`) — that summary is covered by the CLI's own pre-launch console header instead.
  `App.tsx`'s `HEADER_ROWS` bumped 2→3 to reserve the new row.
- Web: extended `WebConfigResponse`/`ServeWebUiOptions` (src/web/protocol.ts,
  src/web/server.ts) with an optional `headerInfo` field, forwarded from `cli.ts`'s
  `serveWebUi()` calls (which have real `DhConfig`/`BuildInfo`) through `WEB_CONFIG_PATH` to
  the browser; `<AppHeader>` (src/web/client/components/AppHeader.tsx) renders the compact
  logo, version line, and config-status line once it lands.
- `dh doctor`: covered via `runDoctor`'s `printAppHeader()` call — no separate init-specific
  work needed since `dh init` doesn't load an existing config to summarize.

Test coverage (CLAUDE.md §9): `src/header-info.test.ts` (new) covers
`formatVersionString`/`buildConfigStatusSummary`/`formatConfigStatusLine`/`buildHeaderInfo`/
`formatHeaderLines` directly. `src/cli.test.ts` — existing doctor/`--server`/`--web`/
`--connect` startup-block tests updated to account for the new header lines (via
`expectedHeaderLines`/`expectedHeaderLinesTty` helpers), verifying the header actually prints
in every one of those run modes without breaking the pre-existing byte-stable e2e-grepped
substrings. `src/tui/ink/Header.test.tsx` and `src/web/client/components/AppHeader.test.tsx`
updated to assert real rendered content instead of the old empty-slot contract.

Gates run: `bun run typecheck` (clean), `bun run lint` (clean on all touched files; 3
pre-existing failures in untouched files confirmed unrelated), `bun run test:coverage`
(2124 pass, 100% coverage on every file this ticket touched; one pre-existing flaky SSE test
in `server.test.ts` confirmed to fail identically on `main` before this change), `bun run e2e`
(2 pre-existing failures in `web.test.ts`/`connect-web.test.ts` — a `"Waiting"` vs `"waiting"`
casing mismatch — confirmed to fail identically on `main` before this change, unrelated to
this ticket).
