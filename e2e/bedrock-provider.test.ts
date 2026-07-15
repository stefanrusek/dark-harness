// Bedrock-type provider e2e coverage (docs/handoffs/e2e.md gap 2b): until this round, the
// `bedrock`-type provider had unit-level adapter tests only (src/agent/providers/bedrock.test.ts,
// with an injected fake `BedrockClientLike`) and zero coverage of the real compiled binary
// actually driving it end-to-end. HANDOFF.md §5 names Bedrock as a first-class provider
// alongside Anthropic specifically for operators without Anthropic access, so an unexercised
// second provider is a real coverage gap.
//
// This drives the real, unmodified `BedrockProvider` (src/agent/providers/bedrock.ts) through
// the real compiled `dh` binary against a local mock Converse-API-shaped server
// (e2e/support/mock-bedrock-provider.ts), using the AWS SDK's own standard
// `AWS_ENDPOINT_URL_BEDROCK_RUNTIME` environment variable to redirect the real
// `BedrockRuntimeClient` — no source change, no client injection, no real AWS credentials or
// network egress.
//
// Deliberately uses a config where `ModelConfig.name` ("bedrock-mock", the friendly alias) and
// `ModelConfig.model` (a fake Bedrock model ARN/id) are different values, and asserts the
// mock's captured `modelId` path segment is the latter. Core's round 11
// (docs/handoffs/core.md) found and fixed a severe bug — every provider call sent `name`
// instead of `model` — via real hands-on testing against real AWS Bedrock; this scenario is
// built to catch exactly that class of regression automatically going forward.

import { afterEach, describe, expect, test } from "bun:test";
import type { DhConfig } from "../src/contracts/index.ts";
import { createCleanupRegistry } from "./support/cleanup.ts";
import { spawnDh } from "./support/dh-process.ts";
import {
  mockBedrockEnv,
  startMockBedrockProvider,
  successTurn,
} from "./support/mock-bedrock-provider.ts";
import { createWorkspace } from "./support/workspace.ts";

const cleanups = createCleanupRegistry();
afterEach(() => cleanups.runAll());

const BEDROCK_MODEL_ID = "anthropic.claude-3-5-sonnet-20241022-v2:0";

function bedrockConfig(): DhConfig {
  return {
    options: { defaultModel: "bedrock-mock" },
    provider: [{ name: "bedrock-provider", type: "bedrock", region: "us-east-1" }],
    models: [
      // Deliberately: `name` != `model`, mirroring Core round 11's bug class (sending the
      // friendly `name` instead of the real provider-side `model` id).
      { name: "bedrock-mock", provider: "bedrock-provider", model: BEDROCK_MODEL_ID },
    ],
  };
}

describe("bedrock-type provider (gap 2b)", () => {
  test("real binary drives the real BedrockProvider against a mock Converse endpoint -> exit 0", async () => {
    const provider = await startMockBedrockProvider([successTurn("All done via Bedrock.")]);
    cleanups.addProcess(provider.stop);
    const ws = createWorkspace();
    cleanups.addWorkspace(ws.cleanup);
    ws.writeConfig(bedrockConfig());
    const instructionsPath = ws.writeFile("instructions.txt", "Do the thing via Bedrock.");

    const proc = await spawnDh({
      args: ["--instructions", instructionsPath, "--job"],
      cwd: ws.dir,
      extraEnv: mockBedrockEnv(provider.baseURL),
    });
    const code = await proc.waitForExit();

    expect(code).toBe(0);
    expect(proc.stdout()).toContain("All done via Bedrock.");
    expect(provider.callCount).toBe(1);

    // The class of bug this scenario is built to catch: the real provider-side model id
    // (ModelConfig.model), not the friendly ModelConfig.name, must be what's sent on the wire.
    expect(provider.modelIds).toEqual([BEDROCK_MODEL_ID]);
    expect(provider.modelIds[0]).not.toBe("bedrock-mock");
  });

  test("self-reported failure over Bedrock -> exit 1, same TASK_FAILED convention as Anthropic", async () => {
    const provider = await startMockBedrockProvider([
      { text: "Could not complete the task. TASK_FAILED", stopReason: "end_turn" },
    ]);
    cleanups.addProcess(provider.stop);
    const ws = createWorkspace();
    cleanups.addWorkspace(ws.cleanup);
    ws.writeConfig(bedrockConfig());
    const instructionsPath = ws.writeFile(
      "instructions.txt",
      "Do an impossible thing via Bedrock.",
    );

    const proc = await spawnDh({
      args: ["--instructions", instructionsPath, "--job"],
      cwd: ws.dir,
      extraEnv: mockBedrockEnv(provider.baseURL),
    });
    const code = await proc.waitForExit();

    expect(code).toBe(1);
    expect(proc.stdout()).toContain("TASK_FAILED");
    expect(provider.modelIds).toEqual([BEDROCK_MODEL_ID]);
  });

  test("tool_use over Bedrock resumes the loop after a real tool call", async () => {
    const provider = await startMockBedrockProvider([
      {
        toolCalls: [{ name: "Bash", input: { command: "echo hi" } }],
        stopReason: "tool_use",
      },
      successTurn("Ran the command via Bedrock tool_use."),
    ]);
    cleanups.addProcess(provider.stop);
    const ws = createWorkspace();
    cleanups.addWorkspace(ws.cleanup);
    ws.writeConfig(bedrockConfig());
    const instructionsPath = ws.writeFile("instructions.txt", "Run echo hi via Bedrock.");

    const proc = await spawnDh({
      args: ["--instructions", instructionsPath, "--job"],
      cwd: ws.dir,
      extraEnv: mockBedrockEnv(provider.baseURL),
    });
    const code = await proc.waitForExit();

    expect(code).toBe(0);
    expect(proc.stdout()).toContain("Ran the command via Bedrock tool_use.");
    expect(provider.callCount).toBe(2);
    expect(provider.modelIds).toEqual([BEDROCK_MODEL_ID, BEDROCK_MODEL_ID]);

    // The second request's message history must carry the real tool_result back to Bedrock —
    // proves the loop actually resumed post-tool-call, not just that the tool fired.
    const secondRequest = provider.requests[1] as { messages?: unknown[] };
    const messages = secondRequest.messages ?? [];
    const hasToolResult = messages.some(
      (m) =>
        typeof m === "object" &&
        m !== null &&
        Array.isArray((m as { content?: unknown[] }).content) &&
        (m as { content: unknown[] }).content.some(
          (c) => typeof c === "object" && c !== null && "toolResult" in (c as object),
        ),
    );
    expect(hasToolResult).toBe(true);
  });
});
