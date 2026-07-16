// DH-0060 spike — Test Plan item (DH-0026): "input box supports cursor movement (arrow keys,
// home/end), and previously-dead keys now work."
//
// Drives a realistic typo-fix: type "helo world", arrow back into the text, insert the
// missing "l", then use Home to prepend and End to append — and finally sends the edited
// message, asserting the transcript echoes the fully-corrected string.
//
// Capture nuance (matters for assertions): the input box renders the cursor as an
// inverse-video SPACE at the cursor position (`src/tui/render.ts` CURSOR_MARKER), so a plain
// capture of the input line has a literal " " wherever the cursor sits. This spike presses
// End before each input-line assertion so the marker lands harmlessly at the end of the line.
//
// Run: bun e2e/spikes/tui/spike-input-editing.ts

import { successTurn } from "../../support/mock-provider.ts";
import type { SpikeCheck } from "./spike-support.ts";
import { bootLocalTui, expectContains, reportAndExit } from "./spike-support.ts";

const { session, stop } = await bootLocalTui([successTurn("Editing reply received.")]);

let checks: SpikeCheck[] = [];
let pane = "";
try {
  // Type a string with a typo: "helo world" (missing an "l").
  session.sendText("helo world");
  await session.waitFor((screen) => screen.includes("> helo world"));

  // Arrow left 7 times: cursor moves from the end (after "d") to between "hel" and "o".
  // Note left-arrow with NON-empty input must edit, not open the agent tree (DH-0026's fix —
  // tree navigation only claims left-arrow when the input box is empty).
  session.sendKeys("Left", "Left", "Left", "Left", "Left", "Left", "Left");
  session.sendText("l"); // insert the missing "l" mid-string
  session.sendKeys("End"); // park the cursor marker at the end before asserting
  await session.waitFor((screen) => screen.includes("> hello world"));

  // Home, prepend a word, End, append punctuation.
  session.sendKeys("Home");
  session.sendText("please ");
  session.sendKeys("End");
  session.sendText("!");
  await session.waitFor((screen) => screen.includes("> please hello world!"));

  // Send it — the transcript's echoed user turn is the ground truth for what the input
  // editing actually produced (no cursor marker in transcript lines).
  session.sendKeys("Enter");
  await session.waitFor((screen) => screen.includes("Editing reply received."), 15_000);

  pane = session.capture();
  checks = [
    expectContains(
      pane,
      "> please hello world!",
      "sent message reflects mid-string insert (Left×7 + 'l'), Home-prepend, and End-append",
    ),
    expectContains(pane, "Editing reply received.", "edited message completed a real turn"),
  ];
} finally {
  // reportAndExit calls process.exit, which would skip this finally — clean up first,
  // report after (see spike-support.ts).
  stop();
}

reportAndExit("input-editing (DH-0026)", checks, pane);
