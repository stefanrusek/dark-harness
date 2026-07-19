import { describe, expect, test } from "bun:test";
import type { AgentOutputEvent, ServerSentEvent } from "../contracts/index.ts";
import { parseServerSentEventPayload } from "./sse-payload.ts";

function outputEvent(overrides: Partial<AgentOutputEvent> = {}): AgentOutputEvent {
  return {
    version: 1,
    id: "1",
    timestamp: "2026-07-15T00:00:00.000Z",
    type: "agent_output",
    agentId: "root",
    chunk: "hello",
    ...overrides,
  };
}

describe("parseServerSentEventPayload", () => {
  test("parses a valid ServerSentEvent JSON payload", () => {
    const event = outputEvent();
    const result = parseServerSentEventPayload(JSON.stringify(event));
    expect(result).toEqual(event);
  });

  test("returns null for malformed JSON", () => {
    const result = parseServerSentEventPayload("{not json");
    expect(result).toBeNull();
  });

  test("returns null for well-formed JSON missing required fields", () => {
    const result = parseServerSentEventPayload(JSON.stringify({ foo: "bar" }));
    expect(result).toBeNull();
  });

  test("DH-0089: accepts tool_call and tool_result event types", () => {
    const toolCall = {
      version: 1 as const,
      id: "1",
      timestamp: "2026-07-15T00:00:00.000Z",
      type: "tool_call" as const,
      agentId: "root",
      toolUseId: "tu_1",
      toolName: "Bash",
      inputSummary: "echo hi",
    };
    const toolResult = {
      version: 1 as const,
      id: "2",
      timestamp: "2026-07-15T00:00:00.000Z",
      type: "tool_result" as const,
      agentId: "root",
      toolUseId: "tu_1",
      toolName: "Bash",
      isError: false,
      durationMs: 12,
    };
    expect(parseServerSentEventPayload(JSON.stringify(toolCall))).toEqual(toolCall);
    expect(parseServerSentEventPayload(JSON.stringify(toolResult))).toEqual(toolResult);
  });

  // DH-0184: the canonical validator is a permissive shape-check with no event-type
  // allowlist — the TUI's pre-DH-0184 KNOWN_TYPES set was a confirmed latent bug that
  // silently dropped model_switched/resync/agent_thinking (all in the contracts
  // ServerSentEvent union and all handled by the TUI reducer). These three, plus any other
  // well-shaped-but-unrecognized type, must now parse through — filtering unknown types is
  // the reducer's job, not the transport's.
  test("accepts model_switched, resync, and agent_thinking — previously dropped by the TUI's KNOWN_TYPES allowlist bug", () => {
    const modelSwitched = {
      ...outputEvent(),
      type: "model_switched",
    } as unknown as ServerSentEvent;
    const resync = { ...outputEvent(), type: "resync" } as unknown as ServerSentEvent;
    const agentThinking = {
      ...outputEvent(),
      type: "agent_thinking",
    } as unknown as ServerSentEvent;
    expect(parseServerSentEventPayload(JSON.stringify(modelSwitched))).toEqual(modelSwitched);
    expect(parseServerSentEventPayload(JSON.stringify(resync))).toEqual(resync);
    expect(parseServerSentEventPayload(JSON.stringify(agentThinking))).toEqual(agentThinking);
  });

  test("tolerates an entirely unrecognized event type (permissive shape-check, no allowlist)", () => {
    const payload = { ...outputEvent(), type: "something_else" } as unknown as ServerSentEvent;
    const result = parseServerSentEventPayload(JSON.stringify(payload));
    expect(result).toEqual(payload);
  });

  test("returns null when version is not 1", () => {
    const payload = { ...outputEvent(), version: 2 };
    const result = parseServerSentEventPayload(JSON.stringify(payload));
    expect(result).toBeNull();
  });

  test("returns null when id is not a string", () => {
    const payload = { ...outputEvent(), id: 1 };
    const result = parseServerSentEventPayload(JSON.stringify(payload));
    expect(result).toBeNull();
  });

  test("returns null when timestamp is not a string", () => {
    const payload = { ...outputEvent(), timestamp: 12345 };
    const result = parseServerSentEventPayload(JSON.stringify(payload));
    expect(result).toBeNull();
  });

  test("returns null when type is not a string", () => {
    const payload = { ...outputEvent(), type: 42 };
    const result = parseServerSentEventPayload(JSON.stringify(payload));
    expect(result).toBeNull();
  });

  test("returns null for a JSON primitive (not an object)", () => {
    const result = parseServerSentEventPayload("42");
    expect(result).toBeNull();
  });

  test("returns null for JSON null", () => {
    const result = parseServerSentEventPayload("null");
    expect(result).toBeNull();
  });
});
