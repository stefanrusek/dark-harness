// Exit-code matrix (docs/handoffs/e2e.md scope item 7, ADR 0006): the real compiled binary,
// run with `--instructions <file> --job`, must report 0/1/2+ correctly for a self-reported
// success, a self-reported failure, and a harness error — all driven through the standalone
// dark-factory path (src/cli.ts's `main()`), never `--server`/TUI/Web.

import { afterEach, describe, expect, test } from "bun:test";
import { spawnDh } from "./support/dh-process.ts";
import {
  startMockAnthropicProvider,
  successTurn,
  taskFailedTurn,
} from "./support/mock-provider.ts";
import { baseConfig, createWorkspace } from "./support/workspace.ts";

const cleanups: (() => void)[] = [];
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.();
});

describe("exit-code matrix (--job)", () => {
  test("success: root agent self-reports completion -> exit 0", async () => {
    const provider = startMockAnthropicProvider([successTurn("All done, no issues.")]);
    cleanups.push(provider.stop);
    const ws = createWorkspace();
    cleanups.push(ws.cleanup);
    ws.writeConfig(baseConfig(provider.baseURL));
    const instructionsPath = ws.writeFile("instructions.txt", "Do the thing.");

    const proc = await spawnDh({
      args: ["--instructions", instructionsPath, "--job"],
      cwd: ws.dir,
    });
    const code = await proc.waitForExit();

    expect(code).toBe(0);
    expect(proc.stdout()).toContain("All done, no issues.");
    expect(provider.callCount).toBe(1);
  });

  test("self-reported failure: TASK_FAILED marker -> exit 1", async () => {
    const provider = startMockAnthropicProvider([taskFailedTurn()]);
    cleanups.push(provider.stop);
    const ws = createWorkspace();
    cleanups.push(ws.cleanup);
    ws.writeConfig(baseConfig(provider.baseURL));
    const instructionsPath = ws.writeFile("instructions.txt", "Do an impossible thing.");

    const proc = await spawnDh({
      args: ["--instructions", instructionsPath, "--job"],
      cwd: ws.dir,
    });
    const code = await proc.waitForExit();

    expect(code).toBe(1);
    expect(proc.stdout()).toContain("TASK_FAILED");
  });

  test("harness error: malformed dh.json -> exit 2+, never a raw crash", async () => {
    const ws = createWorkspace();
    cleanups.push(ws.cleanup);
    ws.writeFile("dh.json", "{ this is not valid json");
    const instructionsPath = ws.writeFile("instructions.txt", "irrelevant — config fails first.");

    const proc = await spawnDh({
      args: ["--instructions", instructionsPath, "--job"],
      cwd: ws.dir,
    });
    const code = await proc.waitForExit();

    expect(code).toBeGreaterThanOrEqual(2);
    expect(proc.stderr()).toContain("dh:");
  });

  test("harness error: unknown model reference -> exit 2+", async () => {
    const ws = createWorkspace();
    cleanups.push(ws.cleanup);
    ws.writeConfig({
      options: { defaultModel: "does-not-exist" },
      provider: [{ name: "p", type: "anthropic", baseURL: "http://localhost:1", apiKey: "x" }],
      models: [{ name: "mock", provider: "p", model: "mock-model" }],
    });
    const instructionsPath = ws.writeFile("instructions.txt", "irrelevant.");

    const proc = await spawnDh({
      args: ["--instructions", instructionsPath, "--job"],
      cwd: ws.dir,
    });
    const code = await proc.waitForExit();

    expect(code).toBeGreaterThanOrEqual(2);
  });
});
