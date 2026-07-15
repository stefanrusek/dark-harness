// Headless browser e2e for the web UI (docs/handoffs/e2e.md scope item 4): spawns the real
// compiled `dh --web` process and drives the served UI with the pre-installed Chromium
// (PLAYWRIGHT_BROWSERS_PATH points at /opt/pw-browsers; the pinned playwright-core in
// package.json resolves to chromium revision 1228, while the pre-installed browser is
// revision 1194, so this launches with an explicit `executablePath` per this session's
// operating instructions rather than the version-matched default path).
//
// IMPORTANT — same cross-domain defect documented in e2e/tui.test.ts's header comment: the
// web client's composer never renders for the root agent before it has spawned at least
// once (`AppView` never calls `request_agent_tree` on boot; `selectedAgentId` is only set by
// an `agent_spawned` SSE event — see `src/web/client/state.ts`'s `applyEvent` and
// `src/web/client/app.ts`). This test kicks off the root agent's first turn with a direct
// `fetch` POST to `/api/commands` (learning the target server's URL the same way the real
// page does — via its own `/dh-config.json` — so this isn't privileged information a real
// user couldn't get), then verifies every part of the UI that *is* reachable once the root
// agent exists: live SSE-driven rendering, status colors, token/cost display, and log
// download, all through real Playwright interactions against the real page.

import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { chromium } from "playwright";
import { spawnDh } from "./support/dh-process.ts";
import { startMockAnthropicProvider, successTurn } from "./support/mock-provider.ts";
import { baseConfig, createWorkspace } from "./support/workspace.ts";

const CHROMIUM_PATH = "/opt/pw-browsers/chromium";

const cleanups: (() => void)[] = [];
afterEach(async () => {
  while (cleanups.length > 0) {
    const fn = cleanups.pop();
    if (fn) await fn();
  }
});

