// Headless browser e2e for the web UI (docs/handoffs/e2e.md scope item 4): spawns the real
// compiled `dh --web` process and drives the served UI with the pre-installed Chromium
// (PLAYWRIGHT_BROWSERS_PATH points at /opt/pw-browsers; the pinned playwright-core in
// package.json resolves to chromium revision 1228, while the pre-installed browser is
// revision 1194, so this launches with an explicit `executablePath` per this session's
// operating instructions rather than the version-matched default path).
//
// FIXED DEFECT (originally found by this real-browser test — see docs/handoffs/web.md's
// Round 2 status log and docs/handoffs/e2e.md): the web client's composer never rendered
// for the root agent before it had spawned at least once, because `AppView` never called
// `request_agent_tree` on boot — `selectedAgentId` was only ever set by an `agent_spawned`
// SSE event, which itself never fires until someone sends a first message, which nothing
// could do without a composer. A fresh `dh --web` session deadlocked; nothing was
// reachable via the real UI. Fixed in `src/web/client/app.ts` (`bootstrapAgentTree`, called
// from `start()`) + `src/web/client/state.ts` (`seedFromTree`): Server already synthesizes
// a pre-start root node (`status: "waiting"`, `parentAgentId: null`) precisely so
// `request_agent_tree` can answer this before any message is ever sent. This test now
// drives the *real* composer (type + click, the actual interactive path) to send the root
// agent's first turn — no direct API workaround — then verifies every other part of the UI
// once the root agent exists: live SSE-driven rendering, status colors, token/cost display,
// and log download, all through real Playwright interactions against the real page.

import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { chromium } from "playwright";
import { createCleanupRegistry } from "./support/cleanup.ts";
import { spawnDh } from "./support/dh-process.ts";
import { startMockAnthropicProvider, successTurn } from "./support/mock-provider.ts";
import { baseConfig, createWorkspace } from "./support/workspace.ts";

const CHROMIUM_PATH = "/opt/pw-browsers/chromium";

const cleanups = createCleanupRegistry();
afterEach(() => cleanups.runAll());

