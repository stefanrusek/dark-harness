// The agent loop (docs/handoffs/core.md §4). Takes a system prompt, a model, a starting
// instruction, runs tool-call turns against a ModelProvider until the model signals
// completion, and emits ServerSentEvent-shaped events + LogLine-shaped log lines via plain
// callbacks — the Server domain wires these to real HTTP/SSE + JSONL sinks. This module
// never imports src/server/.
//
// SELF-REPORT CONVENTION (DH-0050, architect design Fable 2026-07-15, superseding the
// original TASK_FAILED-only convention below): in non-interactive mode, detection precedence
// is (1) an authoritative `ReportOutcome` tool call — the turn it lands in is terminal,
// checked right after that turn's tool calls run; last valid call in the turn wins; (2) if a
// non-tool-use turn ends with no valid ReportOutcome ever recorded and stopReason !==
// "max_tokens", one harness-injected reminder turn (REPORT_OUTCOME_NUDGE_MESSAGE) is sent —
// exactly once — before falling back to; (3) the legacy convention: the final assistant text
// is scanned for the literal marker `TASK_FAILED` (case-sensitive, anywhere in the text); its
// presence means self-reported failure, its absence means success. A max_tokens stop on a
// no-tool-call turn is always treated as failure (the response is truncated, not a
// deliberate completion) and skips the nudge (nudging a truncating model just truncates
// again). `ReportOutcome` is only ever registered for non-interactive runtimes (runtime.ts) —
// interactive sessions have no exit-code semantics to report into and never reach this
// branch at all (see MODE DISTINCTION below). The system prompt must instruct the model to
// call `ReportOutcome` (with `TASK_FAILED` taught as the deprecated fallback) — that's a
// request to the Prompt domain, not implemented here.
//
// MODE DISTINCTION (Round 5, docs/handoffs/core.md status log): the self-report convention
// above is exactly right for the standalone `--instructions`/`--job` dark-factory path (a
// one-shot autonomous task genuinely should exit the first time the model stops calling
// tools) but wrong for interactive sessions (root/sub-agents reachable via SendMessage under
// server/TUI/Web) — a conversational turn with no tool call routinely just means "waiting
// for the human's next message," not "task complete." `AgentLoopParams.interactive` (set by
// AgentRuntime, per-runtime-instance — see runtime.ts) switches this: when true, a
// non-tool-use turn does NOT end the loop. Instead it marks the agent "waiting" (an existing
// AgentStatus value) and the loop pauses (without returning, so `registerSendMessage`'s sink
// stays installed and the in-memory `messages` history stays intact) until either a new
// message arrives via that sink or the loop is aborted. TASK_FAILED/max_tokens self-report
// checking is skipped entirely on this path — there's no natural "done" state for an
// ongoing conversation, only a genuine stop (AbortSignal, already wired in Round 3) ends it.
// This applies identically to sub-agents (spawnAgent()) and the root (runRoot()) — both
// route through this same function, so there's exactly one implementation of "what does a
// non-tool-use turn mean" per runtime, not a root-only special case.
//
// maxTurns in interactive mode (Round 5 judgment call): kept as a single whole-conversation
// cap, not reset per exchange. `turns` only increments once per actual model round-trip, so
// time spent paused in "waiting" between messages never counts against it — a long-running
// but sparse conversation isn't penalized by wall-clock time, only by how many turns of
// actual model work it has consumed in total. Hitting the cap still ends the session as a
// failure (`"exceeded max turns"`), the same safety valve as before — this is intentionally
// the one exception to "only a genuine stop ends an interactive session," since letting a
// pathological loop run forever isn't a real feature. A per-message budget was considered
// and rejected: it would let a conversation consisting of many short exchanges each doing a
// bounded amount of tool-calling work forever, which defeats the point of a safety cap.

import { randomUUID } from "node:crypto";
import { BUILD_INFO } from "../config/build-info.ts";
import {
  type LogLine,
  type OutcomeReportedBy,
  REPORT_OUTCOME_TOOL_NAME,
  type ReportedOutcome,
  type ServerSentEvent,
  type SessionClientKind,
  type ThinkingConfig,
} from "../contracts/index.ts";
import {
  type ModelProvider,
  type ProviderCompletionResult,
  type ProviderContentBlock,
  ProviderError,
  type ProviderMessage,
  type ProviderUsage,
} from "./providers/types.ts";
import { summarizeToolInput } from "./tool-summary.ts";
import { parseReportedOutcome } from "./tools/report-outcome.ts";
import type { Tool, ToolContext } from "./tools/types.type.ts";

export const TASK_FAILED_MARKER = "TASK_FAILED";
const DEFAULT_MAX_TURNS = 100;

/** DH-0044 D5: coalescing thresholds for turning raw provider text deltas into `agent_output`
 * SSE events. A raw delta can be per-token; the loop buffers them and flushes one event when
 * *either* threshold is hit first — caps the steady-state event rate at ~20 events/agent/sec
 * while keeping perceived latency well under a frame. Exported so tests can drive both
 * thresholds deterministically without waiting on real wall-clock time. */
export const STREAM_FLUSH_BYTES = 1024;
export const STREAM_FLUSH_INTERVAL_MS = 50;

/** DH-0050: the harness-injected reminder sent (once) when a non-interactive turn ends with
 * no tool call and no `ReportOutcome` was ever recorded — the "missed-call nudge" that makes
 * a forgotten self-report a detectable, recoverable state instead of silently scoring as
 * success. Exported so e2e fixtures/tests can assert against the exact text. */
export const REPORT_OUTCOME_NUDGE_MESSAGE =
  "You ended your turn without calling the ReportOutcome tool. Call ReportOutcome now with " +
  'status "success" or "failure" (plus optional summary/filesChanged/artifacts). Do nothing else.';

