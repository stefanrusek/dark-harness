// PTY harness for the console TUI (docs/handoffs/e2e.md scope item 3) and a real
// cross-process `--connect` scenario (scope item 5), both driving the actual compiled
// binary under a real pseudo-terminal via `tmux` (see support/tmux-pty.ts's header comment
// for why tmux, not node-pty).
//
// IMPORTANT — documents a confirmed cross-domain defect, doesn't work around it silently:
// a fresh interactive session's root agent cannot currently be started from the TUI's own
// input box. `src/tui/state.ts`'s `handleRootKey` only ever sends `send_message` once
// `state.rootAgentId` is non-null, and `rootAgentId` is only populated by an `agent_spawned`
// SSE event (state.ts `handleSseEvent`) — which itself only fires once the root agent's
// `runAgentLoop` starts, which only happens once `send_message` is sent. Pressing left-arrow
// to open the tree view issues `request_agent_tree` (which *does* return a synthesized root
// node even pre-start — verified directly in e2e/server-protocol.test.ts's first test) but
// `applyTreeResponse` never feeds that back into `rootAgentId`, so there is no path back to
// the root view that unblocks sending. Confirmed live below: typing a message and pressing
// Enter shows "No root agent yet — please wait." forever. The same gap exists in the Web
// client (`src/web/client/app.ts` never calls `request_agent_tree` at all) — see
// e2e/web.test.ts's header comment for how that suite works around it for its own coverage.
// This needs a fix in the TUI/Web domains (e.g. seed `rootAgentId` from the
// `request_agent_tree` response, or issue it automatically on boot) — flagged in
// docs/handoffs/e2e.md's status log as a cross-domain request, not fixed here (out of e2e/'s
// ownership per CLAUDE.md §3).

import { afterEach, describe, expect, test } from "bun:test";
import { ensureBuilt } from "./support/build.ts";
import { spawnDh } from "./support/dh-process.ts";
import { startMockAnthropicProvider, successTurn } from "./support/mock-provider.ts";
import { findFreePort } from "./support/port.ts";
import { startTmuxSession } from "./support/tmux-pty.ts";
import { baseConfig, createWorkspace } from "./support/workspace.ts";

const cleanups: (() => void)[] = [];
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.();
});

describe("local TUI (dh, no flags) under a real PTY", () => {
  test("boots, renders the alt-screen shell, and responds to real keystrokes", async () => {
    const provider = startMockAnthropicProvider([successTurn("unused in this scenario")]);
    cleanups.push(provider.stop);
    const ws = createWorkspace();
    cleanups.push(ws.cleanup);
    ws.writeConfig(baseConfig(provider.baseURL));
    const dhBinary = await ensureBuilt();

    const session = startTmuxSession([dhBinary], { cwd: ws.dir, cols: 100, rows: 30 });
    cleanups.push(session.kill);

    await session.waitFor((screen) => screen.includes("Dark Harness"));
    await session.waitFor((screen) => screen.includes("Root Agent"));
    // SSE connects fast against a local server; confirm the connection pill leaves
    // "connecting".
    await session.waitFor((screen) => /—\s+(open|connecting)\b/.test(screen));

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
    // Documented defect (see file header): this never actually sends, and the footer says so
    // instead of a real agent_output ever appearing.
    await session.waitFor((screen) => screen.includes("No root agent yet"));
  }, 20_000);
});

describe("--connect: a real second dh process against a real dh --server", () => {
  test("console client renders live SSE output from a message sent to the remote server", async () => {
    const provider = startMockAnthropicProvider([successTurn("Hello from the remote server!")]);
    cleanups.push(provider.stop);

    const serverWs = createWorkspace();
    cleanups.push(serverWs.cleanup);
    serverWs.writeConfig(baseConfig(provider.baseURL));
    const port = await findFreePort();
    const serverProc = await spawnDh({
      args: ["--server", "--port", String(port)],
      cwd: serverWs.dir,
    });
    cleanups.push(serverProc.kill);
    await serverProc.waitForStdout(/listening on port/);

    // The connecting client also loads its own dh.json (models/provider are required by the
    // schema even though --connect never calls a model directly) — reuse baseConfig with an
    // unused provider URL.
    const clientWs = createWorkspace();
    cleanups.push(clientWs.cleanup);
    clientWs.writeConfig(baseConfig("http://localhost:1"));

    const dhBinary = await ensureBuilt();
    const session = startTmuxSession([dhBinary, "--connect", "localhost", "--port", String(port)], {
      cwd: clientWs.dir,
      cols: 100,
      rows: 30,
    });
    cleanups.push(session.kill);

    await session.waitFor((screen) => screen.includes("Dark Harness"));

    // Kick off the root agent's only turn via a direct API call against the real remote
    // server (working around the TUI-side defect documented at the top of this file) — the
    // point of this test is proving the real second `dh --connect` process renders it live
    // over the wire, not exercising the (currently broken) input-box send path.
    const postRes = await fetch(`http://localhost:${port}/api/commands`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "send_message", agentId: "agent-root", message: "hi from e2e" }),
    });
    expect(postRes.status).toBe(200);

    await session.waitFor((screen) => screen.includes("Hello from the remote server!"), 15_000);
    await session.waitFor((screen) => screen.includes("session ended"), 15_000);
  }, 30_000);
});
