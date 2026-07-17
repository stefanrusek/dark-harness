---
spile: ticket
id: DH-0045
type: feature
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

# DH-0045: No extended-thinking (interleaved/extended thinking blocks) support

## Summary

`ProviderContentBlock` (`src/agent/providers/types.ts`) only models `text`/`tool_use`/
`tool_result` variants — there is no `thinking`/`redacted_thinking` block type, and the Anthropic
adapter never requests thinking. Extended thinking is a meaningful quality lever for complex
coding tasks on Claude models and is entirely absent from the harness today. Worse than merely
absent: `fromAnthropicContent()` returns `null` for unknown block types, so if a provider ever
returned thinking blocks they would be silently dropped from the echoed history — which the
Anthropic API rejects on the next turn of a tool-use conversation.

## User Stories

### As an operator running complex coding tasks, I want the option to enable extended thinking for models that support it

- Given a model/provider that supports extended thinking, when configured, then the harness can
  request it, and thinking content is represented end-to-end (types, provider mapping, log/display
  handling) rather than being unsupported.

## Design (architect pass — Fable, 2026-07-15)

### 0. API-drift correction to this ticket's premise

The shape `thinking: {type: "enabled", budget_tokens: N}` named in the original summary is the
**legacy** form: it still works on pre-4.6 Claude models, is deprecated on Opus/Sonnet 4.6, and is
**rejected with a 400** on Opus 4.7/4.8, Sonnet 5, and Fable 5, where the on-mode is
`thinking: {type: "adaptive"}` (no token budget; optional `display: "summarized" | "omitted"`).
Both forms therefore must be expressible in config — dh targets arbitrary Anthropic-compatible
endpoints and cannot know which family a configured model belongs to. dh does no capability
gating: a wrong form for the model surfaces as the provider's own 400, classified `other`/
non-retryable by the DH-0009 error taxonomy, which is the correct failure mode.

### 1. `ProviderContentBlock` extension (`src/agent/providers/types.ts` — Core-internal)

Two new variants, mirroring the Anthropic wire shape (verified against the installed
`@anthropic-ai/sdk` `ThinkingBlock`/`RedactedThinkingBlock` types):

```ts
export type ProviderContentBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | { type: "tool_result"; toolUseId: string; content: string; isError?: boolean }
  | { type: "thinking"; thinking: string; signature: string }
  | { type: "redacted_thinking"; data: string };
```

- `signature` is the model-issued verification token; it must be echoed back **unmodified**.
- `data` is opaque base64 ciphertext. It is never decoded, never displayed, and never leaves the
  in-memory message history (see §6) — it exists solely so multi-turn echo works.

`ProviderCompletionRequest` gains `thinking?: ThinkingConfig` (camelCase internal mirror of the
config knob in §2).

### 2. Config knob (`src/contracts/config.ts` — contracts change, approved by this design pass)

```ts
/** DH-0045: opt-in extended thinking for a model. Absent = off (no thinking parameter is sent
 * to the provider at all — today's behavior, matching this project's default-off pattern for
 * new capability knobs; see LimitsConfig / LogRetentionConfig). */
export interface ThinkingConfig {
  /** "adaptive" — Claude 4.6+ family form; budgetTokens must be absent.
   *  "enabled"  — legacy fixed-budget form for pre-4.6 models; budgetTokens required. */
  type: "adaptive" | "enabled";
  /** Required iff type === "enabled". Integer, >= 1024 (API minimum). */
  budgetTokens?: number;
  /** Optional visibility control, passed through verbatim. "omitted" still returns (empty)
   * thinking blocks with signatures for multi-turn continuity. */
  display?: "summarized" | "omitted";
}
```

`ModelConfig` gains `thinking?: ThinkingConfig`. Validation rules (src/config/, Core):

- `type` must be `"adaptive"` or `"enabled"`.
- `type: "enabled"` → `budgetTokens` required, integer, >= 1024.
- `type: "adaptive"` → `budgetTokens` must be absent.
- `display`, when present, must be `"summarized"` or `"omitted"`.
- No provider-type restriction — the knob is valid on both `anthropic` and `bedrock` models
  (Bedrock supports it; see §4).

### 3. Anthropic adapter (`src/agent/providers/anthropic.ts`)

**Request.** When `request.thinking` is set, add to `messages.create` params:

- adaptive: `thinking: { type: "adaptive", ...(display ? { display } : {}) }`
- enabled: `thinking: { type: "enabled", budget_tokens: budgetTokens, ...(display ? { display } : {}) }`