// Round 3 (docs/handoffs/core.md status log): the two distinct points `signal` is checked,
// each with its own log reason so a "why did this stop" reader can tell which one fired.
export const STOPPED_BETWEEN_TURNS_REASON = "stopped by operator before starting the next turn";
export const STOPPED_DURING_PROVIDER_CALL_REASON =
  "stopped by operator while waiting for the model";
// Round 5: a third distinct point — paused in "waiting" for the human's next message
// (interactive mode only), not actively between turns or mid-provider-call.
export const STOPPED_WHILE_WAITING_REASON =
  "stopped by operator while waiting for the next message";

export interface AgentLoopParams {
  sessionId: string;
  agentId: string;
  parentAgentId: string | null;
  /** The friendly config alias (`ModelConfig.name`) — used only for display/diagnostics
   * (the `agent_spawned` SSE event's `model` field, the JSONL log header's `model` field).
   * Never sent to the provider — see `providerModel` for that. */
  model: string;
  /** Round 11 fix (docs/handoffs/core.md status log): the real provider-side model
   * identifier (`ModelConfig.model`) — this, not `model` (the friendly alias), is what
   * actually gets sent to `provider.complete()`. Before this fix, every provider call sent
   * the config alias instead of the real upstream model id, silently masked by LM Studio
   * (ignores the field) and by auth failures in earlier Anthropic testing; confirmed live
   * against real AWS Bedrock, which rejected every call with "invalid model identifier"
   * regardless of what was actually configured. */
  providerModel: string;
  systemPrompt: string;
  instruction: string;
  /** Round 13 (docs/handoffs/core.md, P1 item 8): human-readable label from the Agent tool's
   * optional `description` param, threaded from runtime.ts's spawnAgent() into this call's
   * JSONL log header — the root agent never has one (nothing spawned it via the Agent tool). */
  description?: string;
  provider: ModelProvider;
  tools: Map<string, Tool>;
  toolContext: ToolContext;
  maxTurns?: number;
  /** Injected by the runtime so SendMessage can steer a running agent between turns. */
  registerSendMessage?: (fn: (message: string) => void) => void;
  onEvent?: (event: ServerSentEvent) => void;
  onLogLine?: (line: LogLine) => void;
  /** Round 3 addition: cooperative cancellation, driven by TaskStop/stopAgent
   * (AgentRuntime.spawnAgent()/runRoot() — see their doc comments). Checked at two points:
   * (1) the top of every turn, before starting a new one, so a stop between turns takes
   * effect immediately rather than waiting for maxTurns or natural completion; (2) around
   * the provider call itself — both built-in providers (anthropic.ts/bedrock.ts) forward
   * this signal to their SDK's own abort support, so an in-flight model request can also be
   * interrupted mid-flight, not just the *next* one prevented.
   *
   * NOT threaded into individual tool executions (ToolContext has no signal field this
   * round) — a blocking tool call already in progress (e.g. Bash without
   * run_in_background) runs to completion once started; stopping only guarantees no *new*
   * turn or model request starts afterward. Documented explicitly (not silently) as the
   * chosen minimum-viable scope — see docs/handoffs/core.md's Round 3 status log for the
   * reasoning and what a deeper fix would need to touch. */
  signal?: AbortSignal;
  /** Round 5: selects which mode this loop invocation runs in. `false`/omitted (the default)
   * preserves the original standalone `--instructions`/`--job` behavior exactly: a
   * non-tool-use turn ends the loop via the TASK_FAILED self-report convention. `true` is for
   * interactive sessions (server/TUI/Web) — see the module doc comment above for the full
   * design. Set once per AgentRuntime instance (runtime.ts), not per call. */
  interactive?: boolean;
  /**
   * Round 6b: optional per-model pricing (USD per million tokens), threaded from
   * `ModelConfig.inputPricePerMToken`/`outputPricePerMToken` via runtime.ts. When present,
   * every `token_usage` event/log line this call emits gets a computed `costUsd`; when
   * absent, `costUsd` stays undefined exactly as before this round (no regression for
   * unconfigured models — see computeCostUsd()'s own doc comment for the half-configured
   * case).
   */
  pricing?: {
    inputPricePerMToken?: number;
    outputPricePerMToken?: number;
    /** DH-0010 Part A: USD per million cache-read tokens. When unset but
     * `inputPricePerMToken` is set, `computeCostUsd` defaults to 0.1x the input price. */
    cacheReadPricePerMToken?: number;
    /** DH-0010 Part A: USD per million cache-write tokens. When unset but
     * `inputPricePerMToken` is set, `computeCostUsd` defaults to 1.25x the input price. */
    cacheWritePricePerMToken?: number;
  };
  /** DH-0045: opt-in extended thinking, threaded from `ModelConfig.thinking` via runtime.ts
   * (same pattern as `pricing`/`providerModel`). Absent means off — no `thinking` param sent
   * to the provider. */
  thinking?: ThinkingConfig;
  /** DH-0010 Part A: opt-in prompt caching, threaded from `ModelConfig.cache` via runtime.ts
   * (same pattern as `pricing`/`thinking`). Absent/false means every `provider.complete()`
   * call this loop makes stays byte-identical to pre-DH-0010 behavior. */
  cache?: boolean;
  /** DH-0010 Part B: this model's context window (tokens), threaded from
   * `ModelConfig.contextWindow` via runtime.ts. Required (alongside `compaction.enabled`) for
   * the compaction trigger check below to ever fire — absent means compaction never triggers
   * for this model, regardless of `compaction.enabled`. */
  contextWindow?: number;
  /** DH-0010 Part B: opt-in context-window compaction, threaded from the top-level
   * `compaction` config block via runtime.ts. Absent/`enabled: false` means the trigger
   * check below never runs — today's unbounded-growth behavior, unchanged. */
  compaction?: { enabled: boolean; thresholdPercent?: number };
  /** Round 8 (ADR 0005 amendment): how the process that owns this session was invoked — see
   * SessionClientKind's own doc comment in src/contracts/log.type.ts. Required (not defaulted) so
   * no call site can silently record a wrong value; threaded from AgentRuntimeOptions.client
   * via runtime.ts into every runAgentLoop() call (root and every sub-agent alike — a
   * session's client kind doesn't vary per agent within it). */
  client: SessionClientKind;
  /** DH-0038 (`--resume <sessionId>`): when present, seeds `messages` from the replayed
   * history (`src/agent/resume.ts`'s `loadResumeSession`) instead of starting from an empty
   * history, and stamps the new header's `resumedFrom` field. `params.instruction` (the wake-
   * up notice, and/or `--instructions` content — composed by src/cli.ts) is still applied via
   * the normal trailing-role merge below; when `resume` is absent this is a no-op change from
   * the original behavior (empty history, so the merge always appends a fresh user message,
   * exactly as before this round). Root agent only — never set for a spawnAgent() call. */
  resume?: { messages: ProviderMessage[]; fromSessionId: string };
  /** DH-0093: installs a sink runtime.ts's `AgentRuntime.switchModel()` can push a new
   * `ModelBinding` through — the exact mirror of `registerSendMessage` above. A pushed switch
   * takes effect on the very next `provider.complete()` call/`computeCostUsd()` computation,
   * never mid-flight, and the loop is never restarted — the in-memory `messages` history
   * (the whole point of a live switch instead of a fresh session) survives intact. See the
   * mutable `binding` local in `runAgentLoop` below for where this is actually read. */
  registerModelSwitch?: (fn: (binding: ModelBinding) => void) => void;
  /** DH-0140: threaded from `AgentRuntime`'s `TaskRegistry.hasNonTerminalChildren()` — checked
   * fresh at each DH-0050 nudge decision point rather than snapshotted once, since a child can
   * finish between turns. When true, the nudge is skipped for that turn (the agent is treated
   * as deliberately waiting on its own children, not as having forgotten to self-report) —
   * see the module doc comment's SELF-REPORT CONVENTION section for the nudge itself. Absent
   * (root loop invocations outside a full AgentRuntime, e.g. some test harnesses) behaves
   * exactly as before this ticket — nudge fires unconditionally on the relevant turn. */
  hasPendingChildren?: () => boolean;
}

