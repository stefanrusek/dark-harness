// DH-0189: proves `dh --import <path>` end-to-end against the REAL compiled binary — not
// just src/server/import-claude-session.test.ts's unit-level round-trip through
// replayAgentHistory, and not just src/cli.test.ts's mocked-deps flag/wiring tests. DH-0187's
// governing insight ("import writes logs, resume replays them") is only actually proven once
// a real Claude Code-shaped transcript survives translation into a new `.dh-logs/<sessionId>`
// directory AND the real `--resume` launch path folds it back into a live model turn against
// a real (mock) provider — the exact "looks right in a unit test but needs a real end-to-end
// proof" risk this ticket's Notes call out.

import { afterEach, describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createCleanupRegistry } from "./support/cleanup.ts";
import { spawnDh } from "./support/dh-process.ts";
import { jobSuccessTurn, startMockAnthropicProvider } from "./support/mock-provider.ts";
import { baseConfig, createWorkspace } from "./support/workspace.ts";

const cleanups = createCleanupRegistry();
afterEach(() => cleanups.runAll());

/** A minimal, real-shaped Claude Code transcript line (one prior user turn) — enough to prove
 * translation + fold without pulling in a full synthetic fixture (that level of shape
 * coverage already lives in src/server/import-claude-session.test.ts). */
function ccUserLine(text: string): string {
  return JSON.stringify({
    parentUuid: null,
    isSidechain: false,
    type: "user",
    timestamp: "2026-07-18T00:00:00.000Z",
    sessionId: "cc-original-session",
    message: { role: "user", content: text },
  });
}

describe("dh --import <path> (DH-0187/DH-0189, real binary + mock provider)", () => {
  test("live-mode .jsonl import produces a resumable session the real --resume path replays and runs", async () => {
    const provider = startMockAnthropicProvider([
      jobSuccessTurn("Picked up right where the imported session left off."),
    ]);
    cleanups.addProcess(provider.stop);
    const ws = createWorkspace();
    cleanups.addWorkspace(ws.cleanup);
    ws.writeConfig(baseConfig(provider.baseURL));

    // A live single-session transcript path (DH-0187 Decision 1's "live mode") — no
    // manifest.json, no sidecar, just the bare `<id>.jsonl` a real
    // `~/.claude/projects/<slug>/<id>.jsonl` would be.
    const sourcePath = ws.writeFile(
      "claude-projects/some-project/cc-original-session.jsonl",
      `${ccUserLine("Please refactor the auth module.")}\n`,
    );
    const instructionsPath = ws.writeFile("instructions.txt", "Continue with the next step.");

    const proc = await spawnDh({
      args: ["--import", sourcePath, "--instructions", instructionsPath, "--job"],
      cwd: ws.dir,
    });
    const code = await proc.waitForExit();

    expect(code).toBe(0);
    expect(proc.stdout()).toContain("Picked up right where the imported session left off.");
    // The real provider actually saw a prior-turn history folded from the imported transcript
    // (DH-0187's whole "resumable, not just viewable" point) — not a fresh, contextless call.
    expect(provider.callCount).toBe(1);
    const lastRequest = provider.requests.at(-1) as { messages?: { role: string }[] } | undefined;
    expect(lastRequest?.messages?.some((m) => m.role === "user")).toBe(true);

    // A real `.dh-logs/<sessionId>` directory was written by the DH-0188 translator (the
    // imported session), and the standalone --job run (going through the existing --resume
    // launch path, DH-0038) logged its own continuation session chained to it via
    // `resumedFromSessionId` — same two-directory shape a native `--resume` run already
    // produces, not an import-specific behavior.
    const logsRoot = join(ws.dir, ".dh-logs");
    const sessions = readdirSync(logsRoot);
    expect(sessions.length).toBe(2);
    const headers = sessions.map((sessionId) => {
      const content = readFileSync(join(logsRoot, sessionId, "agent-root.jsonl"), "utf8");
      const [firstLine] = content.split("\n");
      return JSON.parse(firstLine as string);
    });
    expect(
      headers.some((h: { resumedFrom?: { sessionId: string } }) => h.resumedFrom !== undefined),
    ).toBe(true);
  });

  test("--import with an unresolvable --model fails cleanly before writing any session", async () => {
    // A scripted turn the provider must never actually serve (asserted via callCount below) —
    // startMockAnthropicProvider requires at least one turn even for a mock that's expected to
    // receive zero requests.
    const provider = startMockAnthropicProvider([jobSuccessTurn("should never be reached")]);
    cleanups.addProcess(provider.stop);
    const ws = createWorkspace();
    cleanups.addWorkspace(ws.cleanup);
    ws.writeConfig(baseConfig(provider.baseURL));
    const sourcePath = ws.writeFile(
      "cc-session.jsonl",
      `${ccUserLine("Hello from Claude Code.")}\n`,
    );

    const proc = await spawnDh({
      args: ["--import", sourcePath, "--model", "does-not-exist"],
      cwd: ws.dir,
    });
    const code = await proc.waitForExit();

    expect(code).not.toBe(0);
    expect(proc.stderr()).toContain('model alias "does-not-exist"');
    expect(provider.callCount).toBe(0);
    expect(() => readdirSync(join(ws.dir, ".dh-logs"))).toThrow();
  });
});
