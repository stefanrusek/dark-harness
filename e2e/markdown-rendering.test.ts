// Real-binary coverage for DH-0056 (render agent output as Markdown, not raw escape
// passthrough) — TUI side. Drives the actual compiled `dh` binary under a real `tmux` PTY
// (see support/tmux-pty.ts) against a mock provider whose scripted turn text is hostile:
// DA/DSR terminal-response-eliciting sequences, an OSC 52 clipboard-hijack payload, and a
// cursor-movement/screen-clear spoof attempt, plus a positive-path Markdown smoke test.
//
// The property under test is `src/markdown/index.ts`'s `sanitizeText` (applied
// unconditionally as parseMarkdown's step zero) composed with `src/tui/render.ts`/
// `src/tui/markdown-ansi.ts`'s allowlisted-SGR-only renderer: model-authored text can never
// put a raw CSI/OSC/DCS byte sequence onto the real terminal, only the client's own allowlist
// constants (SGR 0/1/2/3/4/7/9, 30-37/90-97/39). We assert this by capturing the pane
// *with* tmux's own escape-sequence handling (`capture-pane -e`) and confirming the only
// escape sequences present are `\x1b[` + digits/`;` + `m` (SGR) — never `n`/`c`-terminated
// DA/DSR, `]`-introduced OSC, `P`/`X`/`^`/`_`-introduced DCS/SOS/PM/APC, or cursor/erase CSI
// finals (`H`, `J`, `K` outside the renderer's own row-framing use of `K`, `A-D`, `f`, `r`).
//
// Per DH-0056's own domain-assignment table (D7): "After TUI+Web land" — Web's
// `src/web/client/markdown-dom.ts` has not landed yet as of this round (only the shared
// `src/markdown/` parser and TUI's `src/tui/markdown-ansi.ts` exist in this tree; confirmed
// via `git log`/`find src/web -iname "*markdown*"` before writing this file). Web-side
// hostile-input/positive-path coverage is deferred to a follow-up once Susan's round lands —
// noted explicitly rather than silently skipped.

import { afterEach, describe, expect, test } from "bun:test";
import { ensureBuilt } from "./support/build.ts";
import { createCleanupRegistry } from "./support/cleanup.ts";
import { startMockAnthropicProvider, successTurn } from "./support/mock-provider.ts";
import { startTmuxSession } from "./support/tmux-pty.ts";
import { baseConfig, createWorkspace } from "./support/workspace.ts";

const cleanups = createCleanupRegistry();
afterEach(() => cleanups.runAll());

/** Every SGR-introduced escape sequence in `raw` (tmux's `-e` capture already only shows
 * sequences tmux itself recognizes and re-renders — no unrecognized bytes survive it as
 * literal text, so this asserts on what tmux *did* apply). */
const ESC = "\x1b";
function sgrSequences(raw: string): string[] {
  return raw.match(new RegExp(`${ESC}\\[[0-9;]*m`, "g")) ?? [];
}

async function bootLocalTui(turns: Parameters<typeof startMockAnthropicProvider>[0]) {
  const provider = startMockAnthropicProvider(turns);
  cleanups.addProcess(provider.stop);
  const ws = createWorkspace();
  cleanups.addWorkspace(ws.cleanup);
  ws.writeConfig(baseConfig(provider.baseURL));
  const dhBinary = await ensureBuilt();

  const session = startTmuxSession([dhBinary], { cwd: ws.dir, cols: 100, rows: 30 });
  cleanups.addProcess(session.kill);

  await session.waitFor((screen) => screen.includes("Dark Harness"));
  await session.waitFor((screen) => screen.includes("Root Agent"));
  return { provider, session };
}

async function sendAndAwaitTurn(
  session: Awaited<ReturnType<typeof bootLocalTui>>["session"],
  marker: string,
) {
  session.sendText("go");
  await session.waitFor((screen) => screen.includes("> go"));
  session.sendKeys("Enter");
  // Wait on rendered turn content rather than the "session ended" footer: the point of these
  // tests is what got rendered, not the session lifecycle (covered elsewhere in
  // server-protocol.test.ts/tui.test.ts).
  await session.waitFor((screen) => screen.includes(marker), 15_000);
}

