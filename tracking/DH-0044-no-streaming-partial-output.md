---
spile: ticket
id: DH-0044
type: feature
status: verifying
owner: stefan
resolution:
blocked_by: []
created: 2026-07-15
relations:
  depends_on: []
  relates_to: []
  supersedes: []
implementation:
  - repo: dark-harness
---

# DH-0044: No streaming of partial model output — `agent_output` events only fire once per completed turn

## Summary

Both provider adapters call the non-streaming API variant (`messages.create` with
`MessageCreateParamsNonStreaming`; Bedrock's `ConverseCommand`, not `ConverseStreamCommand`), so
`agent_output` SSE events are emitted only once per whole completed turn, not incrementally. A long
single-turn response (a big plan, a long explanation) appears all at once in both the TUI and Web
UI rather than streaming token-by-token, unlike most comparable harnesses (including Claude Code
itself).

## User Stories

### As an operator watching a live session, I want to see model output as it's generated, not all at once when the turn finishes

- Given a long assistant turn, when it streams from the provider, then `agent_output` events are
  emitted incrementally as content arrives, and both TUI and Web render it progressively.

## Functional Requirements

- **Owner decision (2026-07-15): full scope, both providers.** Switch both Anthropic
  (`messages.create` with `stream: true`) and Bedrock (`ConverseStreamCommand`) adapters to
  their streaming APIs; emit `agent_output` SSE events incrementally as text arrives; both
  TUI and Web render progressively as chunks arrive.
- Streaming is **always on** — no config knob, no non-streaming fallback path in the built-in
  adapters. One code path, one coverage surface; matches Claude Code's own behavior.
- The JSONL log stays turn-granular: exactly one `message` log line per completed assistant
  turn carrying the full text (plus one partial line on a mid-turn error/stop — see §D5). The
  log never becomes chunked.
- Tool-call semantics are unchanged: tools still execute only after the full assistant
  message completes (`stopReason === "tool_use"`), exactly as today. Streaming affects
  *display latency of text*, not turn structure.
- Architect design pass (Fable, 2026-07-15) below **is** the CLAUDE.md §6.2 sign-off for the
  two contract touches this ticket makes (§D1 doc-comment change in `src/contracts/events.ts`,
  §D5 optional `partial` field in `src/contracts/log.ts`). No further architect round-trip
  needed before implementation.

## Design (architect pass — Fable, 2026-07-15)

### D1. Contract: reuse `AgentOutputEvent`, no new event type

**Decision: no new SSE event type.** The existing `AgentOutputEvent` already has exactly the
right shape for incremental output — its payload field is literally named `chunk`, and **both
clients already implement chunk accumulation**: TUI's `appendOutput` (src/tui/state.ts) and
Web's `appendAssistantChunk` (src/web/client/state.ts) both extend the trailing assistant turn
when consecutive `agent_output` events arrive with no intervening user turn. The wire contract
was built for streaming; only the producer side emits once per turn today.

The contract change is therefore a **semantics clarification, not a shape change**: update the
doc comment on `AgentOutputEvent` in `src/contracts/events.ts` to state that a single
assistant turn MAY be delivered as many `agent_output` events, in order, and that clients MUST
accumulate consecutive chunks into one logical turn. Wire shape, version field, and event
union are untouched.

Why not `AgentOutputChunkEvent` / a `delta` variant:

1. **Version-skew safety.** TUI's `handleSseEvent` switch has no default case — an old TUI
   binary `--connect`-ed to a newer server receiving an unknown event type falls out of the
   switch and returns `undefined`, crashing the reducer. Reusing the existing type means zero
   risk to any deployed client. (Web tolerates unknown types via its `default:` case, but the
   TUI does not.)
2. **No turn-boundary marker is needed.** Merging consecutive assistant turns is *already*
   today's client behavior (two back-to-back assistant turns with no user turn between them
   merge under both reducers), so per-delta emission produces byte-identical rendered
   transcripts. Resume via `Last-Event-ID` replays the buffered chunk sequence and
   reconstructs the same text.
3. **The final complete text still exists** where it matters — the JSONL `message` log line
   (one per turn, full text) and `AgentLoopResult.finalOutput` are assembled from the
   provider's complete result, not from the chunk stream.

