---
spile: ticket
id: DH-0010
type: feature
status: ready
owner: stefan
resolution:
blocked_by: []
created: 2026-07-15
relations:
  depends_on: []
  relates_to: [DH-0043]
  supersedes: []
implementation:
  - repo: dark-harness
---

# DH-0010: No context-window compaction/token-budget handling, and no prompt caching (`cache_control`)

## Summary

`runAgentLoop`'s `messages: ProviderMessage[]` grows every turn with no cap, summarization, or
windowing, and nothing reads the model's context-length limit — a long interactive session or a
turn-heavy dark-factory job will eventually exceed the context window and get a hard, uncaught
provider error rather than a graceful compaction. Separately, neither provider adapter ever sets
`cache_control` (Anthropic) or Bedrock's equivalent cache points on the system prompt / tool
definitions / stable message prefix, despite resending the same system prompt and growing history
on every turn — one of the largest cost levers for an agentic loop is unused.

## User Stories

### As an operator running a long unattended session, I want the harness to compact history before hitting the model's context limit, not crash

- Given a conversation approaching the model's context window, when the loop detects this, then it
  summarizes/prunes older turns (or fails with a clear, actionable message) rather than letting the
  provider reject the request uncaught.

### As an operator paying for tokens, I want the harness to use prompt caching where the provider supports it

- Given a system prompt + tool definitions that don't change turn to turn, when a request is sent,
  then cache breakpoints are marked so the provider can serve cached tokens at a reduced rate.

### As an operator, I want to explicitly enable or disable context-window compaction via config

- Given `dh.json`, when a `compaction: { enabled: boolean }`-shaped setting (implementer's call on
  exact field name/shape, consistent with existing config conventions) is set, then compaction only
  runs if explicitly enabled — the owner wants this as an explicit on/off switch, not an
  always-on background behavior with no opt-out.

## Design (architect pass — Fable, 2026-07-15)

Two separable parts. **Part A (prompt caching) ships first as its own implementation round** —
pure win, zero behavior change with the flag off, no new failure modes. **Part B (compaction) is
a second, independent round.** Both are Core (Grace): `src/agent/loop.ts`, both provider
adapters, `src/config/validate.ts`. The contracts edits specified below (`src/contracts/config.ts`,
`events.ts`, `log.ts`) are architect-approved by this design per CLAUDE.md §6.2 — all additive,
all optional fields, wire version stays 1.

### Part A — Prompt caching

**Opt-in knob: `ModelConfig.cache?: boolean`, default `false`.** Per-model, not per-provider:
Bedrock cache-point support varies by model (Anthropic Claude 3.5+-on-Bedrock, Amazon Nova, a
few others — unsupported models throw `ValidationException`), and anthropic-type support varies
by endpoint (a `baseURL`-pointed Anthropic-compatible local server may reject or ignore unknown
`cache_control` fields). A per-model boolean covers both axes with one flag and no capability
auto-detection. Default off keeps every existing config byte-identical in behavior; enabling is
one line.

**Plumbing:** `ProviderCompletionRequest` (src/agent/providers/types.ts — Core-internal, not
contracts) gains `cache?: boolean`; `runtime.ts` threads `ModelConfig.cache` into a new optional
`AgentLoopParams.cache`; `loop.ts` passes it through on every `provider.complete()` call. When
false/absent, adapters emit requests byte-identical to today.

**Anthropic breakpoints — spend 3 of the 4 budget:**

1. **System prompt block** — switch `system` from string to
   `[{ type: "text", text, cache_control: { type: "ephemeral" } }]`. Anthropic's cache prefix
   order is tools → system → messages, so this single breakpoint caches the tool definitions
   *and* the system prompt together; a separate breakpoint on the last tool buys nothing since
   tools and system are both fixed for the life of a session. This prefix is shared across every
   agent in a session using the same model + toolset.
2. **Last content block of the final message** — the standard sliding breakpoint; each turn
   writes only the new suffix and reads the whole prior conversation from cache.
3. **Last content block of the second-to-last user message** — insurance for Anthropic's
   ~20-block prefix-lookback when a single turn appends many blocks (large multi-tool_result
   turns), so the previous turn's cache entry is still found.

Fourth breakpoint held in reserve. Prefixes under the provider's minimum cacheable length
(1024 tokens for most models) simply don't cache — no special handling needed.

**Bedrock equivalent:** Converse's `{ cachePoint: { type: "default" } }` content block, at the
same three positions — appended after the system text block in `system: [...]`, and as trailing
content blocks at the two message positions above. (It is also legal inside `toolConfig.tools`;
not needed, same reasoning as Anthropic.) Support is model/region-gated on AWS's side — that is
exactly what the per-model `cache` flag gates. Optional hardening, implementer's choice, not
required: on a `ValidationException` mentioning cachePoint, strip cache points and retry once
with a one-time stderr warning.

