---
spile: ticket
id: DH-0182
type: feature
status: closed
owner: stefan
resolution: done
blocked_by: []
created: 2026-07-18
relations:
  depends_on: []
  relates_to: [DH-0022, DH-0168, DH-0166]
  supersedes: []
implementation:
  - repo: dark-harness
---

# DH-0182: Add a CLI flag to override security.hostname, overriding config

## Summary

DH-0022 gave the bind address a dh.json-only mechanism (security.hostname) with no CLI flag
override. Owner decision (2026-07-18, made while reviewing DH-0168's port design): for both
host and port, support both a config field and a CLI flag, with the flag overriding config
when both are set. This ticket is the host-side half of that decision — DH-0168 is the
port-side half. Add a `--host <name>` CLI flag that, when set, overrides `dh.json`'s
`security.hostname` for that invocation only; when unset, `security.hostname` (or its
absence, i.e. bind-all) behaves exactly as today. Follows the same validation/plumbing
pattern DH-0168 establishes for `--web-port` (`FLAGS_WITH_VALUES`, `HELP_FLAG_ITEMS`,
`parseArgs`, threaded to `DhServer`/`serveWebUi` call sites). Note: this changes DH-0022's
original design (config-only, no flag) per direct owner instruction, not a routine
implementer call — safe to build since the owner made the call explicitly; noted here since
it revises a previously-closed ticket's decision.

**Naming resolution (implementer call, 2026-07-19):** the ticket's own summary left the flag
name "TBD" between `--host`, `--web-host`, and `--bind-host`. Went with plain **`--host
<name>`** — no existing flag collides with it (`--connect <host>` and `--web` are separate
flags with separate names), and the override is not web-UI-specific: it feeds both the local
`DhServer`'s bind address (`--server`/local mode) and `serveWebUi`'s `hostname` option
identically, the same way `security.hostname` itself already does. A `--web-host` name would
have wrongly implied it only affected the web static server.

## User Stories

### As an operator running a container with an image-baked dh.json, I want to override the bind address per-invocation without editing the config

- Given `dh --server --host 0.0.0.0` with a `dh.json` that sets `security.hostname:
  "127.0.0.1"`, when the server starts, then it binds to `0.0.0.0`, not `127.0.0.1` — the
  flag overrides the config field for this invocation only (the file on disk is untouched).

### As an operator, I want the default behavior unchanged when I don't pass `--host`

- Given `dh --server` (or `dh --web`, or `dh --connect <host> --web`) with no `--host` flag,
  when the process starts, then `security.hostname` (or its absence — Bun's own "all
  interfaces" default) behaves exactly as it did before this ticket.

### As an operator, I want `--host` to apply uniformly wherever a bind address is used

- Given `dh --web --host 0.0.0.0`, when the web UI's static server starts, then `serveWebUi`
  receives `hostname: "0.0.0.0"`.
- Given `dh --connect example.com --web --host 0.0.0.0`, when the locally-served web UI
  starts (no local `DhServer` is created in `--connect` mode), then `serveWebUi` still
  receives `hostname: "0.0.0.0"` — the override applies to any local bind, not just the
  `--server`/local-mode `DhServer`.
- Given `dh --server --host 0.0.0.0` with no `security.hostname` configured at all, when the
  server starts, then it still binds to `0.0.0.0` — `--host` does not require a pre-existing
  config field to override.

## Functional Requirements

- Add `--host <name>` to `FLAGS_WITH_VALUES` and `CliOptions.host: string | null` (no numeric
  validation — an arbitrary bind-address string, same shape as `security.hostname` itself).
- Add `--host <name>` to `HELP_FLAG_ITEMS`.
- Resolve `options.host ?? config.security?.hostname` once, in `main()`, immediately after
  `dh.json` is loaded (same place `--web-port`'s resolution happens), and merge the result
  back into the `config.security.hostname` field used for the rest of the run. This is a
  deliberately different mechanism than DH-0168's dedicated `webPort` parameter threaded
  through `runInteractiveMode`: because every existing read site already reads
  `config.security?.hostname` (the local `DhServer`'s bind, both `serveWebUi` call sites'
  `hostname` option, and the printed "bound to `<host>`:`<port>`" startup line), merging the
  override into `config` once means all of them pick it up with no further plumbing, rather
  than needing a second override parameter threaded to every call site.
- No mode restriction: unlike `--web-port`, `--host` is not rejected when the current
  invocation doesn't start a local server (e.g. plain `--connect` with no `--web`) — it is
  simply unused in that case, mirroring how an unused `security.hostname` config field is
  already silently inert today.
- Tests (CLAUDE.md §9): parse-level case for accepted value and default-unset; `main()`-level
  cases (mocked `serveWebUi`/`createServer`) asserting the override reaches `serveWebUi`
  (both local `--web` and `--connect --web`) and `createServer`'s `security` option, that it
  applies even when `dh.json` sets no `security.hostname` at all, and that omitting `--host`
  leaves `security.hostname` (or its absence) unchanged. All exercisable against mocks — unit
  tier, no integration tier needed.

## Assumptions

- Both `DhServer` and `serveWebUi` already accept an optional `hostname` sourced from
  `config.security?.hostname` (DH-0022) — no new server-side plumbing needed, only a new
  source (the CLI flag) merged into the same config field before those call sites run.

## Risks

- **Low.** Purely additive: a new optional flag whose unset default reproduces today's exact
  `security.hostname`-driven behavior (including "unset" itself). The only behavior change is
  when an operator explicitly passes `--host`.

## Open Questions

(none — flag name resolved by the implementer per the Summary's naming-resolution note above)

## Notes

> [!NOTE]
> **Revises DH-0022.** DH-0022 (closed) deliberately chose config-only for `security.hostname`
> with no CLI flag, as an explicit owner preference at the time. This ticket exists because the
> owner revisited that call on 2026-07-18 (see DH-0168's Notes) and asked for both a config
> field and a flag, flag-overriding-config, applied symmetrically to host and port. Not a
> routine implementer judgment call — recorded here per that direct instruction.

> [!NOTE]
> **DH-0182 implementation (2026-07-19).** Landed the `--host <name>` CLI flag. Parsed as a
> plain string in `parseArgs` (added to `FLAGS_WITH_VALUES`), no format validation (matches
> `security.hostname`'s own lack of validation beyond "is a string"). Resolved
> (`options.host ?? config.security?.hostname`) once in `main()` right after config load, and
> merged back into `config.security.hostname` before `runInteractiveMode` is called — every
> existing read site (`DhServer`'s bind via `createServer({ security: config.security })`,
> both `serveWebUi({ hostname: … })` call sites, and the printed "bound to `<host>`:`<port>`"
> startup line) therefore picks up the override with zero additional plumbing. Landed together
> with DH-0168 in the same pass (both touch the same `main()`/`runInteractiveMode` call
> sites in `src/cli.ts`). Tests: `src/cli.test.ts` ("DH-0182: ..." cases) cover both
> `serveWebUi` call sites, `createServer`'s `security` option, the no-existing-config-hostname
> case, and the unchanged-when-unset case. All four quality gates (typecheck/lint/
> test:coverage at 100% lines for changed code/e2e) green.
