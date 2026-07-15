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

import { randomUUID } from "node:crypto";
import type { LogLine, ServerSentEvent } from "../contracts/index.ts";
import type {
  ModelProvider,
  ProviderCompletionResult,
  ProviderContentBlock,
  ProviderMessage,
} from "./providers/types.ts";
import type { Tool, ToolContext } from "./tools/types.ts";

export const TASK_FAILED_MARKER = "TASK_FAILED";
const DEFAULT_MAX_TURNS = 100;

// Round 3 (docs/handoffs/core.md status log): the two distinct points `signal` is checked,
// each with its own log reason so a "why did this stop" reader can tell which one fired.
export const STOPPED_BETWEEN_TURNS_REASON = "stopped by operator before starting the next turn";
export const STOPPED_DURING_PROVIDER_CALL_REASON =
  "stopped by operator while waiting for the model";

export interface AgentLoopParams {
  sessionId: string;
  agentId: string;
  parentAgentId: string | null;
  model: string;
  systemPrompt: string;
  instruction: string;
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

/** Reports a stopped-via-signal turn using the exact same shape a self-reported failure
 * already uses (`success: false`, `agent_status: failed`, a logged `failed` event) — Round
 * 3's docs/handoffs/core.md status log entry explains why a distinct "stopped" AgentStatus
 * wasn't introduced: TaskStop/stopAgent's existing task-registry bookkeeping for sub-agents
 * already collapses "stopped" into "failed" (`task.error = "stopped by TaskStop"`), so this
 * keeps the two mechanisms consistent instead of adding a status value only one of them
 * uses. */
function reportStopped(
  params: AgentLoopParams,
  finalText: string,
  turns: number,
  reason: string,
): AgentLoopResult {
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
  const messages: ProviderMessage[] = [
    { role: "user", content: [{ type: "text", text: params.instruction }] },
  ];
  const pendingMessages: string[] = [];
  params.registerSendMessage?.((message: string) => {
    pendingMessages.push(message);
  });

  emitEvent(params, {
    version: 1,
    id: randomUUID(),
    timestamp: nowIso(),
    type: "agent_spawned",
    agentId: params.agentId,
    parentAgentId: params.parentAgentId,
    model: params.model,
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
  });
  emitLog(params, {
    version: 1,
    timestamp: nowIso(),
    type: "message",
    role: "user",
    content: params.instruction,
  });

  const toolDefs = [...params.tools.values()].map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema,
  }));

  let turns = 0;
  let finalText = "";

  while (turns < maxTurns) {
    if (params.signal?.aborted) {
      return reportStopped(params, finalText, turns, STOPPED_BETWEEN_TURNS_REASON);
    }
    turns += 1;

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
          model: params.model,
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

    emitEvent(params, {
      version: 1,
      id: randomUUID(),
      timestamp: nowIso(),
      type: "token_usage",
      agentId: params.agentId,
      inputTokens: completion.usage.inputTokens,
      outputTokens: completion.usage.outputTokens,
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
    });

    if (completion.stopReason !== "tool_use") {
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
