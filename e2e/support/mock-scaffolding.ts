// DH-0177: shared scaffolding for the two mock provider servers (`mock-provider.ts` for
// Anthropic, `mock-bedrock-provider.ts` for Bedrock). Both mocks accumulate scripted turns
// (text -> chunked streaming deltas), guard against an empty turn script, and clamp the
// call index once the script is exhausted (the last turn repeats forever). This module is
// the single source of that shared logic — the two mocks differ only in how they serialize
// a turn onto the wire (SSE vs. AWS event-stream binary framing), which stays provider-specific.

/** DH-0044: chunk size (chars) for splitting a scripted turn's `text` into multiple
 * streaming delta events. Small enough that a realistically "long" scripted turn (a few KB)
 * produces enough deltas to cross the agent loop's `STREAM_FLUSH_BYTES` threshold
 * (src/agent/loop.ts) more than once. Shared by both mock providers, whose streaming wire
 * formats differ but which both delta-chunk scripted text at this same granularity. */
export const TEXT_DELTA_CHUNK_SIZE = 64;

/** Splits `text` into chunks of at most `size` characters, in order. */
export function chunkText(text: string, size: number): string[] {
  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += size) {
    chunks.push(text.slice(i, i + size));
  }
  return chunks;
}

/** Throws if a mock provider was started with no scripted turns at all — both mocks require
 * at least one so the "index clamps to the last turn once exhausted" convention below has a
 * turn to clamp to. */
export function requireTurns<T>(turns: T[], providerName: string): void {
  if (turns.length === 0) {
    throw new Error(`${providerName} requires at least one scripted turn`);
  }
}

/** Both mocks consume `turns` in order, one per request; once exhausted the last turn repeats
 * (a safety net so a test that under-scripts doesn't hang the agent loop indefinitely — it
 * should still assert `callCount` to catch that). Shared index-clamp logic for that. */
export function clampTurnIndex(callCount: number, turnsLength: number): number {
  return Math.min(callCount, turnsLength - 1);
}

/** Common shape both `MockTurn` (mock-provider.ts) and `MockBedrockTurn`
 * (mock-bedrock-provider.ts) satisfy — just enough for the shared scripted-turn factories
 * below. Each mock's own turn type carries additional provider-specific optional fields
 * (e.g. `error`/`delayMs` for Anthropic, `toolUseId` inside its tool-call shape for
 * Bedrock); since every field here is optional, both concrete turn types are valid
 * instantiations of `T`. */
export interface ScriptedTurnLike {
  text?: string;
  toolCalls?: { name: string; input: unknown }[];
  stopReason?: "end_turn" | "tool_use" | "max_tokens";
}

/** Shorthand for the common case: one final plain-text completion, no tool calls. Use only
 * for interactive (server/TUI/Web) scripted turns — `ReportOutcome` is never registered as a
 * tool there (DH-0050), so a plain-text end_turn is the right shape. For non-interactive
 * (`--job`/sub-agent) turns, use `jobSuccessTurn` instead: a plain-text turn there gets one
 * harness-injected `REPORT_OUTCOME_NUDGE_MESSAGE` reminder turn first (loop.ts), doubling the
 * expected provider call count. */
export function successTurn<T extends ScriptedTurnLike>(text: string): T {
  return { text, stopReason: "end_turn" } as T;
}

/** A self-reported-failure completion per loop.ts's `TASK_FAILED_MARKER` convention. Same
 * interactive-only caveat as `successTurn` — use `jobTaskFailedTurn` for non-interactive
 * runs. */
export function taskFailedTurn<T extends ScriptedTurnLike>(
  text = "Could not complete the task. TASK_FAILED",
): T {
  return { text, stopReason: "end_turn" } as T;
}

/** DH-0115: non-interactive (`--job`/sub-agent) equivalent of `successTurn` — emits an
 * authoritative `ReportOutcome(status: "success")` tool call alongside the text so the turn
 * resolves in exactly one provider call (DH-0050 tier 1), instead of `successTurn`'s plain
 * end_turn, which triggers a harness-injected nudge turn first when `ReportOutcome` is never
 * called. Do not use for interactive (server/TUI/Web) scripted turns: `ReportOutcome` isn't a
 * registered tool there and the call would hit an unknown-tool error. */
export function jobSuccessTurn<T extends ScriptedTurnLike>(text: string): T {
  return {
    text,
    toolCalls: [{ name: "ReportOutcome", input: { status: "success", summary: text } }],
    stopReason: "tool_use",
  } as T;
}

/** Non-interactive equivalent of `taskFailedTurn` — emits an authoritative
 * `ReportOutcome(status: "failure")` tool call alongside the text, same rationale and
 * interactive-mode caveat as `jobSuccessTurn`. */
export function jobTaskFailedTurn<T extends ScriptedTurnLike>(
  text = "Could not complete the task. TASK_FAILED",
): T {
  return {
    text,
    toolCalls: [{ name: "ReportOutcome", input: { status: "failure", summary: text } }],
    stopReason: "tool_use",
  } as T;
}