**Accounting — mostly pre-wired, three real fixes ride along in this round:**

- Already done (verified): both adapters parse `cache_read_input_tokens`/
  `cache_creation_input_tokens` (Bedrock: `cacheReadInputTokens`/`cacheWriteInputTokens`) into
  `ProviderUsage.cacheReadTokens`/`cacheWriteTokens`, and `loop.ts` already writes them into the
  JSONL `token_usage` line (fields exist in `src/contracts/log.ts`). Once markers are sent, real
  values flow to the logs with zero further changes.
- **Fix 1 — cost:** `computeCostUsd` (loop.ts) ignores cache tokens, and both providers'
  `input_tokens` *excludes* cache-read/creation tokens — so with caching on, cost would be
  silently undercounted. Add optional `ModelConfig.cacheReadPricePerMToken` /
  `cacheWritePricePerMToken`; when unset but `inputPricePerMToken` is set, default to **0.1× /
  1.25× of the input price** (the published multiplier on both Anthropic and Bedrock — a
  multiplier default, not a hardcoded price table; the base price still comes from config,
  honoring ModelConfig's own stated rule).
- **Fix 2 — SSE:** `TokenUsageEvent` (src/contracts/events.ts) gains optional
  `cacheReadTokens?`/`cacheWriteTokens?` mirroring the log line, so Web/TUI readers don't see
  inputTokens inexplicably collapse when caching kicks in. Additive; existing clients ignore
  unknown fields; actually *displaying* them in TUI/Web is a separate follow-up ticket if wanted.
- **Fix 3 — budgets:** DH-0013's `maxTotalTokens` accumulator must count
  `input + output + cacheRead + cacheWrite`, else caching silently inflates the budget's
  effective size.

### Part B — Context-window compaction

**Config — top-level block (the `limits` precedent from DH-0012), default absent = disabled,
exactly the explicit opt-in the owner asked for:**

```json
"compaction": { "enabled": true, "thresholdPercent": 80 }
```

`enabled: boolean` (required when the block is present); `thresholdPercent` optional integer
1–99, default 80. Plus **`ModelConfig.contextWindow?: number`** (tokens) — per-model config, no
hardcoded model→window table, same rationale as pricing. Validation: `compaction.enabled: true`
requires every configured model to declare `contextWindow` — fail fast at config load (same
spirit as the defaultModel referential check), not at hour three of a run.

**Trigger:** no client-side tokenizer (none exists for Bedrock/local models; chars÷4 is noise).
Use the provider's own usage report from the previous completion:
`contextTokens ≈ inputTokens + cacheReadTokens + cacheWriteTokens + outputTokens`. At the top of
each turn, before the provider call: if `contextTokens ≥ contextWindow × thresholdPercent/100`,
compact. The first turn can't trigger (no usage yet) — fine; a single oversized tool result
landing between checks is caught by the overflow-error safety net below.

**Strategy: summarization, not truncation.** The primary use case is hours-long unattended
dark-factory runs; dropping the oldest turns silently deletes exactly the instructions and
decisions the agent needs to not repeat work — this ticket's own original risk. Mechanics:

1. One extra `provider.complete()` call — same model/provider, **no tools** — with the current
   history plus a final user message requesting a structured summary (original task, decisions
   made and why, current state, files touched, work remaining). With Part A live this call
   mostly reads cache, so it's cheap; without it, it costs one near-threshold input pass —
   another reason caching ships first.
2. Rebuild `messages` as: `[ user: original instruction verbatim + "[History compacted —
   summary of prior work follows]" + summary, ...tail ]`, where the tail is the most recent
   messages **starting at an assistant-message boundary** — never at a user tool_result message,
   which would orphan its tool_use pairing and be rejected by both providers; starting at an
   assistant message also keeps user/assistant alternation valid. Tail size is an implementer
   constant (suggest ~2 exchanges / 4 messages).
3. Compact at most once per trigger — if the very next call still overflows, fail cleanly via
   the safety net below rather than compaction-looping.
4. Emit a new JSONL log line `{ type: "compaction", preTokens, droppedMessages,
   retainedMessages, summaryChars }` (additive `LogLine` variant in src/contracts/log.ts,
   approved here — diagnostics-critical for post-hoc "why did the agent forget X"). No SSE event
   in round 1.
5. Applies identically in interactive and non-interactive mode; only the `messages` array is
   rewritten — the SendMessage pending-queue/waiting machinery is untouched.
6. A summarization-call failure propagates like any provider error (it already passes through
   the adapter's withRetry); no half-compacted state is ever left behind.

**Disabled-but-hit (and enabled-but-still-overflowing) behavior:** adapters classify
context-overflow responses (Anthropic: 400 `invalid_request_error` "prompt is too long";
Bedrock: `ValidationException` "Input is too long") as a new `ProviderErrorKind`
`"context_overflow"`, non-retryable (types.ts is Core-internal). `loop.ts` catches that kind and
reports a normal agent failure with an actionable reason — "context window exceeded; enable
compaction (`compaction.enabled` in dh.json) or reduce task scope" — status `failed`, exit-code 1
semantics, never an uncaught crash. This one net covers both the disabled case and the
pathological enabled case (e.g. one tool result bigger than the window).

**Cache interaction:** compaction rewrites the message prefix and invalidates the message-side
cache (the tools+system breakpoint survives). Expected, rare — once per ~threshold-fill —
acceptable.

## Functional Requirements

- Given `ModelConfig.cache: true` on an anthropic-type model, when any completion request is
  sent, then `cache_control: { type: "ephemeral" }` markers are present at the three positions
  above, and subsequent turns report nonzero `cacheReadTokens` in the JSONL `token_usage` line
  and SSE event against a real caching provider.
- Given `ModelConfig.cache: true` on a bedrock-type model, when any completion request is sent,
  then `cachePoint` blocks are present at the equivalent positions.
- Given `cache` unset/false, when requests are sent, then they are byte-identical to current
  behavior (no marker fields at all).
- Given caching is producing cache reads/writes and pricing is configured, when `costUsd` is
  computed, then it includes cache-read tokens at `cacheReadPricePerMToken` (default 0.1× input
  price) and cache-write tokens at `cacheWritePricePerMToken` (default 1.25× input price).
- Given `compaction.enabled: true` and the previous turn's reported context tokens at or above
  `thresholdPercent` of the model's `contextWindow`, when the next turn starts, then history is
  summarized and rebuilt per the strategy above and a `compaction` log line is emitted.
- Given `compaction.enabled: true` and any configured model missing `contextWindow`, when config
  loads, then a `ConfigError` names the model and the missing field.
- Given compaction disabled (or a post-compaction request still too large), when the provider
  rejects for context overflow, then the agent fails with the actionable reason string above —
  never an uncaught provider exception.

## Assumptions

- Provider caching support is heterogeneous; the per-model `cache: boolean` opt-in is the
  capability gate — no runtime auto-detection in round 1.
- The provider's own per-turn usage report is an adequate proxy for next-request context size;
  no client-side tokenizer is introduced.
- Context-window sizes come from config (`ModelConfig.contextWindow`), never a hardcoded
  model table — same rule as pricing.

## Risks

- Summarization is lossy by construction — mitigated (not eliminated) by keeping the original
  instruction verbatim, a structured summary, and a verbatim recency tail; the `compaction` log
  line makes any information loss diagnosable post-hoc. Accepted per this design; further
  relitigation goes back to the architect.
- Context-overflow error detection is string/shape-matching on provider errors and can drift
  with provider SDK/API changes; the failure mode is graceful (falls back to the generic
  provider-error path), not a crash.
- The 0.1×/1.25× cache-price default multipliers could diverge from a provider's future
  pricing; both are config-overridable per model.

## Notes

> [!NOTE]
> Source: Core domain sweep finding #2 (no compaction) and Competitive-differentiation sweep
> findings #1 (compaction) and #2 (prompt caching) — independently identified by both sweeps as one
> of the highest-impact gaps for the primary "hours-long unattended" use case and its cost profile.

> [!NOTE]
> Owner decision (2026-07-15): queue both compaction and caching now. **DH-0043 closed as
> superseded by this ticket** (it was a strict subset — prompt caching only — filed
> independently by a different sweep pass). Compaction specifically is a lossy,
> behavior-changing design decision (per this ticket's own Risks section) — routed to
> architect (Fable) for a design pass before implementation, per CLAUDE.md §6.1. Caching
> (cache_control/cache points) is a pure win with no behavior change and could ship
> independently/sooner if the architect's design separates the two cleanly.

> [!NOTE]
> Architect design pass complete (Fable, 2026-07-15) — see the Design section above. The two
> parts separate cleanly: dispatch Part A (caching) and Part B (compaction) to Core as two
> independent implementation rounds, Part A first. Contracts edits listed in the Design section
> are pre-approved; anything beyond them returns to the architect.
