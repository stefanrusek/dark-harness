// DH-0068: reproducible README hero screenshot capture — NOT part of any gate (no `.test.`
// suffix; pattern-matches e2e/spikes/web/explore-design-review.ts).
//
// Drives the REAL compiled `dh --web` binary against a scripted mock provider and real
// Playwright/Chromium — no image editing, no fake DOM — to produce a single session frame
// that demonstrates the product's core "watch a tree of agents work" pitch: a 5-agent
// hierarchy (root -> three children, one of which has its own child) with all four status
// colors visible at once (blue running, amber waiting, green done, red failed), rich
// Markdown mid-transcript, a user message bubble, non-zero token/cost totals, short
// (non-UUID) sidebar labels, and the Live connection pill + composer both in frame.
//
// Saves two PNGs directly to docs/media/ (committed, not gitignored artifacts):
//   docs/media/hero-web-dark.png
//   docs/media/hero-web-light.png
//
// Run:  bun e2e/spikes/web/hero-screenshot.ts

import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { spawnDh } from "../../support/dh-process.ts";
import { startMockAnthropicProvider, successTurn } from "../../support/mock-provider.ts";
import { baseConfig, createWorkspace } from "../../support/workspace.ts";
import { resolveChromiumExecutable } from "./support.ts";

const MEDIA_DIR = resolve(import.meta.dir, "..", "..", "..", "docs", "media");
mkdirSync(MEDIA_DIR, { recursive: true });
const DARK_PATH = resolve(MEDIA_DIR, "hero-web-dark.png");
const LIGHT_PATH = resolve(MEDIA_DIR, "hero-web-light.png");

// Reused verbatim from explore-design-review.ts's "deploy report" fixture: heading, styled
// fenced code block, list, blockquote — already shaped right per DH-0068's spec.
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
  "  const res = await fetch(`https://${node}/healthz`);",
  '  return res.ok && (await res.json()).status === "green";',
  "}",
  "```",
  "",
  "---",
  "",
  "Full dashboards: [grafana](https://grafana.internal/d/apigw) — a long trailing paragraph to judge how dense prose reads in the transcript bubble at typical widths.",
].join("\n");

// Pricing (USD per million tokens) shared by every model so `costUsd` is computed for every
// turn and the session-total strip reads a real, non-zero, sub-$1 amount rather than $0.00.
const PRICING = { inputPricePerMToken: 3, outputPricePerMToken: 15 };

// --- Root: rich-markdown reply, then a background 3-way fan-out, then a final wrap-up. ---
const rootProvider = startMockAnthropicProvider([
  { text: RICH_MARKDOWN, stopReason: "end_turn", inputTokens: 15_000, outputTokens: 3_000 },
  {
    toolCalls: [
      {
        name: "Agent",
        input: {
          prompt: "Analyze the deploy logs for anomalies.",
          description: "Analyze deploy logs",
          model: "deep-analysis",
        },
      },
      {
        name: "Agent",
        input: {
          prompt: "Draft the release notes from the deploy report.",
          description: "Draft release notes",
          model: "release-notes",
        },
      },
      {
        name: "Agent",
        input: {
          prompt: "Validate the rollback plan against the current topology.",
          description: "Validate rollback plan",
          model: "rollback-check",
        },
      },
    ],
    stopReason: "tool_use",
    inputTokens: 5_000,
    outputTokens: 500,
  },
  {
    text: "Kicked off three verification agents in the background — release notes and the rollback check are already in; deploy-log analysis is still running.",
    stopReason: "end_turn",
    inputTokens: 8_000,
    outputTokens: 800,
  },
  // DH-0068 fix: each background sub-agent's completion/failure wakes root with its own
  // SendMessage, and root replies once per wake-up — under-scripting this repeats the prior
  // turn verbatim (mock-provider.ts's exhausted-turns fallback), which reads as a rendering
  // bug (three identical assistant bubbles) rather than the intended one-line acks below.
  {
    text: "Noted — the rollback validation failed; flagging it for follow-up.",
    stopReason: "end_turn",
    inputTokens: 6_000,
    outputTokens: 400,
  },
  {
    text: "Release notes are in and canary metrics are synced.",
    stopReason: "end_turn",
    inputTokens: 6_500,
    outputTokens: 400,
  },
]);

// --- Child A: stays "running" (blue, pulsing) for the whole capture window — a long
// artificial delay simulates a still-in-flight model call. ---
const analysisProvider = startMockAnthropicProvider([
  {
    text: "Deploy log analysis complete: no anomalies found.",
    stopReason: "end_turn",
    inputTokens: 7_000,
    outputTokens: 1_400,
    delayMs: 90_000,
  },
]);

// --- Child B: reaches "done", and along the way spawns its own child (Child D) — the
// grandchild that demonstrates two-level indentation, not just one. ---
const releaseNotesProvider = startMockAnthropicProvider([
  {
    toolCalls: [
      {
        name: "Agent",
        input: {
          prompt: "Sync the canary rollout metrics into the release notes.",
          description: "Sync canary metrics",
          model: "canary-sync",
        },
      },
    ],
    stopReason: "tool_use",
    inputTokens: 4_000,
    outputTokens: 800,
  },
  {
    text: "Release notes drafted; canary metrics synced in.",
    stopReason: "end_turn",
    inputTokens: 5_000,
    outputTokens: 1_700,
  },
]);

// --- Child D (grandchild, under Child B): "done". ---
const canaryProvider = startMockAnthropicProvider([
  {
    text: "Canary rollout metrics synced.",
    stopReason: "end_turn",
    inputTokens: 6_000,
    outputTokens: 1_200,
  },
]);