/** DH-0093: the mutable per-loop state a model switch replaces — everything a provider call
 * or cost computation needs that used to be read directly off `AgentLoopParams`. Exported so
 * `runtime.ts`'s `AgentRuntime.switchModel()` can construct one to push through the
 * `registerModelSwitch` sink. */
export interface ModelBinding {
  model: string;
  providerModel: string;
  provider: ModelProvider;
  pricing?: AgentLoopParams["pricing"];
  thinking?: AgentLoopParams["thinking"];
  /** DH-0010 Part A: threaded per-model, same reasoning as `pricing`/`thinking` — a live
   * model switch can change whether caching applies. */
  cache?: AgentLoopParams["cache"];
  /** DH-0010 Part B: threaded per-model — a live model switch can change (or newly set/
   * unset) the context window this loop compacts against. */
  contextWindow?: AgentLoopParams["contextWindow"];
}

/** Computes a `token_usage` event's `costUsd`, or undefined if pricing wasn't configured at
 * all for this model. If only one side of the split (input/output) is configured, the other
 * side is treated as $0/MToken rather than making the whole result undefined — a partial
 * price is still a real, deliberately-configured value, not "unconfigured". DH-0010 Part A:
 * `cacheReadTokens`/`cacheWriteTokens` (default 0) are priced at `pricing.
 * cacheReadPricePerMToken`/`cacheWritePricePerMToken` when set, else 0.1x/1.25x of
 * `inputPricePerMToken` when *that* is set, else $0 — same "unconfigured stays unconfigured,
 * partial is still real" rule as input/output above. */
export function computeCostUsd(
  pricing: AgentLoopParams["pricing"],
  inputTokens: number,
  outputTokens: number,
  cacheReadTokens = 0,
  cacheWriteTokens = 0,
): number | undefined {
  if (
    !pricing ||
    (pricing.inputPricePerMToken === undefined && pricing.outputPricePerMToken === undefined)
  ) {
    return undefined;
  }
  const inputPrice = pricing.inputPricePerMToken ?? 0;
  const cacheReadPrice = pricing.cacheReadPricePerMToken ?? inputPrice * 0.1;
  const cacheWritePrice = pricing.cacheWritePricePerMToken ?? inputPrice * 1.25;
  const inputCost = (inputPrice * inputTokens) / 1_000_000;
  const outputCost = ((pricing.outputPricePerMToken ?? 0) * outputTokens) / 1_000_000;
  const cacheReadCost = (cacheReadPrice * cacheReadTokens) / 1_000_000;
  const cacheWriteCost = (cacheWritePrice * cacheWriteTokens) / 1_000_000;
  return inputCost + outputCost + cacheReadCost + cacheWriteCost;
}

export interface AgentLoopResult {
  success: boolean;
  finalOutput: string;
  turns: number;
  /** DH-0050: present iff `reportedBy === "tool"`. */
  outcome?: ReportedOutcome;
  /** DH-0050: which detection-precedence tier produced `success` — absent only for the
   * interactive "stopped mid-conversation" (`reportStopped()`) return path, which has no
   * self-report semantics at all. */
  reportedBy?: OutcomeReportedBy;
}

function nowIso(): string {
  return new Date().toISOString();
}

function emitEvent(params: AgentLoopParams, event: ServerSentEvent): void {
  params.onEvent?.(event);
}

function emitLog(params: AgentLoopParams, line: LogLine): void {
  params.onLogLine?.(line);
}

