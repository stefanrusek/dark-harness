// DH-0246 real-PTY verification spike — mirrors DH-0060's spike pattern (spike-support.ts):
// boots the real compiled binary under a real tmux PTY against a scripted mock provider, and
// checks the transcript's collapsed-by-default tool-call grouping/expand-collapse/detail
// behavior visually, not just via ink-testing-library's lastFrame() (unit tests already cover
// that; this is the "does it actually work in a real terminal" check the ticket asks for).
//
// Run: bun e2e/spikes/tui/spike-tool-call-grouping.ts
// Exit code 0 = all checks passed; 1 = at least one failed. Full report on stdout.

import { successTurn } from "../../support/mock-provider.ts";
import type { SpikeCheck } from "./spike-support.ts";
import { bootLocalTui, expectContains, expectTrue, reportAndExit } from "./spike-support.ts";

// Turn 1: two consecutive Bash calls (a groupable run of 2) -> the model resumes and
// finishes with a plain reply. This exercises User Story "run of 2+ collapses" end to end.
const { session, stop } = await bootLocalTui([
  {
    toolCalls: [{ name: "Bash", input: { command: "echo one" } }],
    stopReason: "tool_use",
  },
  {
    toolCalls: [{ name: "Bash", input: { command: "echo two" } }],
    stopReason: "tool_use",
  },
  successTurn("Both commands ran."),
]);

let checks: SpikeCheck[] = [];
let pane = "";
try {
  session.sendText("run two commands");
  await session.waitFor((screen) => screen.includes("> run two commands"));
  session.sendKeys("Enter");
  await session.waitFor((screen) => screen.includes("Both commands ran."), 15_000);

  // Collapsed by default: one "2 tool calls" summary row, not each call's own input line.
  const collapsedPane = session.capture();
  const collapsedChecks: SpikeCheck[] = [
    expectContains(
      collapsedPane,
      "2 tool calls",
      "a run of 2+ tool calls collapses to a summary row",
    ),
    expectTrue(
      !collapsedPane.includes("echo one"),
      "the collapsed group hides each individual call's input (echo one not shown)",
    ),
  ];

  // Composer is empty right now (message already sent) — down focuses the (only) group
  // header row, enter expands it into its member rows.
  session.sendKeys("Down");
  session.sendKeys("Enter");
  await session.waitFor((screen) => screen.includes("echo one") && screen.includes("echo two"));
  const expandedPane = session.capture();
  const expandChecks: SpikeCheck[] = [
    expectContains(
      expandedPane,
      "echo one",
      "expanding the group reveals the first member's input",
    ),
    expectContains(
      expandedPane,
      "echo two",
      "expanding the group reveals the second member's input",
    ),
  ];

  // Activating a member row (down once more onto the first member, enter) shows its
  // input+result detail — duration/success, not raw output (the wire has none).
  session.sendKeys("Down");
  session.sendKeys("Enter");
  await session.waitFor((screen) => screen.includes("Result:"));
  const detailPane = session.capture();
  const detailChecks: SpikeCheck[] = [
    expectContains(
      detailPane,
      "Input: Bash: echo one",
      "activated member row shows its input summary",
    ),
    expectContains(
      detailPane,
      "Result: ✓ ok",
      "activated member row shows success + duration, no raw output",
    ),
  ];

  // Re-activate to collapse the detail back down.
  session.sendKeys("Enter");
  await session.waitFor((screen) => !screen.includes("Result:"));
  const collapsedAgainPane = session.capture();
  const collapseAgainChecks: SpikeCheck[] = [
    expectTrue(
      !collapsedAgainPane.includes("Result:"),
      "re-activating the row collapses its detail again",
    ),
  ];

  pane = collapsedAgainPane;
  checks = [...collapsedChecks, ...expandChecks, ...detailChecks, ...collapseAgainChecks];
} finally {
  stop();
}

reportAndExit("tool-call-grouping", checks, pane);
