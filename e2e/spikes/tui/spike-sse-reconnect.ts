// DH-0060 spike — Test Plan item (DH-0024): "SSE reconnect: killing/restarting the server
// mid-session triggers a visible reconnect indicator, then resumes without duplicating or
// losing transcript content."
//
// Only testable in `--connect` mode (a real second `dh` process against a real, separately
// running `dh --server`) — local mode's client and server are one process, so there is no
// server to kill independently of the TUI. Sequence: start `dh --server` on a fixed port,
// connect a `dh --connect` TUI client to it, complete one real exchange, kill the server
// process, restart a brand-new `dh --server` process bound to the SAME port, and confirm:
// (a) the client's title bar shows the "⚠ Reconnected — history may be incomplete." notice
// (src/tui/render.ts's `reconnectSuffix`, driven by `onReconnected`/the SSE client's own
// reconnect-with-backoff loop, src/tui/sse-client.ts), and (b) the pre-kill transcript turn is
// still on screen afterward — the client keeps its own local transcript state across a
// reconnect (never wiped), so "no duplication or loss" for already-rendered content is a
// property of the client holding its state, not of the new server replaying history (the new
// server process has no memory of the old one's agents at all, a real limitation worth
// flagging rather than hiding).
//
// Run: bun e2e/spikes/tui/spike-sse-reconnect.ts

import { ensureBuilt } from "../../support/build.ts";
import { spawnDh } from "../../support/dh-process.ts";
import { startMockAnthropicProvider, successTurn } from "../../support/mock-provider.ts";
import { findFreePort } from "../../support/port.ts";
import { startTmuxSession } from "../../support/tmux-pty.ts";
import { baseConfig, createWorkspace } from "../../support/workspace.ts";
import type { SpikeCheck } from "./spike-support.ts";
import { expectContains, expectTrue, reportAndExit } from "./spike-support.ts";

const provider = startMockAnthropicProvider([successTurn("Hello before the restart.")]);
const serverWs = createWorkspace("dh-spike-server-");
serverWs.writeConfig(baseConfig(provider.baseURL));
const clientWs = createWorkspace("dh-spike-client-");
clientWs.writeConfig(baseConfig("http://localhost:1"));

const port = await findFreePort();
const server = await spawnDh({ args: ["--server", "--port", String(port)], cwd: serverWs.dir });
await server.waitForStdout(/listening on port/, 5_000);

const dhBinary = await ensureBuilt();
const session = startTmuxSession([dhBinary, "--connect", "localhost", "--port", String(port)], {
  cwd: clientWs.dir,
  cols: 100,
  rows: 30,
});

let secondServer: Awaited<ReturnType<typeof spawnDh>> | null = null;
const stop = () => {
  session.kill();
  server.kill();
  secondServer?.kill();
  provider.stop();
  serverWs.cleanup();
  clientWs.cleanup();
};

let checks: SpikeCheck[] = [];
let pane = "";
try {
  await session.waitFor((screen) => screen.includes("Dark Harness"));

  const postRes = await fetch(`http://localhost:${port}/api/commands`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ type: "send_message", agentId: "agent-root", message: "hi" }),
  });
  const sentOk = postRes.status === 200;
  await session.waitFor((screen) => screen.includes("Hello before the restart."), 15_000);
  const preKillScreen = session.capture();

  // Kill the server the client is connected to — its next SSE read fails, driving the
  // client into "connecting"/backoff-retry.
  server.kill();
  const sawDisconnected = await session
    .waitFor((screen) => /—\s+(connecting|closed|error)\b/.test(screen), 10_000)
    .then(() => true)
    .catch(() => false);

  // Restart a brand-new server process bound to the SAME port so the client's existing
  // reconnect loop (which retries the same host:port) can actually succeed.
  secondServer = await spawnDh({ args: ["--server", "--port", String(port)], cwd: serverWs.dir });
  await secondServer.waitForStdout(/listening on port/, 5_000);

  pane = await session.waitFor((screen) => screen.includes("Reconnected"), 15_000);

  checks = [
    expectTrue(sentOk, "initial send_message to the first server succeeded"),
    expectContains(
      preKillScreen,
      "Hello before the restart.",
      "pre-kill transcript turn rendered before the server was killed",
    ),
    expectTrue(
      sawDisconnected,
      "client's connection status left 'open' after the server was killed",
      sawDisconnected ? undefined : "never saw connecting/closed/error in the title bar",
    ),
    expectContains(
      pane,
      "⚠ Reconnected — history may be incomplete.",
      "client shows the visible reconnect notice once the restarted server accepts SSE again",
    ),
    expectContains(
      pane,
      "Hello before the restart.",
      "pre-kill transcript content is still visible after reconnect (not lost, not duplicated — client-side state persists across reconnects)",
    ),
    expectTrue(
      (pane.match(/Hello before the restart\./g) ?? []).length === 1,
      "pre-kill transcript turn appears exactly once after reconnect (no duplication)",
    ),
  ];
} finally {
  stop();
}

reportAndExit("sse-reconnect (DH-0024)", checks, pane);
