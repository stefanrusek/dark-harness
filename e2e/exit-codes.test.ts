// Exit-code matrix (docs/handoffs/e2e.md scope item 7, ADR 0006): the real compiled binary,
// run with `--instructions <file> --job`, must report 0/1/2+ correctly for a self-reported
// success, a self-reported failure, and a harness error — all driven through the standalone
// dark-factory path (src/cli.ts's `main()`), never `--server`/TUI/Web.

import { afterEach, describe, expect, test } from "bun:test";
import { createCleanupRegistry } from "./support/cleanup.ts";
import { spawnDh } from "./support/dh-process.ts";
import {
  errorTurn,
  jobSuccessTurn,
  jobTaskFailedTurn,
  malformedTurn,
  startMockAnthropicProvider,
} from "./support/mock-provider.ts";
import { baseConfig, createWorkspace } from "./support/workspace.ts";

const cleanups = createCleanupRegistry();
afterEach(() => cleanups.runAll());

describe("exit-code matrix (--job)", () => {
  test("success: root agent self-reports completion -> exit 0", async () => {
    const provider = startMockAnthropicProvider([jobSuccessTurn("All done, no issues.")]);
    cleanups.addProcess(provider.stop);
    const ws = createWorkspace();
    cleanups.addWorkspace(ws.cleanup);
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

  test("self-reported failure: ReportOutcome(failure) -> exit 1", async () => {
    const provider = startMockAnthropicProvider([jobTaskFailedTurn()]);
    cleanups.addProcess(provider.stop);
    const ws = createWorkspace();
    cleanups.addWorkspace(ws.cleanup);
    ws.writeConfig(baseConfig(provider.baseURL));
    const instructionsPath = ws.writeFile("instructions.txt", "Do an impossible thing.");

    const proc = await spawnDh({
      args: ["--instructions", instructionsPath, "--job"],
      cwd: ws.dir,
    });
    const code = await proc.waitForExit();

    expect(code).toBe(1);
    expect(proc.stdout()).toContain("TASK_FAILED");
    expect(provider.callCount).toBe(1);
  });

  test("harness error: malformed dh.json -> exit 2+, never a raw crash", async () => {
    const ws = createWorkspace();
    cleanups.addWorkspace(ws.cleanup);
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
    cleanups.addWorkspace(ws.cleanup);
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

  // DH-0033: the mock provider can now inject a real provider-side failure (non-200 status,
  // or a 200 with a malformed body) instead of only ever returning a scripted completion.
  // First real discovery from actually exercising this end-to-end (not assumed up front):
  // neither provider adapter (src/agent/providers/anthropic.ts) implements its own
  // retry/backoff — DH-0009 (provider retry/backoff/error taxonomy) is still open
  // (`tracking/DH-0009-...md`, status: implementing) — but the underlying `@anthropic-ai/sdk`
  // client itself already retries retryable HTTP statuses (429/5xx) up to its default
  // `maxRetries` (2) before the adapter ever sees a rejection, so `provider.callCount` for a
  // single retryable-status failure is really 3 (1 initial + 2 SDK retries), not 1. A
  // malformed-but-200 response is not retried (no bad status to trigger it) — that one really
  // is a single call. Once DH-0009 adds harness-level retry/backoff on top, these
  // call-count assertions may need revisiting again (e.g. if it changes `maxRetries` via
  // client config); that's Core's call, not e2e's — this round's job was making the failure
  // injectable and asserting today's real, verified behavior.
  test("provider error: 429 rate limit -> exit 2+, harness error, never a raw crash", async () => {
    const provider = startMockAnthropicProvider([
      errorTurn(429, { error: { type: "rate_limit_error", message: "Rate limited" } }),
    ]);
    cleanups.addProcess(provider.stop);
    const ws = createWorkspace();
    cleanups.addWorkspace(ws.cleanup);
    ws.writeConfig(baseConfig(provider.baseURL));
    const instructionsPath = ws.writeFile("instructions.txt", "Do the thing.");

    const proc = await spawnDh({
      args: ["--instructions", instructionsPath, "--job"],
      cwd: ws.dir,
    });
    const code = await proc.waitForExit();

    expect(code).toBeGreaterThanOrEqual(2);
    // 1 initial attempt + the Anthropic SDK's own default 2 retries on a 429.
    expect(provider.callCount).toBe(3);
  });

  test("provider error: 500 upstream failure -> exit 2+, harness error", async () => {
    const provider = startMockAnthropicProvider([errorTurn(500)]);
    cleanups.addProcess(provider.stop);
    const ws = createWorkspace();
    cleanups.addWorkspace(ws.cleanup);
    ws.writeConfig(baseConfig(provider.baseURL));
    const instructionsPath = ws.writeFile("instructions.txt", "Do the thing.");

    const proc = await spawnDh({
      args: ["--instructions", instructionsPath, "--job"],
      cwd: ws.dir,
    });
    const code = await proc.waitForExit();

    expect(code).toBeGreaterThanOrEqual(2);
    // 1 initial attempt + the Anthropic SDK's own default 2 retries on a 5xx.
    expect(provider.callCount).toBe(3);
  });

  test("provider error: malformed (non-JSON) response body -> exit 2+, never a raw crash", async () => {
    const provider = startMockAnthropicProvider([malformedTurn()]);
    cleanups.addProcess(provider.stop);
    const ws = createWorkspace();
    cleanups.addWorkspace(ws.cleanup);
    ws.writeConfig(baseConfig(provider.baseURL));
    const instructionsPath = ws.writeFile("instructions.txt", "Do the thing.");

    const proc = await spawnDh({
      args: ["--instructions", instructionsPath, "--job"],
      cwd: ws.dir,
    });
    const code = await proc.waitForExit();

    expect(code).toBeGreaterThanOrEqual(2);
    expect(provider.callCount).toBe(1);
  });

  test("provider error: mid-multi-turn failure (tool_use turn ok, resume call errors) -> exit 2+", async () => {
    const provider = startMockAnthropicProvider([
      {
        text: "Let me check.",
        toolCalls: [{ name: "Bash", input: { command: "echo hi" } }],
        stopReason: "tool_use",
      },
      errorTurn(529, { error: { type: "overloaded_error", message: "Overloaded" } }),
    ]);
    cleanups.addProcess(provider.stop);
    const ws = createWorkspace();
    cleanups.addWorkspace(ws.cleanup);
    ws.writeConfig(baseConfig(provider.baseURL));
    const instructionsPath = ws.writeFile("instructions.txt", "Do the thing.");

    const proc = await spawnDh({
      args: ["--instructions", instructionsPath, "--job"],
      cwd: ws.dir,
    });
    const code = await proc.waitForExit();

    expect(code).toBeGreaterThanOrEqual(2);
    // 1 successful tool_use turn + (1 initial + 2 SDK retries) on the failing resume call.
    expect(provider.callCount).toBe(4);
  });
});
