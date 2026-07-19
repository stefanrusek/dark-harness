// Real end-to-end coverage for the Workflow tool (DH-0226): the compiled `dh --server`
// binary, driven over real HTTP/SSE, executing a genuine checked-in workflow script that
// fans out a real ad-hoc sub-agent via `wf.agent()` — mirrors the "Agent tool spawns a real
// sub-agent" test in server-protocol.test.ts, but scripts a `Workflow` tool_use turn instead
// of a direct `Agent` tool_use turn, proving the script-loader -> WorkflowApi -> spawnAgent
// path is real end to end, not just unit-tested against a fake ctx.spawnAgent.

import { afterEach, describe, expect, test } from "bun:test";
import type { AgentTreeResponse } from "../src/contracts/index.ts";
import { createCleanupRegistry } from "./support/cleanup.ts";
import {
  jobSuccessTurn,
  startMockAnthropicProvider,
  successTurn,
} from "./support/mock-provider.ts";
import { startDhServer } from "./support/port.ts";
import { connectSse } from "./support/sse-client.ts";
import { createWorkspace } from "./support/workspace.ts";

const cleanups = createCleanupRegistry();
afterEach(() => cleanups.runAll());

const WORKFLOW_SCRIPT = `
export default async function (wf) {
  const out = await wf.agent("Say hi as a workflow sub-agent.", {
    model: "sub",
    description: "workflow sub-agent",
  });
  wf.log("workflow finished");
  return \`workflow got: \${out}\`;
}
`;

describe("Workflow tool over real HTTP/SSE (DH-0226)", () => {
  test("a Workflow tool_use turn dynamic-imports a real script and fans out a real sub-agent via wf.agent()", async () => {
    const rootProvider = startMockAnthropicProvider([
      {
        toolCalls: [{ name: "Workflow", input: { script: "./workflow.ts" } }],
        stopReason: "tool_use",
      },
      successTurn("Root heard back from the workflow."),
    ]);
    cleanups.addProcess(rootProvider.stop);
    const subProvider = startMockAnthropicProvider([
      jobSuccessTurn("Sub-agent reporting in via workflow."),
    ]);
    cleanups.addProcess(subProvider.stop);

    const ws = createWorkspace();
    cleanups.addWorkspace(ws.cleanup);
    ws.writeFile("workflow.ts", WORKFLOW_SCRIPT);
    ws.writeConfig({
      options: { defaultModel: "mock" },
      provider: [
        { name: "root-provider", type: "anthropic", baseURL: rootProvider.baseURL, apiKey: "k" },
        { name: "sub-provider", type: "anthropic", baseURL: subProvider.baseURL, apiKey: "k" },
      ],
      models: [
        { name: "mock", provider: "root-provider", model: "mock-model" },
        { name: "sub", provider: "sub-provider", model: "mock-model" },
      ],
    });
    const { proc, port } = await startDhServer({ cwd: ws.dir });
    cleanups.addProcess(proc.kill);
    const baseUrl = `http://localhost:${port}`;

    const sse = await connectSse(baseUrl);
    cleanups.addProcess(sse.close);

    const postRes = await fetch(new URL("/api/commands", baseUrl), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        type: "send_message",
        agentId: "agent-root",
        message: "run the workflow",
      }),
    });
    expect(postRes.status).toBe(200);

    // The workflow script's own wf.agent() call spawns a real, independently-observable
    // sub-agent — the same signal server-protocol.test.ts's Agent-tool test uses to prove
    // real nesting rather than a hand-built fixture.
    const childSpawned = await sse.waitFor(
      (e) => e.type === "agent_spawned" && e.agentId !== "agent-root",
    );
    expect(childSpawned).toMatchObject({
      type: "agent_spawned",
      parentAgentId: "agent-root",
      model: "sub",
    });
    const childAgentId = (childSpawned as { agentId: string }).agentId;

    const childOutput = await sse.waitFor(
      (e) => e.type === "agent_output" && e.agentId === childAgentId,
    );
    expect(childOutput).toMatchObject({ chunk: "Sub-agent reporting in via workflow." });

    // Root's own follow-up turn (after the Workflow tool_result, which — because wf.agent()
    // blocks — already carries the sub-agent's output plus the script's wf.log() line) proves
    // the whole script ran synchronously inside the single Workflow tool call.
    const rootOutput = await sse.waitFor(
      (e) => e.type === "agent_output" && e.agentId === "agent-root" && e.chunk.length > 0,
    );
    expect(rootOutput).toMatchObject({ chunk: "Root heard back from the workflow." });

    await sse.waitFor(
      (e) => e.type === "agent_status" && e.agentId === "agent-root" && e.status === "waiting",
    );

    expect(rootProvider.callCount).toBe(2);
    expect(subProvider.callCount).toBe(1);

    // The tool_result the root's second turn was built from is only reachable indirectly over
    // this wire protocol (no raw-request introspection endpoint), so the strongest available
    // proof that the script's return value + wf.log() output actually reached the model is the
    // real nested-tree shape below plus the child's own real output above — both of which only
    // exist if the dynamic import, wf.agent() call, and blocking await all really happened.
    const treeRes = await fetch(new URL("/api/commands", baseUrl), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "request_agent_tree" }),
    });
    const treeBody = (await treeRes.json()) as AgentTreeResponse;
    expect(treeBody.tree).toEqual([
      {
        agentId: "agent-root",
        parentAgentId: null,
        model: "mock",
        status: "waiting",
        children: [
          {
            agentId: childAgentId,
            parentAgentId: "agent-root",
            model: "sub",
            description: "workflow sub-agent",
            status: "done",
            children: [],
          },
        ],
      },
    ]);
  }, 15_000);
});