/** Reports a stopped-via-signal turn. DH-0017 fix: this used to report `agent_status:
 * "failed"` (the same shape as a genuine self-reported failure) with the rationale that
 * TaskRegistry.stop() also collapsed "stopped" into "failed" bookkeeping, so the two
 * mechanisms were at least internally consistent — but that meant a deliberately-stopped
 * agent was never actually distinguishable from a real failure anywhere downstream (JSONL log,
 * SSE `agent_status`, TUI/Web display all read "failed"). TaskRegistry.stop() (tasks.ts) has
 * since been the one recording a genuine "stopped" status on its own snapshot — but because
 * this function fed "failed" back through the exact same onEvent path that
 * AgentRuntime.spawnAgent()/runRoot() use to keep their own status bookkeeping in sync
 * (`this.tasks.setStatus(agentId, event.status)` / `this.rootStatus = event.status`), that later
 * "failed" event would silently overwrite the registry's already-correct "stopped" back to
 * "failed" — the exact flip DH-0017 reports. Now reports "stopped" here too, so every reader of
 * this status (JSONL, SSE, task registry, root bookkeeping) agrees, regardless of which of the
 * two code paths (loop.ts's own signal check vs. TaskRegistry.stop()) observes the stop first. */
function reportStopped(
  params: AgentLoopParams,
  finalText: string,
  turns: number,
  reason: string,
  success = false,
): AgentLoopResult {
  emitEvent(params, {
    version: 1,
    id: randomUUID(),
    timestamp: nowIso(),
    type: "agent_status",
    agentId: params.agentId,
    status: "stopped",
  });
  emitLog(params, {
    version: 1,
    timestamp: nowIso(),
    type: "status_change",
    status: "stopped",
    reason,
  });
  return { success, finalOutput: finalText, turns };
}

function textOf(content: ProviderContentBlock[]): string {
  return content
    .filter((b): b is Extract<ProviderContentBlock, { type: "text" }> => b.type === "text")
    .map((b) => b.text)
    .join("");
}

/** DH-0010 Part B: number of trailing messages to keep verbatim after compaction (~2
 * exchanges) — an implementer constant per the ticket's Design section. */
const COMPACTION_TAIL_SIZE = 4;

export const COMPACTION_SUMMARY_REQUEST =
  "Summarize this conversation for context compaction: the original task, decisions made " +
  "and why, current state, files touched, and work remaining. Respond with the summary " +
  "text only, no preamble.";

/** DH-0010 Part B: finds the first index at or after `messages.length - COMPACTION_TAIL_SIZE`
 * whose message is an `assistant` turn — the tail must start at an assistant-message
 * boundary, never at a `user` tool_result message (which would orphan its `tool_use`
 * pairing and be rejected by both providers) and starting at `assistant` also keeps
 * user/assistant alternation valid. Returns `messages.length` (empty tail) if no assistant
 * message exists at or after the target cutoff. */
function computeCompactionTailStart(messages: ProviderMessage[]): number {
  let start = Math.max(0, messages.length - COMPACTION_TAIL_SIZE);
  while (start < messages.length && messages[start]?.role !== "assistant") {
    start += 1;
  }
  return start;
}

/** DH-0010 Part B: performs one compaction pass — one extra no-tools `provider.complete()`
 * call requesting a structured summary, then rebuilds `messages` in place as `[ user:
 * original instruction + compaction marker + summary, ...tail ]` (tail starting at an
 * assistant-message boundary — see `computeCompactionTailStart`). Emits the `compaction`
 * JSONL log line. A summarization-call failure propagates like any provider error (already
 * passes through the adapter's own withRetry) — no half-compacted state is left behind,
 * since `messages` is only mutated after the call resolves. */
async function performCompaction(
  params: AgentLoopParams,
  binding: ModelBinding,
  messages: ProviderMessage[],
  preTokens: number,
): Promise<void> {
  const summaryRequestMessages: ProviderMessage[] = [
    ...messages,
    { role: "user", content: [{ type: "text", text: COMPACTION_SUMMARY_REQUEST }] },
  ];
  const summaryCompletion = await binding.provider.complete({
    model: binding.providerModel,
    system: params.systemPrompt,
    messages: summaryRequestMessages,
    tools: [],
  });
  const summary = textOf(summaryCompletion.content);

  const tailStart = computeCompactionTailStart(messages);
  const tail = messages.slice(tailStart);
  const droppedMessages = messages.length - tail.length;

  const rebuilt: ProviderMessage[] = [
    {
      role: "user",
      content: [
        {
          type: "text",
          text: `${params.instruction}\n\n[History compacted — summary of prior work follows]\n${summary}`,
        },
      ],
    },
    ...tail,
  ];

  messages.length = 0;
  messages.push(...rebuilt);

  emitLog(params, {
    version: 1,
    timestamp: nowIso(),
    type: "compaction",
    preTokens,
    droppedMessages,
    retainedMessages: tail.length,
    summaryChars: summary.length,
  });
}

/** DH-0010 Part B: `contextTokens ≈ inputTokens + cacheReadTokens + cacheWriteTokens +
 * outputTokens`, the provider's own usage report used as a next-request context-size proxy
 * (no client-side tokenizer exists for Bedrock/local models). */
function contextTokensOf(usage: ProviderUsage): number {
  return (
    usage.inputTokens +
    (usage.cacheReadTokens ?? 0) +
    (usage.cacheWriteTokens ?? 0) +
    usage.outputTokens
  );
}

