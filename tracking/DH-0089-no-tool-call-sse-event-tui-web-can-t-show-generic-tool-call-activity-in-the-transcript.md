---
spile: ticket
id: DH-0089
type: feature
status: verifying
owner: stefan
resolution:
blocked_by: []
created: 2026-07-16
relations:
  depends_on: []
  relates_to: []
  supersedes: []
implementation:
  - repo: dark-harness
---

# DH-0089: No tool_call SSE event — TUI/Web can't show generic tool-call activity in the transcript

## Summary

Found while implementing DH-0065's TUI polish: the transcript can show sub-agent spawns (inferred client-side from the existing agent_spawned event) but has no way to show generic tool-call activity (Bash, Read, Edit, etc.) as it happens, because there is no tool_call SSE event in src/contracts/events.ts at all -- only the JSONL log records tool calls, and that is not streamed live. Real Claude Code style UIs show a compact 'agent is running X' indicator per tool call. This is a real contracts change (new SSE event type, emission from src/agent/loop.ts, consumption in both TUI and Web renderers) needing architect sign-off per Constitution 6.2, not something to guess at from one domain.

## User Stories

### As an operator watching a live session, I want to see what tool the agent is currently running, not just its final text output

- Given an agent turn that calls Bash/Read/Edit/etc., when the tool call happens, then
  both TUI and Web show a compact live indicator (tool name + key argument, e.g. "Bash: `bun
  test`") in the transcript at the point the call occurs, not only after the fact via the
  JSONL log.

## Design (Fable, architect-on-call, 2026-07-16 — signed per Constitution §6.2)

### D1. Event shapes (`src/contracts/events.ts`, additive — ADR 0002/0006 "extend minimally")

Two new event types, named to match their JSONL log-line counterparts (`tool_call` /
`tool_result` in `src/contracts/log.ts`) — precedent: `token_usage` already shares its name
across both schemas. Call-start **and** call-result: start alone can't distinguish a
long-running Bash call from a finished one, and result lets clients mark errors; the volume
cost is negligible (see D3).

```ts
export interface ToolCallEvent extends SseEventBase {
  type: "tool_call";
  agentId: string;
  /** Correlates with the matching tool_result event (same id as the JSONL line's toolUseId). */
  toolUseId: string;
  toolName: string;
  /** Display-only, single-line, <= TOOL_INPUT_SUMMARY_MAX_CHARS (200) chars, "…"-suffixed
   * when truncated. NEVER the full arguments — the JSONL log's tool_call line carries those
   * (redacted per DH-0020); this field exists solely for a compact live indicator. Produced
   * by src/agent/tool-summary.ts (Core) and secret-redacted server-side before it reaches
   * the wire (see D4). Not parseable — clients must not attempt to reconstruct arguments. */
  inputSummary: string;
}

export interface ToolResultEvent extends SseEventBase {
  type: "tool_result";
  agentId: string;
  toolUseId: string;
  /** Repeated from the tool_call event so clients that missed the call (resume gap) can
   * still render something meaningful without a join. */
  toolName: string;
  isError: boolean;
  /** Wall-clock duration of the execute() call. For run_in_background tools (Bash bg, Agent)
   * this measures the synchronous spawn/dispatch, not background completion. */
  durationMs: number;
}
```

Both added to the `ServerSentEvent` union. Deliberately **no output content** on
`tool_result`: outputs can be huge (whole-file Reads) and are the largest secret surface;
a compact indicator only needs success/failure. Full output lives in the JSONL log, already
redacted per DH-0020. No `version` bump — additive union members, per-event `version: 1`
unchanged; the TUI's `KNOWN_TYPES` whitelist (`src/tui/sse-parser.ts`) means older clients
drop unknown types gracefully, so compat holds in both directions.

`inputSummary` production: new Core helper `summarizeToolInput(toolName, input)` in
`src/agent/tool-summary.ts`, exporting `TOOL_INPUT_SUMMARY_MAX_CHARS = 200`. Heuristic:
first present string value among the priority keys `["command", "file_path", "path", "url",
"query", "prompt", "description", "name", "skill"]`; else the first string-valued property;
else compact `JSON.stringify(input)`. Then collapse all whitespace runs to single spaces and
truncate to 200 chars with a trailing `…`. The priority list is an internal heuristic Core
may evolve without a contracts change — the wire contract only promises "single-line,
display-only, <=200 chars".

### D2. Emission point (`src/agent/loop.ts`, Core)

Inside `runToolCalls()` (the per-toolUse loop), alongside — never replacing — the existing
JSONL lines, following loop.ts's file-wide emitEvent-then-emitLog ordering convention:

- **Before `tool.execute()`**: emit the `tool_call` SSE event immediately before the existing
  `emitLog({type: "tool_call", ...})` (currently loop.ts:235–242). Capture
  `const startedAt = Date.now()` here.
- **After output/isError are determined** (covers both the unknown-tool branch and the normal
  execute path): emit the `tool_result` SSE event with `durationMs: Date.now() - startedAt`,
  immediately before the existing `emitLog({type: "tool_result", ...})` (currently
  loop.ts:260–267).

No other emission sites. Standalone `--instructions`/`--job` mode is unaffected (no `onEvent`
sink wired — `emitEvent` is already a no-op there).

### D3. Volume/throttling: none needed (argued)

DH-0044's 1 KiB / 50 ms coalescing exists because text-delta streaming is a *continuous*
firehose — hundreds of events/sec for the full duration of every completion, uncapped by
anything. Tool-call events are structurally different:

- They occur only inside `runToolCalls`, which awaits each tool **sequentially**; every event
  pair is separated by at least one real tool execution (file IO, subprocess, network), and
  every batch is separated by a full provider round-trip (hundreds of ms to seconds).
- Worst realistic case — a turn with dozens of instant tool calls — is a one-off burst of
  ~2 small events per call, self-limiting at the next model round-trip. Steady-state rate is
  far below the ~20 events/agent/sec DH-0044's coalescing already deems acceptable.
- Each event serializes to ≤ ~350 bytes (200-char summary + envelope), so `EventBuffer`'s
  10 MB byte cap (DH-0012) is unaffected; count-cap consumption (2 per call) is modest and
  already covered by DH-0044 §D8's note about raising the count cap for streaming. **No
  EventBuffer resize needed for this ticket.**
- Clients do O(1) work per event (append/update one marker), and both clients already absorb
  bursts at the render layer (TUI ~30 fps frame-coalescing, Web rAF batching, per DH-0044 §D9).

Decision: emit unconditionally, no coalescing, no throttling. If a pathological MCP tool ever
spams, the failure mode is bounded (EventBuffer eviction shortens the resume window) — revisit
then, not preemptively.

### D4. Redaction (Server touch — this is the one thing beyond pass-through)

DH-0020's `redactSecrets` (`src/server/redact.ts`) guards only the JSONL sink
(`SessionLogger.append`); the live SSE stream was out of its scope because no SSE event
carried tool arguments — this ticket changes that (an MCP tool call's arguments can carry an
API key). Server therefore applies redaction at event intake: a small
`sanitizeEvent(event, knownSecrets)` helper that, for `type === "tool_call"`, returns a copy
with `inputSummary: redactSecrets(inputSummary, knownSecrets)` (identity for every other
type), applied at **both** `agentLoop.onEvent` subscription sites in `src/server/server.ts`
(EventBuffer intake, currently :124, and the live per-connection broadcast, currently :286)
— or hoisted into one shared wrapper, Server's call.

Accepted residual risk (documented, not fixed): Core truncates to 200 chars before Server
redacts, so a secret straddling the truncation boundary loses exact-match known-secret
redaction (pattern-based redaction still matches truncated prefixes of `sk-ant-…`-style
keys). Acceptable because the wire posture is air-gapped plaintext by default (ADR 0003) and
the durable record (JSONL) is fully redacted.

### D5. Client consumption

Shared rule for both clients: **suppress the generic marker for `toolName === "Agent"`** —
DH-0065's richer spawn marker (driven by `agent_spawned`, showing model + description)
already covers spawns, and rendering both would double-mark every spawn. Exception: an
`Agent` `tool_result` with `isError: true` IS rendered (a failed spawn never fires
`agent_spawned`, so the error would otherwise be invisible).

**TUI (Mary — `src/tui/sse-parser.ts`, `state.ts`, `render.ts`):**

- `sse-parser.ts`: add `"tool_call"`, `"tool_result"` to `KNOWN_TYPES`.
- `state.ts`: on `tool_call`, append a tool-role turn via the existing `appendToolMarker`
  path (DH-0065) with text `` `<toolName>: <inputSummary>` `` and record
  `toolUseId → turn ref` in a per-agent pending map. On `tool_result`: if `isError`, append
  a red `✗` suffix to that turn's text; on success leave the marker unchanged (no churn).
  Remove from the map either way. Unknown `toolUseId` (resume gap): render a standalone
  `` `<toolName> ✗` `` marker if `isError`, else drop.
- `render.ts`: structurally unchanged — reuses DH-0065's tool-role branch exactly (first-row
  glyph `⚙ `, whole row DIM/SGR-2, blank continuation gutter). Exact error-suffix SGR is
  Mary's call (suggest `\x1b[31m✗`).

**Web (Susan — `src/web/client/sse.ts`, `state.ts`, `render.ts`, `styles.css`):**

- Add a `"tool"` turn kind (Web currently has none — no spawn marker either). State logic
  mirrors the TUI's (pending map keyed by `toolUseId`, error suffix, Agent suppression rule).
- `render.ts`: new `buildTurnElement` branch for the tool kind — a single compact
  `.turn.turn-tool` row, no "You"/"Agent" role label: glyph `⚙` + `toolName:` +
  summary, muted foreground, smaller font. Error adds class `turn-tool-error` and a `✗` in
  the existing danger color.
- Optional (Susan's call, not required by this ticket): drive a spawn marker from
  `agent_spawned` through the same tool-turn kind, closing the TUI/Web asymmetry DH-0065 left.

### D6. Domain assignment and sequencing

1. **Core (Grace)** — first: the `src/contracts/events.ts` addition (architect-approved
   here, exact shapes in D1), `src/agent/tool-summary.ts`, `loop.ts` emission (D2), unit
   tests (events emitted for known + unknown tools, event/log adjacency, `durationMs`,
   summary heuristic/single-lining/truncation).
2. **Server (Radia)** — after Core: `sanitizeEvent` redaction wrapper (D4). No EventBuffer
   resize (D3). Tests: a `tool_call` event carrying a configured secret arrives redacted on
   both the replay and live paths.
3. **TUI (Mary)** and **Web (Susan)** — in parallel, after Core lands (they only need the
   contract types + a server emitting the events).
4. **E2E (Hedy)** — follow-up scope, sequenced last: mock provider issues a `tool_use` turn;
   assert the TUI shows a `⚙ Bash:` marker and the Web transcript grows a `.turn-tool` row.

## Assumptions

- DH-0065's sub-agent-spawn marker (inferred from the existing `agent_spawned` event) is a
  reasonable stopgap for that one case and doesn't need to be redone once this lands — this
  ticket is about the general case (any tool call), not a replacement for that. (Confirmed
  by the design: D5 keeps the spawn marker and suppresses the generic one for `Agent` calls.)

## Risks

- ~~Event volume: a busy agent can call many tools quickly; consider whether this needs the
  same coalescing/throttling treatment DH-0044's streaming design already established for
  `agent_output`.~~ **Resolved (D3): no throttling — tool-call volume is bounded by
  sequential execution + provider round-trips, orders of magnitude below the text-delta
  stream DH-0044's coalescing exists for.**
- Truncation-boundary redaction gap: a secret straddling the 200-char summary truncation
  loses exact-match redaction (patterns still catch key prefixes). Accepted, documented in
  D4 — the JSONL durable record is fully redacted, and the default posture is air-gapped.

## Open Questions

- ~~Exact event shape/granularity (call-start only, or call-start + call-result; full
  arguments or a truncated summary) — architect's call.~~ **Resolved: call-start + call-result
  (`tool_call` / `tool_result`, D1); truncated display-only `inputSummary`, never full
  arguments; no output content on results.**

## Notes

> [!NOTE]
> Found 2026-07-16 while implementing DH-0065 (TUI visual polish) — the implementer correctly
> declined to guess at a contracts change from within a single domain and flagged it here
> instead, per Constitution §6.2.

> [!NOTE]
> **2026-07-16 — Core's piece (D1/D2/D3) done (Grace).** `ToolCallEvent`/`ToolResultEvent`
> added to `src/contracts/events.ts`; `src/agent/tool-summary.ts` (`summarizeToolInput`,
> `TOOL_INPUT_SUMMARY_MAX_CHARS`) implements the priority-key/fallback/truncation heuristic
> verbatim; `src/agent/loop.ts`'s `runToolCalls()` emits both events at the exact points D2
> specifies (including the unknown-tool-name error branch), no throttling per D3. Growing the
> `ServerSentEvent` union broke `src/tui/state.ts`'s and `src/web/client/state.ts`'s
> exhaustive switches over `event.type`; added a minimal no-op case to each (commented,
> pointing here) purely to keep `bun run typecheck` green — no rendering logic, D5 untouched.
> Gates: typecheck/lint clean, `bun run test:coverage` 1543 pass/0 fail with 100% lines on
> all new/changed files, `bun run e2e` 30 pass/2 fail (pre-existing headless-Chromium
> sandbox gap, unrelated). Full details in `docs/roster/grace.md`'s Round 17 entry.
>
> **Still open, not closed:** Server (Radia) — D4 redaction wrapper in `src/server/server.ts`.
> TUI (Mary) — D5: `KNOWN_TYPES` + real marker/pending-map/error-suffix/Agent-suppression
> logic in `src/tui/sse-parser.ts`/`state.ts`, replacing Grace's placeholder default case.
> Web (Susan) — D5: new `"tool"` turn kind, pending-map, `render.ts` `.turn-tool` row,
> replacing Grace's placeholder case in `state.ts`. E2E (Hedy) — D6 follow-up, sequenced last.

> [!NOTE]
> **2026-07-16 — Server's piece (D4) done (Radia).** Added `sanitizeEvent(event,
> knownSecrets)` to `src/server/redact.ts`: for `type === "tool_call"` returns a shallow
> copy with `inputSummary` passed through the existing `redactSecrets`; identity (same
> reference) for every other event type. Applied at both `agentLoop.onEvent` subscription
> sites in `src/server/server.ts` — the `EventBuffer` intake in `start()` and the live
> per-connection broadcast in the SSE stream's `start` callback — via a new
> `DhServer`-private `knownSecrets` field (reusing the same `options.knownSecrets` DH-0020
> already threads to `SessionLogger`, rather than adding a second config surface). No
> `EventBuffer` resize (D3 already ruled that out — untouched). Accepted residual risk from
> the design (Core's 200-char truncation happening before this redaction runs, so a secret
> straddling the truncation boundary can lose exact-match redaction) is left as documented,
> not fixed — pattern-based redaction still catches recognizable truncated prefixes. Gates:
> `bun run typecheck`/`bun run lint` clean, `bun run test:coverage` 1549 pass/0 fail with
> 100% line+function coverage on every changed file (`redact.ts`, `server.ts`, plus their
> test files — new tests cover a known-secret redaction and a pattern-only redaction on
> `tool_call`, both at the live-broadcast and buffered-replay paths, and identity
> pass-through for `agent_output`/`tool_result`). `bun run e2e`: 30 pass/2 fail, both
> pre-existing headless-Chromium sandbox gaps (`web.test.ts`/`connect-web.test.ts`),
> unrelated to this change — no `src/server/` e2e test regressed.
>
> **Still open, not closed:** TUI (Mary) and Web (Susan) — D5 client rendering. E2E (Hedy)
> — D6 follow-up, sequenced last.

> [!NOTE]
> **2026-07-17 — TUI's (Mary) and Web's (Susan) D5 client rendering done, in one pass.**
> Both clients now consume `tool_call`/`tool_result` per D5: a per-agent `pendingToolCall`
> (`{toolUseId, turnIndex}`) records the marker turn a `tool_call` appends
> (`"toolName: inputSummary"`), suppressing the marker entirely when `toolName === "Agent"`
> (DH-0065's spawn marker already covers it). The matching `tool_result` resolves the
> pending entry — marking the same turn `toolError: true` on failure, leaving it unchanged
> on success — or, when there's no matching pending entry (resume gap, or the suppressed
> `Agent` case), renders a standalone `"toolName ✗"` marker on failure and drops silently on
> success.
>
> TUI: `src/tui/sse-parser.ts`'s `KNOWN_TYPES` gained `tool_call`/`tool_result`;
> `src/tui/state.ts` replaced Grace's placeholder default case with real
> `handleToolCall`/`handleToolResult` handlers (plus an explicit `agent_thinking` case, since
> removing the blanket default made the switch require every variant named); `src/tui/types.ts`
> added `AgentInfo.pendingToolCall` and `Turn.toolError`; `src/tui/render.ts` appends a red
> `✗` after a `toolError` turn's last row rather than baking ANSI into `turn.text` (which
> `sanitizeText` would strip).
>
> Web: `src/web/client/state.ts` replaced the no-op `tool_call`/`tool_result` cases with the
> same handler pair (`AgentNode.pendingToolCall`, `Turn.toolError`); `src/web/client/render.ts`
> added a `buildToolTurnElement` branch — no "You"/"Agent" role label (unlike every other
> turn kind, per D5), just a muted `⚙` glyph + text, red on error; `src/web/client/styles.css`
> added `.turn-tool`/`.turn-tool-error`.
>
> Gates: `bun run typecheck` and `bun run lint` clean (lint's only remaining findings are
> pre-existing, unrelated to `src/`: `.claude/skills/forked-subagent/scripts/*`).
> `bun run test:coverage`: 2052 pass/0 fail, 100% coverage on every changed file except two
> pre-existing gaps this round didn't touch (`src/tui/state.ts:376`'s `model_switched`
> non-root branch, `src/web/client/render.ts:766-769`'s model-picker keydown handler).
> Replaced Grace's and Radia's placeholder "accepted without altering state" tests in both
> `state.test.ts` files with real assertions of the marker/pending/suppression/error-suffix
> behavior above.
>
> **Still open, not closed:** E2E (Hedy) — D6 follow-up, sequenced last (mock-provider
> `tool_use` turn → assert TUI shows a `⚙ Bash:` marker and Web grows a `.turn-tool` row).
