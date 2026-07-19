// DH-0044 D10 (E2E/Hedy): the ticket's single User Story — "as an operator watching a live
// session, I want to see model output as it's generated, not all at once when the turn
// finishes" — closed out here per CLAUDE.md §9. Core (Grace) and Server (Radia) already
// landed the producer/contract side; TUI (Mary) and Web (Susan) already landed client-side
// render scheduling. This file is the acceptance test: the one place that can observe *true*
// incremental delivery end to end, across a real process boundary, against the real compiled
// binary and a mock provider that now actually streams (see support/mock-provider.ts and
// support/mock-bedrock-provider.ts, both updated this round to emit a scripted turn's text as
// many small `content_block_delta`/`contentBlockDelta` events instead of one whole-text
// delta).
//
// Three tiers:
//  1. Raw HTTP/SSE (no browser, no PTY) — the most direct proof that multiple `agent_output`
//     events actually arrive for one long turn, and that concatenating their `chunk` fields
//     reconstructs the full text exactly.
//  2. Web (headless browser) — the real client accumulates the streamed chunks and ends up
//     rendering the fully accumulated text.
//  3. TUI (real PTY via tmux) — same, for the console client.

import { afterEach, describe, expect, test } from "bun:test";
import { chromium } from "playwright";
import { resolveChromiumExecutable } from "./support/chromium.ts";
import { ensureBuilt } from "./support/build.ts";
import { createCleanupRegistry } from "./support/cleanup.ts";
import { spawnDh } from "./support/dh-process.ts";
import { startMockAnthropicProvider, successTurn } from "./support/mock-provider.ts";
import { startDhServer } from "./support/port.ts";
import { connectSse } from "./support/sse-client.ts";
import { startTmuxSession } from "./support/tmux-pty.ts";
import { baseConfig, createWorkspace } from "./support/workspace.ts";

const cleanups = createCleanupRegistry();
afterEach(() => cleanups.runAll());

/** Long enough (well over the agent loop's 1 KiB `STREAM_FLUSH_BYTES` coalescing threshold,
 * src/agent/loop.ts) that the mock provider's ~64-char delta chunking (see
 * support/mock-provider.ts's `TEXT_DELTA_CHUNK_SIZE`) is guaranteed to cross that threshold
 * more than once — i.e. this turn *must* produce more than one `agent_output` SSE event if
 * streaming is really incremental, not just accumulated client-side from a single chunk. */
function longTurnText(): string {
  const sentence = "The agent keeps talking so this turn streams in many small pieces. ";
  return sentence.repeat(60); // ~4.2 KB — several times STREAM_FLUSH_BYTES.
}

