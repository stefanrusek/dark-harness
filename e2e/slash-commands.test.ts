// PTY-driven e2e coverage for DH-0093's client-side slash-command system (the final,
// E2E-owned round of that ticket — Contracts/Server/Core and TUI/Web are already merged).
// This exercises the real compiled binary's TUI against a real mock Anthropic-compatible
// provider (e2e/support/mock-provider.ts), asserting on the mock's *recorded requests*, not
// just what renders on screen — the ticket explicitly calls for confirming the wire-level
// effect (provider-side model id on switch, zero calls for /help, expanded skill content on
// invocation), which no unit/integration test below the real binary substitutes for.

import { afterEach, describe, expect, test } from "bun:test";
import { ensureBuilt } from "./support/build.ts";
import { createCleanupRegistry } from "./support/cleanup.ts";
import { startMockAnthropicProvider, successTurn } from "./support/mock-provider.ts";
import { startTmuxSession } from "./support/tmux-pty.ts";
import { createWorkspace } from "./support/workspace.ts";

const cleanups = createCleanupRegistry();
afterEach(() => cleanups.runAll());

const GREET_SKILL = [
  "---",
  "name: greet",
  "description: says a friendly hello",
  "---",
  "",
  "Always greet the operator warmly before doing anything else.",
].join("\n");

