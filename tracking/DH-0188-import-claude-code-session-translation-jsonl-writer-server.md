---
spile: ticket
id: DH-0188
type: feature
status: ready
owner: stefan
resolution:
blocked_by: []
created: 2026-07-18
relations:
  depends_on: []
  relates_to: [DH-0187]
  supersedes: []
implementation:
  - repo: dark-harness
---

# DH-0188: import: Claude Code session translation + JSONL writer (Server)

## Summary

Server-owned half of DH-0187: a pure translation-and-writer module in src/server/ that reads a Claude Code session (main transcript + subagents/ sidecar) and writes a valid dh .dh-logs/<sessionId>/ directory (LogHeader + LogEvent per agent, ADR 0005), which the existing --resume path can then replay. Owns the Claude-Code-line-type -> LogLine mapping, sidecar -> per-agent-file tree mapping, and all lossy-content decisions.

The full mapping design lives in **DH-0187** (Architect design, Fable 2026-07-18) — this
ticket carries the Server-owned slice. Read DH-0187 Decisions 2/3/4 before implementing.

## User Stories

- **As the importer, I want** to translate a Claude Code root transcript into an ADR-0005
  root-agent JSONL. **Given** `<id>.jsonl`, **when** `importClaudeSession` runs, **then** each
  user/assistant/tool/thinking/system line maps to the corresponding `LogEvent` per DH-0187
  Decision 2, in source order. *(test: root-transcript translation round-trips through
  `readAgentLogLines`.)*
- **As the importer, I want** to reconstruct the sub-agent tree. **Given** a `subagents/`
  sidecar, **when** it is translated, **then** each subagent becomes a sub-agent JSONL whose
  `parentAgentId` resolves via `meta.toolUseId`→parent `Task` `tool_use`, including depth-2
  nesting. *(test: tree-build case with a nested subagent.)*
- **As the importer, I want** deterministic lossy-content handling. **Given** `attachment`,
  `file-history-snapshot`, `mode`, `permission-mode`, `last-prompt`, `ai-title`, `system`
  lines, **when** translated, **then** each follows the DH-0187 Decision-4 table exactly.
  *(test: one case per line type asserting its disposition.)*
- **As a resumer, I want** the output to be resume-valid. **Given** an imported directory,
  **when** folded via `replayAgentHistory`, **then** message sequence and tool_use/tool_result
  pairing are intact. *(test: fold the real backup `fable-july-18-swarm` and assert integrity.)*

## Functional Requirements

- FR3, FR4, FR7 from DH-0187 (see there). Module: `importClaudeSession(source, opts) →
  { sessionId, logsRoot }` in `src/server/`.
- Reuse existing session-write primitives (the `SessionLogger` write path or its lower-level
  serialization) — do not hand-roll JSONL emission.
- Provenance stamped per DH-0187 Decision 4 (`instructionsSummary` + leading `system`
  message); no `src/contracts/` change.
- Tolerate truncated final source lines and unknown/future Claude Code line types.

## Assumptions

- Source format is exactly the `session-backup` shape (DH-0187 Summary). Inline
  `isSidechain:true` branches must be tolerated even though the sampled backup uses the
  sidecar mechanism instead.

## Risks

- Attachment→user-turn association is the highest-lossiness area (DH-0187 Risks) — test it
  as its own case.

## Open Questions

- None blocking; inherits DH-0187's owner-facing model-default question (Core-side, DH-0189).

## Notes

Interface contract with Core (DH-0189): `importClaudeSession(source, opts) → { sessionId,
logsRoot }`. Minted 2026-07-18 as the Server slice of DH-0187.
