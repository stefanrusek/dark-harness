// DH-0060 spike — Test Plan items (DH-0059): "Ctrl+C in local mode (server+TUI same process)
// stops the agent and exits cleanly with the correct exit code", plus "per-agent status shows
// the correct label/color" (the waiting-state probe doubles as a status-color check).
//
// Exit-code capture trick: tmux runs the binary through `sh -c '<binary>; echo SPIKE-EXIT:$?;
// sleep 60'` — when the TUI exits its alt-screen, the pane falls back to the normal screen
// where the echoed exit code is visible to capture-pane, and the trailing sleep keeps the
// pane alive long enough to read it.
//
// Sequencing detail that decides the exit code: stopping an agent PAUSED IN "waiting" is a
// graceful end of conversation → exit 0 (DH-0059 / ADR 0005 amendment); stopping one mid-work
// is exit 1. So the spike first confirms the root agent reached "waiting" — deterministically,
// not with a sleep — by opening the agent tree and polling the RAW capture for the root
// entry's status glyph in cyan (`\x1b[36m` = waiting, src/tui/render.ts STATUS_COLOR). The
// root agent has no "Status:" detail view (Enter on the root tree entry returns to the root
// transcript view), so the colored glyph is the only on-screen waiting indicator for it.
//
// Run: bun e2e/spikes/tui/spike-ctrlc-exit-code.ts

import { successTurn } from "../../support/mock-provider.ts";
import type { SpikeCheck } from "./spike-support.ts";
import { bootLocalTui, expectContains, expectTrue, reportAndExit } from "./spike-support.ts";

const WAITING_GLYPH = "\x1b[36m●\x1b[39m agent-root"; // cyan status dot (●) = "waiting"

const { session, stop } = await bootLocalTui([successTurn("Stop-test reply.")], {
  wrapCommand: (binaryPath) => ["sh", "-c", `"${binaryPath}"; echo "SPIKE-EXIT:$?"; sleep 60`],
});

let checks: SpikeCheck[] = [];
let evidence = "";
try {
  // Complete one full exchange so the root agent has been active.
  session.sendText("hello");
  await session.waitFor((screen) => screen.includes("> hello"));
  session.sendKeys("Enter");
  await session.waitFor((screen) => screen.includes("Stop-test reply."), 15_000);

  // Left-arrow on an empty input opens the agent tree; poll the raw (ANSI-preserving)
  // capture until the root's status glyph turns cyan = "waiting". `waitFor` polls the plain
  // capture, so poll captureRaw() by hand here.
  session.sendKeys("Left");
  await session.waitFor((screen) => screen.includes("Agent Tree"));
  let sawWaitingGlyph = false;
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (session.captureRaw().includes(WAITING_GLYPH)) {
      sawWaitingGlyph = true;
      break;
    }
    await Bun.sleep(150);
  }
  session.sendKeys("Escape"); // back to the root view
  await session.waitFor((screen) => screen.includes("Root Agent"));

  // First Ctrl+C: sends stop_agent, waits for session_ended, renders the final frame with
  // "session ended (exit 0)" (lingers ~1s), then quits — the shell then echoes the real
  // process exit code into the pane.
  session.sendKeys("C-c");
  const endedScreen = await session.waitFor(
    (screen) => screen.includes("session ended (exit 0)"),
    10_000,
  );
  const exitScreen = await session.waitFor((screen) => screen.includes("SPIKE-EXIT:"), 10_000);

  evidence = exitScreen;
  checks = [
    expectTrue(
      sawWaitingGlyph,
      "root agent showed the cyan 'waiting' status glyph before Ctrl+C",
      sawWaitingGlyph ? undefined : "cyan \\x1b[36m● glyph never appeared in the tree view",
    ),
    expectContains(
      endedScreen,
      "session ended (exit 0)",
      "TUI rendered graceful session end after Ctrl+C",
    ),
    expectContains(
      exitScreen,
      "SPIKE-EXIT:0",
      "process exited with code 0 (graceful stop while waiting)",
    ),
  ];
} finally {
  // reportAndExit calls process.exit, which would skip this finally — clean up first,
  // report after (see spike-support.ts).
  stop();
}

reportAndExit("ctrlc-exit-code (DH-0059)", checks, evidence);
