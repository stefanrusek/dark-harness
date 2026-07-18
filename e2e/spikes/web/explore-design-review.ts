// Architect design-review exploration (Fable, 2026-07-16) — NOT part of any gate.
// Drives a rich-Markdown conversation plus a 3-level agent tree through the real web UI and
// captures dark- and light-mode screenshots for visual judgment. Run:
//   bun e2e/spikes/web/explore-design-review.ts

import { spawnDh } from "../../support/dh-process.ts";
import { startMockAnthropicProvider, successTurn } from "../../support/mock-provider.ts";
import { baseConfig, createWorkspace } from "../../support/workspace.ts";
import { artifactPath, resolveChromiumExecutable } from "./support.ts";

const RICH_MARKDOWN = [
  "# Deploy report",
  "",
  "The rollout of **api-gateway v2.3.1** is *complete*. Verified `healthz` on all nodes.",
  "",
  "## What changed",
  "",
  "- Rate limiting moved to the edge",
  "  - token bucket, `1000 req/min` per key",
  "  - burst allowance of 50",
  "- Removed the legacy `/v1/auth` shim",
  "1. drained connections",
  "2. flipped traffic",
  "3. verified error rates",
  "",
  "> Note: one canary node reported elevated p99 for ~3 minutes during the flip.",
  "",
  "```typescript",
  "export async function verify(node: string): Promise<boolean> {",
  // biome-ignore lint/suspicious/noTemplateCurlyInString: literal example code text, not an interpolation bug.
  "  const res = await fetch(`https://${node}/healthz`);",
  '  return res.ok && (await res.json()).status === "green";',
  "}",
  "```",
  "",
  "---",
  "",
  "Full dashboards: [grafana](https://grafana.internal/d/apigw) — a long trailing paragraph to judge how dense prose reads in the transcript bubble at typical widths.",
].join("\n");

const rootProvider = startMockAnthropicProvider([
  successTurn(RICH_MARKDOWN),
  {
    toolCalls: [
      {
        name: "Agent",
        input: { prompt: "Level-2 work.", description: "Level-2 work", model: "sub" },
      },
    ],
    stopReason: "tool_use",
  },
  successTurn("Root coordinated **two levels** of sub-agents."),
]);
const subProvider = startMockAnthropicProvider([
  {
    toolCalls: [
      {
        name: "Agent",
        input: { prompt: "Level-3 work.", description: "Level-3 work", model: "subsub" },
      },
    ],
    stopReason: "tool_use",
  },
  successTurn("Level-2 sub-agent done."),
]);
const subsubProvider = startMockAnthropicProvider([successTurn("Level-3 leaf agent done.")]);

const workspace = createWorkspace("dh-explore-web-");
workspace.writeConfig(
  baseConfig(rootProvider.baseURL, {
    provider: [
      { name: "root-provider", type: "anthropic", baseURL: rootProvider.baseURL, apiKey: "k" },
      { name: "sub-provider", type: "anthropic", baseURL: subProvider.baseURL, apiKey: "k" },
      { name: "subsub-provider", type: "anthropic", baseURL: subsubProvider.baseURL, apiKey: "k" },
    ],
    models: [
      { name: "mock", provider: "root-provider", model: "mock-model" },
      { name: "sub", provider: "sub-provider", model: "mock-model" },
      { name: "subsub", provider: "subsub-provider", model: "mock-model" },
    ],
  }),
);

const proc = await spawnDh({ args: ["--web"], cwd: workspace.dir });
const stdout = await proc.waitForStdout(/web UI ready at (\S+)/, 20_000);
const webUrl = /web UI ready at (\S+)\./.exec(stdout)?.[1];
if (!webUrl) throw new Error(`could not parse web UI URL from dh stdout: ${stdout}`);

const executablePath = await resolveChromiumExecutable();
const { chromium } = await import("playwright");
const browser = await chromium.launch({ executablePath, headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.emulateMedia({ colorScheme: "dark" });
await page.goto(webUrl);
await page.waitForSelector(".dh-app");
await page.waitForFunction("document.querySelector('.connection-pill')?.textContent === 'Live'");

try {
  // Turn 1: rich markdown.
  await page.fill(".composer-input", "show me the deploy report");
  await page.click(".composer-send");
  await page.waitForSelector(".turn-assistant", { timeout: 15_000 });
  await page.waitForFunction(
    "document.querySelector('.agent-transcript')?.textContent?.includes('Full dashboards')",
    undefined,
    { timeout: 15_000 },
  );
  await page.waitForTimeout(600);
  await page.screenshot({ path: artifactPath("explore-md-dark.png") });
  console.log("saved:", artifactPath("explore-md-dark.png"));

  // Turn 2: nested spawns.
  await page.fill(".composer-input", "spawn the workers");
  await page.click(".composer-send");
  await page.waitForFunction("document.querySelectorAll('.agent-row').length >= 3", undefined, {
    timeout: 20_000,
  });
  await page.waitForFunction(
    "document.querySelector('.agent-transcript')?.textContent?.includes('two levels')",
    undefined,
    { timeout: 20_000 },
  );
  await page.waitForTimeout(800);
  await page.screenshot({ path: artifactPath("explore-tree-dark.png") });
  console.log("saved:", artifactPath("explore-tree-dark.png"));

  // Sidebar HTML dump for structure judgment.
  const sidebarHtml = await page.evaluate(
    "document.querySelector('.sidebar-tree')?.innerHTML ?? '(none)'",
  );
  console.log("SIDEBAR HTML:\n", sidebarHtml);

  // Markdown DOM structure of the rich turn.
  const turnHtml = await page.evaluate(
    "document.querySelector('.turn-assistant .turn-text')?.innerHTML ?? '(none)'",
  );
  console.log("RICH TURN HTML (first 1200 chars):\n", String(turnHtml).slice(0, 1200));

  // Select the level-3 sub-agent to see a non-root transcript + header.
  await page.click(".agent-row:last-child");
  await page.waitForTimeout(500);
  await page.screenshot({ path: artifactPath("explore-subagent-dark.png") });
  console.log("saved:", artifactPath("explore-subagent-dark.png"));

  // Light mode of the markdown-heavy root view.
  await page.click(".agent-row.root");
  await page.emulateMedia({ colorScheme: "light" });
  await page.waitForTimeout(400);
  await page.screenshot({ path: artifactPath("explore-md-light.png") });
  console.log("saved:", artifactPath("explore-md-light.png"));
} finally {
  await browser.close().catch(() => {});
  proc.kill();
  rootProvider.stop();
  subProvider.stop();
  subsubProvider.stop();
  workspace.cleanup();
}
console.log("EXPLORE: done");
