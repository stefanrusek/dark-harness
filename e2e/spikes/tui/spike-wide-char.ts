// DH-0060 spike — Test Plan item (DH-0025, wide-character half): "wide characters (CJK,
// emoji, combining marks) wrap/pad correctly without corrupting the frame."
//
// (The other DH-0025 halves — rapid-resize flicker/corruption and no visible full-redraw
// flicker on the idle tick — are judgment calls, not fixed-string-assertable; see the ticket's
// Mode B prompt for those, driven via interactive-boot.ts.)
//
// Scripts an assistant reply containing CJK text, an emoji, and a combining-mark sequence,
// then confirms: the frame renders at exactly the tmux pane's row count every capture (no
// ragged/corrupted frame — src/tui/width.ts's whole point), the CJK/emoji text is visible
// verbatim, and a plain ASCII line sent immediately after still renders correctly (proving
// the wide-char turn didn't leave the renderer's column math desynced for subsequent output).
//
// Run: bun e2e/spikes/tui/spike-wide-char.ts

import { successTurn } from "../../support/mock-provider.ts";
import type { SpikeCheck } from "./spike-support.ts";
import { bootLocalTui, expectContains, expectTrue, reportAndExit } from "./spike-support.ts";

const CJK_EMOJI_REPLY = "宽字符测试 (wide char test) 🎉 café́ done."; // CJK + emoji + combining mark (é + combining acute)
const ROWS = 30;

/** `tmux capture-pane -p`'s stdout always ends with exactly one trailing newline terminator
 * (not an extra blank frame row) — strip only that single artifact, not every trailing blank
 * line, since the renderer legitimately pads short frames with real blank rows
 * (src/tui/render.ts's `padRows`) that must still count toward the row total. */
function countPaneRows(screen: string): number {
  const withoutTrailingNewline = screen.endsWith("\n") ? screen.slice(0, -1) : screen;
  return withoutTrailingNewline.split("\n").length;
}

const { session, stop } = await bootLocalTui(
  [successTurn(CJK_EMOJI_REPLY), successTurn("Plain ASCII follow-up received.")],
  { rows: ROWS, cols: 100 },
);

let checks: SpikeCheck[] = [];
let pane = "";
try {
  session.sendText("say something with wide characters");
  await session.waitFor((screen) => screen.includes("> say something with wide characters"));
  session.sendKeys("Enter");
  const wideScreen = await session.waitFor((screen) => screen.includes("done."), 15_000);

  const wideScreenRowCount = countPaneRows(wideScreen);

  // Follow-up plain-ASCII turn: confirms the renderer isn't left in a corrupted state.
  session.sendText("thanks");
  await session.waitFor((screen) => screen.includes("> thanks"));
  session.sendKeys("Enter");
  const followUpScreen = await session.waitFor(
    (screen) => screen.includes("Plain ASCII follow-up received."),
    15_000,
  );
  const followUpRowCount = countPaneRows(followUpScreen);

  pane = followUpScreen;
  checks = [
    expectContains(wideScreen, "宽字符测试", "CJK text rendered verbatim"),
    expectContains(wideScreen, "🎉", "emoji rendered verbatim"),
    expectContains(wideScreen, "café", "combining-mark sequence rendered without corruption"),
    expectTrue(
      wideScreenRowCount === ROWS,
      `frame after wide-char turn has exactly ${ROWS} rows (no corrupted/ragged frame)`,
      wideScreenRowCount === ROWS ? undefined : `captured ${wideScreenRowCount} rows`,
    ),
    expectContains(
      followUpScreen,
      "Plain ASCII follow-up received.",
      "a plain-ASCII turn immediately after the wide-char turn still renders correctly",
    ),
    expectTrue(
      followUpRowCount === ROWS,
      `frame after the follow-up turn still has exactly ${ROWS} rows`,
      followUpRowCount === ROWS ? undefined : `captured ${followUpRowCount} rows`,
    ),
  ];
} finally {
  stop();
}

reportAndExit("wide-char (DH-0025, partial)", checks, pane);