describe("DH-0093 slash commands under a real PTY + mock provider", () => {
  test("/model switches the provider-side model id on the next request", async () => {
    const provider = startMockAnthropicProvider([
      successTurn("First reply"),
      successTurn("Second reply"),
    ]);
    cleanups.addProcess(provider.stop);
    const ws = createWorkspace();
    cleanups.addWorkspace(ws.cleanup);
    ws.writeConfig({
      options: { defaultModel: "model-a" },
      provider: [
        { name: "mock-provider", type: "anthropic", baseURL: provider.baseURL, apiKey: "test-key" },
      ],
      models: [
        { name: "model-a", provider: "mock-provider", model: "mock-model-a" },
        { name: "model-b", provider: "mock-provider", model: "mock-model-b" },
      ],
    });
    const dhBinary = await ensureBuilt();

    const session = startTmuxSession([dhBinary], { cwd: ws.dir, cols: 100, rows: 30 });
    cleanups.addProcess(session.kill);

    await session.waitFor((screen) => screen.includes("Dark Harness"));
    await session.waitFor((screen) => screen.includes("Root Agent"));

    // First real turn establishes the root agent and proves the baseline model id.
    session.sendText("hello there");
    await session.waitFor((screen) => screen.includes("> hello there"));
    session.sendKeys("Enter");
    await session.waitFor((screen) => screen.includes("First reply"), 15_000);
    expect(provider.callCount).toBe(1);
    expect(provider.requests[0]?.model).toBe("mock-model-a");

    // /model with no argument opens the picker, pre-selected on the active model
    // (model-a, index 0) — move down to model-b and confirm.
    session.sendText("/model");
    await session.waitFor((screen) => screen.includes("> /model"));
    session.sendKeys("Enter");
    const pickerScreen = await session.waitFor(
      (screen) => screen.includes("model-a") && screen.includes("model-b"),
    );
    expect(pickerScreen).toContain("[Enter] switch");
    expect(pickerScreen).toMatch(/model-a.*\[active, default\]|model-a.*active/);

    session.sendKeys("Down");
    session.sendKeys("Enter");
    await session.waitFor((screen) => screen.includes("switching model to model-b"));
    // Back on the root view, ready for the next chat turn.
    await session.waitFor((screen) => screen.includes("Root Agent"));

    session.sendText("hello again");
    await session.waitFor((screen) => screen.includes("> hello again"));
    session.sendKeys("Enter");
    await session.waitFor((screen) => screen.includes("Second reply"), 15_000);

    // The direct, load-bearing assertion: the *next* request to the mock provider actually
    // carried the new provider-side model id, not just a UI-level confirmation.
    expect(provider.callCount).toBe(2);
    expect(provider.requests[1]?.model).toBe("mock-model-b");
  }, 30_000);

  test("/help renders locally with zero calls to the provider", async () => {
    const provider = startMockAnthropicProvider([successTurn("should never be used")]);
    cleanups.addProcess(provider.stop);
    const ws = createWorkspace();
    cleanups.addWorkspace(ws.cleanup);
    ws.writeConfig({
      options: { defaultModel: "mock" },
      provider: [
        { name: "mock-provider", type: "anthropic", baseURL: provider.baseURL, apiKey: "test-key" },
      ],
      models: [{ name: "mock", provider: "mock-provider", model: "mock-model" }],
    });
    const dhBinary = await ensureBuilt();

    const session = startTmuxSession([dhBinary], { cwd: ws.dir, cols: 100, rows: 30 });
    cleanups.addProcess(session.kill);

    await session.waitFor((screen) => screen.includes("Dark Harness"));
    await session.waitFor((screen) => screen.includes("Root Agent"));

    session.sendText("/help");
    await session.waitFor((screen) => screen.includes("> /help"));
    session.sendKeys("Enter");
    await session.waitFor((screen) => screen.includes("Available commands:"));
    const helpScreen = session.capture();
    expect(helpScreen).toContain("/model");
    expect(helpScreen).toContain("/clear");
    expect(helpScreen).toContain("does NOT reset the agent's context");

    // Give any accidental network call a moment to land before asserting its absence.
    await Bun.sleep(500);
    expect(provider.callCount).toBe(0);
  }, 30_000);

  test("/skillname [args] delivers the expanded skill content to the provider", async () => {
    const provider = startMockAnthropicProvider([successTurn("Greeted!")]);
    cleanups.addProcess(provider.stop);
    const ws = createWorkspace();
    cleanups.addWorkspace(ws.cleanup);
    ws.writeFile("skills/greet/SKILL.md", GREET_SKILL);
    ws.writeConfig({
      options: { defaultModel: "mock" },
      provider: [
        { name: "mock-provider", type: "anthropic", baseURL: provider.baseURL, apiKey: "test-key" },
      ],
      models: [{ name: "mock", provider: "mock-provider", model: "mock-model" }],
      skillPaths: ["./skills"],
    });
    const dhBinary = await ensureBuilt();

    const session = startTmuxSession([dhBinary], { cwd: ws.dir, cols: 100, rows: 30 });
    cleanups.addProcess(session.kill);

    await session.waitFor((screen) => screen.includes("Dark Harness"));
    await session.waitFor((screen) => screen.includes("Root Agent"));

    session.sendText("/greet hello world");
    await session.waitFor((screen) => screen.includes("> /greet hello world"));
    session.sendKeys("Enter");
    // Local echo of the raw command, then the real completion.
    await session.waitFor((screen) => screen.includes("/greet hello world"));
    // DH-0165: give our own wait a shorter budget than the surrounding `test(...)` timeout
    // below, and log the last screen + provider call count on failure — otherwise bun's own
    // test-level timeout (which used to be set to the exact same 30_000ms as this wait) fires
    // first and swallows tmux-pty's own "timed out ... Last screen:" diagnostic before it ever
    // gets thrown, so a CI failure here rendered no useful information at all about what was
    // actually on screen or whether the mock provider was ever called.
    try {
      await session.waitFor((screen) => screen.includes("Greeted!"), 45_000);
    } catch (err) {
      console.error(`/skillname wait failed; provider.callCount=${provider.callCount}`);
      console.error(`last screen:\n${session.capture()}`);
      throw err;
    }

    expect(provider.callCount).toBe(1);
    const lastRequest = provider.requests[0] as { messages?: { content: unknown }[] };
    const messages = lastRequest.messages ?? [];
    const serialized = JSON.stringify(messages);
    expect(serialized).toContain("<command-name>/greet</command-name>");
    expect(serialized).toContain("<command-args>hello world</command-args>");
    expect(serialized).toContain("Always greet the operator warmly before doing anything else.");
  }, 60_000);
});