describe("DH-0044: progressive output actually streams end to end", () => {
  test("raw HTTP/SSE: a long turn arrives as multiple agent_output events whose chunks reconstruct the full text", async () => {
    const text = longTurnText();
    const provider = startMockAnthropicProvider([successTurn(text)]);
    cleanups.addProcess(provider.stop);
    const ws = createWorkspace();
    cleanups.addWorkspace(ws.cleanup);
    ws.writeConfig(baseConfig(provider.baseURL));
    const { proc, port } = await startDhServer({ cwd: ws.dir });
    cleanups.addProcess(proc.kill);
    const baseUrl = `http://localhost:${port}`;

    const sse = await connectSse(baseUrl);
    cleanups.addProcess(sse.close);

    const postRes = await fetch(new URL("/api/commands", baseUrl), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "send_message", agentId: "agent-root", message: "go long" }),
    });
    expect(postRes.status).toBe(200);

    // Wait for the turn to fully complete (the "waiting" status only fires once the whole
    // turn — including the final flush — has landed), then look back at everything received.
    await sse.waitFor((e) => e.type === "agent_status" && e.status === "waiting");

    const outputEvents = sse.events.filter(
      (e): e is Extract<typeof e, { type: "agent_output" }> => e.type === "agent_output",
    );
    // The whole point: more than one agent_output event for this one turn — a non-streaming
    // producer (the pre-DH-0044 behavior) would emit exactly one, containing the whole text.
    expect(outputEvents.length).toBeGreaterThan(1);
    expect(outputEvents.every((e) => e.agentId === "agent-root")).toBe(true);
    // In order, chunks reconstruct the full turn text exactly — no loss, no duplication, no
    // reordering (D5.4's ordering guarantee).
    expect(outputEvents.map((e) => e.chunk).join("")).toBe(text);
  });

  test("web (headless browser): the client accumulates streamed chunks into the fully rendered turn", async () => {
    const text = longTurnText();
    const provider = startMockAnthropicProvider([successTurn(text)]);
    cleanups.addProcess(() => provider.stop());
    const ws = createWorkspace();
    cleanups.addWorkspace(() => ws.cleanup());
    ws.writeConfig(baseConfig(provider.baseURL));

    const proc = await spawnDh({ args: ["--web"], cwd: ws.dir });
    cleanups.addProcess(() => proc.kill());
    const stdout = await proc.waitForStdout(/web UI ready at (\S+)/);
    const webUrl = /web UI ready at (\S+)\./.exec(stdout)?.[1];
    if (!webUrl) throw new Error(`could not parse web UI URL from stdout: ${stdout}`);

    const executablePath = await resolveChromiumExecutable();
    const browser = await chromium.launch({
      executablePath,
      headless: true,
      // DH-0165: GitHub Actions' runners have no D-Bus session bus, which some headless
      // Chromium subsystems (network proxy resolution, etc) try to reach on launch and hang
      // or crash waiting for; --no-sandbox/--disable-dev-shm-usage/--disable-gpu are the
      // standard trio for running headless Chromium inside an unprivileged CI container.
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
      ],
    });
    cleanups.addProcess(() => browser.close());
    const page = await browser.newPage();
    await page.goto(webUrl);

    await page.waitForSelector(".dh-app");
    await page.waitForFunction(
      "document.querySelector('.connection-pill')?.textContent === 'Live'",
    );
    const composerInput = page.locator(".composer-input");
    await composerInput.waitFor({ state: "visible" });
    await composerInput.fill("go long");
    await page.getByRole("button", { name: "Send" }).click();

    // The real point of DH-0044 D9 (Web/Susan): the rAF-batched render pass still ends up
    // with the exact, fully accumulated text once the turn completes — batching changes
    // *when* the DOM updates, never what it converges to. Passed as a string (not a typed
    // arrow function), same convention as web.test.ts, so this in-page callback isn't
    // typechecked against our Node/Bun tsconfig.json (no DOM lib) — it only ever runs inside
    // the real browser page.
    await page.waitForFunction(
      `document.querySelector('.agent-transcript .turn-assistant .turn-text')?.textContent === ${JSON.stringify(text)}`,
      undefined,
      { timeout: 15_000 },
    );
  }, 30_000);

  test("TUI (real PTY): the console client renders the fully accumulated text after a streamed turn", async () => {
    const text = longTurnText();
    const provider = startMockAnthropicProvider([successTurn(text)]);
    cleanups.addProcess(provider.stop);
    const ws = createWorkspace();
    cleanups.addWorkspace(ws.cleanup);
    ws.writeConfig(baseConfig(provider.baseURL));
    const dhBinary = await ensureBuilt();

    const session = startTmuxSession([dhBinary], { cwd: ws.dir, cols: 100, rows: 30 });
    cleanups.addProcess(session.kill);

    await session.waitFor((screen) => screen.includes("Root Agent"));
    session.sendText("go long");
    session.sendKeys("Enter");

    // DH-0044 D9 (TUI/Mary): the frame-coalesced redraw (at most every ~33ms) still lands on
    // the fully streamed text once the turn completes — a fragment of the sentence, repeated
    // 60 times, is unambiguous evidence this is the real accumulated turn, not a truncated
    // first chunk.
    await session.waitFor(
      (screen) => screen.includes("The agent keeps talking so this turn streams in many small"),
      15_000,
    );

    session.sendKeys("C-c");
    await session.waitForExit(10_000);
  }, 30_000);
});
