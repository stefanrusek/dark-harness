import { describe, expect, test } from "bun:test";
import { ExitCode, type SessionEndedEvent } from "../contracts/index.ts";
import { FakeAgentLoop } from "./__fixtures__/fake-agent-loop.ts";
import { waitForExitCode } from "./exit.ts";

function sessionEnded(exitCode: number): SessionEndedEvent {
  return {
    version: 1,
    id: "evt-1",
    timestamp: "2026-07-15T00:00:00.000Z",
    type: "session_ended",
    exitCode,
  };
}

describe("waitForExitCode", () => {
  test("resolves with 0 on a self-reported success", async () => {
    const loop = new FakeAgentLoop();
    const result = waitForExitCode(loop);
    loop.emitEvent(sessionEnded(0));
    expect(await result).toBe(ExitCode.Success);
  });

  test("resolves with 1 on a self-reported task failure", async () => {
    const loop = new FakeAgentLoop();
    const result = waitForExitCode(loop);
    loop.emitEvent(sessionEnded(1));
    expect(await result).toBe(ExitCode.TaskFailure);
  });

  test("collapses any other exitCode to the HarnessError floor (2)", async () => {
    const loop = new FakeAgentLoop();
    const result = waitForExitCode(loop);
    loop.emitEvent(sessionEnded(7));
    expect(await result).toBe(ExitCode.HarnessError);
  });

  test("ignores non-session_ended events and unsubscribes after resolving", async () => {
    const loop = new FakeAgentLoop();
    const result = waitForExitCode(loop);
    loop.emitEvent({
      version: 1,
      id: "evt-0",
      timestamp: "2026-07-15T00:00:00.000Z",
      type: "agent_status",
      agentId: "a1",
      status: "running",
    });
    loop.emitEvent(sessionEnded(0));
    expect(await result).toBe(ExitCode.Success);

    // A second session_ended after resolution must not throw or double-resolve; the
    // listener should already have been removed.
    expect(() => loop.emitEvent(sessionEnded(1))).not.toThrow();
  });
});
