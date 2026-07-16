// DH-0061 spike 5 (core behavior): agent tree renders parent/child spawn hierarchy correctly
// as a sub-agent is created via the real Agent tool, and each row's status updates live.
//
// Scripts a `toolCalls` mock turn on the root's own provider (per
// e2e/server-protocol.test.ts's "sub-agent spawning over real HTTP/SSE" two-provider
// pattern: root and sub-agent each get their own mock provider instance so there is no
// shared call-order queue to race), then drives the real web UI and asserts the sidebar
// grows a second row, the new row is not `.root`, and both rows eventually settle into a
// terminal/paused status.
//
// Run from the repo root:   bun e2e/spikes/web/spike-agent-tree.ts

import { spawnDh } from "../../support/dh-process.ts";
import { startMockAnthropicProvider, successTurn } from "../../support/mock-provider.ts";
import { createWorkspace } from "../../support/workspace.ts";
import { artifactPath, createReport, resolveChromiumExecutable, sendMessage } from "./support.ts";

const report = createReport("spike-agent-tree");

const rootProvider = startMockAnthropicProvider([
  {
    toolCalls: [{ name: "Agent", input: { prompt: "Say hi as a sub-agent.", model: "sub" } }],
    stopReason: "tool_use",
  },
  successTurn("Root heard back from the sub-agent."),
]);
const subProvider = startMockAnthropicProvider([successTurn("Sub-agent reporting in.")]);
const workspace = createWorkspace("dh-spike-web-tree-");
workspace.writeConfig({
  options: { defaultModel: "mock" },
  provider: [
    { name: "root-provider", type: "anthropic", baseURL: rootProvider.baseURL, apiKey: "k" },
    { name: "sub-provider", type: "anthropic", baseURL: subProvider.baseURL, apiKey: "k" },
  ],
  models: [
    { name: "mock", provider: "root-provider", model: "mock-model" },
    { name: "sub", provider: "sub-provider", model: "mock-model" },
  ],
});

const proc = await spawnDh({ args: ["--web"], cwd: workspace.dir });
const stdout = await proc.waitForStdout(/web UI ready at (\S+)/, 20_000);
const webUrl = /web UI ready at (\S+)\./.exec(stdout)?.[1];

async function cleanup() {
  proc.kill();
  rootProvider.stop();
  subProvider.stop();
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

  // Only the root row exists before anything is sent.
  const initialRows = await page.locator(".agent-row").count();
  report.check(
    "sidebar starts with exactly one (root) row",
    initialRows === 1,
    `rows = ${initialRows}`,
  );

  await sendMessage(page, "spawn a helper");

  // Wait for a second row to appear — the real signal a sub-agent was spawned, not faked.
  await page.waitForFunction(
    "document.querySelectorAll('.agent-tree .agent-row').length >= 2",
    undefined,
    { timeout: 15_000 },
  );
  const rowCount = await page.locator(".agent-row").count();
  report.check(
    "sidebar grows a second row once a sub-agent spawns",
    rowCount === 2,
    `rows = ${rowCount}`,
  );

  const rootRows = await page.locator(".agent-row.root").count();
  report.check("exactly one row is marked .root", rootRows === 1, `.root rows = ${rootRows}`);

  const childRow = page.locator(".agent-row:not(.root)");
  const childCount = await childRow.count();
  report.check(
    "exactly one non-root (child) row exists",
    childCount === 1,
    `count = ${childCount}`,
  );
  const childLabel = await childRow.locator(".agent-label").textContent();
  report.check(
    "child row label reflects the sub-agent's model, distinct from 'root'",
    (childLabel?.includes("sub") ?? false) && childLabel !== "root",
    `label = ${childLabel}`,
  );

  // Both rows eventually settle into a terminal/paused state (root parks at "waiting" per
  // Core Round 5's interactive semantics; the child reaches "done").
  await page.waitForFunction(
    "['done','waiting'].includes(document.querySelector('.agent-row.root')?.getAttribute('data-status') ?? '')",
    undefined,
    { timeout: 15_000 },
  );
  await page.waitForFunction(
    "document.querySelector('.agent-row:not(.root)')?.getAttribute('data-status') === 'done'",
    undefined,
    { timeout: 15_000 },
  );
  const rootStatus = await page.locator(".agent-row.root").getAttribute("data-status");
  const childStatus = await childRow.getAttribute("data-status");
  report.check(
    "root settles at 'waiting' and the child settles at 'done'",
    rootStatus === "waiting" && childStatus === "done",
    `root = ${rootStatus}, child = ${childStatus}`,
  );

  // Selecting the child row switches the main pane to show the sub-agent, not the root.
  await childRow.click();
  await page.waitForFunction(
    "document.querySelector('.agent-header-name')?.textContent?.includes('sub')",
  );
  const headerName = await page.locator(".agent-header-name").textContent();
  report.check(
    "selecting the child row shows the sub-agent's own header, not 'Root agent'",
    headerName !== "Root agent",
    `header name = ${headerName}`,
  );

  const screenshot = artifactPath("spike-agent-tree.png");
  await page.screenshot({ path: screenshot, fullPage: true });
  await browser.close();
  await cleanup();
  report.finish({ screenshot });
} catch (err) {
  const screenshot = artifactPath("spike-agent-tree-error.png");
  await page.screenshot({ path: screenshot, fullPage: true }).catch(() => {});
  await browser.close().catch(() => {});
  await cleanup();
  report.check("script completed without an unexpected error", false, String(err));
  report.finish({ screenshot });
}
