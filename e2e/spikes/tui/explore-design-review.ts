// Architect design-review exploration (Fable, 2026-07-16) — NOT part of any gate.
// Drives a rich-Markdown conversation plus a 3-level agent tree through the real TUI and
// dumps plain + raw-ANSI captures for visual judgment. Run:
//   bun e2e/spikes/tui/explore-design-review.ts

import { ensureBuilt } from "../../support/build.ts";
import { startMockAnthropicProvider, successTurn } from "../../support/mock-provider.ts";
import { startTmuxSession } from "../../support/tmux-pty.ts";
import { baseConfig, createWorkspace } from "../../support/workspace.ts";

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
  "Full dashboards: [grafana](https://grafana.internal/d/apigw) — this is a long trailing paragraph intended to exercise word wrapping behavior at one hundred columns so we can judge how a dense prose line reads when it folds onto the next row of the terminal frame.",
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

const ws = createWorkspace("dh-explore-");
ws.writeConfig(
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
const binaryPath = await ensureBuilt();
const session = startTmuxSession([binaryPath], { cwd: ws.dir, cols: 100, rows: 40 });
const stop = () => {
  session.kill();
  rootProvider.stop();
  subProvider.stop();
  subsubProvider.stop();
  ws.cleanup();
};

function dump(title: string, plain: string, raw?: string): void {
  console.log(`\n========== ${title} (plain) ==========`);
  console.log(plain.trimEnd());
  if (raw !== undefined) {
    console.log(`\n========== ${title} (raw ANSI, JSON-escaped rows w/ escapes) ==========`);
    for (const row of raw.trimEnd().split("\n")) {
      if (row.includes("\x1b")) console.log(JSON.stringify(row));
    }
  }
}

try {
  await session.waitFor((screen) => screen.includes("Root Agent"));

  // Turn 1: rich markdown.
  session.sendText("show me the deploy report");
  session.sendKeys("Enter");
  await session.waitFor((s) => s.includes("Deploy report") || s.includes("Full dashboards"));
  await new Promise((r) => setTimeout(r, 500));
  dump("ROOT VIEW: rich markdown", session.capture(), session.captureRaw());

  // Turn 2: trigger the nested agent spawn.
  session.sendText("spawn the workers");
  session.sendKeys("Enter");
  await session.waitFor((s) => s.includes("two levels"), 15_000);
  await new Promise((r) => setTimeout(r, 500));
  dump("ROOT VIEW: after nested spawn", session.capture());

  // Agent tree view.
  session.sendKeys("Left");
  await session.waitFor((s) => s.includes("Agent Tree"), 10_000);
  await new Promise((r) => setTimeout(r, 300));
  dump("TREE VIEW: 3-level hierarchy", session.capture(), session.captureRaw());

  // Open a sub-agent (navigate down once, Enter).
  session.sendKeys("Down");
  session.sendKeys("Enter");
  await new Promise((r) => setTimeout(r, 500));
  dump("AGENT VIEW: level-2 sub-agent (read-only)", session.capture(), session.captureRaw());

  // Narrow terminal: how does the markdown re-wrap at 60 cols?
  session.resize(60, 24);
  session.sendKeys("Escape");
  await new Promise((r) => setTimeout(r, 500));
  dump("ROOT VIEW at 60x24", session.capture());
} finally {
  stop();
}
console.log("\nEXPLORE: done");
