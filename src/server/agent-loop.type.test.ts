// agent-loop.type.ts is Server's own definition of the minimal shape it needs from Core's real
// agent loop (see the file's header comment). It's type-only — no runtime statements of its
// own — but the contract it defines (the Unsubscribe pattern, the listener signatures, the
// per-command methods) is exercised everywhere in this domain via FakeAgentLoop, the
// reference implementation of AgentLoopHandle. This test asserts that contract directly
// against agent-loop.type.ts's own exported types, rather than relying on it being incidentally
// covered by commands.test.ts/exit.test.ts.

import { describe, expect, test } from "bun:test";
import type {
  AgentTreeNode,
  LogLine,
  ModelInfo,
  ServerSentEvent,
  SkillInfo,
} from "../contracts/index.ts";
import type { AgentLoopHandle } from "./agent-loop.type.ts";
import { FakeAgentLoop } from "./fake-agent-loop.ts";

// Statically confirm FakeAgentLoop really implements every member agent-loop.type.ts declares —
// if the interface grows a member the fake doesn't provide, this line stops compiling.
const asHandle: AgentLoopHandle = new FakeAgentLoop();
void asHandle;

describe("AgentLoopHandle contract (via FakeAgentLoop)", () => {
  test("onEvent subscribes a listener that receives emitted events, until unsubscribed", () => {
    const loop = new FakeAgentLoop();
    const received: ServerSentEvent[] = [];
    const unsubscribe = loop.onEvent((event) => received.push(event));

    const event: ServerSentEvent = {
      type: "agent_status",
      agentId: "agent-1",
      status: "running",
    } as unknown as ServerSentEvent;
    loop.emitEvent(event);
    expect(received).toEqual([event]);

    unsubscribe();
    loop.emitEvent(event);
    // No further delivery once unsubscribed.
    expect(received).toEqual([event]);
  });

  test("onLog subscribes a listener that receives (agentId, line) pairs, until unsubscribed", () => {
    const loop = new FakeAgentLoop();
    const received: Array<{ agentId: string; line: LogLine }> = [];
    const unsubscribe = loop.onLog((agentId, line) => received.push({ agentId, line }));

    const line: LogLine = {
      type: "header",
      sessionId: "s1",
      agentId: "a1",
      parentAgentId: null,
      spawnedAt: "2026-01-01T00:00:00.000Z",
      model: "m",
    } as unknown as LogLine;
    loop.emitLog("agent-1", line);
    expect(received).toEqual([{ agentId: "agent-1", line }]);

    unsubscribe();
    loop.emitLog("agent-1", line);
    expect(received).toEqual([{ agentId: "agent-1", line }]);
  });

  test("multiple independent onEvent subscribers each receive every event", () => {
    const loop = new FakeAgentLoop();
    const a: ServerSentEvent[] = [];
    const b: ServerSentEvent[] = [];
    loop.onEvent((e) => a.push(e));
    loop.onEvent((e) => b.push(e));

    const event = {
      type: "agent_status",
      agentId: "x",
      status: "done",
    } as unknown as ServerSentEvent;
    loop.emitEvent(event);

    expect(a).toEqual([event]);
    expect(b).toEqual([event]);
  });

  test("sendMessage forwards agentId and message through the handle", () => {
    const loop = new FakeAgentLoop();
    const handle: AgentLoopHandle = loop;
    handle.sendMessage("agent-7", "hello there");
    expect(loop.sentMessages).toEqual([{ agentId: "agent-7", message: "hello there" }]);
  });

  test("stopAgent forwards the target agentId through the handle", () => {
    const loop = new FakeAgentLoop();
    const handle: AgentLoopHandle = loop;
    handle.stopAgent("agent-9");
    expect(loop.stoppedAgents).toEqual(["agent-9"]);
  });

  test("getAgentTree returns the current tree snapshot", () => {
    const loop = new FakeAgentLoop();
    const handle: AgentLoopHandle = loop;
    expect(handle.getAgentTree()).toEqual([]);

    const tree: AgentTreeNode[] = [
      { agentId: "root", parentAgentId: null, model: "m", status: "running", children: [] },
    ];
    loop.setAgentTree(tree);
    expect(handle.getAgentTree()).toBe(tree);
  });

  test("listModels returns the configured model catalog", () => {
    const loop = new FakeAgentLoop();
    const handle: AgentLoopHandle = loop;
    expect(handle.listModels()).toEqual([]);

    const models: ModelInfo[] = [
      {
        name: "default",
        provider: "anthropic",
        model: "claude-x",
        isDefault: true,
        isActive: true,
      },
    ];
    loop.setModels(models);
    expect(handle.listModels()).toBe(models);
  });

  test("switchModel forwards agentId and model through the handle", () => {
    const loop = new FakeAgentLoop();
    const handle: AgentLoopHandle = loop;
    handle.switchModel("root", "fast-model");
    expect(loop.switchedModels).toEqual([{ agentId: "root", model: "fast-model" }]);
  });

  test("listSkills returns the configured skill catalog", () => {
    const loop = new FakeAgentLoop();
    const handle: AgentLoopHandle = loop;
    expect(handle.listSkills()).toEqual([]);

    const skills: SkillInfo[] = [{ name: "sm", description: "Sugar Maple filestore" }];
    loop.setSkills(skills);
    expect(handle.listSkills()).toBe(skills);
  });

  test("invokeSkill forwards agentId, skill, and optional args through the handle", async () => {
    const loop = new FakeAgentLoop();
    const handle: AgentLoopHandle = loop;
    await handle.invokeSkill("agent-1", "sm", "read foo.md");
    await handle.invokeSkill("agent-1", "sm", undefined);
    expect(loop.invokedSkills).toEqual([
      { agentId: "agent-1", skill: "sm", args: "read foo.md" },
      { agentId: "agent-1", skill: "sm", args: undefined },
    ]);
  });
});
