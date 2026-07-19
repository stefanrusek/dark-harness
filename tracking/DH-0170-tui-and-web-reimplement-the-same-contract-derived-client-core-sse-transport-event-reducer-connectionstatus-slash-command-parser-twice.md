---
spile: ticket
id: DH-0170
type: bug
status: closed
owner: stefan
resolution: superseded
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

---

## Architect decomposition (Fable, 2026-07-18)

Confirmed all four duplications against the live code. Decomposition decision below.

### Key architectural finding: nothing goes into `src/contracts/`

The ticket flags `src/contracts/` as the "natural home." It is **not** — per CLAUDE.md §3,
contracts holds *wire truth* (types serialized on the SSE/POST/log wire), **not logic**, and
nothing here is on the wire:

- **`ConnectionStatus`** is the client's local connection-lifecycle state. It is never
  serialized in any SSE event or POST command — it's computed client-side from the transport's
  reconnect loop. Shared *client vocabulary*, not wire truth.
- **The slash-command grammar** is pure client input parsing. The *resulting* command is a
  wire command (already in `contracts/commands.type.ts`), but the parsing/grammar is not.
- **The `Turn` type** is a client display model, never serialized.
- The **event vocabulary itself already lives in contracts** (`ServerSentEvent`,
  `events.type.ts`) and both reducers already import it — that part is not duplicated.

So the correct home for the shared *implementation* is a **new shared client-implementation
directory, `src/client-core/`** — a sibling to `src/contracts/` but for logic, not schema.
This is the architect-approved ownership decision (CLAUDE.md §6 items 2 & 3). **No contracts
change is actually required**, which also means no §6-item-2 wire review is triggered.
`src/client-core/` is owned by **Core (Grace)** as the neutral integrating domain (it already
owns cross-cutting non-UI glue); both TUI and Web import from it. DH-0183's scope includes
adding the `src/client-core/` row to the CLAUDE.md §3 ownership map (pre-approved here).

### Item-by-item disposition

1. **SSE transport (parser + backoff + reconnect)** — genuine shared logic, zero UI coupling
   (both clients use `fetch()`, not `EventSource`). **Extract to `src/client-core/`.**
   → **DH-0184** (build the shared module) + **DH-0185** (TUI swap) + **DH-0186** (Web swap).
   **Validation-strictness divergence resolved:** the permissive shape-check (Web's) is
   canonical; the TUI's strict `KNOWN_TYPES` allowlist is a **confirmed latent bug** — it
   omits `model_switched`, `resync`, and `agent_thinking` (all present in the contracts
   `ServerSentEvent` union and all handled by the TUI reducer), so those events are silently
   dropped at the parser today. Unknown/future types are the reducer's exhaustiveness-default
   to tolerate, not the parser's to filter.
2. **SSE-event reducer + `Turn` type** — **does NOT decompose / deliberately left duplicated.**
   Despite sharing the event vocabulary, the two reducers have genuinely diverged in ways that
   make a single shared reducer a large, risky rewrite forcing one architecture onto both:
   - **Different merge semantics:** TUI merges streamed chunks purely on trailing-turn role;
     Web tracks an explicit `turnOpen` flag cleared when status leaves `running` (the DH-0066
     "two turns concatenate into one bubble" fix). Not interchangeable.
   - **Different `Turn` shapes:** Web has a `timestamp` field and a distinct `"system"` role;
     TUI has neither (uses `"tool"` for `/help`).
   - **Different architecture:** TUI's `state.ts` is a full Elm-style `(state, action) ->
     {state, effects}` reducer also owning keys, views (picker/tree), size, ownsServer/Ctrl+C
     shutdown. Web's `state.ts` is a bag of pure helper functions driven imperatively by
     `app.ts`, with React owning views and no effect channel.
     Unifying these would subordinate both clients' UX models to one shared shape for little
     gain. The shared *vocabulary* they consume is already centralized (contracts). **Record
     as intentional; do not merge.**
3. **Slash-command parser** — byte-identical, zero coupling. **Consolidate into
   `src/client-core/`.** → **DH-0183.**
4. **`ConnectionStatus` union** — shared client vocabulary, declared twice. **Consolidate into
   `src/client-core/`.** → **DH-0183** (bundled with the slash parser as the low-risk
   foundation).

### Sub-tickets (independently pickup-able)

- **DH-0183** — establish `src/client-core/`; move slash-parser + `ConnectionStatus`; update
  CLAUDE.md §3. Low-risk foundation.
- **DH-0184** — build the shared SSE transport in `src/client-core/` (validation decision
  baked in). Depends on DH-0183.
- **DH-0185** — TUI (Mary) migrates onto the shared transport. Depends on DH-0184.
- **DH-0186** — Web (Susan) migrates onto the shared transport. Depends on DH-0184.

DH-0185 and DH-0186 are independent of each other — Mary and Susan can pick them up in
parallel once DH-0184 lands. Item 2 (reducer/`Turn`) yields no ticket by design.

DH-0170 closes as **superseded** by this decomposition.

