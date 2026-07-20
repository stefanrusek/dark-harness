---
spile: ticket
id: DH-0210
type: bug
status: closed
owner: stefan
resolution: done
blocked_by: []
created: 2026-07-19
relations:
  depends_on: []
  relates_to: [DH-0187, DH-0188, DH-0189]
  supersedes: []
implementation:
  - repo: dark-harness
---

# DH-0210: --import + resume chain: toolResult/toolUse block count mismatch crashes the provider request

## Summary

Owner-reported real failure (2026-07-19), reproduced against a real Bedrock haiku model on a real imported Claude Code session: 'dh --import ~/claude-session-backups/test/ --model haiku-bedrock' succeeds at import time, but the resulting session fails on its first turn with 'bedrock provider request failed: The number of toolResult blocks at messages.8.content exceeds the number of toolUse blocks of previous turn.' Confirmed this is a genuine harness bug, not credentials/config -- the error is a real Bedrock API rejection of a malformed message sequence (more tool_result blocks in one message than tool_use blocks in the preceding assistant turn). Notably this specific failure surfaced on a SECOND-level resume (a session that was itself resumed from the original --import session, i.e. 'dh --resume' run twice in sequence) -- the first-level import+resume reportedly completed fine per DH-0188's own round-trip verification (236/236 tool_use/tool_result pairs matched against the fable-july-18-swarm backup), so this may be specific to: (a) src/agent/resume.ts's foldEventsToMessages() double-folding behavior across nested resume chains, not the DH-0188 importer itself, or (b) an edge case in the imported session's actual content shape (e.g. sidechain branches, multi-tool_result messages) that DH-0188's reference backup didn't exercise. Needs real investigation against the owner's actual failing session logs (.dh-logs/3b379af7-30e2-41b1-a1f6-70605c90273a and its resume chain back through e6229b4b-9b16-4c4e-b9b1-9f4b04a5b5f3 to the original import) to find the exact malformed message and root-cause whether it's the importer or the resume-fold path. Core/Server domain -- likely src/agent/resume.ts or src/server/import-claude-session.ts depending on where the malformation is introduced.

## User Stories

### As an operator resuming an imported (or twice-resumed) session, I want the replayed history to always be a valid provider message sequence

- Given a session whose JSONL log contains two consecutive tool-only assistant turns (a
  `tool_call`/`tool_result` pair immediately followed by another `tool_call`/`tool_result`
  pair, with no `message` event — i.e. no leading/trailing text — between them), when
  `loadResumeSession()`/`foldEventsToMessages()` replays that log, then each folded user
  turn's `tool_result` block count never exceeds the immediately preceding assistant turn's
  `tool_use` block count. Proven by
  `src/agent/resume.test.ts` — "DH-0210: two back-to-back tool-only turns (no text between
  them) fold into separate turns, not merged tool_results" — which reproduces the exact real
  malformed shape found in the owner's failing `.dh-logs/e6229b4b-.../agent-root.jsonl` and
  asserts both the exact expected message array and the general per-turn invariant a real
  Bedrock/Anthropic API enforces.

## Functional Requirements

- `foldEventsToMessages()` (`src/agent/resume.ts`) must flush any pending (already-resulted)
  tool_results into a user message *before* opening a new assistant turn from a `tool_call`
  event, exactly as it already does in the `message` case — not only when the new turn opens
  with a leading text `message` event.

## Assumptions

## Risks

## Open Questions

## Notes

**2026-07-19 — root cause found, fixed, verified against real logs.** Root cause found and
fixed against the owner's real `.dh-logs` (session `3b379af7-...` resumed from
`e6229b4b-...`, the real `--import`-produced session). This was NOT a double-resume/chain
bug and NOT an import-time (`import-claude-session.ts`) bug — it is a single-hop fold bug in
`src/agent/resume.ts`'s `foldEventsToMessages()`. The `tool_call` case opens a new assistant
turn (`openAssistant = {role:'assistant', content:[]}`) whenever `openAssistant` is
undefined, but unlike the `message` case it never called `flushResults()` first. When a real
turn boundary has no leading/trailing text (a bare `tool_call` immediately following another
turn's `tool_result`, e.g. a ToolSearch call+result immediately followed by a Bash
call+result with zero `message` events between them — exactly the shape at lines 16-21 of the
real `e6229b4b-9b16-4c4e-b9b1-9f4b04a5b5f3/agent-root.jsonl`), the prior turn's
already-collected `tool_result` stayed in `pendingResults` and got merged with the next
turn's own `tool_result` into a single user message once something eventually called
`flushResults()`. That merged user message then had 2 `tool_result` blocks immediately
following an assistant turn with only 1 `tool_use` block — exactly the real Bedrock
rejection ("toolResult blocks ... exceeds ... toolUse blocks of previous turn") reported at
`messages.8`.

Fix: call `flushResults()` in the `tool_call` case's `!openAssistant` branch too, mirroring
the `message` case.

Verified against the full real 957-message folded history of the owner's actual failing
session — 0 mismatches after the fix (script-verified: every `tool_result`'s `toolUseId`
belongs to the immediately preceding assistant turn's `tool_use` set, each consumed exactly
once). Added a regression test in `src/agent/resume.test.ts` reproducing the exact real
malformed shape (two back-to-back tool-only turns) plus the general per-turn invariant check.

Gates: typecheck clean, lint clean, `test:coverage` 137/137 passed at 100.00% line coverage,
e2e 39/40 — the 1 failure (`e2e/web.test.ts`'s headless-browser test) is a pre-existing
environmental flake unrelated to this fix, reproduced identically with `git stash` on the
unmodified pre-fix tree, and passes reliably when run in isolation via
`bun test e2e/web.test.ts`.
