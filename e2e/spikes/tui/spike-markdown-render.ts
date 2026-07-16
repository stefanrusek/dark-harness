// DH-0060 spike — Test Plan item (DH-0056): "assistant output renders real Markdown
// formatting … via ANSI — never raw Markdown syntax characters, never a raw/garbled escape
// sequence."
//
// The scripted model turn combines a positive path (heading, bold, italic, list, fenced code
// block) with two hostile escape sequences (a clear-screen CSI and an OSC 52 clipboard write)
// embedded mid-text, so one capture proves both halves: Markdown renders as formatting, and
// model-authored escape bytes never reach the real terminal (asserted on the RAW capture,
// `tmux capture-pane -e`).
//
// Run: bun e2e/spikes/tui/spike-markdown-render.ts

import { successTurn } from "../../support/mock-provider.ts";
import type { SpikeCheck } from "./spike-support.ts";
import {
  bootLocalTui,
  expectAbsent,
  expectContains,
  expectTrue,
  reportAndExit,
} from "./spike-support.ts";

const ESC = "\x1b";
const clearScreen = `${ESC}[2J`;
const osc52 = `${ESC}]52;c;ZXZpbA==\x07`; // clipboard-hijack write, base64 "evil"

const turnText = [
  "# Heading One",
  "",
  "Some **bold** and *italic* text.",
  "",
  "- item one",
  "- item two",
  "",
  "```",
  "code line here",
  "```",
  "",
  `hostile${clearScreen}${osc52}payload`,
].join("\n");

const { session, stop } = await bootLocalTui([successTurn(turnText)]);

let checks: SpikeCheck[] = [];
let pane = "";
try {
  session.sendText("go");
  await session.waitFor((screen) => screen.includes("> go"));
  session.sendKeys("Enter");
  await session.waitFor((screen) => screen.includes("code line here"), 15_000);

  const plain = session.capture();
  const raw = session.captureRaw();
  const sgrSequences = raw.match(new RegExp(`${ESC}\\[[0-9;]*m`, "g")) ?? [];

  pane = plain;
  checks = [
    expectContains(plain, "Heading One", "heading text renders"),
    expectAbsent(plain, "# Heading One", "no raw '#' heading marker"),
    expectContains(plain, "bold", "bold text renders"),
    expectAbsent(plain, "**bold**", "no raw '**' emphasis markers"),
    expectContains(plain, "italic", "italic text renders"),
    expectAbsent(plain, "*italic*", "no raw '*' emphasis markers"),
    expectContains(plain, "item one", "list item renders"),
    expectContains(plain, "code line here", "code block content renders"),
    expectAbsent(plain, "```", "no raw code fences"),
    // Styling really happened — at least one SGR sequence (bold=1 for heading/strong).
    expectTrue(
      sgrSequences.some((seq) => seq.includes("1")),
      "ANSI bold styling was actually applied (SGR '1' present in raw capture)",
      `SGR sequences seen: ${JSON.stringify(sgrSequences.slice(0, 10))}`,
    ),
    // Hostile bytes were stripped, their surrounding text kept (adjacent, inert).
    expectContains(plain, "hostilepayload", "hostile-sequence surroundings render as inert text"),
    expectTrue(!raw.includes(clearScreen), "raw capture has no clear-screen CSI (ESC[2J)"),
    expectTrue(!raw.includes(`${ESC}]`), "raw capture has no OSC introducer (ESC])"),
    // The UI frame survived — a real clear-screen would have wiped the header.
    expectContains(plain, "Dark Harness", "UI header intact after hostile turn"),
  ];
} finally {
  // reportAndExit calls process.exit, which would skip this finally — clean up first,
  // report after (see spike-support.ts).
  stop();
}

reportAndExit("markdown-render (DH-0056)", checks, pane);
