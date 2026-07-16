// The agent loop (docs/handoffs/core.md §4). Takes a system prompt, a model, a starting
// instruction, runs tool-call turns against a ModelProvider until the model signals
// completion, and emits ServerSentEvent-shaped events + LogLine-shaped log lines via plain
// callbacks — the Server domain wires these to real HTTP/SSE + JSONL sinks. This module
// never imports src/server/.
//
// SELF-REPORT CONVENTION (a design decision this round explicitly had to make — see
// docs/handoffs/core.md status log for the cross-domain request to Prompt): the loop ends
// when the model produces a turn with no tool calls (stopReason !== "tool_use"). The final
// assistant text is scanned for the literal marker `TASK_FAILED` (case-sensitive, anywhere
// in the text); its presence means self-reported failure, its absence means success. A
// max_tokens stop on a no-tool-call turn is always treated as failure (the response is
// truncated, not a deliberate completion). The system prompt must instruct the model to
// emit `TASK_FAILED` when it cannot complete its instructions — that's a request to the
// Prompt domain, not implemented here.
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
import type { LogLine, ServerSentEvent, SessionClientKind } from "../contracts/index.ts";
import type {
  ModelProvider,
  ProviderCompletionResult,
  ProviderContentBlock,
  ProviderMessage,
} from "./providers/types.ts";
import { summarizeToolInput } from "./tool-summary.ts";
import type { Tool, ToolContext } from "./tools/types.ts";

export const TASK_FAILED_MARKER = "TASK_FAILED";
const DEFAULT_MAX_TURNS = 100;

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
  pricing?: { inputPricePerMToken?: number; outputPricePerMToken?: number };
  /** Round 8 (ADR 0005 amendment): how the process that owns this session was invoked — see
   * SessionClientKind's own doc comment in src/contracts/log.ts. Required (not defaulted) so
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
}

/** Computes a `token_usage` event's `costUsd`, or undefined if pricing wasn't configured at
 * all for this model. If only one side of the split (input/output) is configured, the other
 * side is treated as $0/MToken rather than making the whole result undefined — a partial
 * price is still a real, deliberately-configured value, not "unconfigured". */
function computeCostUsd(
  pricing: AgentLoopParams["pricing"],
  inputTokens: number,
  outputTokens: number,
): number | undefined {
  if (
    !pricing ||
    (pricing.inputPricePerMToken === undefined && pricing.outputPricePerMToken === undefined)
  ) {
    return undefined;
  }
  const inputCost = ((pricing.inputPricePerMToken ?? 0) * inputTokens) / 1_000_000;
  const outputCost = ((pricing.outputPricePerMToken ?? 0) * outputTokens) / 1_000_000;
  return inputCost + outputCost;
}

export interface AgentLoopResult {
  success: boolean;
  finalOutput: string;
  turns: number;
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

  let turns = 0;
  let finalText = "";

  while (turns < maxTurns) {
    if (params.signal?.aborted) {
      return reportStopped(params, finalText, turns, STOPPED_BETWEEN_TURNS_REASON);
    }
    turns += 1;

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

    let completion: ProviderCompletionResult;
    try {
      completion = await params.provider.complete(
        {
          model: params.providerModel,
          system: params.systemPrompt,
          messages,
          tools: toolDefs,
        },
        params.signal,
      );
    } catch (err) {
      if (params.signal?.aborted) {
        return reportStopped(params, finalText, turns, STOPPED_DURING_PROVIDER_CALL_REASON);
      }
      throw err;
    }

    messages.push({ role: "assistant", content: completion.content });

    const text = textOf(completion.content);
    if (text.length > 0) {
      emitEvent(params, {
        version: 1,
        id: randomUUID(),
        timestamp: nowIso(),
        type: "agent_output",
        agentId: params.agentId,
        chunk: text,
      });
      emitLog(params, {
        version: 1,
        timestamp: nowIso(),
        type: "message",
        role: "assistant",
        content: text,
      });
      finalText = text;
    }

    const costUsd = computeCostUsd(
      params.pricing,
      completion.usage.inputTokens,
      completion.usage.outputTokens,
    );
    emitEvent(params, {
      version: 1,
      id: randomUUID(),
      timestamp: nowIso(),
      type: "token_usage",
      agentId: params.agentId,
      inputTokens: completion.usage.inputTokens,
      outputTokens: completion.usage.outputTokens,
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
        const success =
          completion.stopReason !== "max_tokens" && !finalText.includes(TASK_FAILED_MARKER);
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
                  completion.stopReason === "max_tokens"
                    ? "response truncated at max_tokens before completion"
                    : "model reported TASK_FAILED",
              },
        );
        return { success, finalOutput: finalText, turns };
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
  return { success: false, finalOutput: finalText, turns };
}
