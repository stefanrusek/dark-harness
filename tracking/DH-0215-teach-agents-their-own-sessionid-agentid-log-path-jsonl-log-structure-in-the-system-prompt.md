---
spile: ticket
id: DH-0215
type: feature
status: closed
owner: stefan
resolution: done
blocked_by: []
created: 2026-07-19
relations:
  depends_on: []
  relates_to: []
  supersedes: []
implementation:
  - repo: dark-harness
---

# DH-0215: Teach agents their own sessionId/agentId/log path + JSONL log structure in the system prompt

## Summary

Owner observation (2026-07-19): cloud agents (Claude Code sub-agents in this very coordinating session) know their own session ID and the basics of their session log's structure, and can use that to introspect their own transcript/history. dh's agents currently have no equivalent -- the system prompt's existing 'About this dh instance' section (renderSelfInfoSection, src/prompt/system-prompt.ts) tells an agent its build version, current model, and other configured models, but never its own sessionId, agentId, or where its JSONL log lives on disk (.dh-logs/<sessionId>/agent-<agentId>.jsonl per ADR 0004) or the basic shape of that format (header line + typed event lines: message/tool_call/tool_result/token_usage/status_change/completed, per docs/jsonl-log-format.md which already documents this for humans). Confirmed technically feasible: AgentRuntime already has sessionId and logsRoot as instance fields (src/agent/runtime.ts), and both call sites of buildAgentSystemPrompt(model) (runRootLoop, runSubAgent) already have the spawning agentId in scope -- just needs threading through as a new parameter.

## User Stories

### As an agent (root or sub-agent), I want to know my own session ID, agent ID, and log file path, so I can read my own history when useful (e.g. reviewing what I've already tried, debugging my own confusion, or analyzing a prior turn in detail)

- Given any agent's system prompt, when it's rendered, then it includes the current
  `sessionId`, the current `agentId`, and the exact on-disk path to that agent's own JSONL
  log file (`.dh-logs/<sessionId>/agent-<agentId>.jsonl`, per ADR 0004's naming convention —
  verify the real current file-naming logic in `src/server/logger.ts`/`SessionLogger` rather
  than assuming, since this ticket must describe the actual path an agent could `Read`).

### As an agent, I want to know the basic shape of my own log format, so I can actually parse/make sense of it if I read it

- Given the system prompt's self-info section, when an agent reads it, then it includes a
  short, accurate description of the JSONL structure: one header line (session/agent/parent
  metadata) followed by typed event lines (`message`, `tool_call`, `tool_result`,
  `token_usage`, `status_change`, `completed`, etc.) — concise enough not to bloat every
  prompt, pointing at `docs/jsonl-log-format.md` isn't an option (agents don't have arbitrary
  filesystem access to docs/ guaranteed relative to their cwd), so the essential shape must
  be inlined directly, kept in sync with the real format by construction (e.g. derived from
  or cross-checked against the same source `docs/jsonl-log-format.md` and
  `src/contracts/log.type.ts` describe, not hand-duplicated prose that can drift).

### As a sub-agent, I want my own agentId specifically, not the root's

- Given a sub-agent spawned via the `Agent` tool, when its system prompt is built, then the
  self-info section reports *that sub-agent's own* `agentId` (not the root's) and its own
  log file path — each agent in a tree can find its own transcript, not just the root's.

## Functional Requirements

- Extend `renderSelfInfoSection` (`src/prompt/system-prompt.ts`) to accept and render
  `sessionId`, `agentId`, and the log file path as new parameters.
- Thread `agentId` through `AgentRuntime.buildAgentSystemPrompt(model)` → `(model, agentId)`
  at both call sites (`runRootLoop` passing `ROOT_AGENT_ID`, `runSubAgent` passing its own
  `agentId` parameter) — `sessionId`/`logsRoot` are already instance fields, no new plumbing
  needed for those two.
- Confirm and use the real current log-file-naming convention (check `SessionLogger`/
  `src/server/logger.ts` for the actual filename pattern per agent) rather than assuming
  `agent-<agentId>.jsonl` is still exactly right post-DH-0173's runtime split.
- Keep the JSONL-structure description short — a few lines, not a reproduction of the full
  `docs/jsonl-log-format.md` — this is a system-prompt addition charged on every single turn,
  so verbosity has a real, ongoing token-cost tradeoff.

## Assumptions

- Agents already have `Read`/`Bash` tool access sufficient to actually open and inspect their
  own log file once they know its path — no new tool/capability needed, purely an
  information-availability gap.

## Risks

- Low — purely additive prompt content, no contracts/wire-format change, no security
  implication (an agent already has filesystem access broad enough to find its own logs by
  searching `.dh-logs/` blindly; this just makes it direct instead of requiring a search).
- Token-cost tradeoff noted above — keep the addition concise.

## Open Questions

## Notes

### 2026-07-19 — Implemented and verified

- `renderSelfInfoSection` (`src/prompt/system-prompt.ts`) gained three new optional trailing
  params (`sessionId`, `agentId`, `logFilePath`); when all three are present it appends a
  paragraph with the session id, agent id, the exact log file path, and a concise description
  of the JSONL structure (header line + `message`/`tool_call`/`tool_result`/`token_usage`/
  `status_change`/`completed` typed event lines).
- Verified the real current filename convention against `SessionLogger.filePathFor()`
  (`src/server/logger.ts`) rather than assuming the ticket's guess: it is
  `<logsRoot>/<sessionId>/<encodeURIComponent(agentId)>.jsonl` (no `agent-` prefix — that
  guess was stale post-DH-0173). `AgentRuntime.buildAgentSystemPrompt()`
  (`src/agent/runtime.ts`) now takes `(model, agentId)` and computes this same path via
  `join(this.logsRoot, this.sessionId, encodeURIComponent(agentId) + ".jsonl")`. Both call
  sites (root loop, sub-agent loop) pass their own agent id (`ROOT_AGENT_ID` / the spawned
  sub-agent's id).
- Test coverage: `src/agent/runtime.test.ts` — new "DH-0215" test asserts root and a sub-agent
  each get distinct sessionId/agentId/log-path text in their system prompts, that the reported
  path matches a real `SessionLogger.filePathFor()`, and — the load-bearing check — reads the
  actual file back off disk and confirms its header line's `agentId` matches. All three User
  Stories are covered by this one test. 100% line coverage maintained
  (`bun run test:coverage`).
- Real-session verification (not just unit tests): built the release binary
  (`bun scripts/build.ts`) and drove it end-to-end via the e2e mock-provider harness
  (`--instructions ... --job` against `startMockAnthropicProvider`) — confirmed the actual
  system prompt sent to the model contained a real UUID session id, `agent-root` as the agent
  id, and a log path that, when read from disk, was a real file whose header line matched.
  Scratch verification script was not committed (ad hoc, not part of the repo).
- All four gates green locally: `bun run typecheck`, `bun run lint`, `bun run test:coverage`
  (100.00% lines), `bun run e2e`.
