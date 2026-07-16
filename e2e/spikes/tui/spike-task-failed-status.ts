// DH-0060 spike — Test Plan item: "`TASK_FAILED`/structured-outcome self-report is reflected
// in the UI's final status marker."
//
// Deliberately spawns a SUB-AGENT that self-reports `TASK_FAILED`, not the root: the root
// agent in every interactive session (server/TUI/Web) is always constructed with
// `interactive: true` (src/cli.ts), and src/agent/loop.ts's Round 5 convention makes an
// interactive loop pause at "waiting" on every non-tool-use turn regardless of content — it
// never even checks the `TASK_FAILED` marker, so the root can literally never reach "failed"
// while interactive (confirmed by reading loop.ts's `if (!params.interactive)` guard around
// the self-report check). Sub-agents spawned via the `Agent` tool always get
// `interactive: false` (src/agent/runtime.ts's spawnAgent, by design — a spawned sub-agent has
// no human operator to pause and wait for), so they DO check the marker and DO reach a real
// terminal "failed" status, which the tree renders with the red glyph
// (`STATUS_COLOR.failed` = `\x1b[31m`, src/tui/render.ts). This is the only reachable path to
// this Test Plan item through the actual TUI.
//
// Run: bun e2e/spikes/tui/spike-task-failed-status.ts

import { ensureBuilt } from "../../support/build.ts";
import {
  startMockAnthropicProvider,
  successTurn,
  taskFailedTurn,
} from "../../support/mock-provider.ts";
import { startTmuxSession } from "../../support/tmux-pty.ts";
import { baseConfig, createWorkspace } from "../../support/workspace.ts";
import type { SpikeCheck } from "./spike-support.ts";
import { expectContains, expectTrue, reportAndExit } from "./spike-support.ts";

const rootProvider = startMockAnthropicProvider([
  {
    toolCalls: [
      {
        name: "Agent",
        input: { prompt: "Do the impossible.", description: "Do the impossible", model: "sub" },
      },
    ],
    stopReason: "tool_use",
  },
  successTurn("Root heard the helper couldn't finish."),
]);
const subProvider = startMockAnthropicProvider([taskFailedTurn()]);

const ws = createWorkspace("dh-spike-");
ws.writeConfig(
  baseConfig(rootProvider.baseURL, {
    provider: [
      { name: "root-provider", type: "anthropic", baseURL: rootProvider.baseURL, apiKey: "k" },
      { name: "sub-provider", type: "anthropic", baseURL: subProvider.baseURL, apiKey: "k" },
    ],
    models: [
      { name: "mock", provider: "root-provider", model: "mock-model" },
      { name: "sub", provider: "sub-provider", model: "mock-model" },
    ],
  }),
);
const binaryPath = await ensureBuilt();
const session = startTmuxSession([binaryPath], { cwd: ws.dir, cols: 100, rows: 30 });
const stop = () => {
  session.kill();
  rootProvider.stop();
  subProvider.stop();
  ws.cleanup();
};

const FAILED_GLYPH_PREFIX = "\x1b[31m●\x1b[39m"; // red status dot (●) = "failed"

let checks: SpikeCheck[] = [];
let evidence = "";
try {
  await session.waitFor((screen) => screen.includes("Dark Harness"));
  await session.waitFor((screen) => screen.includes("Root Agent"));

  session.sendText("spawn a helper for an impossible task");
  await session.waitFor((screen) => screen.includes("> spawn a helper for an impossible task"));
  session.sendKeys("Enter");
  // Root's second turn only fires after the tool_result carrying the sub-agent's own outcome
  // comes back, so waiting for root's final reply also proves the sub-agent's loop finished.
  await session.waitFor(
    (screen) => screen.includes("Root heard the helper couldn't finish."),
    15_000,
  );

  session.sendKeys("Left");
  await session.waitFor((screen) => screen.includes("Agent Tree"));
  let sawFailedGlyph = false;
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const raw = session.captureRaw();
    if (raw.includes(FAILED_GLYPH_PREFIX) && raw.includes("Do the impossible")) {
      sawFailedGlyph = true;
      break;
    }
    await Bun.sleep(150);
  }
  evidence = session.captureRaw();
  const plainPane = session.capture();

  checks = [
    expectContains(plainPane, "agent-", "sub-agent entry present in the tree"),
    expectTrue(
      sawFailedGlyph,
      "sub-agent tree entry shows the red 'failed' status glyph after self-reporting TASK_FAILED",
      sawFailedGlyph
        ? undefined
        : "red \\x1b[31m● glyph never appeared next to the sub-agent entry",
    ),
  ];
} finally {
  stop();
}

reportAndExit("task-failed-status", checks, evidence);