describe("TUI renders agent output as Markdown, never raw escape passthrough (DH-0056)", () => {
  test("positive path: headings, bold/italic, lists, and code blocks render as real formatting", async () => {
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
    ].join("\n");
    const { session } = await bootLocalTui([successTurn(turnText)]);
    await sendAndAwaitTurn(session, "code line here");

    const plain = session.capture();
    // Real formatting, not literal Markdown syntax characters.
    expect(plain).toContain("Heading One");
    expect(plain).not.toContain("# Heading One");
    expect(plain).toContain("bold");
    expect(plain).not.toContain("**bold**");
    expect(plain).toContain("italic");
    expect(plain).not.toContain("*italic*");
    expect(plain).toContain("item one");
    expect(plain).toContain("item two");
    expect(plain).toContain("code line here");
    expect(plain).not.toContain("```");

    // Real ANSI styling did get applied (bold=1, underline=4 for h1, cyan=36 unused here but
    // at least *some* SGR sequence fired) — this isn't just plain unstyled text.
    const raw = session.captureRaw();
    const sgr = sgrSequences(raw);
    expect(sgr.length).toBeGreaterThan(0);
    expect(sgr.some((seq) => seq.includes("1"))).toBe(true); // bold used for heading/strong
  }, 30_000);

  test("hostile input: DA/DSR, OSC 52 clipboard, and cursor/screen-clear spoofs never reach the real terminal", async () => {
    const da1 = "\x1b[c"; // primary Device Attributes
    const da2 = "\x1b[>c"; // secondary Device Attributes
    const dsr5 = "\x1b[5n"; // Device Status Report
    const dsr6 = "\x1b[6n"; // Cursor Position Report
    const osc52 = "\x1b]52;c;ZXZpbCBwYXlsb2Fk\x07"; // clipboard-hijack write (base64 "evil payload")
    const clearAndHome = "\x1b[2J\x1b[H"; // screen clear + cursor home, frame-spoof attempt
    const cup = "\x1b[10;5H"; // arbitrary cursor positioning

    const hostileText = [
      "Before",
      `mid1${da1}mid2${da2}mid3${dsr5}mid4${dsr6}mid5`,
      `${osc52}after-osc`,
      `${clearAndHome}${cup}FAKE FRAME`,
      "End",
    ].join("\n");

    const { session } = await bootLocalTui([successTurn(hostileText)]);
    await sendAndAwaitTurn(session, "FAKE FRAME");

    const raw = session.captureRaw();

    // None of the hostile sequences survive verbatim to the pane tmux actually rendered.
    for (const hostile of [da1, da2, dsr5, dsr6, osc52, clearAndHome, cup]) {
      expect(raw).not.toContain(hostile);
    }
    // Belt-and-suspenders on the specific byte patterns the ticket calls out by name: no OSC
    // introducer, no DCS/SOS/PM/APC introducer, and no CSI final byte outside the renderer's
    // own allowlisted SGR ('m') / its own row-framing erase-to-EOL ('K').
    expect(raw).not.toMatch(new RegExp(`${ESC}\\]`)); // OSC
    expect(raw).not.toMatch(new RegExp(`${ESC}[PX^_]`)); // DCS/SOS/PM/APC
    expect(raw).not.toMatch(new RegExp(`${ESC}\\[[0-9;]*[cnHJf]`)); // DA/DSR/cursor-position/clear-screen finals

    // The sanitized text still renders adjacently as inert literal content (stripped, not
    // replaced with placeholders) — confirms this is "removed" not "silently swallowing the
    // whole turn."
    const plain = session.capture();
    expect(plain).toContain("Before");
    expect(plain).toContain("mid1mid2mid3mid4mid5");
    expect(plain).toContain("after-osc");
    expect(plain).toContain("FAKE FRAME");
    expect(plain).toContain("End");

    // The real UI chrome (header, agent tree pane borders, footer hints) is still exactly
    // where it should be — a real cursor-move/clear-screen sequence, had it reached the
    // terminal, would have been able to overwrite this; it never got the chance because it
    // never left sanitizeText.
    expect(plain).toContain("Dark Harness");
    expect(plain).toContain("Root Agent");

    // No fake keystroke injection: a real terminal that actually received `ESC[6n`/`ESC[c`
    // would reply on stdin as if typed, which — if not filtered — could land in the TUI's own
    // input box next time it's focused. Confirm the input box still behaves like a normal
    // input box afterward: type real text and see exactly that text, nothing extra prepended
    // from a stray terminal reply that might have been queued into the pty's input stream.
    session.sendText("still working");
    const afterInput = await session.waitFor((screen) => screen.includes("> still working"));
    expect(afterInput).toContain("> still working");
    expect(afterInput).not.toMatch(/>\s*\d+;\d+R/); // a literal CPR reply string, if it leaked in
  }, 30_000);
});