describe("web UI (dh --web) in a real headless browser", () => {
  test("status colors, live output, token/cost display, and log download", async () => {
    const provider = startMockAnthropicProvider([successTurn("Hello from the web e2e mock!")]);
    cleanups.push(() => provider.stop());
    const ws = createWorkspace();
    cleanups.push(() => ws.cleanup());
    ws.writeConfig(baseConfig(provider.baseURL));

    const proc = await spawnDh({ args: ["--web"], cwd: ws.dir });
    cleanups.push(() => proc.kill());
    const stdout = await proc.waitForStdout(/web UI ready at (\S+)/);
    const webUrl = /web UI ready at (\S+)\./.exec(stdout)?.[1];
    if (!webUrl) throw new Error(`could not parse web UI URL from stdout: ${stdout}`);

    // Learn the target dh-server's own URL the same way the real page does on boot
    // (src/web/client/main.ts fetches this same-origin endpoint) — used below to kick off
    // the root agent's first turn, working around the composer-bootstrap defect documented
    // above.
    const dhConfig = (await fetch(new URL("/dh-config.json", webUrl)).then((r) => r.json())) as {
      baseUrl: string;
    };

    const browser = await chromium.launch({ executablePath: CHROMIUM_PATH, headless: true });
    cleanups.push(() => browser.close());
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
    expect(await page.locator(".empty-state").textContent()).toBe("Waiting for an agent to spawn…");

    const postRes = await fetch(new URL("/api/commands", dhConfig.baseUrl), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        type: "send_message",
        agentId: "agent-root",
        message: "hi from playwright",
      }),
    });
    expect(postRes.status).toBe(200);

    // Sidebar: one root row, status eventually "done" (status colors, HANDOFF.md §9).
    const rootRow = page.locator(".agent-row.root");
    await rootRow.waitFor({ state: "visible" });
    await page.waitForFunction(
      "document.querySelector('.agent-row.root')?.getAttribute('data-status') === 'done'",
      undefined,
      { timeout: 15_000 },
    );
    expect(await rootRow.getAttribute("data-status")).toBe("done");
    const dotClass = await rootRow.locator(".status-dot").getAttribute("class");
    expect(dotClass).toMatch(/status-done/);

    // Main pane: live output, header status badge, token/cost stats.
    await page.waitForFunction(
      "document.querySelector('.agent-output')?.textContent === 'Hello from the web e2e mock!'",
    );
    expect(await page.locator(".agent-header-title .status-badge").textContent()).toBe("Done");
    const headerStats = await page.locator(".agent-header-stats").textContent();
    expect(headerStats).toContain("in /");
    expect(headerStats).toContain("out ·");

    // Session summary strip + end-of-session banner.
    const sessionStats = await page.locator(".session-stats").textContent();
    expect(sessionStats).toContain("in /");
    await page.waitForSelector(".session-banner");
    expect(await page.locator(".session-banner").textContent()).toBe(
      "Session ended — success (exit 0)",
    );
    const bannerClass = await page.locator(".session-banner").getAttribute("class");
    expect(bannerClass).toMatch(/session-banner-ok/);

    // Composer: now that the root agent exists and is selected, it does render (proving the
    // *rest* of the interactive flow works — see this file's header comment for what's out
    // of scope here).
    expect(await page.locator(".composer-input").isVisible()).toBe(true);

    // Log download: per-agent JSONL.
    //
    // CONFIRMED DEFECT (found by this real-browser test, not visible against Node's
    // unrestricted `fetch` in e2e/server-protocol.test.ts): `src/server/server.ts`'s
    // `CORS_HEADERS` never sends `Access-Control-Expose-Headers: Content-Disposition`, so a
    // real browser's cross-origin `fetch` (the web UI and the dh server are different
    // origins/ports even in local `--web` mode, per ADR 0003) hides the
    // `Content-Disposition` response header from JS entirely — `res.headers.get(...)`
    // returns null. `src/web/client/download.ts`'s `filenameFromContentDisposition` then
    // always falls back to `suggestedLogFilename` (`src/web/client/format.ts`), so the
    // server's real suggested filename is never actually used by a real browser. For the
    // per-agent case this fallback (`${agentId}.jsonl`) happens to coincide with the
    // server's own naming, masking the bug; for the full-bundle case it doesn't — the
    // browser always saves `dh-session-logs.tar.gz` (a generic, session-id-less name with
    // the wrong extension: the real payload is a plain, non-gzipped tar) instead of the
    // server's real `session-<sessionId>.tar`. Flagged in docs/handoffs/e2e.md's status log
    // as a Server-domain fix (add the CORS expose-headers entry) — asserting the actual
    // current behavior here, not the intended one, so this suite stays honest.
    const [agentDownload] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: "Download log" }).click(),
    ]);
    expect(agentDownload.suggestedFilename()).toBe("agent-root.jsonl");
    const agentLogPath = await agentDownload.path();
    if (!agentLogPath) throw new Error("download did not materialize a local file");
    const firstLine = JSON.parse(readFileSync(agentLogPath, "utf8").split("\n")[0] ?? "{}");
    expect(firstLine).toMatchObject({ type: "header", agentId: "agent-root" });

    // Log download: full session bundle (tar) — see the defect note above for why the
    // filename doesn't match the server's real `Content-Disposition` header.
    const [bundleDownload] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: "Download session bundle" }).click(),
    ]);
    expect(bundleDownload.suggestedFilename()).toBe("dh-session-logs.tar.gz");
    const bundlePath = await bundleDownload.path();
    if (!bundlePath) throw new Error("bundle download did not materialize a local file");
    const bundleBytes = readFileSync(bundlePath);
    expect(bundleBytes.byteLength).toBeGreaterThan(0);
    // The actual bytes on disk are still the server's real (non-gzip) tar payload — only the
    // browser-visible filename is wrong. A tar's first 512-byte header block ends with a
    // null-padded name field; the session's log filename should appear near the start.
    expect(bundleBytes.toString("utf8", 0, 100)).toContain("agent-root");
  }, 30_000);
});