For the `enabled` form the API requires `budget_tokens < max_tokens`. Guarantee: effective
`max_tokens = max(request.maxTokens ?? DEFAULT_MAX_TOKENS, budgetTokens + DEFAULT_MAX_TOKENS)` —
the thinking budget never cannibalizes the response budget, deterministically and without a new
config knob. (Adaptive form: no change to max_tokens handling.)

**Response.** Extend `fromAnthropicContent()` to map `thinking` → `{type:"thinking", thinking,
signature}` and `redacted_thinking` → `{type:"redacted_thinking", data}` instead of dropping
them (`return null`). Array order is preserved by the existing `.map()` — thinking blocks arrive
before/interleaved with `text`/`tool_use` and stay in that order.

**Echo.** Extend `toAnthropicContent()` with the two new cases, emitting the blocks verbatim
(`signature`/`data` unmodified). This is what satisfies Anthropic's multi-turn requirement that
thinking blocks be preserved in the assistant turns of tool-use conversations.

### 4. Bedrock (`src/agent/providers/bedrock.ts`) — supported, mapped

Claude-on-Bedrock via `ConverseCommand` **does** support extended thinking (verified against the
installed `@aws-sdk/client-bedrock-runtime` types):

- **Request:** Converse has no first-class thinking field; the documented Anthropic-on-Bedrock
  mechanism is passthrough: `additionalModelRequestFields: { thinking: <same snake_case wire
  shape as §3> }`. Set it when `request.thinking` is present. Same `max_tokens` note as §3 does
  not apply (this adapter doesn't set an output cap today; the model default governs — if that
  proves to reject `budget_tokens`, follow-up sets `inferenceConfig.maxTokens` the same way §3
  does).
- **Response:** `ContentBlock.reasoningContent` is a union:
  `{ reasoningText: { text, signature? } }` → `{type:"thinking", thinking: text, signature:
  signature ?? ""}`; `{ redactedContent: Uint8Array }` → base64-encode →
  `{type:"redacted_thinking", data}`. Map both in `fromBedrockContent()` (which currently
  returns `null` for them).
- **Echo:** reverse mapping in `toBedrockContent()` — `thinking` → `reasoningContent.
  reasoningText` (include `signature` only when non-empty), `redacted_thinking` → base64-decode
  → `reasoningContent.redactedContent`.
- A non-Claude Bedrock model that rejects the passthrough fails with the provider's own
  validation error (`other`/non-retryable per DH-0009) — acceptable and symmetric with the
  Anthropic-side wrong-form case in §0. No dh-side capability table.

### 5. Agent loop (`src/agent/loop.ts`, `runtime.ts`) — minimal

- Thread `ModelConfig.thinking` → `AgentRuntime` → new `AgentLoopParams.thinking` → the
  `provider.complete()` request. (Same pattern as `pricing` / `providerModel`.)
- **No history-reconstruction changes:** the loop already pushes `completion.content` verbatim
  into `messages`, so once the adapters map the blocks both ways, multi-turn echo is automatic.
- After each completion, walk `completion.content` in order: for each `thinking` block with
  non-empty text, emit SSE `agent_thinking` + JSONL `thinking` (§6); for each
  `redacted_thinking`, emit both with `redacted: true` and **empty content** — ciphertext never
  enters the SSE stream or the JSONL log. Empty-text thinking blocks (`display: "omitted"`)
  emit nothing.
- `textOf()` / `finalText` / the `TASK_FAILED` scan are untouched — thinking is never part of
  `finalOutput` and never contributes to the self-report convention.

### 6. SSE + JSONL representation (contracts change, approved by this design pass)

**Decision: a new SSE event type, not a `blockType` discriminator on `agent_output`.**
`agent_output.chunk` feeds the transcript/finalText paths in both clients; overloading it would
make any unaware client render the model's private reasoning as answer text. A distinct type
degrades to *invisible* on an unaware client rather than to *wrong*.

`src/contracts/events.ts`:

```ts
export interface AgentThinkingEvent extends SseEventBase {
  type: "agent_thinking";
  agentId: string;
  /** Thinking text; empty string when redacted. Never ciphertext. */
  chunk: string;
  /** Present and true for redacted_thinking blocks — client renders a placeholder. */
  redacted?: true;
}
```

Added to the `ServerSentEvent` union. Additive; `version` stays 1. TUI and Web SSE parsers must
ignore unknown event types (verify/harden as part of their tasks — required for forward
compatibility generally, not just here).

`src/contracts/log.ts` — new `LogEvent` variant (not a `message` role: reasoning is not part of
the message record):