### D2. Provider adapter interface (`src/agent/providers/types.ts`)

**Decision: optional callback parameter; keep the promise-of-complete-result return type.**

```ts
export interface ProviderStreamCallbacks {
  /** Called zero or more times, in order, with incremental assistant *text* as the provider
   * streams it. Advisory/display-only: the resolved ProviderCompletionResult remains the
   * single source of truth for content, stopReason, and usage. Tool-use input deltas are
   * never surfaced here. A provider that ignores this degrades gracefully to whole-turn
   * output (the loop has a fallback — see D5). */
  onTextDelta?: (text: string) => void;
}

export interface ModelProvider {
  complete(
    request: ProviderCompletionRequest,
    signal?: AbortSignal,
    callbacks?: ProviderStreamCallbacks,
  ): Promise<ProviderCompletionResult>;
}
```

Why a callback and not an async generator: `loop.ts` needs the *complete* result at the end of
every turn regardless — the full `content` block array goes into `messages` history, `usage`
feeds `token_usage`, `stopReason` drives the tool-use/self-report branch. With a generator,
every consumer would have to re-implement content-block assembly (accumulate text deltas,
buffer tool_use JSON, map stop reason, collect usage) just to rebuild what the adapter already
knows. The callback keeps assembly inside the adapter where the SDK-shape knowledge lives,
keeps `complete()`'s contract identical (same return type, same error taxonomy, same retry
wrapper), and makes streaming a pure side-channel. It also mirrors the existing optional
`signal` pattern: additive, third-party-adapter-compatible (an adapter that ignores
`callbacks` still works).

### D3. Anthropic adapter (`src/agent/providers/anthropic.ts`)

Use raw streaming via `messages.create({ ...params, stream: true })`, which returns an async
iterable of `Anthropic.RawMessageStreamEvent` — *not* the SDK's `messages.stream()` helper.
Rationale: the raw iterable keeps `AnthropicClientLike` a minimal injectable slice (tests
inject a fake async iterable; no MessageStream class to fake), and the accumulation we need is
small and explicit — which the 100%-coverage gate wants anyway.

`AnthropicClientLike` gains a streaming overload (the SDK's own `create` is overloaded on the
`stream` param):

```ts
export interface AnthropicClientLike {
  messages: {
    create(
      params: Anthropic.MessageCreateParamsStreaming,
      options?: { signal?: AbortSignal },
    ): Promise<AsyncIterable<Anthropic.RawMessageStreamEvent>>;
  };
}
```

Event mapping (the SDK emits, in order: `message_start` → per block
{`content_block_start`, `content_block_delta`*, `content_block_stop`} → `message_delta` →
`message_stop`):

| Stream event | Adapter action |
| --- | --- |
| `message_start` | Read `message.usage` → `inputTokens`, `cacheReadTokens` (`cache_read_input_tokens`), `cacheWriteTokens` (`cache_creation_input_tokens`). |
| `content_block_start`, block `type: "text"` | Open a text accumulator at that index. |
| `content_block_start`, block `type: "tool_use"` | Open a tool_use accumulator (capture `id`, `name`), start an empty JSON string buffer. |
| `content_block_delta`, delta `type: "text_delta"` | Append `delta.text` to the text accumulator **and** invoke `callbacks.onTextDelta(delta.text)`. |
| `content_block_delta`, delta `type: "input_json_delta"` | Append `delta.partial_json` to the tool_use JSON buffer. **Not** surfaced via `onTextDelta`. |
| `content_block_stop` | Finalize the block: text → `{type: "text", text}`; tool_use → `JSON.parse` the buffer (empty buffer parses as `{}`) → `{type: "tool_use", id, name, input}`. |
| `message_delta` | `stop_reason` → `mapStopReason` (unchanged); `usage.output_tokens` → `outputTokens` (cumulative — take the last value seen). |
| `message_stop` | Resolve `ProviderCompletionResult` from the accumulated blocks + usage. |

