// DH-0061 spike 9 (core behavior, DH-0024): killing and restarting the server process behind
// a `--connect --web` client triggers a visible reconnect indicator (`.gap-banner` loses its
// "hidden" class), then the client resumes without duplicating the transcript content it had
// already rendered before the drop.
//
// Mirrors e2e/connect-web.test.ts's real-process `--server` + `--connect --web` composition
// (a genuine second OS process, not a same-process fake), but here the server process is
// killed mid-session and a fresh one is respawned on the same port — the real "server
// restarted underneath a live web client" scenario DH-0024 exists for.
//
// Run from the repo root:   bun e2e/spikes/web/spike-reconnect.ts

import { spawnDh } from "../../support/dh-process.ts";
import { startMockAnthropicProvider, successTurn } from "../../support/mock-provider.ts";
import { startDhServer } from "../../support/port.ts";
import { baseConfig, createWorkspace } from "../../support/workspace.ts";
import { artifactPath, createReport, resolveChromiumExecutable } from "./support.ts";

const report = createReport("spike-reconnect");

const provider = startMockAnthropicProvider([
  successTurn("First reply, before the server restarts."),
]);
const serverWs = createWorkspace("dh-spike-reconnect-server-");
serverWs.writeConfig(baseConfig(provider.baseURL));

const first = await startDhServer({ cwd: serverWs.dir });
let serverProc = first.proc;
const boundPort = first.port;

const clientWs = createWorkspace("dh-spike-reconnect-client-");
clientWs.writeConfig(baseConfig("http://localhost:1"));
const clientProc = await spawnDh({
  args: ["--connect", "localhost", "--port", String(boundPort), "--web"],
  cwd: clientWs.dir,
});
const clientStdout = await clientProc.waitForStdout(/web UI ready at (\S+)/, 20_000);
const webUrl = /web UI ready at (\S+?)[\s.]/.exec(clientStdout)?.[1];

async function cleanup() {
  clientProc.kill();
  serverProc.kill();
  provider.stop();
  serverWs.cleanup();
  clientWs.cleanup();
}

if (!webUrl) {
  await cleanup();
  report.check("could not parse web UI URL from dh --connect --web stdout", false, clientStdout);
  report.finish();
}

const executablePath = await resolveChromiumExecutable();
const { chromium } = await import("playwright");
const browser = await chromium.launch({ executablePath, headless: true });
const page = await browser.newPage();

try {
  await page.goto(webUrl as string);
  await page.waitForSelector(".dh-app");
  await page.waitForFunction("document.querySelector('.connection-pill')?.textContent === 'Live'");

  const gapBannerHiddenBefore = await page
    .locator(".gap-banner")
    // DH-0136: this program has no `dom` lib (root tsconfig deliberately stays ESNext-only),
    // so `Element` here is playwright's own minimal ambient type, not lib.dom's — it doesn't
    // carry `classList`. Runs in a real browser via playwright's `evaluate()`, where the real
    // DOM API is always present regardless of this program's `lib` setting.
    .evaluate((el: Element) =>
      (el as unknown as { classList: { contains(name: string): boolean } }).classList.contains(
        "hidden",
      ),
    );
  report.check(
    "gap banner starts hidden (no reconnect has happened yet)",
    gapBannerHiddenBefore,
    `hidden = ${gapBannerHiddenBefore}`,
  );

  const composer = page.locator(".composer-input");
  await composer.waitFor({ state: "visible" });
  await composer.fill("first message, before the restart");
  await page.getByRole("button", { name: "Send" }).click();
  await page.waitForFunction(
    "document.querySelectorAll('.agent-transcript .turn-assistant').length >= 1",
    undefined,
    { timeout: 15_000 },
  );
  const turnsBeforeRestart = await page.locator(".agent-transcript .turn").count();
  report.check(
    "transcript shows the first exchange (2 turns) before the server restarts",
    turnsBeforeRestart === 2,
    `turn count = ${turnsBeforeRestart}`,
  );

  // Kill the real server process, then respawn a fresh one on the exact same port — the
  // scenario under test: a live web client's server disappears and comes back.
  serverProc.kill();
  await new Promise((resolve) => setTimeout(resolve, 500));
  const restarted = await spawnDh({
    args: ["--server", "--port", String(boundPort)],
    cwd: serverWs.dir,
  });
  await restarted.waitForStdout(/listening on port/, 10_000);
  serverProc = restarted;

  // The client's SSE connection notices the drop and reconnects — the gap banner appears.
  await page.waitForFunction(
    "!document.querySelector('.gap-banner')?.classList.contains('hidden')",
    undefined,
    { timeout: 30_000 },
  );
  const gapBannerHiddenAfter = await page
    .locator(".gap-banner")
    // DH-0136: this program has no `dom` lib (root tsconfig deliberately stays ESNext-only),
    // so `Element` here is playwright's own minimal ambient type, not lib.dom's — it doesn't
    // carry `classList`. Runs in a real browser via playwright's `evaluate()`, where the real
    // DOM API is always present regardless of this program's `lib` setting.
    .evaluate((el: Element) =>
      (el as unknown as { classList: { contains(name: string): boolean } }).classList.contains(
        "hidden",
      ),
    );
  report.check(
    "gap banner becomes visible once the server restarts and the client reconnects",
    !gapBannerHiddenAfter,
    `hidden = ${gapBannerHiddenAfter}`,
  );
  const gapBannerText = await page.locator(".gap-banner").textContent();
  report.check(
    "gap banner carries reconnect-related text, not blank",
    (gapBannerText ?? "").trim().length > 0,
    `text = ${gapBannerText}`,
  );

  // No duplicate turns from the reconnect/resume itself.
  const turnsAfterReconnect = await page.locator(".agent-transcript .turn").count();
  report.check(
    "no duplicate turns appear from the reconnect alone",
    turnsAfterReconnect === turnsBeforeRestart,
    `turn count before = ${turnsBeforeRestart}, after reconnect = ${turnsAfterReconnect}`,
  );

  const screenshot = artifactPath("spike-reconnect.png");
  await page.screenshot({ path: screenshot, fullPage: true });
  await browser.close();
  await cleanup();
  report.finish({ screenshot });
} catch (err) {
  const screenshot = artifactPath("spike-reconnect-error.png");
  await page.screenshot({ path: screenshot, fullPage: true }).catch(() => {});
  await browser.close().catch(() => {});
  await cleanup();
  report.check("script completed without an unexpected error", false, String(err));
  report.finish({ screenshot });
}