// --- Child C: self-reports TASK_FAILED — the only reachable path to a real terminal
// "failed" status for a (non-interactive, per Agent-tool semantics) sub-agent; see
// e2e/spikes/tui/spike-task-failed-status.ts's doc comment for why. ---
const rollbackProvider = startMockAnthropicProvider([
  {
    text: "Rollback plan references a topology snapshot that no longer exists. TASK_FAILED",
    stopReason: "end_turn",
    inputTokens: 4_000,
    outputTokens: 1_600,
  },
]);

const workspace = createWorkspace("dh-hero-web-");
workspace.writeConfig(
  baseConfig(rootProvider.baseURL, {
    provider: [
      { name: "root-provider", type: "anthropic", baseURL: rootProvider.baseURL, apiKey: "k" },
      {
        name: "analysis-provider",
        type: "anthropic",
        baseURL: analysisProvider.baseURL,
        apiKey: "k",
      },
      {
        name: "release-notes-provider",
        type: "anthropic",
        baseURL: releaseNotesProvider.baseURL,
        apiKey: "k",
      },
      { name: "canary-provider", type: "anthropic", baseURL: canaryProvider.baseURL, apiKey: "k" },
      {
        name: "rollback-provider",
        type: "anthropic",
        baseURL: rollbackProvider.baseURL,
        apiKey: "k",
      },
    ],
    models: [
      { name: "mock", provider: "root-provider", model: "mock-model", ...PRICING },
      { name: "deep-analysis", provider: "analysis-provider", model: "mock-model", ...PRICING },
      {
        name: "release-notes",
        provider: "release-notes-provider",
        model: "mock-model",
        ...PRICING,
      },
      { name: "canary-sync", provider: "canary-provider", model: "mock-model", ...PRICING },
      { name: "rollback-check", provider: "rollback-provider", model: "mock-model", ...PRICING },
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

function rowByLabel(label: string) {
  return page.locator(".agent-row", { hasText: label });
}

try {
  // Turn 1: user message + rich-markdown assistant reply.
  await page.fill(".composer-input", "show me the deploy report");
  await page.click(".composer-send");
  await page.waitForFunction(
    "document.querySelector('.agent-transcript')?.textContent?.includes('Full dashboards')",
    undefined,
    { timeout: 15_000 },
  );
  await page.waitForFunction(
    "document.querySelector('.agent-row.root')?.getAttribute('data-status') === 'waiting'",
    undefined,
    { timeout: 15_000 },
  );

  // Turn 2: fan out to three verification agents (background spawns).
  await page.fill(".composer-input", "spawn the verification team");
  await page.click(".composer-send");
  await page.waitForFunction(
    "document.querySelectorAll('.agent-tree .agent-row').length >= 4",
    undefined,
    { timeout: 20_000 },
  );
  // Child B (release notes) spawns Child D (canary sync) — the grandchild.
  await page.waitForFunction(
    "document.querySelectorAll('.agent-tree .agent-row').length >= 5",
    undefined,
    { timeout: 20_000 },
  );
  // Root parks back at "waiting" once its background fan-out returns.
  await page.waitForFunction(
    "document.querySelector('.agent-row.root')?.getAttribute('data-status') === 'waiting'",
    undefined,
    { timeout: 20_000 },
  );
  // Settle the terminal-status children: release notes + canary sync -> done, rollback
  // check -> failed. Deploy-log analysis is deliberately left "running" (90s delay).
  await page.waitForFunction(
    "[...document.querySelectorAll('.agent-row')].find(r => r.textContent.includes('Draft release notes'))?.getAttribute('data-status') === 'done'",
    undefined,
    { timeout: 20_000 },
  );
  await page.waitForFunction(
    "[...document.querySelectorAll('.agent-row')].find(r => r.textContent.includes('Sync canary metrics'))?.getAttribute('data-status') === 'done'",
    undefined,
    { timeout: 20_000 },
  );
  await page.waitForFunction(
    "[...document.querySelectorAll('.agent-row')].find(r => r.textContent.includes('Validate rollback plan'))?.getAttribute('data-status') === 'failed'",
    undefined,
    { timeout: 20_000 },
  );

  const analysisStatus = await rowByLabel("Analyze deploy logs").getAttribute("data-status");
  if (analysisStatus !== "running") {
    throw new Error(`expected 'Analyze deploy logs' to still be running, got: ${analysisStatus}`);
  }

  // Sanity-check every status token is present in one frame before capturing.
  const statuses = await page.$$eval(".agent-row", (rows) =>
    rows.map((r) => r.getAttribute("data-status")),
  );
  for (const want of ["running", "waiting", "done", "failed"]) {
    if (!statuses.includes(want)) {
      throw new Error(`expected a '${want}' status row in frame, got statuses: ${statuses}`);
    }
  }

  // Select the root agent, then scroll its transcript back up to the rich-Markdown deploy
  // report (a fresh message auto-scrolls to the bottom — the ack replies to the background
  // completions, not the styled Markdown the hero needs in frame).
  await page.click(".agent-row.root");
  await page.evaluate("document.querySelector('pre')?.scrollIntoView({ block: 'center' })");
  await page.waitForTimeout(600);

  await page.screenshot({ path: DARK_PATH });
  console.log("saved:", DARK_PATH);

  await page.emulateMedia({ colorScheme: "light" });
  await page.waitForTimeout(400);
  await page.screenshot({ path: LIGHT_PATH });
  console.log("saved:", LIGHT_PATH);

  console.log("HERO SCREENSHOT: done");
} finally {
  await browser.close().catch(() => {});
  proc.kill();
  rootProvider.stop();
  analysisProvider.stop();
  releaseNotesProvider.stop();
  canaryProvider.stop();
  rollbackProvider.stop();
  workspace.cleanup();
}