async function runToolCalls(
  toolUses: Extract<ProviderContentBlock, { type: "tool_use" }>[],
  params: AgentLoopParams,
): Promise<ProviderContentBlock[]> {
  const results: ProviderContentBlock[] = [];
  for (const toolUse of toolUses) {
    const startedAt = Date.now();
    emitEvent(params, {
      version: 1,
      id: randomUUID(),
      timestamp: nowIso(),
      type: "tool_call",
      agentId: params.agentId,
      toolUseId: toolUse.id,
      toolName: toolUse.name,
      inputSummary: summarizeToolInput(toolUse.name, toolUse.input),
    });
    emitLog(params, {
      version: 1,
      timestamp: nowIso(),
      type: "tool_call",
      toolName: toolUse.name,
      toolUseId: toolUse.id,
      input: toolUse.input,
    });

    const tool = params.tools.get(toolUse.name);
    let output: string;
    let isError: boolean;
    if (!tool) {
      output = `Unknown tool: ${toolUse.name}`;
      isError = true;
    } else {
      const input =
        typeof toolUse.input === "object" && toolUse.input !== null
          ? (toolUse.input as Record<string, unknown>)
          : {};
      const result = await tool.execute(input, params.toolContext);
      output = result.output;
      isError = result.isError;
    }

    emitEvent(params, {
      version: 1,
      id: randomUUID(),
      timestamp: nowIso(),
      type: "tool_result",
      agentId: params.agentId,
      toolUseId: toolUse.id,
      toolName: toolUse.name,
      isError,
      durationMs: Date.now() - startedAt,
    });
    emitLog(params, {
      version: 1,
      timestamp: nowIso(),
      type: "tool_result",
      toolUseId: toolUse.id,
      output,
      isError,
    });

    results.push({ type: "tool_result", toolUseId: toolUse.id, content: output, isError });
  }
  return results;
}

