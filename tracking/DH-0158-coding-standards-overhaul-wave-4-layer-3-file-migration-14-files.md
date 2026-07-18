---
spile: ticket
id: DH-0158
type: feature
status: verifying
owner: stefan
resolution:
blocked_by: []
created: 2026-07-18
relations:
  depends_on: []
  relates_to: [DH-0157]
  supersedes: []
implementation:
  - repo: dark-harness
---

# DH-0158: Coding-standards overhaul Wave 4: layer-3 file migration (14 files)

## Summary

Fourth wave of Fable's leaf-to-root dependency-tree migration plan. These files depend only on Waves 1-3 (now final). Includes agent/runtime.ts, unblocked by DH-0153's earlier cycle-break with resume.ts. Split into 2 sub-waves (4A server/config/runtime cluster, 4B UI composites) per Fable's dispatch breakdown.

## User Stories

### As the coding-standards overhaul, I want agent/runtime.ts (now unblocked by DH-0153) and the rest of layer-3 correctly classified

- Given `agent/runtime.ts`, when checked, then it imports `ROOT_AGENT_ID` from
  `agent-id.constant.ts` (not `resume.ts`), confirming DH-0153's cycle-break holds and the
  file classifies cleanly as regular (real orchestration class logic).
- Given every other layer-3 file, when classified, then it correctly stays regular — proven
  by 2 sub-wave agents' independent review.

## Functional Requirements

- No renames were warranted anywhere in this wave. All 13 files — `agent/loop.ts`,
  `agent/runtime.ts`, the `agent/tools/index.ts` barrel (paths verified correct),
  `config/load.ts`, `server/server.ts`, `server/fake-agent-loop.ts` (4A), plus
  `mcp/project-config.ts`, `web/client/download.ts`, and 6 Ink/React composite components
  (4B) — have real logic disqualifying them from `.type.ts`/`.constant.ts`.

## Assumptions

## Risks

## Open Questions

## Notes

> [!NOTE]
> 2026-07-18: Both sub-waves (4A, 4B) complete. Zero file changes — every layer-3 file
> correctly stays regular, same pattern as Wave 2. `bun run typecheck` clean, `bun run lint`
> exits 0 (258 warnings, unchanged since nothing here qualified for renaming).
> `bun run test:coverage` 125/125 (99.75%), unaffected.
