---
spile: ticket
id: DH-0188
type: feature
status: closed
owner: stefan
resolution: done
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

### 2026-07-18 — implementation

Built `src/server/import-claude-session.ts` (exported from `src/server/index.ts`):
`importClaudeSession({ transcriptPath, sidecarDir? }, { logsRoot, model, client?, build? }) →
{ sessionId, logsRoot }`. Writes via `SessionLogger` (FR3 — no hand-rolled JSONL). Per-agent
`LogEvent` translation and `LogHeader` writing are shared through one `translateAgentLines` +
`writeTranslatedAgent` pair used identically for the root agent, sidecar subagents, and inline
sidechain branches, so all three get the same Decision 2/3/4 handling.

**Mapping implemented (Decision 2):** user/assistant text -> `message`; `tool_use` ->
`tool_call` (Claude Code's `Task` tool name rewritten to dh's `Agent`, per Decision 3);
`tool_result` -> `tool_result` (`is_error`/`tool_use_id` field names correctly read — real
backup uses snake_case here even though the rest of the format is camelCase); `thinking`/
`redacted_thinking` -> `thinking`; `message.usage` -> `token_usage`; `system` -> `message`
role `system` (skipped on replay per `foldEventsToMessages`, confirmed).

**Sub-agent tree (Decision 3):** sidecar `subagents/*.meta.json`+`.jsonl` pairs processed in
ascending `spawnDepth` so a depth-2 child's `meta.toolUseId` resolves against a depth-1
parent's just-mapped `Agent`/`Task` tool_use id (built via a `toolUseId -> dh agentId` map
populated incrementally). Orphans (unresolvable `toolUseId`) attach to root with a system
annotation, per spec. Verified against the real backup: 43 depth-1 + 15 depth-2 = 58
sub-agents, all resolved correctly (see verification below).

**Lossy content (Decision 4):** implemented the table verbatim —
`file-history-snapshot`/`-delta`, `mode`, `permission-mode`, `last-prompt`, `bridge-session`,
`pr-link`, `queue-operation` all dropped with no event; `ai-title` consumed into
`header.description`; `attachment` inlined (textual) or placeholdered (non-textual) into the
next user turn's text.

**One deliberate deviation from the design prose, with reasoning:** Decision 4 says
attachments are inlined "into the owning user turn's text." Real attachment lines (hook
output, skill listings, deferred-tool deltas) carry no back-reference to a specific user turn
— only source order. Rather than guess at a `parentUuid`-based association (fragile, and the
real backup's `SessionStart` hook attachment has `parentUuid: null`, i.e. no conversational
owner at all), I buffer attachment text and prepend it to the *next* user-role message emitted
in the same stream — the simplest reading of "owning turn" that source order actually
supports. An attachment with no following user turn (end of transcript) is tolerated, not
crashed on, and its content is simply not surfaced (documented in a test case) rather than
invented a fallback annotation channel not asked for.

**Inline `isSidechain:true` tolerance (Decision 3):** implemented via bucketing by the line's
own `agentId` field (falling back to folding un-keyed sidechain lines into the current stream
rather than inventing a synthetic grouping — no real example existed to validate a synthetic
scheme against). Recursion guard: a bucket's own lines carry the same `isSidechain:true` flag
forever, so `translateAgentLines` takes an `ownAgentId` parameter and only re-buckets a line
whose `agentId` differs from the stream's own id — first implementation attempt infinite-
looped on this exact case against the real backup before the guard was added.

**Real round-trip verification (the ticket's Risks-mandated check):** ran `importClaudeSession`
against the real, 4.2MB, ~2300-line `~/claude-session-backups/fable-july-18-swarm/` backup
(full transcript + full `subagents/` sidecar, not a trimmed copy), then folded the result
through the actual `replayAgentHistory`/`foldEventsToMessages` (unmodified). Results: 786
folded `ProviderMessage`s, 236 `tool_use` blocks / 236 `tool_result` blocks with **zero**
outstanding unmatched tool_use ids after fold, 59 sub-agents (43 depth-1 + 16 incl. root's own
tree, all `status: done`), header/model/sessionId self-consistent. This was a one-off manual
script (not checked in — the backup path is user-local, not portable to CI); the checked-in
test suite (`src/server/import-claude-session.test.ts`) carries synthetic fixtures built
directly off the real line shapes sampled during that verification (field names, nesting,
`tool_use_id`/`is_error` casing, `toolUseId`/`agentId` linkage) so the same code paths stay
covered by the 100%-coverage gate without depending on the external backup.

**Verified:** `bun run typecheck`, `bun run lint`, `bun run test:coverage` (100.00% lines/
100.00% functions on the new file; whole-suite 2199 pass/0 fail), `bun run e2e` (38 pass/0
fail) — all green locally. User Stories from this ticket and DH-0187 relevant to the Server
slice are each backed by a named test in `import-claude-session.test.ts` (round-trip, tool
pairing, depth-2 tree, one case per Decision-4 line type, real-backup verification recorded
above).

Not built here (Core's job, DH-0189): `--import`/`--model` CLI flags, path-kind detection
(Decision 1), `--model` resolution against `dh.json` (Decision 5), and launching `--resume` on
the produced session id.
