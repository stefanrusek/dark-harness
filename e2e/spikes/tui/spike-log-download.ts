// DH-0060 spike — Test Plan item: "Log download/export command works and produces a valid
// file."
//
// NOT TUI-driven on purpose: the TUI (src/tui/keys.ts, state.ts) has no keybinding that
// issues a `download_logs` command — it is a server/protocol-level command
// (src/server/commands.ts) with no client-side affordance in the console client today (only
// the web client exposes a download button, per src/web/client). Rather than fabricate a key
// sequence the real TUI doesn't have, this spike drives the real compiled binary in
// `--server` mode directly over HTTP/SSE (same technique e2e/server-protocol.test.ts's
// "download_logs" test uses), which is the actual, real code path this feature runs through.
// If a future round adds a TUI keybinding for this, a proper tmux-driven scenario belongs
// here instead.
//
// Run: bun e2e/spikes/tui/spike-log-download.ts

import { startMockAnthropicProvider, successTurn } from "../../support/mock-provider.ts";
import { startDhServer } from "../../support/port.ts";
import { connectSse } from "../../support/sse-client.ts";
import { baseConfig, createWorkspace } from "../../support/workspace.ts";
import type { SpikeCheck } from "./spike-support.ts";
import { expectTrue, reportAndExit } from "./spike-support.ts";

const provider = startMockAnthropicProvider([successTurn("Log this exchange.")]);
const ws = createWorkspace("dh-spike-");
ws.writeConfig(baseConfig(provider.baseURL));

const { proc, port } = await startDhServer({ cwd: ws.dir });
const baseUrl = `http://localhost:${port}`;
const stop = () => {
  proc.kill();
  provider.stop();
  ws.cleanup();
};

let checks: SpikeCheck[] = [];
let evidence = "";
try {
  const sse = await connectSse(baseUrl);
  await fetch(new URL("/api/commands", baseUrl), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ type: "send_message", agentId: "agent-root", message: "hi" }),
  });
  await sse.waitFor((e) => e.type === "agent_status" && e.status === "waiting");
  sse.close();

  const agentLogRes = await fetch(new URL("/api/commands", baseUrl), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ type: "download_logs", agentId: "agent-root" }),
  });
  const agentLogOk = agentLogRes.status === 200;
  const agentLogContentType = agentLogRes.headers.get("content-type");
  const jsonl = agentLogOk ? await agentLogRes.text() : "";
  let firstLineOk = false;
  let firstLineDetail = "";
  try {
    const firstLine = JSON.parse(jsonl.split("\n")[0] ?? "{}");
    firstLineOk =
      firstLine.type === "header" &&
      firstLine.agentId === "agent-root" &&
      firstLine.parentAgentId === null;
    firstLineDetail = JSON.stringify(firstLine);
  } catch (err) {
    firstLineDetail = `failed to parse first JSONL line: ${err}`;
  }

  const bundleRes = await fetch(new URL("/api/commands", baseUrl), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ type: "download_logs" }),
  });
  const bundleOk = bundleRes.status === 200;
  const bundleContentType = bundleRes.headers.get("content-type");
  const tarBytes = bundleOk ? new Uint8Array(await bundleRes.arrayBuffer()) : new Uint8Array();

  evidence = [
    `POST /api/commands {type: "download_logs", agentId: "agent-root"} -> ${agentLogRes.status}, content-type=${agentLogContentType}`,
    `  first JSONL line: ${firstLineDetail}`,
    `POST /api/commands {type: "download_logs"} -> ${bundleRes.status}, content-type=${bundleContentType}, byteLength=${tarBytes.length}`,
  ].join("\n");

  checks = [
    expectTrue(
      agentLogOk,
      "per-agent download_logs returns HTTP 200",
      agentLogOk ? undefined : `status was ${agentLogRes.status}`,
    ),
    expectTrue(
      agentLogContentType === "application/x-ndjson",
      "per-agent download has content-type application/x-ndjson",
      agentLogContentType === "application/x-ndjson"
        ? undefined
        : `content-type was ${agentLogContentType}`,
    ),
    expectTrue(
      firstLineOk,
      "per-agent JSONL's first line is a valid header for agent-root",
      firstLineOk ? undefined : firstLineDetail,
    ),
    expectTrue(
      bundleOk,
      "full-session tar bundle download returns HTTP 200",
      bundleOk ? undefined : `status was ${bundleRes.status}`,
    ),
    expectTrue(
      bundleContentType === "application/x-tar",
      "full-session bundle has content-type application/x-tar",
      bundleContentType === "application/x-tar"
        ? undefined
        : `content-type was ${bundleContentType}`,
    ),
    expectTrue(
      tarBytes.length > 0,
      "full-session tar bundle is non-empty",
      tarBytes.length > 0 ? undefined : "tar byte length was 0",
    ),
  ];
} finally {
  stop();
}

reportAndExit("log-download", checks, evidence);
