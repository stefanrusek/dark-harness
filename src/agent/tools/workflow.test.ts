// Unit tests for the Workflow tool (DH-0226) — script loading/dispatch surface. The
// agent()/parallel() primitive semantics themselves are covered in
// src/agent/workflow/runner.test.ts; this file covers the tool's own contract: path
// resolution, import failure, missing/non-function default export, script throw, and a
// realistic end-to-end multi-agent script run through this tool's real execute().

import { describe, expect, test } from "bun:test";
import path from "node:path";
import { makeToolContext } from "./test-helpers.ts";
import { workflowTool } from "./workflow.ts";

const FIXTURES_DIR = path.join(import.meta.dir, "../workflow/fixtures");

function withFakeSpawn(overrides: Parameters<typeof makeToolContext>[0] = {}) {
  const ctx = makeToolContext({
    cwd: FIXTURES_DIR,
    ...overrides,
    spawnAgent: () => "placeholder",
  });
  ctx.spawnAgent = ({ model, prompt, description }) =>
    ctx.tasks.start({
      kind: "agent",
      parentAgentId: ctx.agentId,
      model,
      ...(description !== undefined ? { description } : {}),
      run: async (handle) => {
        handle.append(`ran: ${prompt}`);
        if (prompt.includes("fail")) {
          throw new Error("sub-agent self-reported failure");
        }
      },
    });
  return ctx;
}

describe("Workflow tool", () => {
  test("rejects a missing script field", async () => {
    const ctx = withFakeSpawn();
    const result = await workflowTool.execute({}, ctx);
    expect(result.isError).toBe(true);
    expect(result.output).toContain("'script'");
  });

  test("script path that does not resolve to an importable file -> isError, names the path", async () => {
    const ctx = withFakeSpawn();
    const result = await workflowTool.execute({ script: "./does-not-exist.ts" }, ctx);
    expect(result.isError).toBe(true);
    expect(result.output).toContain("does-not-exist.ts");
    expect(result.output).toContain("Workflow tool error");
  });

  test("module with no callable default export -> isError, clear message", async () => {
    const ctx = withFakeSpawn();
    const result = await workflowTool.execute({ script: "./no-default-script.ts" }, ctx);
    expect(result.isError).toBe(true);
    expect(result.output).toContain("default export function");
  });

  test("no-default-script.ts's own (non-default) export still behaves as documented", async () => {
    const mod = await import("../workflow/fixtures/no-default-script.ts");
    expect(mod.notTheDefault()).toBe("nope");
  });

  test("script's default export throwing -> caught, isError, carries the error message", async () => {
    const ctx = withFakeSpawn();
    const result = await workflowTool.execute({ script: "./throwing-script.ts" }, ctx);
    expect(result.isError).toBe(true);
    expect(result.output).toContain("script exploded");
  });

  test("successful script run resolves to the coerced return value plus drained log", async () => {
    const ctx = withFakeSpawn();
    const result = await workflowTool.execute(
      { script: "./ok-script.ts", input: { foo: "bar" } },
      ctx,
    );
    expect(result.isError).toBe(false);
    expect(result.output).toContain('ok:{"foo":"bar"}');
    expect(result.output).toContain("starting");
  });

  test("input defaults to {} when omitted", async () => {
    const ctx = withFakeSpawn();
    const result = await workflowTool.execute({ script: "./ok-script.ts" }, ctx);
    expect(result.isError).toBe(false);
    expect(result.output).toContain("ok:{}");
  });

  test("end-to-end: a realistic multi-agent script fans out agent()+parallel() and a failed worker maps to null without failing the run", async () => {
    const ctx = withFakeSpawn();
    const result = await workflowTool.execute({ script: "./multi-agent-script.ts" }, ctx);
    expect(result.isError).toBe(false);
    expect(result.output).toContain("lead said: ran: plan the work");
    const parsed = JSON.parse(result.output.split("\n")[0] ?? "[]") as Array<string | null>;
    expect(parsed[0]).toContain("ran: worker one");
    expect(parsed[1]).toContain("ran: worker two");
    expect(parsed[2]).toBeNull();
  });
});
