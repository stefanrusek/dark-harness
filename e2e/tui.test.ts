// PTY harness for the console TUI (docs/handoffs/e2e.md scope item 3) and a real
// cross-process `--connect` scenario (scope item 5), both driving the actual compiled
// binary under a real pseudo-terminal via `tmux` (see support/tmux-pty.ts's header comment
// for why tmux, not node-pty).
//
// FIXED DEFECT (originally found by this test): a fresh interactive session's root agent
// could not be started from the TUI's own input box — `applyTreeResponse` never seeded
// `rootAgentId` from a `request_agent_tree` response, and nothing issued that request on
// startup, so `rootAgentId` stayed null until an `agent_spawned` event that could never
// fire. Fixed in `src/tui/state.ts`/`app.ts` (TUI round 3, docs/handoffs/tui.md). The first
// test below now exercises the real fix: typing a message and pressing Enter with no
// `agent_spawned` event ever having fired actually sends it and renders the real response.

import { afterEach, describe, expect, test } from "bun:test";
import { ensureBuilt } from "./support/build.ts";
import { createCleanupRegistry } from "./support/cleanup.ts";
import { startMockAnthropicProvider, successTurn } from "./support/mock-provider.ts";
import { startDhServer } from "./support/port.ts";
import { startTmuxSession } from "./support/tmux-pty.ts";
import { baseConfig, createWorkspace } from "./support/workspace.ts";

const cleanups = createCleanupRegistry();
afterEach(() => cleanups.runAll());

describe("local TUI (dh, no flags) under a real PTY", () => {
  test("boots, renders the alt-screen shell, and responds to real keystrokes", async () => {
    const provider = startMockAnthropicProvider([successTurn("Hello from the fixed TUI!")]);
    cleanups.addProcess(provider.stop);
    const ws = createWorkspace();
    cleanups.addWorkspace(ws.cleanup);
    ws.writeConfig(baseConfig(provider.baseURL));
    const dhBinary = await ensureBuilt();

    const session = startTmuxSession([dhBinary], { cwd: ws.dir, cols: 100, rows: 30 });
    cleanups.addProcess(session.kill);

    await session.waitFor((screen) => screen.includes("Dark Harness"));
    await session.waitFor((screen) => screen.includes("Root Agent"));
    // SSE connects fast against a local server; confirm the connection pill leaves
    // "connecting" (DH-0105: canonical connection-state words are "live"/"connecting…"/
    // "reconnecting…"/"disconnected" — match on "live" or "connecting" loosely enough to
    // tolerate the pending-state spinner glyph and ellipsis prefixed/suffixed to the word).
    await session.waitFor((screen) => /—\s+\S*\s*(live|connecting)/.test(screen));

    // Left-arrow with an empty input (HANDOFF.md §8) opens the agent tree view and issues a
    // real request_agent_tree round-trip — do this first, from a genuinely empty input.
    session.sendKeys("Left");
    const treeScreen = await session.waitFor((screen) => screen.includes("Agent Tree"));
    // The server-synthesized root node (verified directly in e2e/server-protocol.test.ts)
    // really does render here, even though the root agent hasn't started yet.
    await session.waitFor((screen) => screen.includes("agent-root"));
    expect(treeScreen).toContain("[↑/↓] navigate");

    // Back to the root view (Escape) to exercise the input box + the documented defect.
    session.sendKeys("Escape");
    await session.waitFor((screen) => screen.includes("Root Agent"));

    session.sendText("hello agent");
    const withInput = await session.waitFor((screen) => screen.includes("> hello agent"));
    expect(withInput).toContain("[Enter] send");

    session.sendKeys("Enter");
    // Real fix, not a workaround: rootAgentId came from the tree-response bootstrap above
    // (no agent_spawned event has fired yet), so this actually sends and the real turn
    // completes end to end.
    await session.waitFor((screen) => screen.includes("Hello from the fixed TUI!"), 15_000);

    // DH-0059: an interactive root agent parks in "waiting" and never reaches
    // session_ended on its own — this process owns the server, so Ctrl+C here really does
    // send stop_agent and wait for the graceful shutdown, not just detach.
    session.sendKeys("C-c");
    await session.waitFor((screen) => screen.includes("stopping session"), 5_000);
    await session.waitFor((screen) => screen.includes("session ended"), 15_000);
    // Confirm the real process actually exited, not just that the TUI rendered the string.
    await session.waitForExit(5_000);
  }, 30_000);
});

describe("--connect: a real second dh process against a real dh --server", () => {
  test("console client renders live SSE output from a message sent to the remote server", async () => {
    const provider = startMockAnthropicProvider([successTurn("Hello from the remote server!")]);
    cleanups.addProcess(provider.stop);

    const serverWs = createWorkspace();
    cleanups.addWorkspace(serverWs.cleanup);
    serverWs.writeConfig(baseConfig(provider.baseURL));
    const { proc: serverProc, port } = await startDhServer({ cwd: serverWs.dir });
    cleanups.addProcess(serverProc.kill);

    // The connecting client also loads its own dh.json (models/provider are required by the
    // schema even though --connect never calls a model directly) — reuse baseConfig with an
    // unused provider URL.
    const clientWs = createWorkspace();
    cleanups.addWorkspace(clientWs.cleanup);
    clientWs.writeConfig(baseConfig("http://localhost:1"));

    const dhBinary = await ensureBuilt();
    const session = startTmuxSession([dhBinary, "--connect", "localhost", "--port", String(port)], {
      cwd: clientWs.dir,
      cols: 100,
      rows: 30,
    });
    cleanups.addProcess(session.kill);

    await session.waitFor((screen) => screen.includes("Dark Harness"));

    // Kick off the root agent's only turn via a direct API call against the real remote
    // server — this test's point is proving the real second `dh --connect` process renders
    // it live over the wire (the input-box send path itself is covered by the local-TUI
    // test above).
    const postRes = await fetch(`http://localhost:${port}/api/commands`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "send_message", agentId: "agent-root", message: "hi from e2e" }),
    });
    expect(postRes.status).toBe(200);

    await session.waitFor((screen) => screen.includes("Hello from the remote server!"), 15_000);

    // DH-0059: in --connect mode this process does NOT own the server, so Ctrl+C is
    // detach-only — it must NOT send stop_agent to the remote agent. The remote root agent
    // parks in "waiting" and never reaches session_ended on its own; since this test isn't
    // the one asserting detach behavior, end the remote session directly via the server's
    // own API (the same one any real operator could use) so the SSE-forwarded
    // "session ended" text actually renders in this --connect client before the test ends.
    const stopRes = await fetch(`http://localhost:${port}/api/commands`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "stop_agent", agentId: "agent-root" }),
    });
    expect(stopRes.status).toBe(200);

    await session.waitFor((screen) => screen.includes("session ended"), 15_000);
  }, 30_000);
});
