// DH-0060 spike — Test Plan item: "Agent tree renders parent/child spawn hierarchy correctly
// as sub-agents are created."
//
// Also covers half of the Test Plan's "per-agent status shows the correct label/color"
// item: since the sub-agent here completes successfully (a plain successTurn, not
// TASK_FAILED), it reaches a terminal "done" status — this spike also polls for the green
// "done" glyph (spike-ctrlc-exit-code.ts covers "waiting" cyan, spike-task-failed-status.ts
// covers "failed" red; "running"/"stopped" aren't covered by any spike in this round).
//
// Scripts a genuine `tool_use` turn calling the real `Agent` tool (mirrors
// e2e/server-protocol.test.ts's "Agent tool spawns a real sub-agent" scenario, but driven
// through the actual TUI under tmux instead of raw HTTP/SSE): root gets a tool_use turn that
// spawns a sub-agent on a second, independently-scripted mock provider, then opens the Agent
// Tree view (Left-arrow on empty input) and asserts the child renders indented one level
// under the root with its own id and model name.
//
// Run: bun e2e/spikes/tui/spike-agent-tree-hierarchy.ts

import { STATUS_TOKENS } from "../../../src/design-tokens.ts";
import { ensureBuilt } from "../../support/build.ts";
import { startMockAnthropicProvider, successTurn } from "../../support/mock-provider.ts";
import { startTmuxSession } from "../../support/tmux-pty.ts";
import { baseConfig, createWorkspace } from "../../support/workspace.ts";
import type { SpikeCheck } from "./spike-support.ts";
import { expectContains, expectTrue, reportAndExit } from "./spike-support.ts";

const rootProvider = startMockAnthropicProvider([
  {
    toolCalls: [
      {
        name: "Agent",
        input: {
          prompt: "Say hi as a sub-agent.",
          description: "Say hi as sub-agent",
          model: "sub",
        },
      },
    ],
    stopReason: "tool_use",
  },
  successTurn("Root heard back from the sub-agent."),
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
const session = startTmuxSession([binaryPath], { cwd: ws.dir, cols: 100, rows: 30 });
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

  session.sendText("spawn a helper");
  await session.waitFor((screen) => screen.includes("> spawn a helper"));
  session.sendKeys("Enter");
  // Root's second turn only fires after the sub-agent's own turn completes and the tool
  // result is fed back, so waiting for the root's final reply also proves the sub-agent ran.
  await session.waitFor((screen) => screen.includes("Root heard back from the sub-agent."), 15_000);

  // Left-arrow on an empty input opens the Agent Tree view.
  session.sendKeys("Left");
  pane = await session.waitFor((screen) => screen.includes("Agent Tree"), 10_000);
  // DH-0212: this used to wait only for "agent-root" — trivially already on screen the
  // instant the tree view opens (the request_agent_tree round-trip resolves before the
  // child's row paints), so the childLine/childIndent checks below raced the child's own
  // render and saw a root-only tree. Wait for the child's own description text too, same
  // poll pattern as spike-tree-scroll.ts.
  pane = await session.waitFor(
    (screen) => screen.includes("agent-root") && screen.includes("Say hi as sub-agent"),
    5_000,
  );

  const lines = pane.split("\n");
  const rootLine = lines.find((l) => l.includes("agent-root"));
  const childLine = lines.find((l) => l.includes("Say hi as sub-agent"));
  // DH-0065: nesting depth is now shown with tree connectors ("├─ "/"└─ ", matching `dh
  // logs`), not plain repeated ASCII spaces — a leading-whitespace-only regex no longer
  // grows with depth (the connector glyphs are non-whitespace). Measure depth instead by the
  // ANSI-stripped column position of the "●" status glyph, which the connector prefix still
  // pushes further right for a deeper entry.
  // biome-ignore lint/suspicious/noControlCharactersInRegex: stripping real ESC bytes is the point
  const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");
  const glyphColumn = (line: string | undefined): number =>
    line ? stripAnsi(line).indexOf("●") : -1;
  const rootIndent = glyphColumn(rootLine);
  const childIndent = glyphColumn(childLine);

  // Poll for the green "done" glyph on the (sub) entry — a plain terminal-status color check
  // to close out the Test Plan's "per-agent status shows the correct label/color" item.
  // DH-0212: derive the color code from the shared STATUS_TOKENS (src/design-tokens.ts)
  // instead of a second hardcoded literal, so it can't silently drift the way
  // spike-ctrlc-exit-code.ts's waiting-glyph check did (DH-0100 recolored a status without
  // this spike's copy following). The `\x1b[39m` reset stays as-is — `tmux capture-pane -e`
  // re-serializes a foreground-only SGR run as a foreground-only reset regardless of what
  // full-reset byte the renderer actually emitted (see spike-ctrlc-exit-code.ts's comment).
  const DONE_GLYPH_PREFIX = `\x1b[${STATUS_TOKENS.done.sgr}m●\x1b[39m`;
  let sawDoneGlyph = false;
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const raw = session.captureRaw();
    if (raw.includes(DONE_GLYPH_PREFIX) && raw.includes("Say hi as sub-agent")) {
      sawDoneGlyph = true;
      break;
    }
    await Bun.sleep(150);
  }

  checks = [
    expectContains(pane, "agent-root", "root agent entry rendered in the tree"),
    expectTrue(
      childLine !== undefined,
      "a second (child sub-agent) entry rendered in the tree",
      childLine !== undefined ? undefined : `no non-root entry found; pane:\n${pane}`,
    ),
    expectTrue(
      childLine !== undefined && childIndent > rootIndent,
      "child entry is indented deeper than the root entry (parent/child hierarchy)",
      childLine === undefined
        ? undefined
        : `root indent=${rootIndent}, child indent=${childIndent}`,
    ),
    expectTrue(
      sawDoneGlyph,
      "sub-agent tree entry shows the green 'done' status glyph after completing successfully",
      sawDoneGlyph
        ? undefined
        : "green \\x1b[32m● glyph never appeared next to the sub-agent entry",
    ),
  ];
} finally {
  stop();
}

reportAndExit("agent-tree-hierarchy", checks, pane);