export async function runAgentLoop(params: AgentLoopParams): Promise<AgentLoopResult> {
  const maxTurns = params.maxTurns ?? DEFAULT_MAX_TURNS;
  // DH-0038: seeded from replayed resume history when resuming, empty otherwise. Either way,
  // `params.instruction` (the wake-up notice / --instructions content) is applied right after
  // via the same trailing-role merge (D1): appended to the last message if it's already a
  // `user` turn, or pushed as a new one otherwise — never two adjacent same-role messages.
  // With no resume history this always takes the "push a new user message" branch, exactly
  // reproducing the original (pre-resume) behavior.
  const messages: ProviderMessage[] = params.resume ? [...params.resume.messages] : [];
  const lastMessage = messages[messages.length - 1];
  if (lastMessage && lastMessage.role === "user") {
    lastMessage.content = [...lastMessage.content, { type: "text", text: params.instruction }];
  } else {
    messages.push({ role: "user", content: [{ type: "text", text: params.instruction }] });
  }
  const pendingMessages: string[] = [];
  // Round 5: when the loop is paused in "waiting" (interactive mode only — see below), a
  // newly-arrived message wakes it up immediately instead of sitting unread until some other
  // trigger polls for it. `waitingResolve` is only ever non-null while the loop is actually
  // inside the wait, so this is a no-op (just queues into pendingMessages, picked up at the
  // top of the next turn) whenever a message arrives mid-turn — the original round-1/round-4
  // behavior, unchanged.
  let waitingResolve: (() => void) | null = null;
  params.registerSendMessage?.((message: string) => {
    pendingMessages.push(message);
    if (waitingResolve) {
      const resolve = waitingResolve;
      waitingResolve = null;
      resolve();
    }
  });

  // DH-0093: mutable binding a live model switch replaces — every provider.complete() call
  // and computeCostUsd() computation below reads from this, not from `params` directly, so a
  // pushed switch takes effect on the very next turn without restarting the loop (messages
  // history stays intact — see AgentLoopParams.registerModelSwitch's doc comment).
  const binding: ModelBinding = {
    model: params.model,
    providerModel: params.providerModel,
    provider: params.provider,
    pricing: params.pricing,
    thinking: params.thinking,
    cache: params.cache,
    contextWindow: params.contextWindow,
  };
  params.registerModelSwitch?.((newBinding: ModelBinding) => {
    const from = binding.model;
    const to = newBinding.model;
    binding.providerModel = newBinding.providerModel;
    binding.provider = newBinding.provider;
    binding.pricing = newBinding.pricing;
    binding.thinking = newBinding.thinking;
    binding.cache = newBinding.cache;
    binding.contextWindow = newBinding.contextWindow;
    binding.model = to;
    emitEvent(params, {
      version: 1,
      id: randomUUID(),
      timestamp: nowIso(),
      type: "model_switched",
      agentId: params.agentId,
      from,
      to,
    });
    emitLog(params, {
      version: 1,
      timestamp: nowIso(),
      type: "model_switched",
      from,
      to,
    });
  });

  emitEvent(params, {
    version: 1,
    id: randomUUID(),
    timestamp: nowIso(),
    type: "agent_spawned",
    agentId: params.agentId,
    parentAgentId: params.parentAgentId,
    model: params.model,
    // DH-0069: threads through to the Web client's AgentNode so its sidebar/tree row can
    // show the same human-readable label the TUI already reads off AgentTreeNode.description
    // via its separate tree-poll path.
    ...(params.description !== undefined ? { description: params.description } : {}),
  });
  // A freshly spawned sub-agent is about to make its first model call — genuinely "running",
  // not idle. Without this, a client that defaults an unknown agent's status to "waiting" on
  // `agent_spawned` (see web client state.ts's `ensureAgent`) shows a sub-agent mid-turn as
  // amber/idle for its entire first call, contradicting the style guide's own definition of
  // `waiting` ("idle, awaiting input/dispatch") — this agent has already been dispatched.
  // Root is excluded: its own "running"/"waiting" semantics are already governed separately
  // by AgentRuntime.rootStatus (runtime.ts) and its own set of interactive-loop transitions;
  // duplicating an unconditional "running" here would just be a redundant/contradictory event
  // on top of that existing, already-tested state machine.
  const isSubAgent = params.parentAgentId !== null;
  if (isSubAgent && !params.signal?.aborted) {
    emitEvent(params, {
      version: 1,
      id: randomUUID(),
      timestamp: nowIso(),
      type: "agent_status",
      agentId: params.agentId,
      status: "running",
    });
  }
  emitLog(params, {
    type: "header",
    version: 1,
    sessionId: params.sessionId,
    agentId: params.agentId,
    parentAgentId: params.parentAgentId,
    spawnedAt: nowIso(),
    model: params.model,
    instructionsSummary: params.instruction.slice(0, 200),
    client: params.client,
    build: BUILD_INFO,
    ...(params.description !== undefined ? { description: params.description } : {}),
    ...(params.resume ? { resumedFrom: { sessionId: params.resume.fromSessionId } } : {}),
  });
  emitLog(params, {
    version: 1,
    timestamp: nowIso(),
    type: "message",
    role: "user",
    content: params.instruction,
  });
  if (isSubAgent && !params.signal?.aborted) {
    emitLog(params, {
      version: 1,
      timestamp: nowIso(),
      type: "status_change",
      status: "running",
    });
  }

  let turns = 0;
  let finalText = "";
  // DH-0050: set once the missed-call nudge has been sent, so it's only ever injected once
  // per run — the second consecutive non-tool-use turn falls through to the legacy fallback
  // regardless of whether the model complied.
  let nudged = false;
  // DH-0010 Part B: the previous turn's usage (the compaction trigger's own proxy for
  // "current context size") and a one-shot guard so a trigger compacts at most once — see
  // `performCompaction`'s doc comment and the trigger check below.
  let lastUsage: ProviderUsage | undefined;
  let justCompacted = false;

  while (turns < maxTurns) {
    if (params.signal?.aborted) {
      return reportStopped(params, finalText, turns, STOPPED_BETWEEN_TURNS_REASON);
    }
    turns += 1;

    // DH-0010 Part B: trigger check, top of every turn, before the provider call — compacts
    // at most once per trigger (a second consecutive turn hitting this check, immediately
    // after a compaction, is skipped; if the compacted request itself still overflows, the
    // context_overflow catch below is the safety net rather than compaction-looping).
    if (justCompacted) {
      justCompacted = false;
    } else if (
      params.compaction?.enabled &&
      binding.contextWindow !== undefined &&
      lastUsage !== undefined
    ) {
      const thresholdPercent = params.compaction.thresholdPercent ?? 80;
      const contextTokens = contextTokensOf(lastUsage);
      if (contextTokens >= (binding.contextWindow * thresholdPercent) / 100) {
        await performCompaction(params, binding, messages, contextTokens);
        justCompacted = true;
      }
    }

    // DH-0002: computed fresh every turn (not once before the loop) so a `deferred` MCP
    // tool that ToolSearch activates mid-conversation becomes visible to the provider on
    // the very next turn, and so tools that connect asynchronously after runtime startup
    // (McpManager.connectAll() resolving) are picked up without any extra plumbing — this
    // reads `params.tools` fresh, and runtime.ts mutates that same Map in place as servers
    // connect. Built-ins never set `deferred`, so with no `mcpServers` configured (or none
    // of their tools activated) this filter is a no-op and the provider sees exactly the
    // same tool list every turn as before this change — see loop.test.ts's explicit
    // behavioral-identity test.
    const toolDefs = [...params.tools.values()]
      .filter((t) => !(t.deferred && !params.toolContext.activatedTools.has(t.name)))
      .map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
      }));

    if (pendingMessages.length > 0) {
      const injected = pendingMessages.splice(0, pendingMessages.length).join("\n");
      messages.push({ role: "user", content: [{ type: "text", text: injected }] });
      emitLog(params, {
        version: 1,
        timestamp: nowIso(),
        type: "message",
        role: "user",
        content: injected,
      });
    }

    // DH-0044 D5: per-turn coalescing state for the provider's `onTextDelta` side-channel.
    // `streamBuffer` holds text not yet flushed as an `agent_output` event; `streamedSoFar`
    // is the full accumulated text streamed *this turn* regardless of flush state (used only
    // for the mid-turn-error partial log line below). `deltaCount` distinguishes "this
    // provider streamed nothing" (fallback: emit one whole-turn agent_output, exactly as
    // before this change) from "it streamed, and the buffer's already been flushed live".
    let streamBuffer = "";
    let streamedSoFar = "";
    let deltaCount = 0;
    let flushTimer: ReturnType<typeof setTimeout> | null = null;

    function flushStreamBuffer(): void {
      if (flushTimer !== null) {
        clearTimeout(flushTimer);
        flushTimer = null;
      }
      if (streamBuffer.length === 0) return;
      const chunk = streamBuffer;
      streamBuffer = "";
      emitEvent(params, {
        version: 1,
        id: randomUUID(),
        timestamp: nowIso(),
        type: "agent_output",
        agentId: params.agentId,
        chunk,
      });
    }

    function onTextDelta(delta: string): void {
      deltaCount += 1;
      streamedSoFar += delta;
      streamBuffer += delta;
      if (Buffer.byteLength(streamBuffer, "utf8") >= STREAM_FLUSH_BYTES) {
        flushStreamBuffer();
        return;
      }
      if (flushTimer === null) {
        flushTimer = setTimeout(() => {
          flushTimer = null;
          flushStreamBuffer();
        }, STREAM_FLUSH_INTERVAL_MS);
      }
    }

    let completion: ProviderCompletionResult;
    try {
      completion = await binding.provider.complete(
        {
          model: binding.providerModel,
          system: params.systemPrompt,
          messages,
          tools: toolDefs,
          ...(binding.thinking !== undefined ? { thinking: binding.thinking } : {}),
          ...(binding.cache !== undefined ? { cache: binding.cache } : {}),
        },
        params.signal,
        { onTextDelta },
      );
    } catch (err) {
      // D5.3: mid-turn error/stop with partial output — flush whatever's buffered, then
      // record the accumulated partial text as its own `message` log line (marked
      // `partial: true`) so text an operator watched stream live doesn't vanish from the
      // durable log just because the turn never completed normally. Only when at least one
      // delta actually arrived — a provider that failed before streaming anything (or one
      // that doesn't stream at all) has nothing partial to record here.
      flushStreamBuffer();
      if (deltaCount > 0) {
        emitLog(params, {
          version: 1,
          timestamp: nowIso(),
          type: "message",
          role: "assistant",
          content: streamedSoFar,
          partial: true,
        });
      }
      if (params.signal?.aborted) {
        return reportStopped(params, finalText, turns, STOPPED_DURING_PROVIDER_CALL_REASON);
      }
      // DH-0010 Part B: a context-window overflow (disabled compaction, or a
      // pathologically-oversized single turn even with compaction enabled) is a graceful
      // agent failure with an actionable reason, never an uncaught crash.
      if (err instanceof ProviderError && err.kind === "context_overflow") {
        const reason =
          "context window exceeded; enable compaction (compaction.enabled in dh.json) or reduce task scope";
        emitEvent(params, {
          version: 1,
          id: randomUUID(),
          timestamp: nowIso(),
          type: "agent_status",
          agentId: params.agentId,
          status: "failed",
        });
        emitLog(params, { version: 1, timestamp: nowIso(), type: "failed", reason });
        return { success: false, finalOutput: finalText, turns };
      }
      throw err;
    }

    messages.push({ role: "assistant", content: completion.content });

    // D5.4 ordering guarantee: flush is synchronous, right here, before any other event this
    // turn emits (token_usage, agent_status, or the next turn's tool_call) — so no later
    // event can ever precede this turn's last streamed chunk.
    flushStreamBuffer();

    // DH-0045 §5: walk this turn's content blocks in order — a non-empty `thinking` block
    // emits SSE `agent_thinking` + JSONL `thinking`; a `redacted_thinking` block emits both
    // with `redacted: true` and empty content (ciphertext never enters the SSE stream or the
    // JSONL log); an empty-text thinking block (`display: "omitted"`) emits nothing.
    for (const block of completion.content) {
      if (block.type === "thinking" && block.thinking.length > 0) {
        emitEvent(params, {
          version: 1,
          id: randomUUID(),
          timestamp: nowIso(),
          type: "agent_thinking",
          agentId: params.agentId,
          chunk: block.thinking,
        });
        emitLog(params, {
          version: 1,
          timestamp: nowIso(),
          type: "thinking",
          content: block.thinking,
          redacted: false,
        });
      } else if (block.type === "redacted_thinking") {
        emitEvent(params, {
          version: 1,
          id: randomUUID(),
          timestamp: nowIso(),
          type: "agent_thinking",
          agentId: params.agentId,
          chunk: "",
          redacted: true,
        });
        emitLog(params, {
          version: 1,
          timestamp: nowIso(),
          type: "thinking",
          content: "",
          redacted: true,
        });
      }
    }

    const text = textOf(completion.content);
    if (text.length > 0) {
      // D5.2: the old whole-turn `agent_output` emission is removed except as a fallback —
      // a provider that streamed at least one delta already emitted its output live above
      // (via onTextDelta/flushStreamBuffer); a provider that ignored `callbacks` entirely
      // (zero deltas) still needs its output to reach clients somehow, so it gets exactly
      // today's whole-turn event instead.
      if (deltaCount === 0) {
        emitEvent(params, {
          version: 1,
          id: randomUUID(),
          timestamp: nowIso(),
          type: "agent_output",
          agentId: params.agentId,
          chunk: text,
        });
      }
      // The JSONL log stays turn-granular regardless of streaming — one `message` line per
      // completed turn, always the full text from `completion.content` (the single source of
      // truth), never the chunked stream.
      emitLog(params, {
        version: 1,
        timestamp: nowIso(),
        type: "message",
        role: "assistant",
        content: text,
      });
      finalText = text;
    }

    lastUsage = completion.usage;
    const costUsd = computeCostUsd(
      binding.pricing,
      completion.usage.inputTokens,
      completion.usage.outputTokens,
      completion.usage.cacheReadTokens ?? 0,
      completion.usage.cacheWriteTokens ?? 0,
    );
    emitEvent(params, {
      version: 1,
      id: randomUUID(),
      timestamp: nowIso(),
      type: "token_usage",
      agentId: params.agentId,
      inputTokens: completion.usage.inputTokens,
      outputTokens: completion.usage.outputTokens,
      ...(completion.usage.cacheReadTokens !== undefined
        ? { cacheReadTokens: completion.usage.cacheReadTokens }
        : {}),
      ...(completion.usage.cacheWriteTokens !== undefined
        ? { cacheWriteTokens: completion.usage.cacheWriteTokens }
        : {}),
      ...(costUsd !== undefined ? { costUsd } : {}),
    });
    emitLog(params, {
      version: 1,
      timestamp: nowIso(),
      type: "token_usage",
      inputTokens: completion.usage.inputTokens,
      outputTokens: completion.usage.outputTokens,
      ...(completion.usage.cacheReadTokens !== undefined
        ? { cacheReadTokens: completion.usage.cacheReadTokens }
        : {}),
      ...(completion.usage.cacheWriteTokens !== undefined
        ? { cacheWriteTokens: completion.usage.cacheWriteTokens }
        : {}),
      ...(costUsd !== undefined ? { costUsd } : {}),
    });

    if (completion.stopReason !== "tool_use") {
      if (!params.interactive) {
        // DH-0050 precedence tier 2: a non-tool-use turn that never produced a valid
        // ReportOutcome call gets exactly one harness-injected reminder turn before falling
        // back to the legacy marker scan. A max_tokens truncation skips the nudge entirely —
        // nudging a model whose response is already being cut off just truncates again, so it
        // goes straight to the unconditional failure it always has.
        if (completion.stopReason !== "max_tokens" && params.hasPendingChildren?.()) {
          // DH-0140: this agent has its own spawned children still running/waiting — it's
          // deliberately waiting on them, not a forgotten self-report. Skip the nudge (and
          // don't mark `nudged`) and just start another turn; the legacy fallback below still
          // applies once the children finish, if the agent keeps ending turns with no tool
          // call after that.
          continue;
        }
        if (completion.stopReason !== "max_tokens" && !nudged) {
          nudged = true;
          messages.push({
            role: "user",
            content: [{ type: "text", text: REPORT_OUTCOME_NUDGE_MESSAGE }],
          });
          emitLog(params, {
            version: 1,
            timestamp: nowIso(),
            type: "message",
            role: "user",
            content: REPORT_OUTCOME_NUDGE_MESSAGE,
          });
          continue;
        }

        const reportedBy: OutcomeReportedBy =
          completion.stopReason === "max_tokens"
            ? "max-tokens"
            : finalText.includes(TASK_FAILED_MARKER)
              ? "text-marker"
              : "clean-end";
        const success = reportedBy === "clean-end";
        emitEvent(params, {
          version: 1,
          id: randomUUID(),
          timestamp: nowIso(),
          type: "agent_status",
          agentId: params.agentId,
          status: success ? "done" : "failed",
        });
        emitLog(
          params,
          success
            ? { version: 1, timestamp: nowIso(), type: "completed", success: true }
            : {
                version: 1,
                timestamp: nowIso(),
                type: "failed",
                reason:
                  reportedBy === "max-tokens"
                    ? "response truncated at max_tokens before completion"
                    : "model reported TASK_FAILED",
              },
        );
        return { success, finalOutput: finalText, turns, reportedBy };
      }

      // Round 5, interactive mode: no self-report checking, no terminal return — pause and
      // wait for the operator's next message (or a genuine stop).
      emitEvent(params, {
        version: 1,
        id: randomUUID(),
        timestamp: nowIso(),
        type: "agent_status",
        agentId: params.agentId,
        status: "waiting",
      });
      emitLog(params, {
        version: 1,
        timestamp: nowIso(),
        type: "status_change",
        status: "waiting",
      });

      if (pendingMessages.length === 0 && !params.signal?.aborted) {
        await new Promise<void>((resolve) => {
          waitingResolve = resolve;
          params.signal?.addEventListener(
            "abort",
            () => {
              if (waitingResolve === resolve) {
                waitingResolve = null;
                resolve();
              }
            },
            { once: true },
          );
        });
      }

      if (params.signal?.aborted) {
        // DH-0059: a stop while paused in "waiting" (between turns, conversationally idle —
        // as opposed to STOPPED_BETWEEN_TURNS_REASON/STOPPED_DURING_PROVIDER_CALL_REASON,
        // which interrupt genuinely active work) is a graceful end of an interactive
        // conversation, not an interrupted task — `success: true` here is what lets
        // `session_ended` report exitCode 0 for an operator-ended waiting session (via
        // runtime.ts's `result.success ? Success : TaskFailure` mapping). See ADR 0005's
        // amendment note for the full reasoning.
        return reportStopped(params, finalText, turns, STOPPED_WHILE_WAITING_REASON, true);
      }

      emitEvent(params, {
        version: 1,
        id: randomUUID(),
        timestamp: nowIso(),
        type: "agent_status",
        agentId: params.agentId,
        status: "running",
      });
      emitLog(params, {
        version: 1,
        timestamp: nowIso(),
        type: "status_change",
        status: "running",
      });
      continue;
    }

    const toolUses = completion.content.filter(
      (b): b is Extract<ProviderContentBlock, { type: "tool_use" }> => b.type === "tool_use",
    );
    const toolResults = await runToolCalls(toolUses, params);
    messages.push({ role: "user", content: toolResults });

    // DH-0050 precedence tier 1: an authoritative ReportOutcome call, checked only for
    // non-interactive runs (the tool is never registered for interactive ones — see
    // runtime.ts/tools/index.ts). The turn this lands in is terminal: tool calls have already
    // run above; last valid ReportOutcome call in the turn wins if the model (incorrectly)
    // called it more than once.
    if (!params.interactive) {
      let reported: ReportedOutcome | null = null;
      for (const toolUse of toolUses) {
        if (toolUse.name !== REPORT_OUTCOME_TOOL_NAME) continue;
        const parsed = parseReportedOutcome(toolUse.input);
        if (parsed) reported = parsed;
      }
      if (reported) {
        const success = reported.status === "success";
        emitEvent(params, {
          version: 1,
          id: randomUUID(),
          timestamp: nowIso(),
          type: "agent_status",
          agentId: params.agentId,
          status: success ? "done" : "failed",
        });
        emitLog(
          params,
          success
            ? {
                version: 1,
                timestamp: nowIso(),
                type: "completed",
                success: true,
                outcome: reported,
              }
            : {
                version: 1,
                timestamp: nowIso(),
                type: "failed",
                reason: "model reported failure via ReportOutcome",
                outcome: reported,
              },
        );
        return { success, finalOutput: finalText, turns, outcome: reported, reportedBy: "tool" };
      }
    }
  }

  emitEvent(params, {
    version: 1,
    id: randomUUID(),
    timestamp: nowIso(),
    type: "agent_status",
    agentId: params.agentId,
    status: "failed",
  });
  emitLog(params, {
    version: 1,
    timestamp: nowIso(),
    type: "failed",
    reason: `exceeded max turns (${maxTurns}) without completing`,
  });
  return { success: false, finalOutput: finalText, turns, reportedBy: "max-turns" };
}
