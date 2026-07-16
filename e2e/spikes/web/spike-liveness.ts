// DH-0061 spike 8 (core behavior): the liveness/heartbeat indicator updates during a
// long-running turn instead of looking frozen. `support.ts`'s mock provider always answers
// instantly, so this spike scripts its own deliberately-slow `/v1/messages` handler (same
// wire shape, just delayed) and asserts `.agent-elapsed` (sidebar row) and `.status-elapsed`
// (header) advance across that delay — proof the UI's periodic re-render tick
// (`LIVENESS_TICK_MS` in src/web/client/app.ts) is really running, not just rendered once.
//
// Observed while writing this spike: a first-ever root turn never emits an `agent_status:
// "running"` SSE event (src/agent/runtime.ts's `runRoot()` sets `rootStatus = "running"`
// internally, but that's only reflected in a later `request_agent_tree` poll, not pushed
// over SSE — only the *end* of the turn emits a status event). So the sidebar row's
// `data-status` legitimately stays "waiting" for the whole slow call; this spike does not
// assert a "running" transition. What it does assert — the actual Test Plan item — is that
// the elapsed-time text keeps advancing throughout the delay, proving the liveness tick is
// alive and re-rendering, not that any particular status label is shown meanwhile.
//
// Run from the repo root:   bun e2e/spikes/web/spike-liveness.ts

import { spawnDh } from "../../support/dh-process.ts";
import { baseConfig, createWorkspace } from "../../support/workspace.ts";
import { artifactPath, createReport, resolveChromiumExecutable, sendMessage } from "./support.ts";

const report = createReport("spike-liveness");
const SLOW_TURN_MS = 8_000;

// A minimal Anthropic-shaped provider that delays its one reply, unlike
// `startMockAnthropicProvider` (which is intentionally instant) — the delay is the point of
// this spike: it gives the UI's liveness tick multiple opportunities to re-render mid-turn.
const server = Bun.serve({
  port: 0,
  fetch: async (req) => {
    const url = new URL(req.url);
    if (url.pathname !== "/v1/messages" || req.method !== "POST") {
      return new Response("not found", { status: 404 });
    }
    await new Promise((resolve) => setTimeout(resolve, SLOW_TURN_MS));
    return Response.json({
      id: "msg_slow",
      type: "message",
      role: "assistant",
      model: "mock-model",
      content: [{ type: "text", text: "Finally responded after a slow turn." }],
      stop_reason: "end_turn",
      stop_sequence: null,
      usage: { input_tokens: 10, output_tokens: 10 },
    });
  },
});
const baseURL = `http://localhost:${server.port}`;

const workspace = createWorkspace("dh-spike-web-liveness-");
workspace.writeConfig(baseConfig(baseURL));
const proc = await spawnDh({ args: ["--web"], cwd: workspace.dir });
const stdout = await proc.waitForStdout(/web UI ready at (\S+)/, 20_000);
const webUrl = /web UI ready at (\S+)\./.exec(stdout)?.[1];

async function cleanup() {
  proc.kill();
  server.stop(true);
  workspace.cleanup();
}

if (!webUrl) {
  await cleanup();
  report.check("could not parse web UI URL from dh stdout", false, stdout);
  report.finish();
}

const executablePath = await resolveChromiumExecutable();
const { chromium } = await import("playwright");
const browser = await chromium.launch({ executablePath, headless: true });
const page = await browser.newPage();

try {
  await page.goto(webUrl as string);
  await page.waitForSelector(".dh-app");
  await page.waitForFunction("document.querySelector('.connection-pill')?.textContent === 'Live'");

  await sendMessage(page, "kick off a slow turn");
  await page.waitForSelector(".agent-row.root .agent-elapsed");
  await page.waitForSelector(".status-elapsed");

  const rowElapsedEarly = await page.locator(".agent-row.root .agent-elapsed").textContent();
  const headerElapsedEarly = await page.locator(".status-elapsed").textContent();

  // Sample again partway through the slow turn — enough time for several liveness ticks
  // (LIVENESS_TICK_MS in src/web/client/app.ts) to fire and re-render both the sidebar row
  // and the header, well before the provider's delayed reply ever arrives.
  await page.waitForTimeout(4_000);
  const rowElapsedLater = await page.locator(".agent-row.root .agent-elapsed").textContent();
  const headerElapsedLater = await page.locator(".status-elapsed").textContent();

  report.check(
    "sidebar row's elapsed-time text advances during the long turn (doesn't look frozen)",
    rowElapsedEarly !== null && rowElapsedLater !== null && rowElapsedEarly !== rowElapsedLater,
    `early = ${rowElapsedEarly}, later = ${rowElapsedLater}`,
  );
  report.check(
    "header's elapsed-time text also advances during the long turn",
    headerElapsedEarly !== null &&
      headerElapsedLater !== null &&
      headerElapsedEarly !== headerElapsedLater,
    `early = ${headerElapsedEarly}, later = ${headerElapsedLater}`,
  );

  // The turn eventually completes and the assistant text arrives — confirms the "liveness"
  // ticks weren't masking a hang; the slow call really was still in flight the whole time.
  //
  // NOTE: `e2e/web.test.ts`/`e2e/connect-web.test.ts` assert against a `.agent-output`
  // selector that no longer exists in `src/web/client/render.ts` (superseded by the
  // `.agent-transcript .turn-assistant .turn-text` structure once DH-0056's Markdown
  // rendering landed) — flagged separately in this ticket's Notes, not fixed here (out of
  // this spike's scope; those are gated `.test.ts` files, not spikes).
  await page.waitForFunction(
    "document.querySelector('.agent-transcript .turn-assistant .turn-text')?.textContent === " +
      "'Finally responded after a slow turn.'",
    undefined,
    { timeout: SLOW_TURN_MS + 10_000 },
  );
  const finalOutput = await page
    .locator(".agent-transcript .turn-assistant .turn-text")
    .textContent();
  report.check(
    "the slow turn eventually completes and delivers its reply",
    finalOutput === "Finally responded after a slow turn.",
    `output = ${finalOutput}`,
  );

  const screenshot = artifactPath("spike-liveness.png");
  await page.screenshot({ path: screenshot, fullPage: true });
  await browser.close();
  await cleanup();
  report.finish({ screenshot });
} catch (err) {
  const screenshot = artifactPath("spike-liveness-error.png");
  await page.screenshot({ path: screenshot, fullPage: true }).catch(() => {});
  await browser.close().catch(() => {});
  await cleanup();
  report.check("script completed without an unexpected error", false, String(err));
  report.finish({ screenshot });
}
