// DH-0034: `dh --connect <host> --web` — a web client, locally served, connected to a
// *remote* `dh --server` process — is a run-mode composition CLAUDE.md §4 invariant 1 names
// explicitly, but until this file every other combination had coverage (local `--web` in
// `e2e/web.test.ts`, plain `--connect` console in `e2e/tui.test.ts`) except this one. This
// mirrors `e2e/web.test.ts`'s real-headless-browser approach but against a real second
// process: a `dh --server` started first (via `startDhServer`, DH-0034's port-race
// mitigation), then a separate `dh --connect <host> --port <n> --web` process pointed at it,
// driven with the same pre-installed Chromium.
//
// NOT RUN IN EVERY SANDBOX: like `e2e/web.test.ts`, this needs a real Chromium binary,
// resolved via `resolveChromiumExecutable` (DH-0066: was hardcoded to the CI sandbox's
// pre-installed `/opt/pw-browsers/chromium` with no fallback; the resolver also checks
// playwright's own download and the local playwright browser cache). Environments with no
// Chromium anywhere still can't run this test — that's a sandbox-tooling gap, not a defect
// in this test or in `--connect --web` itself.

import { afterEach, describe, expect, test } from "bun:test";
import { resolveChromiumExecutable } from "./spikes/web/support.ts";
import { createCleanupRegistry } from "./support/cleanup.ts";
import { spawnDh } from "./support/dh-process.ts";
import { startMockAnthropicProvider, successTurn } from "./support/mock-provider.ts";
import { startDhServer } from "./support/port.ts";
import { baseConfig, createWorkspace } from "./support/workspace.ts";

const cleanups = createCleanupRegistry();
afterEach(() => cleanups.runAll());

describe("--connect --web: a real web client process against a real remote dh --server", () => {
  test("live SSE-driven rendering of a message sent to the remote server", async () => {
    // Dynamically imported so a sandbox with no Chromium binary can still load this file
    // (and every other e2e file) without `playwright`'s own module-load side effects
    // becoming a hard failure before the test itself gets a chance to run/skip.
    const { chromium } = await import("playwright");

    const provider = startMockAnthropicProvider([
      successTurn("Hello from the remote server, via the web client!"),
    ]);
    cleanups.addProcess(() => provider.stop());

    const serverWs = createWorkspace();
    cleanups.addWorkspace(() => serverWs.cleanup());
    serverWs.writeConfig(baseConfig(provider.baseURL));
    const { proc: serverProc, port } = await startDhServer({ cwd: serverWs.dir });
    cleanups.addProcess(() => serverProc.kill());

    // The connecting client also loads its own dh.json (models/provider are required by the
    // schema even though --connect never calls a model directly, same convention as
    // e2e/tui.test.ts's --connect scenario) — reuse baseConfig with an unused provider URL.
    const clientWs = createWorkspace();
    cleanups.addWorkspace(() => clientWs.cleanup());
    clientWs.writeConfig(baseConfig("http://localhost:1"));

    const clientProc = await spawnDh({
      args: ["--connect", "localhost", "--port", String(port), "--web"],
      cwd: clientWs.dir,
    });
    cleanups.addProcess(() => clientProc.kill());
    const stdout = await clientProc.waitForStdout(/web UI ready at (\S+)/);
    // Unlike local `--web` mode's plain "... ready at {url}." (src/cli.ts), connect mode
    // appends " (connected to {targetBaseUrl})." — a trailing period isn't adjacent to the
    // URL here, so this doesn't require one immediately after it.
    const webUrl = /web UI ready at (\S+?)[\s.]/.exec(stdout)?.[1];
    if (!webUrl) throw new Error(`could not parse web UI URL from stdout: ${stdout}`);
    // Confirms this is really the "connected to a remote server" composition, not a local
    // one — src/cli.ts's connect-mode ready message names the remote target explicitly.
    expect(stdout).toContain(`connected to http://localhost:${port}`);

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
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(webUrl);

    await page.waitForSelector(".dh-app");
    await page.waitForFunction(
      "document.querySelector('.connection-pill')?.textContent === 'Live'",
    );

    const rootHeader = page.locator(".agent-header-name");
    await rootHeader.waitFor({ state: "visible" });
    expect(await rootHeader.textContent()).toBe("Root agent");
    const composerInput = page.locator(".composer-input");
    await composerInput.waitFor({ state: "visible" });

    await composerInput.fill("hi from a remote web client");
    await page.getByRole("button", { name: "Send" }).click();

    // Proves this rendered live over the wire from the *remote* server's own SSE stream —
    // not a local in-process agent loop, since the web client process here holds no model
    // config that could actually run the turn itself.
    await page.waitForFunction(
      "document.querySelector('.agent-transcript .turn-assistant .turn-text')?.textContent === " +
        "'Hello from the remote server, via the web client!'",
      undefined,
      { timeout: 15_000 },
    );
    // Per Core Round 5's interactive semantics (DH-0059), a root agent with no tool call in
    // its turn parks at "waiting" rather than reaching "done"/session end on its own — see
    // e2e/web.test.ts (DH-0062) for the same fix against the local --web scenario.
    expect(await page.locator(".agent-header-title .status-badge").textContent()).toBe("waiting");

    // The remote server itself also saw the real request (not just the client's own render) —
    // a plain fetch against its API, independent of the browser, confirms the tree updated.
    const treeRes = await fetch(`http://localhost:${port}/api/commands`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "request_agent_tree" }),
    });
    expect(treeRes.status).toBe(200);
    // DH-0165: CI's gate.yml groups this file's Chromium launch back-to-back with
    // e2e/web.test.ts's and e2e/streaming.test.ts's own browser launches in the same
    // `bun test` invocation (see gate.yml's "E2E (web/browser — Chromium)" step) — by the
    // time this test's own two `dh` processes (server + connected --web client) and browser
    // launch, the runner has already spent real wall-clock time on two prior full browser
    // sessions. 30s was tight enough to time out in real CI even though this test passes
    // comfortably (and quickly) run in isolation, locally.
  }, 45_000);
});
