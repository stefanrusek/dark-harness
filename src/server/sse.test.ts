import { describe, expect, test } from "bun:test";
import type { AgentOutputEvent } from "../contracts/index.ts";
import { formatSseEvent } from "./sse.ts";

describe("formatSseEvent", () => {
  test("encodes id and JSON data lines with the SSE record terminator", () => {
    const event: AgentOutputEvent = {
      version: 1,
      id: "evt-1",
      timestamp: "2026-07-15T00:00:00.000Z",
      type: "agent_output",
      agentId: "agent-1",
      chunk: "hello",
    };
    const wire = formatSseEvent(event);
    expect(wire).toBe(`id: evt-1\ndata: ${JSON.stringify(event)}\n\n`);
    expect(wire.endsWith("\n\n")).toBe(true);
  });

  test("never leaks a raw newline into the data line, even when chunk contains one", () => {
    const event: AgentOutputEvent = {
      version: 1,
      id: "evt-2",
      timestamp: "2026-07-15T00:00:00.000Z",
      type: "agent_output",
      agentId: "agent-1",
      chunk: "line one\nline two",
    };
    const wire = formatSseEvent(event);
    const lines = wire.split("\n");
    // id line, data line, then the two blank lines from the "\n\n" terminator.
    expect(lines).toHaveLength(4);
    expect(lines[0]).toBe("id: evt-2");
    expect(lines[1]?.startsWith("data: ")).toBe(true);
  });
});
