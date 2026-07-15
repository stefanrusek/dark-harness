// Round 4 (docs/handoffs/e2e.md): proves the build-identity stamp (ADR 0005's amendment,
// Core round 8) actually survives the real compilation pipeline this project uses to build
// `dh` — not just Core's own unit-level `computeBuildInfo()` coverage
// (src/config/build-info.test.ts), which never touches `bun build --compile` or
// `scripts/build.ts` at all. This drives the real compiled binary (via `ensureBuilt()`,
// which now calls `scripts/build.ts` itself — see e2e/support/build.ts) in both a `--server`
// run and a standalone `--instructions --job` run, then reads each root agent's own real
// JSONL log header off disk and asserts the `client`/`build` fields it actually contains.

import { afterEach, describe, expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import pkg from "../package.json" with { type: "json" };
import type { LogHeader } from "../src/contracts/index.ts";
import { spawnDh } from "./support/dh-process.ts";
import { startMockAnthropicProvider, successTurn } from "./support/mock-provider.ts";
import { findFreePort } from "./support/port.ts";
import { connectSse } from "./support/sse-client.ts";
import { baseConfig, createWorkspace } from "./support/workspace.ts";

const cleanups: (() => void)[] = [];
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.();
});

/**
 * Every real `dh` run writes its JSONL logs to `<cwd>/.dh-logs/<sessionId>/<agentId>.jsonl`
 * (`src/cli.ts`'s `createStandaloneRuntime`/`runInteractiveMode`). Each test here uses its
 * own fresh workspace directory with exactly one session ever written into it, so there's no
 * need to know the (randomly generated) sessionId ahead of time — just find the one session
 * subdirectory that exists and read `agent-root.jsonl`'s first line, which `loop.ts` always
 * writes as the `LogHeader` before any other event for that agent.
 */
async function readRootLogHeaderAsync(workspaceDir: string): Promise<LogHeader> {
  const logsDir = join(workspaceDir, ".dh-logs");
  const sessions = readdirSync(logsDir);
  expect(sessions.length).toBe(1);
  const headerPath = join(logsDir, sessions[0] as string, "agent-root.jsonl");
  const text = await Bun.file(headerPath).text();
  const firstLine = text.split("\n")[0] as string;
  return JSON.parse(firstLine) as LogHeader;
}

function expectRealBuildStamp(header: LogHeader) {
  expect(header.type).toBe("header");
  expect(header.agentId).toBe("agent-root");
  expect(header.build.version).toBe(pkg.version);
  // scripts/build.ts stamps the real `git rev-parse HEAD` — a full 40-char hex sha, not a
  // shortened/abbreviated one (that only happens in its own human-readable console log line).
  expect(header.build.gitSha).toMatch(/^[0-9a-f]{40}$/);
  // This is a local, non-release dev build (no --release-tag passed to scripts/build.ts).
  expect(header.build.releaseTag).toBeNull();
}

describe("build-identity stamp survives the real compilation pipeline (Round 4)", () => {
  test("--server run: header.client === 'server', real build stamp present", async () => {
    const provider = startMockAnthropicProvider([successTurn("stamped server run")]);
    cleanups.push(provider.stop);
    const ws = createWorkspace();
    cleanups.push(ws.cleanup);
    ws.writeConfig(baseConfig(provider.baseURL));
    const port = await findFreePort();

    const proc = await spawnDh({ args: ["--server", "--port", String(port)], cwd: ws.dir });
    cleanups.push(proc.kill);
    await proc.waitForStdout(/listening on port/);

    // The root agent (and its JSONL log, whose first line is the header this test asserts
    // on) isn't created until the first send_message — a bare `--server` start has no root
    // agent at all yet (see e2e/server-protocol.test.ts's own "no message sent" tree test).
    const baseUrl = `http://localhost:${port}`;
    const sse = await connectSse(baseUrl);
    cleanups.push(sse.close);
    await fetch(new URL("/api/commands", baseUrl), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "send_message", agentId: "agent-root", message: "hello" }),
    });
    await sse.waitFor((e) => e.type === "agent_output");

    const header = await readRootLogHeaderAsync(ws.dir);
    expect(header.client).toBe("server");
    expectRealBuildStamp(header);
  });

  test("standalone --instructions --job run: header.client === 'none', real build stamp present", async () => {
    const provider = startMockAnthropicProvider([successTurn("stamped standalone run")]);
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

    const header = await readRootLogHeaderAsync(ws.dir);
    expect(header.client).toBe("none");
    expectRealBuildStamp(header);
  });
});
