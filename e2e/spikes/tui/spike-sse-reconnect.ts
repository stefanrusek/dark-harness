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
  //
  // DH-0212: this used to check `/—\s+(connecting|closed|error)\b/` — stale on two counts.
  // The actual pending/disconnected vocabulary (src/design-tokens.ts CONNECTION_TOKENS,
  // rendered by src/tui/ink/TitleBar.tsx) is "connecting…" / "reconnecting…" /
  // "disconnected", not "closed"/"error" (those words never appear anywhere in the title
  // bar). And for the two *pending* states, the title bar renders a spinner glyph between
  // the em dash and the label (`— ⠙ connecting…`), which `\s+` doesn't match, so the regex
  // could never match even the one real label ("connecting") it did name. Match the actual
  // label words directly instead of re-deriving the surrounding chrome.
  server.kill();
  const sawDisconnected = await session
    .waitFor((screen) => /connecting…|reconnecting…|disconnected/.test(screen), 10_000)
    .then(() => true)
    .catch(() => false);

  // DH-0212: `server.kill()` above only sends the signal — the port isn't necessarily free
  // the instant the process exits. The first server actually accepted a live SSE connection
  // (the client under test), so the socket it held goes into TCP TIME_WAIT on close rather
  // than being immediately reusable; the OS can hold that for well past process exit even
  // though nothing is listening anymore. Immediately spawning a second server on the SAME
  // port reliably lost that race ("Failed to start server. Is port N in use?"), timing out
  // this whole spike before the actual reconnect-indicator check ever ran. Wait for the
  // first server's process to fully exit, then retry the rebind with backoff — same-port
  // reuse is a load-bearing part of what's under test here (the client's reconnect loop
  // retries the same host:port, so switching to a fresh port would stop testing the real
  // reconnect path), so the fix is patience, not avoiding the port.
  await server.waitForExit(5_000).catch(() => {
    // Best-effort: if it doesn't report exit within the window, still attempt the rebind —
    // a genuine bind failure below will surface via spawnDh/waitForStdout's own error.
  });

  const REBIND_ATTEMPTS = 6;
  const REBIND_RETRY_DELAY_MS = 1_000;
  for (let attempt = 1; attempt <= REBIND_ATTEMPTS; attempt += 1) {
    secondServer = await spawnDh({ args: ["--server", "--port", String(port)], cwd: serverWs.dir });
    try {
      await secondServer.waitForStdout(/listening on port/, 3_000);
      break;
    } catch (err) {
      secondServer.kill();
      if (attempt === REBIND_ATTEMPTS) throw err;
      await Bun.sleep(REBIND_RETRY_DELAY_MS);
    }
  }

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