describe("web UI (dh --web) in a real headless browser", () => {
  test("status colors, live output, token/cost display, and log download", async () => {
    const provider = startMockAnthropicProvider([successTurn("Hello from the web e2e mock!")]);
    cleanups.addProcess(() => provider.stop());
    const ws = createWorkspace();
    cleanups.addWorkspace(() => ws.cleanup());
    ws.writeConfig(baseConfig(provider.baseURL));

    const proc = await spawnDh({ args: ["--web"], cwd: ws.dir });
    cleanups.addProcess(() => proc.kill());
    const stdout = await proc.waitForStdout(/web UI ready at (\S+)/);
    const webUrl = /web UI ready at (\S+)\./.exec(stdout)?.[1];
    if (!webUrl) throw new Error(`could not parse web UI URL from stdout: ${stdout}`);

    const browser = await chromium.launch({ executablePath: CHROMIUM_PATH, headless: true });
    cleanups.addProcess(() => browser.close());
    const context = await browser.newContext({ acceptDownloads: true });
    const page = await context.newPage();
    await page.goto(webUrl);

    await page.waitForSelector(".dh-app");
    // Passed as strings (not typed arrow functions) so this in-page callback isn't
    // typechecked against our Node/Bun `tsconfig.json` (no DOM lib) — it only ever runs
    // inside the real browser page, never in this process.
    await page.waitForFunction(
      "document.querySelector('.connection-pill')?.textContent === 'Live'",
    );

    // The fix under test: the composer is already usable on a brand-new session, before any
    // message has ever been sent and before any agent_spawned SSE event has ever fired —
    // seeded purely by the request_agent_tree bootstrap (src/web/client/app.ts).
    const rootHeader = page.locator(".agent-header-name");
    await rootHeader.waitFor({ state: "visible" });
    expect(await rootHeader.textContent()).toBe("Root agent");
    const composerInput = page.locator(".composer-input");
    await composerInput.waitFor({ state: "visible" });

    // Send the root agent's first turn through the real interactive UI (type + click) — no
    // direct API workaround.
    await composerInput.fill("hi from playwright");
    await page.getByRole("button", { name: "Send" }).click();

    // Sidebar: one root row. Per Core Round 5's interactive semantics (DH-0059), a root
    // agent with no tool call in its turn parks at "waiting" (Stop button, no session-ended
    // banner) rather than "done" — it never reaches session end on its own.
    const rootRow = page.locator(".agent-row.root");
    await rootRow.waitFor({ state: "visible" });
    await page.waitForFunction(
      "document.querySelector('.agent-row.root')?.getAttribute('data-status') === 'waiting'",
      undefined,
      { timeout: 15_000 },
    );
    expect(await rootRow.getAttribute("data-status")).toBe("waiting");
    const dotClass = await rootRow.locator(".status-dot").getAttribute("class");
    expect(dotClass).toMatch(/status-waiting/);

    // Main pane: live output, header status badge, token/cost stats.
    await page.waitForFunction(
      "document.querySelector('.agent-output')?.textContent === 'Hello from the web e2e mock!'",
    );
    expect(await page.locator(".agent-header-title .status-badge").textContent()).toBe("Waiting");
    const headerStats = await page.locator(".agent-header-stats").textContent();
    expect(headerStats).toContain("in /");
    expect(headerStats).toContain("out ·");

    // Session summary strip: token/cost stats are shown, but there's no end-of-session
    // banner yet — the root agent is only parked "waiting", not stopped.
    const sessionStats = await page.locator(".session-stats").textContent();
    expect(sessionStats).toContain("in /");
    expect(await page.locator(".session-banner").count()).toBe(0);

    // Drive an explicit stop (the Stop button rendered for a "waiting" agent per
    // src/web/client/render.ts) through the real UI to verify session-ended behavior.
    await page.getByRole("button", { name: "Stop" }).click();
    await page.waitForSelector(".session-banner");
    expect(await page.locator(".session-banner").textContent()).toBe(
      "Session ended — success (exit 0)",
    );
    const bannerClass = await page.locator(".session-banner").getAttribute("class");
    expect(bannerClass).toMatch(/session-banner-ok/);

    // Log download: per-agent JSONL.
    //
    // FIXED DEFECT (originally found by this real-browser test, not visible against Node's
    // unrestricted `fetch` in e2e/server-protocol.test.ts): `src/server/server.ts`'s
    // `CORS_HEADERS` didn't send `Access-Control-Expose-Headers: Content-Disposition`, so a
    // real browser's cross-origin `fetch` (the web UI and the dh server are different
    // origins/ports even in local `--web` mode, per ADR 0003) hid the `Content-Disposition`
    // response header from JS entirely — `res.headers.get(...)` returned null and
    // `src/web/client/download.ts`'s `filenameFromContentDisposition` always fell back to a
    // generic client-computed name. Now that the header is exposed, the browser uses the
    // server's real suggested filename — asserting that here.
    const [agentDownload] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: "Download log" }).click(),
    ]);
    expect(agentDownload.suggestedFilename()).toBe("agent-root.jsonl");
    const agentLogPath = await agentDownload.path();
    if (!agentLogPath) throw new Error("download did not materialize a local file");
    const firstLine = JSON.parse(readFileSync(agentLogPath, "utf8").split("\n")[0] ?? "{}");
    expect(firstLine).toMatchObject({ type: "header", agentId: "agent-root" });

    // Log download: full session bundle (tar) — this is where the CORS fix actually changes
    // behavior visibly: a generic, session-id-less filename would mask nothing here (unlike
    // the per-agent case above, which coincidentally matched either way).
    const [bundleDownload] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: "Download session bundle" }).click(),
    ]);
    expect(bundleDownload.suggestedFilename()).toMatch(/^session-[0-9a-f-]+\.tar$/);
    const bundlePath = await bundleDownload.path();
    if (!bundlePath) throw new Error("bundle download did not materialize a local file");
    const bundleBytes = readFileSync(bundlePath);
    expect(bundleBytes.byteLength).toBeGreaterThan(0);
    // A tar's first 512-byte header block ends with a null-padded name field; the session's
    // log filename should appear near the start.
    expect(bundleBytes.toString("utf8", 0, 100)).toContain("agent-root");
  }, 30_000);
});