```ts
export interface LogThinkingEvent extends LogEventBase {
  type: "thinking";
  /** Thinking text; empty string when redacted. Ciphertext is never logged. */
  content: string;
  redacted: boolean;
}
```

Additive per the ADR 0004/0005 pattern — readers of older files see nothing new; readers of new
files must tolerate the new line type. No header/version bump.

### 7. Client display

**TUI (`src/tui/`):** transcript `Turn` gains kind `"thinking"`. Render always-inline (the TUI
has no collapse affordance) but visually distinct: dim/gray ANSI (`\x1b[2m` or `\x1b[90m`,
reset-terminated per the existing SGR allowlist discipline), a `✻ thinking` label line, body as
plain text (`sanitizeText` + `wrapText` — **not** the Markdown path; reasoning is not authored
for presentation). `redacted: true` renders a single dim line: `✻ [redacted thinking]`.

**Web (`src/web/`):** transcript turn kind `"thinking"`, rendered as a `<details
class="turn turn-thinking">` **collapsed by default** with `<summary>Thinking</summary>` and a
dimmed/italic body set via `textContent` (plain text, not `markdown-dom`). Streaming append path
re-renders the open turn the same way `appendTranscript` already does. `redacted` renders a
non-collapsible placeholder div: `[redacted thinking]`. Ciphertext never reaches the client
(§5/§6), so there is nothing to accidentally display.

### 8. Domain assignment and sequencing

| # | Domain | Work | Depends on |
| --- | --- | --- | --- |
| 1 | **Core (Grace)** | Contracts edits (`config.ts`, `events.ts`, `log.ts` — pre-approved by this design pass, §2/§6), `providers/types.ts`, both adapters (§3/§4), config validation (§2), runtime/loop threading + emission (§5). Coverage must include: both adapters' request shapes (adaptive/enabled/display), response mapping, echo round-trips (signature/data byte-identical), redaction never reaching SSE/log, empty-text suppression. | — |
| 2 | **Server (Radia)** | Expected near-no-op: the server relays typed `ServerSentEvent`s. Verify EventBuffer/replay/Last-Event-ID handle `agent_thinking` untouched; add coverage. | 1 |
| 3 | **TUI (Mary)** | §7 TUI display + ignore-unknown-SSE-types hardening. | 1 |
| 3 | **Web (Susan)** | §7 Web display + ignore-unknown-SSE-types hardening. Parallel with TUI. | 1 |
| 4 | **Prompt (Iris)** | README: document `ModelConfig.thinking` (adaptive vs enabled per model family, default off). No system-prompt change — thinking is provider-level and invisible to prompting. | 1 |
| 5 | **E2E (Hedy)** | Mock provider emits `thinking` + `redacted_thinking` blocks; assert TUI dim rendering, Web collapsed `<details>`, JSONL `thinking` lines (no ciphertext), and that follow-up request bodies received by the mock echo the blocks verbatim. | 1–3 |

## Notes

> [!NOTE]
> Source: Competitive-differentiation sweep finding #9.

> [!NOTE]
> Owner decision (2026-07-15): queue now — real quality lever, not speculative. New content-
> block type/config knob/client display needs an architect design pass before implementation.

> [!NOTE]
> Architect design pass complete (2026-07-15, Fable). Contracts changes in §2/§6 carry
> architect sign-off per CLAUDE.md §6 trigger #2 — Core may land them without a second review
> round, provided the shapes match this ticket.

> [!NOTE]
> Core (Grace) implementation complete (2026-07-16). Landed: `ThinkingConfig`
> (`src/contracts/config.ts`) + `ModelConfig.thinking`, config validation
> (`src/config/validate.ts`), `ProviderContentBlock` `thinking`/`redacted_thinking` variants
> and `ProviderCompletionRequest.thinking` (`src/agent/providers/types.ts`), both adapters'
> request/response/echo mapping (`anthropic.ts`, `bedrock.ts`) — this also fixes the real
> silent-drop bug (`fromAnthropicContent()`/`fromBedrockContent()` previously returned `null`
> for these block types), `loop.ts`/`runtime.ts` threading + post-turn SSE `agent_thinking` /
> JSONL `thinking` emission per §5, and `AgentThinkingEvent`/`LogThinkingEvent`
> (`src/contracts/events.ts`, `log.ts`) per §6. `bun run typecheck`, `bun run lint`, and
> `bun run test:coverage` all pass clean (1995 tests, 100% coverage on every touched file
> except one pre-existing uncovered line in `loop.ts` unrelated to this change). TUI/Web/
> Prompt/E2E work (§8 rows 2-5) remains for their respective domain owners. Status →
> verifying.
