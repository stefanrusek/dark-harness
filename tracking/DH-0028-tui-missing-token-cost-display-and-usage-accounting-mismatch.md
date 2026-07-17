---
spile: ticket
id: DH-0028
type: bug
status: closed
owner: stefan
resolution: done
blocked_by: []
created: 2026-07-15
relations:
  depends_on: []
  relates_to: []
  supersedes: []
implementation:
  - repo: dark-harness
---

# DH-0028: TUI never displays token/cost data it already tracks, and TUI vs. Web disagree on whether `token_usage` is a delta or a running total

## Summary

`AgentInfo` in the TUI (`src/tui/types.ts`) tracks `inputTokens`/`outputTokens`/`costUsd` per
agent, incrementally updated, but no view in `src/tui/render.ts` (`renderRoot`, `renderTree`,
`renderAgent`) ever renders them, and there is no session-total anywhere in the TUI — the operator
flying a console session has zero visibility into token spend/cost, while the Web UI shows it
prominently (HANDOFF §9 requires token+cost display; §8's TUI spec doesn't explicitly require it,
but the state model was clearly plumbed with the evident intent to display it). Separately, and
more seriously: the Web client's `sessionTotals`/per-agent `costUsd` treats `TokenUsageEvent` as an
always-incremental delta to be summed, while the TUI's `token_usage` handler *replaces* the value
each time rather than accumulating — at most one of these can be correct against the real wire
semantics. If the server emits running totals, Web's numbers are silently inflated (double-
summing); if it emits deltas, TUI's numbers are wrong (only ever reflect the last event). This is
exactly the "two domains guessing differently" case that should route to the architect rather than
being resolved unilaterally by either domain.

## User Stories

### As an operator using the console TUI, I want to see token/cost spend the same way the web UI shows it

- Given a running session, when viewing the TUI's agent view (and ideally the header), then
  per-agent and session-total token/cost figures are visible, matching the Web UI's existing
  display.

### As a maintainer, I want TUI and Web to agree on whether `token_usage` events carry deltas or running totals

- Given the `TokenUsageEvent` wire contract, when clarified, then both clients implement the same
  (correct) accumulation semantics, and the ambiguity is resolved in `src/contracts/`, not left to
  each client's guess.

## Functional Requirements

- **Resolved by reading the code directly (2026-07-15), no architect pass needed:**
  `src/agent/loop.ts` emits one `token_usage` event per provider completion call (i.e. once
  per turn), with `inputTokens`/`outputTokens` sourced directly from the provider SDK's
  per-request `usage` field (`response.usage.input_tokens`/`output_tokens` in
  `src/agent/providers/anthropic.ts`, equivalent in `bedrock.ts`) — this is a **per-turn
  delta**, not a running total; the Anthropic/Bedrock API's own `usage` field never reflects
  conversation-wide cumulative counts. Web's client (`src/web/client/state.ts`) already sums
  these deltas correctly. **The TUI's handler is the actual bug** — it replaces
  `AgentInfo.inputTokens`/`outputTokens`/`costUsd` on each event instead of accumulating.
  Fix: TUI's `token_usage` handler must add (not replace) into the running per-agent totals,
  matching Web's existing (correct) behavior.
- No `src/contracts/` change needed — `TokenUsageEvent`'s shape is fine as-is; only its
  doc comment should gain a one-line clarification that the fields are per-event deltas, to
  prevent this exact bug recurring. This does NOT need Fable/architect sign-off per CLAUDE.md
  §6.2 since it's a doc-comment clarification, not a schema/shape change.
- Once TUI accumulates correctly, render both per-agent and session-total token/cost figures
  in `src/tui/render.ts`, matching the Web UI's existing display (per the ticket's first user
  story).

## Notes

> [!NOTE]
> Source: TUI/Web domain sweep findings #28 and #29. Finding #29 was originally flagged by the
> sweep as warranting an architect decision (CLAUDE.md §6.5), but on inspection the wire
> semantics are unambiguous from the existing provider-adapter code — no live disagreement
> requiring arbitration, just a straightforward TUI bug (replace instead of accumulate). Owner
> confirmed no further input needed; ticket is ready to implement directly.

> [!NOTE]
> **Fable, 2026-07-16 — architect design pass, confirming existing decision.** Re-invoked per
> CLAUDE.md §6 (coordinator flagged the delta-vs-total question as needing an architect
> sign-off before implementation could be considered safe to close out). On inspection, both
> the design decision above and its implementation are already in place and correct — there
> is no open design question left to settle, so this note records the confirmation rather
> than a new decision:
>
> - **Semantics**: `TokenUsageEvent` (`src/contracts/events.ts`) is a per-turn delta — one
>   event per provider completion call, sourced from that call's own `usage` field — never a
>   running total. Both clients sum. `events.ts`'s doc comment already states this explicitly
>   on `inputTokens`/`outputTokens`/`costUsd`, citing DH-0028, so the ambiguity is resolved in
>   the contract itself, not left to each client's guess (closes the maintainer user story).
> - **TUI accumulation**: `src/tui/state.ts`'s `token_usage` case (~line 283) adds into
>   `existing.inputTokens`/`outputTokens`/`costUsd` instead of replacing, matching Web's
>   `state.ts` (`node.inputTokens += event.inputTokens`, etc., ~line 386). Both track "cost
>   unknown" (no model pricing configured) as a tri-state distinct from "$0" — TUI via
>   `costUsd: number | null` populated lazily, Web via an explicit `hasCost` flag — same
>   semantics, different but equally correct encodings for each client's existing state
>   shape.
> - **Display — both per-agent and session-total, in both clients**: `src/tui/render.ts` now
>   renders per-agent token/cost in the tree view (`formatTokenCost(..., "compact")`) and the
>   agent detail view (`"full"`), plus a session-wide total in the always-visible header via
>   `sessionTokenTotals()` — the TUI-equivalent of Web's `sessionTotals()`. This closes the
>   operator user story: TUI now shows what Web already showed.
> - **Formatting is consistent with DH-0104, not a competing convention**: cost uses the
>   shared `formatCostUsd` (2-dp, `<$0.01` floor, `—` for unknown) from `src/format.ts` in
>   both clients. Tokens follow DH-0104's two-tier context-class rule: compact (`12.3k`) in
>   glanceable chrome (TUI tree rows, header strip; Web badges/strips) via
>   `formatTokenCountCompact`, full comma form (`12,345`) in detail contexts (TUI agent
>   view) via `formatTokenCountFull`. This ticket introduces no new formatting logic — it
>   consumes DH-0104's shared formatters exactly as prescribed.
> - **Test coverage**: `src/tui/state.test.ts`'s "reducer: sse_event token_usage" suite
>   exercises accumulation across multiple events, `costUsd` staying `null` when no event
>   ever carries one, and the tri-state cost behavior once a cost figure does arrive.
>
> No unresolved design question remains. Status stays `ready` (implementation already matches
> spec); whether to move it forward to `closed` is a verification call for the ticket's owner,
> not part of this design pass.
