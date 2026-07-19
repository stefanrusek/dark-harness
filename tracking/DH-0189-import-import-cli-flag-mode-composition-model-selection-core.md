---
spile: ticket
id: DH-0189
type: feature
status: closed
owner: stefan
resolution: done
blocked_by: []
created: 2026-07-18
relations:
  depends_on: [DH-0188]
  relates_to: [DH-0187]
  supersedes: []
implementation:
  - repo: dark-harness
---

# DH-0189: import: --import CLI flag, mode composition, model selection (Core)

## Summary

Core-owned half of DH-0187: the --import <path> top-level flag in src/cli.ts (source-location detection: backup archive dir vs live .jsonl file), model selection (--model override, default to dh.json defaultModel), invoking the Server importer, and handing the produced sessionId to the existing --resume launch path (TUI/web/headless). Owns cli.ts wiring and model-resolution semantics; depends on the Server importer interface.

Full design in **DH-0187** (Architect design, Fable 2026-07-18); this is the Core slice.
Depends on DH-0188's `importClaudeSession(source, opts) → { sessionId, logsRoot }` interface.

## User Stories

- **As an operator, I want** `dh --import <path>`. **Given** a backup-archive dir or a live
  `<id>.jsonl` file, **when** I run `dh --import <path>`, **then** dh detects the path kind
  (DH-0187 Decision 1), resolves transcript + optional sidecar, calls the Server importer, and
  lands me in a resumable session (or prints the new session id). *(test: path-kind detection
  routes file vs directory; bare project-slug dir rejected.)*
- **As an operator, I want** control over the resume model. **Given** `--model <alias>`,
  **when** I import, **then** that alias is stamped and must resolve against `dh.json` (else
  clean pre-write failure); **given** no `--model`, **then** `dh.json` `defaultModel` is used.
  *(test: default vs explicit + unresolvable-alias error path — DH-0187 Decision 5.)*
- **As an operator, I want** import to compose with the other modes. **Given** `--import` plus
  `--web`/`--job`/etc., **when** I run it, **then** mode-composition rules are enforced with
  clear errors for illegal combinations. *(test: composition/conflict cases.)*

## Functional Requirements

- FR1, FR2, FR5, FR6 from DH-0187 (see there). `--import <path>` + optional `--model <alias>`
  in `src/cli.ts`; path-kind detection; model resolution against `dh.json`; hand the produced
  `sessionId` to the existing `--resume` launch path.

## Assumptions

- The existing `--resume` launch path can consume any session id the Server importer produced
  without modification (guaranteed by DH-0188 FR4).

## Risks

- Mode-composition surface in `src/cli.ts` is already dense; `--import` must be added without
  regressing existing flag combinations (existing cli tests are the guard).

## Open Questions

- **Owner (product):** default-to-`defaultModel` vs require explicit `--model` when `--model`
  is omitted — decided as default-for-now per DH-0187 Decision 5, flagged for owner
  confirmation. Reversible one-line change if the owner prefers requiring it.

## Notes

Minted 2026-07-18 as the Core slice of DH-0187. `depends_on: [DH-0188]`.

### 2026-07-19 — implemented, verified, closing

Wired the Core half in `src/cli.ts`:

- `CliOptions.importPath`/`CliOptions.model`, `--import <path>`/`--model <alias>` added to
  `FLAGS_WITH_VALUES` and `parseArgs`.