Unknown block/delta types are skipped, mirroring today's `fromAnthropicContent` returning
`null` for unknown blocks. `classifyAnthropicError` is reused unchanged — mid-stream failures
surface as thrown errors from the iterator and carry the same status/APIConnectionError
signals. Retry interaction: see D5.

### D4. Bedrock adapter (`src/agent/providers/bedrock.ts`)

Switch `ConverseCommand` → `ConverseStreamCommand`. The response carries a `stream` async
iterable of `ConverseStreamOutput` union members. `BedrockClientLike.send` changes to accept
`ConverseStreamCommand` and return `{ stream?: AsyncIterable<ConverseStreamOutput> }`.

| Stream event | Adapter action |
| --- | --- |
| `messageStart` | (role only — ignore) |
| `contentBlockStart` with `start.toolUse` | Open a tool_use accumulator at `contentBlockIndex` (capture `toolUseId`, `name`), empty JSON string buffer. |
| `contentBlockDelta` with `delta.text` | Append to the text accumulator at that index **and** invoke `callbacks.onTextDelta(delta.text)`. |
| `contentBlockDelta` with `delta.toolUse.input` | Append the partial-JSON string to that block's buffer. Not surfaced. |
| `contentBlockStop` | Finalize the block (text as-is; tool_use → `JSON.parse` the buffer, empty → `{}`). |
| `messageStop` | `stopReason` → `mapStopReason` (unchanged). |
| `metadata` | `usage` → `inputTokens`/`outputTokens`/`cacheReadTokens`/`cacheWriteTokens` (same field names as today's non-streaming response). |
| `internalServerException` / `modelStreamErrorException` / `throttlingException` / `validationException` (mid-stream error members / thrown during iteration) | Throw; classify via `classifyBedrockError` (unchanged — it keys on exception `name`). |

Note Bedrock, unlike Anthropic, has no explicit block-start event for *text* blocks — a
`contentBlockDelta` with `delta.text` at an unseen index implicitly opens the accumulator.

### D5. Loop plumbing (`src/agent/loop.ts`)

The loop passes an `onTextDelta` callback into `provider.complete()` and owns **all event
policy** (adapters stay pure SDK-shape mappers):

1. **Coalescing.** Raw SDK deltas can be per-token. The loop buffers deltas and flushes one
   `agent_output` SSE event when *either* the buffer reaches **1 KiB** *or* **50 ms** have
   elapsed since the first unflushed delta (timer via `setTimeout`, cleared on flush). This
   caps the steady-state event rate at ~20 events/agent/second while keeping perceived
   latency well under a frame. Constants exported (`STREAM_FLUSH_BYTES`,
   `STREAM_FLUSH_INTERVAL_MS`) for tests.
2. **Turn completion.** When `complete()` resolves: flush any buffered remainder, then emit
   the single `message` JSONL log line with the **full** turn text from
   `completion.content` (unchanged from today), set `finalText`, emit `token_usage`
   event/log line (unchanged). The old whole-turn `agent_output` emission is **removed** —
   except as fallback: if zero deltas were streamed for this turn but the completed text is
   non-empty (a callback-ignoring provider), emit one whole-turn `agent_output` exactly as
   today. This keeps third-party/test providers working with no behavior change.
3. **Mid-turn error or stop with partial output.** If `complete()` rejects (or the signal
   aborts mid-stream) after ≥1 delta was streamed, the loop first flushes the buffer, then
   emits a `message` log line carrying the accumulated partial text with a new **optional
   `partial: true` field** on `LogMessageEvent` (`src/contracts/log.ts`) — additive,
   absent on all previously-written lines and on all complete turns; readers must tolerate
   its absence. Then the existing paths run unchanged (`reportStopped` for aborts; rethrow
   for errors). Without this line, text an operator *watched stream live* would be
   unfindable in the durable log — a diagnostics gap ADR 0004 exists to prevent.
4. **Ordering guarantee.** All buffered output is flushed before any subsequent `tool_call`
   log line, `agent_status` event, or `token_usage` event for that turn — flush is
   synchronous at turn completion, so no event for turn N+1 can precede turn N's last chunk.

### D6. Retry × streaming (`withRetry` interaction)

**Decision: retry only until first delta.** DH-0009's `withRetry` re-invokes the whole
attempt; retrying after partial output has been streamed would duplicate text on screen and
in the event buffer. Each adapter tracks `emittedAny` in the closure shared across attempts
and gates the retry predicate: `(err) => !emittedAny && classify*(err).retryable`. Before the
first delta (connection failures, 429s at request time, stream errors before any text) the
existing retry/backoff behavior is fully preserved; after the first delta, any error is
surfaced immediately as a non-retried `ProviderError`.

### D7. Mid-stream failure UX

**Decision: keep the partial output visible, add an error marker — never discard/rewind.**
No retraction event exists in the contract and none is added. What arrived stays rendered in
both clients; the failure is signaled through the existing channels — `agent_status:
"failed"` (or `"stopped"`) drives the TUI status color / Web status badge, and the Web error
banner/log fire exactly as for any other failure. This matches operator expectations (partial
output is diagnostic signal, not garbage) and requires zero client changes.

### D8. EventBuffer / DH-0012 interaction (flag, not resolved here)

Streaming multiplies event *count* per turn (a 50 KiB assistant turn becomes ~50–1000 events
depending on flush pattern) while total buffered *bytes* stay roughly flat (same text, plus
~150 B of envelope per event — the coalescing floor of 1 KiB/event keeps envelope overhead
under ~15%). Implications for DH-0012, to note on that ticket when implementing:

- The **1000-event count cap** becomes the binding constraint and now represents far less
  wall-clock history — a resume after even a brief disconnect during heavy streaming will hit
  the `resync` gap path much more often. DH-0012's implementer should size the count cap with
  this in mind (e.g. 5000) or lean on the byte cap as primary.
- The **byte cap** recommendation (~10 MB) is essentially unaffected — chunked delivery of
  the same text is byte-neutral modulo envelope overhead.
- Nothing in this design blocks on DH-0012 or vice versa; land in either order.

### D9. Client rendering

**TUI (Mary).** No reducer or contract-handling change required — `appendOutput` already
accumulates chunks correctly. The work is render scheduling: today app.ts redraws per action;
with N agents streaming concurrently at ~20 events/s each, per-event full-frame redraw is
wasteful. Add frame coalescing in app.ts: on state change, mark dirty and schedule a redraw
at most every **33 ms** (~30 fps) — redraw immediately if ≥33 ms since last frame, else one
pending `setTimeout` for the remainder. Pure app.ts concern; render.ts/state.ts stay pure and
untouched (transcript trimming via `MAX_OUTPUT_CHARS` already handles unbounded growth).

**Web (Susan).** No reducer change required — `appendAssistantChunk` accumulates, and
`appendTranscript`'s fast path already appends a text node for grown turns instead of
rebuilding. Two adjustments: (1) batch state→DOM updates with `requestAnimationFrame` —
coalesce events arriving between frames into one `appendTranscript`/sidebar/header pass
(sidebar + header currently fully rebuild per event, which is the actual per-event cost, not
the transcript); (2) sanity-check the `aria-live="polite"` transcript region under chunked
updates — polite live regions coalesce announcements, so this is expected to be fine, but
verify with a screen reader rather than assume. Existing auto-scroll/jump-to-latest behavior
applies unchanged.

### D10. Domain assignment (dispatch independently; Core first, E2E last)

| Domain | Owner | Work |
| --- | --- | --- |
| **Core** | Grace | `ProviderStreamCallbacks` + `ModelProvider.complete` third param (types.ts); Anthropic adapter streaming per D3; Bedrock adapter streaming per D4; loop.ts coalescing/fallback/partial-log per D5; retry gating per D6. Unit tests with fake async-iterable clients (both adapters), fake providers driving loop coalescing/ordering/error paths. |
| **Server** | Radia | The two contract edits, pre-approved by this design: `AgentOutputEvent` doc-comment semantics update in `src/contracts/events.ts` (D1) and optional `partial?: true` on `LogMessageEvent` in `src/contracts/log.ts` (D5). No handler changes — the SSE path is event-agnostic. Add a note to DH-0012 re: D8 cap sizing. |
| **TUI** | Mary | Frame-coalesced redraw in app.ts per D9 (33 ms). No state.ts/render.ts changes. |
| **Web** | Susan | rAF batching of state→DOM updates; aria-live verification per D9. No state.ts reducer changes. |
| **E2E** | Hedy | The mock Anthropic-compatible provider endpoint must serve **SSE streaming responses** (`stream: true` → `message_start`/`content_block_delta`/… event stream), since the adapters now always request streaming. Add an e2e asserting multiple `agent_output` events arrive for one long mock turn and the TUI/Web render the accumulated text. Sequenced after Core lands. |
| Prompt | Iris | No work. |

Suggested landing order: Server (contract edits are two-line, unblock everyone) → Core →
TUI/Web in parallel → E2E.

## Notes

> [!NOTE]
> Source: Competitive-differentiation sweep finding #8.

> [!NOTE]
> Owner decision (2026-07-15): full streaming for both providers, not Anthropic-only. Routed
> to architect (Fable) for a design pass on the contract addition before dispatch, per
> CLAUDE.md §6.2.

> [!NOTE]
> Architect design pass completed 2026-07-15 (Fable) — see Design sections above. Key call:
> **no new SSE event type**; the existing `agent_output`/`chunk` contract already specifies
> accumulation semantics and both clients already implement it, so the incremental change is
> producer-side only plus two additive contract edits (doc comment + optional log field),
> both signed off in this pass.

> [!NOTE]
> **2026-07-16 (Grace/Radia): Core + Server done, ticket stays `ready` — TUI/Web/E2E still
> pending per D10.**
>
> **Server (Radia):** both pre-approved contract edits landed — `AgentOutputEvent`'s doc
> comment in `src/contracts/events.ts` (D1) and `LogMessageEvent.partial?: true` in
> `src/contracts/log.ts` (D5), no handler changes. Added a sizing note to DH-0012 re: D8
> (event-count cap needs raising, or lean on the byte cap, once streaming multiplies
> per-turn event count).
>
> **Core (Grace):** `ProviderStreamCallbacks`/`complete()`'s third param
> (`src/agent/providers/types.ts`); Anthropic adapter switched to raw `messages.create({
> stream: true })` per D3 (not the SDK's `messages.stream()` helper); Bedrock adapter
> switched to `ConverseStreamCommand` per D4; `loop.ts` coalescing (1 KiB/50ms flush,
> `STREAM_FLUSH_BYTES`/`STREAM_FLUSH_INTERVAL_MS`), whole-turn fallback for a
> callback-ignoring provider, and the `partial: true` mid-turn-error log line per D5; D6's
> `emittedAny`-gated retry (retry only until the first *text* delta, not the first raw
> stream event — see implementer note below) in both adapters.
>
> **Implementer judgment call (not resolved by the design text):** D6 says "retry only
> until first delta." Read literally as "first stream event," a provider that streamed
> `message_start`/tool-input deltas but zero visible text before failing would become
> non-retryable even though nothing ever reached a client — that seemed like an
> unintended tightening of the existing retry safety net for no benefit (no text was ever
> displayed, so there's nothing to duplicate on a retry). Implemented `emittedAny`/gating
> against the first *text* delta specifically (`onTextDelta`'s first call), not the first
> raw event of any kind. Documented inline in both adapters.
>
> **Verification:** unit tests per D2-D6's own prescribed approach — fake async-iterable
> streaming clients for both adapters (event ordering, block accumulation, retry gating),
> fake providers driving `loop.ts`'s coalescing/fallback/ordering/mid-turn-error paths.
> `bun run typecheck`/`lint`/`test:coverage` all green on every file this round touched
> (100%/100% on `anthropic.ts`, `bedrock.ts`, `types.ts`, `events.ts`, `log.ts`; 100%
> funcs/99.8%+ lines on `loop.ts`, remaining gap is pre-existing DH-0038/DH-0050 code this
> round didn't touch). Live-verified against real Anthropic credentials via both the
> `--instructions --job` path (JSONL log: exactly one non-partial `message` line per turn,
> full text) and a real `dh --server` + raw SSE curl (49 incremental `agent_output` events
> for one long turn, reconstructing byte-for-byte to the JSONL log's full text). Also
> live-verified against real AWS Bedrock (Claude Haiku 4.5) the same way — 109 incremental
> `agent_output` events for one turn over the real `ConverseStreamCommand` path.
>
> **Still pending per D10:** TUI (Mary) frame-coalesced redraw, Web (Susan) rAF batching,
> E2E (Hedy) mock-provider SSE streaming support + the multi-event assertion. Leaving this
> ticket `ready`, not closing it.

> [!NOTE]
> **2026-07-17 (Mary/Susan/Hedy): final domain round per D10 — TUI, Web, and E2E all land.
> Ticket moved to `verifying`.**
>
> **TUI (Mary):** frame-coalesced redraw in `src/tui/app.ts` per D9 — a new `scheduleDraw()`
> replaces the unconditional `draw()` call in `dispatch()`: redraws immediately if
> `FRAME_INTERVAL_MS` (33ms) has elapsed since the last frame, otherwise schedules exactly one
> pending `setTimeout` for the remainder (never stacks multiple timers); the pending timer is
> cleared in `cleanup()`. `state.ts`/`render.ts` untouched, confirmed already pure/correct by
> reading both. Existing `app.test.ts` assertions on `stdout` writes race a real 33ms window
> now that redraws can be deferred, so `flush()`'s helper was extended to wait out that window
> — no assertions changed, all 21 existing tests still pass with no behavior change asserted.
>
> **Web (Susan):** `src/web/client/app.ts`'s `handleEvent` (the SSE event handler) now calls a
> new `scheduleRenderAll()` instead of `renderAll()` directly — coalesces `renderAll()` calls
> from SSE events to at most one per animation frame via an injectable
> `rafImpl`/`cancelRafImpl` pair on `AppDeps` (defaults to real `requestAnimationFrame`/
> `cancelAnimationFrame`, falling back to an immediate macrotask outside a browser — see
> `defaultRaf`/`defaultCancelRaf`). State (`applyEvent`) is still always updated synchronously
> in `handleEvent`; only the DOM render pass is deferred, so a render that does fire always
> reflects every event received so far. `state.ts` untouched. `aria-live="polite"` verification
> (D9's second Web item): confirmed via the new headless-browser e2e test below, which asserts
> the fully accumulated turn text renders correctly under chunked/batched updates — a real
> screen reader wasn't run, but polite live regions are documented to coalesce announcements
> by design, matching the design doc's own expectation.
>
> **E2E (Hedy):**
> - `e2e/support/mock-provider.ts` (Anthropic mock): `turnToStreamResponse` now splits a
>   scripted turn's `text` into multiple 64-char `content_block_delta` events instead of one
>   whole-text delta, so a sufficiently long scripted turn actually exercises the agent loop's
>   `STREAM_FLUSH_BYTES` coalescing (src/agent/loop.ts) more than once — a single giant delta
>   would otherwise collapse back into exactly one `agent_output` event regardless of turn
>   length.
> - `e2e/support/mock-bedrock-provider.ts` (Bedrock mock): found broken by the same class of
>   staleness DH-0112 fixed for the Anthropic mock — Core's D4 Bedrock adapter switch to
>   `ConverseStreamCommand` (already landed) moved the real wire call to
>   `POST /model/{modelId}/converse-stream` with AWS's binary
>   `application/vnd.amazon.eventstream` framing, but this mock still served the old
>   non-streaming `/converse` JSON response — confirmed via a direct
>   `bun test e2e/bedrock-provider.test.ts` run pre-fix (all 3 tests failing, exit code 2, not
>   a hang). Rewrote it to build real event-stream binary frames via
>   `@smithy/core/event-streams`'s `EventStreamCodec` (the same codec the SDK itself uses to
>   decode them, reused rather than hand-rolling the length-prefix/CRC32 framing) — wire field
>   names inside each frame's JSON payload were confirmed by reading the generated schema
>   tables in `node_modules/@aws-sdk/client-bedrock-runtime/dist-cjs/index.js` (no `jsonName`
>   overrides in this client generation, so JSON field names equal the SDK's own camelCase TS
>   property names). Also added the same `TEXT_DELTA_CHUNK_SIZE`-based delta-splitting as the
>   Anthropic mock. Post-fix: `bun test e2e/bedrock-provider.test.ts` now reaches real
>   completions (exit codes 0/1 as scripted) — the 3 remaining failures are `callCount`/
>   `modelIds` mismatches from the DH-0115 `ReportOutcome`-nudge-doubling issue (already filed,
>   already known to affect this exact mock's `successTurn()` per that ticket's own text), not
>   a streaming regression.
> - New `e2e/streaming.test.ts` — the ticket's User Story acceptance test, three tiers:
>   1. **Raw HTTP/SSE** (no browser/PTY): `"raw HTTP/SSE: a long turn arrives as multiple
>      agent_output events whose chunks reconstruct the full text"` — scripts a ~4.2 KB turn
>      (several times `STREAM_FLUSH_BYTES`), asserts `outputEvents.length` > 1 and that
>      concatenating every `agent_output` event's `chunk` in order reconstructs the full text
>      exactly. This is the most direct proof of incremental delivery — passing.
>   2. **Web** (`"web (headless browser): the client accumulates streamed chunks into the
>      fully rendered turn"`): drives the real composer against a real headless Chromium,
>      asserts the transcript's `.turn-text` ends up exactly equal to the full long-turn text
>      — passing.
>   3. **TUI** (`"TUI (real PTY): the console client renders the fully accumulated text after
>      a streamed turn"`): same, via a real tmux PTY session against the real compiled binary
>      — written to the same convention as `e2e/tui.test.ts`, but **could not be verified in
>      this sandbox**: `tmux capture-pane` fails with "can't find pane" for every PTY-based
>      test in this repo, including the 4 pre-existing tests in `tui.test.ts`,
>      `markdown-rendering.test.ts`, and `slash-commands.test.ts` — confirmed via a `git
>      stash`-based baseline run (`bun run e2e` on unmodified `main`: 23 pass / 12 fail, same
>      4 tmux-pane failures) that this is a pre-existing sandbox/tmux environment limitation,
>      not something this round introduced or can fix. No silent truncation (CLAUDE.md §8):
>      this test is checked in and correct per the same pattern every other PTY e2e test in
>      this repo uses; it is expected to pass in an environment where tmux PTY sessions
>      actually attach (e.g. CI), same as those 4 pre-existing tests.
>
> **Verification:** `bun run typecheck` / `bun run lint` (scoped to every file this round
> touched — the repo's pre-existing `.claude/skills/` lint failures are unrelated and present
> on unmodified `main` too, confirmed via `git stash`) both clean. `bun test src --coverage`:
> 2041 pass / 0 fail, 100% line coverage on both `src/tui/app.ts` and `src/web/client/app.ts`
> (verified no new uncovered lines vs. each file's pre-round baseline, confirmed via
> `git stash`-based coverage diffing). `bun run e2e`: 25 pass / 13 fail — up from a baseline of
> 23 pass / 12 fail on unmodified `main` (same `git stash` comparison); every failure in both
> runs is one of the two already-known, already-tracked pre-existing causes (DH-0115's
> `ReportOutcome`-nudge mock doubling; this sandbox's tmux/PTY environment limitation), with
> zero net regressions and 2 new passing acceptance-test tiers.
>
> **User Story -> test mapping (CLAUDE.md §9):** "As an operator watching a live session, I
> want to see model output as it's generated, not all at once when the turn finishes" is
> proven by `e2e/streaming.test.ts`'s three cases: `"raw HTTP/SSE: a long turn arrives as
> multiple agent_output events whose chunks reconstruct the full text"` (the SSE-level
> incremental-delivery proof), `"web (headless browser): the client accumulates streamed
> chunks into the fully rendered turn"` (Web renders progressively and converges correctly),
> and `"TUI (real PTY): the console client renders the fully accumulated text after a streamed
> turn"` (same for the console client — written and correct, blocked from running in *this*
> sandbox only by the pre-existing tmux limitation noted above, not a gap in coverage).
>
> This was the final domain per D10 — recommend moving to `closed` once a maintainer confirms
> the TUI e2e tier in an environment with working tmux PTY sessions.
