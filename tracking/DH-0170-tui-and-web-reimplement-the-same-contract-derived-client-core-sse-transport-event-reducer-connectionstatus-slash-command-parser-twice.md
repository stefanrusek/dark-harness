---
spile: ticket
id: DH-0170
type: bug
status: draft
owner: stefan
resolution:
blocked_by: []
created: 2026-07-18
relations:
  depends_on: []
  relates_to: []
  supersedes: []
implementation:
  - repo: dark-harness
---

# DH-0170: TUI and Web reimplement the same contract-derived client core (SSE transport, event reducer, ConnectionStatus, slash-command parser) twice

## Summary

Cross-cutting duplication: the TUI and Web clients independently hand-roll the same wire-format logic. Umbrella finding for coordinator/architect decomposition.

## Domain / owner

TUI (Mary) + Web (Susan) + Contracts (architect sign-off)

## User Stories

_To be written at `refining` (draft filed by refactoring round DH-0169)._

## Notes

Filed by Fable during refactoring round DH-0169 (first-ever full-history sweep).

**Root cause:** the TUI and Web clients consume the identical SSE wire format but were
built independently, so the same contract-derived logic is implemented twice. Four
distinct-but-related duplications were found:

1. **SSE frame parser + backoff + reconnect driver.** `src/tui/sse-parser.ts` +
   `src/tui/sse-client.ts` vs `src/web/client/sse.ts`. The incremental blank-line
   SSE field parser, full-jitter exponential backoff (`backoffDelayMs`, sse-client.ts:48,
   is byte-equivalent to `nextReconnectDelayMs`, sse.ts:84, same 1000/30000 constants),
   and the `Last-Event-ID` reconnect loop are all reimplemented. sse.ts:14-23 openly
   admits the duplication was judged not worth extracting "this round." The two even
   **diverge in validation strictness**: `parseServerSentEvent` (sse-parser.ts:103)
   validates `version===1` + a `KNOWN_TYPES` set, while web's `parseEventPayload`
   (sse.ts:142) only checks `typeof type === "string"` — a real behavioral drift.
2. **SSE-event reducer + `Turn` type.** `src/tui/state.ts` (cases 336-413) vs
   `src/web/client/state.ts` (cases 437-528) fold the identical event vocabulary
   (`agent_spawned`/`agent_output`/`agent_status`/`token_usage`/`session_ended`/`resync`/
   `tool_call`/`tool_result`/`agent_thinking`/`model_switched`) into parallel per-agent
   transcript models with parallel `Turn` types.
3. **Slash-command parser.** `src/tui/commands.ts` vs `src/web/client/slash-commands.ts`
   — the latter's header calls itself "a byte-for-byte mirror." Zero DOM/terminal
   coupling, so the domain-boundary excuse is weak. Also naming drift: `commands.ts`
   means "slash parser" in TUI but "wire-command builders" in Web.
4. **`ConnectionStatus` union** defined twice (`src/tui/connection-status.constant.ts:22`
   vs `src/web/client/state.ts:116`), already deliberately converged per DH-0105/DH-0157
   comments — i.e. a shared vocabulary kept as two declarations.

**FLAGGED FOR ESCALATION / COORDINATOR TRIAGE (CLAUDE.md §6 items 2 & 3):** the natural
home for the shared parser, `Turn` type, event vocabulary, and `ConnectionStatus` is
`src/contracts/` — a shared-schema change that needs architect sign-off — and the work
spans two client domains that cannot be cleanly sliced by the ownership map. This is an
umbrella finding: it should be decomposed (transport / reducer / slash-parser are
independently actionable) by the coordinator with architect input, not implemented as one
lump. Do NOT let an implementer collapse the deliberate validation-strictness divergence
in item 1 without deciding which behavior is correct.