- `parseArgs` mutual-exclusion validation (pure, no filesystem/config needed, same "requires"
  pattern as `--json`/`--web-port`): `--model` requires `--import`; `--import` rejects
  `--resume`, `--check`, `--dry-run`, and `--connect` (reusing `composeMode`, same pattern
  `--web-port`'s own check already uses).
- `resolveImportSource(path)` — new exported function implementing DH-0187 Decision 1's
  path-kind detection: a directory with `manifest.json` (or a lone `*.jsonl` fallback) is
  archive mode; a file ending `.jsonl` is live mode; a sibling/nested `<id>/` directory, if
  present, is picked up as the sidecar. Both reject a bare live project-slug directory (falls
  out naturally — no `manifest.json`, not exactly one `*.jsonl`).
- `main()`: a new block right before the existing DH-0038 `--resume` block resolves the model
  alias (`--model` or `config.options.defaultModel`, validated against `config.models` before
  any write — FR5/Decision 5), calls `resolveImportSource` then `deps.importClaudeSession`
  (new `CliDeps` member, wired to the real DH-0188 `importClaudeSession` in `defaultDeps()`),
  and on success **mutates `options.resume` to the produced `sessionId`** — the only
  integration point. Everything downstream (the DH-0038 resume block, model-alias
  re-validation, `--instructions` composition, interactive vs. standalone launch) is the
  existing, completely unmodified `--resume` code path, per DH-0187's governing insight.

Verification:

- All four CLAUDE.md §5 gates green locally: `bun run typecheck`, `bun run lint`,
  `bun run test:coverage` (100.00% lines, 14015/14015), `bun run e2e` (40/40, all files).
- Every User Story bullet has a named test:
  - Path-kind detection / bare-project-slug rejection: `src/cli.test.ts`
    `describe("resolveImportSource (DH-0189)")` — 12 cases covering archive mode (manifest +
    lone-jsonl fallback, ambiguous/missing rejection, non-string id, missing transcript),
    live mode (with/without sidecar), and the neither-directory-nor-.jsonl rejection.
  - `--model` default-vs-explicit + unresolvable-alias error path:
    `src/cli.test.ts` `describe("main — --import <path> (DH-0189)")` — "an unresolvable
    --model alias fails cleanly before any write" and "omitting --model defaults to
    dh.json's options.defaultModel".
  - Composition/conflict cases: `src/cli.test.ts`
    `describe("parseArgs — --import/--model (DH-0189)")` — `--model` without `--import`,
    `--import` + each of `--resume`/`--check`/`--dry-run`/`--connect`.
  - Real end-to-end proof (not just mocked-deps unit tests) per this ticket's own ask and the
    DH-0187 Risks section's explicit call for real round-trip verification: `src/cli.test.ts`
    "real defaultDeps().importClaudeSession writes a resumable session (real end-to-end
    wiring)" exercises the actual DH-0188 translator (not a fake) through a real temp cwd; and
    new `e2e/import-session.test.ts` spawns the **real compiled binary** with
    `--import <liveJsonlPath> --instructions ... --job` against a **mock Anthropic-compatible
    provider**, asserting: exit 0, the provider actually received a folded prior-user-turn
    message (proving replay, not a fresh contextless call), a second `.dh-logs` session
    directory was written and chained via `resumedFrom` (the same shape a native `--resume`
    run already produces), and — separately — that an unresolvable `--model` fails cleanly
    with zero provider calls and no `.dh-logs` write at all.

Judgment calls (none needed architect escalation — no `src/contracts/` change, no invariant
touched):

- `--import` mutates `CliOptions.resume` internally rather than introducing a parallel launch
  path — this is the literal expression of DH-0187's "import writes logs, resume replays them"
  governing insight, not a shortcut; every downstream behavior (model re-validation,
  `--instructions` composition, interactive vs. `--job`) is the existing, already-tested
  `--resume` code, verified unchanged by this ticket's diff.
- `--import`'s mutual-exclusion errors are usage errors from `parseArgs` (pure, before any
  config/filesystem work), not runtime errors from `main()` — consistent with how
  `--json`/`--web-port`'s own "requires" rules are already enforced, and it means an
  operator's illegal invocation fails before touching the filesystem at all.
- Open Question ("default `defaultModel` vs. require explicit `--model`") is unchanged from
  DH-0187/DH-0189's stated decision (default-for-now, reversible) — still flagged for the
  owner, not resolved by this implementation pass.

**This closes out DH-0187's whole feature** — DH-0188 (Server translator) landed first, this
ticket (DH-0189, Core CLI wiring) is the second and last piece. DH-0187 (umbrella), DH-0188,
and DH-0189 are all now closed.
