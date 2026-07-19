---
spile: ticket
id: DH-0189
type: feature
status: ready
owner: stefan
resolution:
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
