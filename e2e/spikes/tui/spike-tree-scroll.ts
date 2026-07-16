// DH-0060 spike — Test Plan item (DH-0027): "the agent tree view scrolls to keep the
// selected/highlighted entry visible as you navigate a tree taller than the visible pane."
//
// Spawns 15 sub-agents in one root turn (one assistant turn with 15 `Agent` tool_use blocks —
// each fires its own `agent_spawned` event immediately, regardless of the tool's
// `run_in_background` default, so this doesn't need to wait on any sub-agent's own
// completion) against a tmux pane deliberately shrunk to 15 rows, so the resulting 16-entry
// tree (1 root + 15 children) is guaranteed taller than the visible content area (well under
// 12 content rows per src/tui/render.ts's `contentRows = rows - HEADER_ROWS(2) - footerRows(1)`
// math for the tree view). Then it presses Down repeatedly and confirms: (a) the selection
// marker ("> ") is always present on screen (never scrolls off), and (b) the root entry —
// visible at the top initially — eventually scrolls out of view as selection moves deep into
// the list, proving the viewport actually follows the selection rather than staying pinned.
//
// Run: bun e2e/spikes/tui/spike-tree-scroll.ts

import { ensureBuilt } from "../../support/build.ts";
import { startMockAnthropicProvider, successTurn } from "../../support/mock-provider.ts";
import { startTmuxSession } from "../../support/tmux-pty.ts";
import { baseConfig, createWorkspace } from "../../support/workspace.ts";
import type { SpikeCheck } from "./spike-support.ts";
import { expectTrue, reportAndExit } from "./spike-support.ts";

const CHILD_COUNT = 15;

const rootProvider = startMockAnthropicProvider([
  {
    toolCalls: Array.from({ length: CHILD_COUNT }, (_, i) => ({
      name: "Agent",
      input: { prompt: `Helper #${i}, say hi.`, model: "sub" },
    })),
    stopReason: "tool_use",
  },
  successTurn("All helpers spawned."),
]);
const subProvider = startMockAnthropicProvider([successTurn("Sub-agent reporting in.")]);

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
// Deliberately short (15 rows) so the tree view's content area is well under CHILD_COUNT + 1
// entries — forces the scroll-follows-selection behavior to actually engage.
const session = startTmuxSession([binaryPath], { cwd: ws.dir, cols: 100, rows: 15 });
const stop = () => {
  session.kill();
  rootProvider.stop();
  subProvider.stop();
  ws.cleanup();
};

let checks: SpikeCheck[] = [];
let pane = "";
try {
  await session.waitFor((screen) => screen.includes("Dark Harness"));
  await session.waitFor((screen) => screen.includes("Root Agent"));

  session.sendText("spawn helpers");
  await session.waitFor((screen) => screen.includes("> spawn helpers"));
  session.sendKeys("Enter");
  await session.waitFor((screen) => screen.includes("All helpers spawned."), 15_000);

  session.sendKeys("Left");
  pane = await session.waitFor((screen) => screen.includes("Agent Tree"), 10_000);
  // Give every agent_spawned event a moment to land before counting entries.
  pane = await session.waitFor((screen) => {
    const rootCount = (screen.match(/agent-root/g) ?? []).length;
    return rootCount > 0 && screen.includes("(sub)");
  }, 10_000);

  const initialScreenHasRoot = pane.includes("agent-root");

  // Press Down enough times to move well past the visible window (content area is far
  // smaller than CHILD_COUNT entries) and confirm the selection marker never disappears.
  let markerAlwaysVisible = true;
  for (let i = 0; i < CHILD_COUNT; i += 1) {
    session.sendKeys("Down");
    // Small settle; capture-pane reads the already-rendered frame synchronously so no long
    // wait is needed, but give the renderer a beat under load.
    await Bun.sleep(60);
    const screen = session.capture();
    if (!screen.split("\n").some((line) => line.startsWith("> "))) {
      markerAlwaysVisible = false;
      break;
    }
  }

  const finalPane = session.capture();
  const rootScrolledOffEventually = !finalPane.includes("agent-root");
  pane = finalPane;

  checks = [
    expectTrue(initialScreenHasRoot, "root entry visible at the top of the tree before scrolling"),
    expectTrue(
      markerAlwaysVisible,
      "the '> ' selection marker stayed on screen through every Down press",
    ),
    expectTrue(
      rootScrolledOffEventually,
      "root entry scrolled out of view once selection moved deep into the list (viewport follows selection, not pinned to top)",
      rootScrolledOffEventually
        ? undefined
        : `root entry still visible after ${CHILD_COUNT} Down presses; pane:\n${finalPane}`,
    ),
  ];
} finally {
  stop();
}

reportAndExit("tree-scroll (DH-0027)", checks, pane);
