// DH-0061 spike 4 (DH-0023): security headers, verified via network inspection (no browser
// needed). Hard checks: the CORS contract that already ships (src/server/server.ts
// CORS_HEADERS, including the Access-Control-Expose-Headers fix e2e found). Expected-fail
// checks: CSP / X-Frame-Options / X-Content-Type-Options — DH-0023 is `status: ready` and
// not yet implemented; these lines flip to [PASS] automatically once it ships, at which
// point the implementer should promote them to hard checks.
//
// Run from the repo root:   bun e2e/spikes/web/spike-headers.ts

import { spawnDh } from "../../support/dh-process.ts";
import { startMockAnthropicProvider, successTurn } from "../../support/mock-provider.ts";
import { startDhServer } from "../../support/port.ts";
import { baseConfig, createWorkspace } from "../../support/workspace.ts";
import { createReport } from "./support.ts";

const report = createReport("spike-headers");

// Part 1: the API server's CORS contract (dh --server).
const provider = startMockAnthropicProvider([successTurn("unused")]);
const serverWs = createWorkspace("dh-spike-headers-");
serverWs.writeConfig(baseConfig(provider.baseURL));
const { proc: serverProc, port } = await startDhServer({ cwd: serverWs.dir });

// Part 2: the web UI's static-page headers (dh --web serves the client bundle itself).
const webWs = createWorkspace("dh-spike-headers-web-");
webWs.writeConfig(baseConfig(provider.baseURL));
const webProc = await spawnDh({ args: ["--web"], cwd: webWs.dir });

try {
  const apiRes = await fetch(`http://localhost:${port}/api/commands`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: "http://localhost:5173" },
    body: JSON.stringify({ type: "request_agent_tree" }),
  });
  report.check(
    "POST /api/commands answers 200",
    apiRes.status === 200,
    `status = ${apiRes.status}`,
  );
  // The server deliberately echoes the request's own Origin rather than a fixed "*"
  // (src/server/server.ts's corsHeaders, covered by src/server/server.test.ts) — so this
  // check must send an Origin header and assert it's echoed back, not assert a constant.
  const allowOrigin = apiRes.headers.get("access-control-allow-origin");
  report.check(
    "CORS: Access-Control-Allow-Origin echoes the request's Origin",
    allowOrigin === "http://localhost:5173",
    `access-control-allow-origin = ${allowOrigin}`,
  );
  const expose = apiRes.headers.get("access-control-expose-headers") ?? "";
  report.check(
    "CORS: Content-Disposition exposed for log downloads",
    expose.includes("Content-Disposition"),
    `access-control-expose-headers = ${expose}`,
  );

  const preflight = await fetch(`http://localhost:${port}/api/commands`, { method: "OPTIONS" });
  const allowHeaders = preflight.headers.get("access-control-allow-headers") ?? "";
  report.check(
    "CORS preflight answers 204 and allows Last-Event-ID + Authorization",
    preflight.status === 204 &&
      allowHeaders.includes("Last-Event-ID") &&
      allowHeaders.includes("Authorization"),
    `status = ${preflight.status}, access-control-allow-headers = ${allowHeaders}`,
  );

  const webStdout = await webProc.waitForStdout(/web UI ready at (\S+)/, 20_000);
  const webUrl = /web UI ready at (\S+)\./.exec(webStdout)?.[1];
  if (!webUrl) throw new Error(`could not parse web UI URL from dh stdout: ${webStdout}`);
  const pageRes = await fetch(webUrl);
  report.check(
    "web UI static page answers 200",
    pageRes.status === 200,
    `status = ${pageRes.status}`,
  );

  // DH-0023's still-unshipped hardening — reported, not (yet) enforced.
  const csp = pageRes.headers.get("content-security-policy");
  report.expectedFail(
    "CSP header on the served web UI page (DH-0023, not yet implemented)",
    csp !== null,
    `content-security-policy = ${csp ?? "<missing>"}`,
  );
  const xfo = pageRes.headers.get("x-frame-options");
  report.expectedFail(
    "X-Frame-Options clickjacking header (DH-0023, not yet implemented)",
    xfo !== null,
    `x-frame-options = ${xfo ?? "<missing>"}`,
  );
  const nosniff = pageRes.headers.get("x-content-type-options");
  report.expectedFail(
    "X-Content-Type-Options: nosniff (DH-0023, not yet implemented)",
    nosniff === "nosniff",
    `x-content-type-options = ${nosniff ?? "<missing>"}`,
  );

  cleanup();
  report.finish();
} catch (err) {
  cleanup();
  report.check("script completed without an unexpected error", false, String(err));
  report.finish();
}

function cleanup(): void {
  webProc.kill();
  serverProc.kill();
  provider.stop();
  serverWs.cleanup();
  webWs.cleanup();
}
