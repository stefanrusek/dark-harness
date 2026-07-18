---
spile: ticket
id: DH-0157
type: feature
status: verifying
owner: stefan
resolution:
blocked_by: []
created: 2026-07-18
relations:
  depends_on: []
  relates_to: [DH-0156]
  supersedes: []
implementation:
  - repo: dark-harness
---

# DH-0157: Coding-standards overhaul Wave 3: layer-2 file migration (21 files)

## Summary

Third wave of Fable's leaf-to-root dependency-tree migration plan. These 21 files depend only on Wave 1/2 files (now final). Includes the tui/types.ts mixed type+constant standout (needs an actual split decision, per DH-0149's earlier partial backfill) and server/agent-loop.ts (a known type-only contract file from DH-0149's coverage backfill work, strong .type.ts candidate). Split into 5 directory-clustered sub-waves (3A-3E) per Fable's dispatch breakdown, dispatched in parallel.

## User Stories

### As the coding-standards overhaul, I want the tui/types.ts standout resolved and the rest of layer-2 correctly classified

- Given `tui/types.ts` (a known mixed type+constant file), when split, then
  `tui/types.type.ts` holds pure interfaces/type aliases and
  `tui/connection-status.constant.ts` holds `CONNECTION_STATUSES` plus `ConnectionStatus`
  derived from it via `(typeof CONNECTION_STATUSES)[number]` — proven by both new files
  individually producing zero GritQL warnings, and all 27 importers updated.
- Given `server/agent-loop.ts` (confirmed pure type-only, per DH-0149's earlier finding),
  when renamed to `.type.ts`, then all its importers correctly reference the new path.
- Given every other layer-2 file, when classified, then it correctly stays regular (real
  logic disqualifies it) — proven by 4 sub-wave agents' independent review.

## Functional Requirements

- Renamed: `server/agent-loop.ts` -> `.type.ts` (3A); `tui/types.ts` split into
  `types.type.ts` + `connection-status.constant.ts` (3C).
- Left unchanged: everything in 3B, 3D; `server/commands.ts`/`exit.ts`/`summary.ts` (3A —
  mixed function+type exports); `tui/http-client.ts` (3C — mixed logic+constant); both
  barrels `providers/index.ts`/`prompt/index.ts` verified correct against prior waves'
  renames, `tools/report-outcome.ts`/`config/validate.ts` (3E — real logic).

## Assumptions

## Risks

## Open Questions

## Notes

> [!NOTE]
> 2026-07-18: All 5 sub-waves (3A-3E) complete and merged. One process issue caught and
> fixed during merge: sub-wave 3A's agent created `agent-loop.type.ts`/`.test.ts` via Write
> plus importer updates, but never removed the original `agent-loop.ts`/`agent-loop.test.ts`
> (should have been a `git mv`) — left two orphaned, byte-identical-modulo-rename duplicate
> files. Caught during merge verification (`ls src/server/agent-loop*` showed 4 files instead
> of 2), confirmed nothing but the orphaned old test file itself still referenced the old
> path, deleted the orphans in a follow-up commit. Sub-wave 3C's rename (`types.ts` split)
> used proper git rename semantics and had no such issue — worth noting the inconsistency
> for future dispatch prompts (explicitly instruct: verify old file no longer exists after
> any rename, don't just trust the agent's own "importers updated" claim).
>
> Final state: `bun run typecheck` clean, `bun run lint` exits 0 (258 warnings, down from
> 259 — only `agent-loop.ts` had a real top-level statement to lose; pure-type files never
> triggered the rule in the first place). `bun run test:coverage` 125/125 (99.75%).
> `bun run e2e` 35/38 (3 failures identical to the confirmed pre-existing local-only
> `--connect --web` timing flake, not a regression).
