// DH-0061 spike support: shared helpers for the Web overnight-verification spike scripts.
//
// These spikes are NOT part of the `bun run e2e` gate (they are deliberately not named
// `*.test.ts`) — they are standalone, haiku-sub-agent-runnable verification scripts, each
// executed as `bun e2e/spikes/web/spike-<name>.ts` from the repo root. They reuse the real
// e2e support modules (`../../support/*`) so they drive the actual compiled binary against
// the actual mock provider, exactly like the gated e2e suite does.
//
// Design constraints (see tracking/DH-0061):
// - Every script must print machine-readable `[PASS]`/`[FAIL]` lines plus one final
//   `RESULT: PASS|FAIL` line, and exit 0 only when every hard check passed — a haiku-tier
//   agent reports the verdict by reading stdout, never by interpreting a stack trace.
// - Screenshots land in `e2e/spikes/web/artifacts/` (gitignored) with absolute paths
//   printed, so the invoking agent can attach them as evidence.
// - Chromium resolution must not assume one blessed path: CI sandboxes pre-install at
//   /opt/pw-browsers/chromium (see e2e/web.test.ts), dev machines have playwright's own
//   cache — possibly at a different revision than the pinned playwright package expects
//   (observed live: package wants chromium-1228, cache has 1223/1232).

import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Browser, Page } from "playwright";
// DH-0177: promoted into e2e/support/ (the gated tree) since the real CI-gated
// web/streaming/connect-web tests depend on it — re-exported here so existing spike scripts
// importing it from this module keep working unchanged.
import { resolveChromiumExecutable } from "../../support/chromium.ts";
import { type DhProcess, spawnDh } from "../../support/dh-process.ts";
import {
  type MockAnthropicProvider,
  type MockTurn,
  startMockAnthropicProvider,
} from "../../support/mock-provider.ts";
import { baseConfig, createWorkspace, type TestWorkspace } from "../../support/workspace.ts";

export { resolveChromiumExecutable };

export const ARTIFACTS_DIR = resolve(import.meta.dir, "artifacts");

/** Absolute path for a screenshot/evidence file; ensures the artifacts dir exists. */
export function artifactPath(name: string): string {
  mkdirSync(ARTIFACTS_DIR, { recursive: true });
  return join(ARTIFACTS_DIR, name);
}

export interface SpikeCheck {
  name: string;
  pass: boolean;
  detail: string;
  /** True for checks documenting a known-unimplemented behavior (e.g. DH-0023's CSP headers
   * before that ticket ships) — reported, but never fails the script. */
  expectedFail: boolean;
}

export interface SpikeReport {
  /** Records a hard check: a false `pass` makes the whole script FAIL (exit 1). */
  check(name: string, pass: boolean, detail?: string): void;
  /** Records an informational check for known-unimplemented behavior: printed as
   * `[EXPECTED-FAIL]` when failing, upgraded to `[PASS]` once the fix ships. */
  expectedFail(name: string, pass: boolean, detail?: string): void;
  /** Prints every check plus the final `RESULT:` line and exits the process. */
  finish(evidence?: { screenshot?: string }): never;
}

export function createReport(scriptName: string): SpikeReport {
  const checks: SpikeCheck[] = [];
  return {
    check(name, pass, detail = "") {
      checks.push({ name, pass, detail, expectedFail: false });
    },
    expectedFail(name, pass, detail = "") {
      checks.push({ name, pass, detail, expectedFail: true });
    },
    finish(evidence) {
      let hardFailures = 0;
      let hardPasses = 0;
      for (const c of checks) {
        const suffix = c.detail ? ` — ${c.detail}` : "";
        if (c.pass) {
          console.log(`[PASS] ${c.name}${suffix}`);
          if (!c.expectedFail) hardPasses += 1;
        } else if (c.expectedFail) {
          console.log(`[EXPECTED-FAIL] ${c.name}${suffix}`);
        } else {
          console.log(`[FAIL] ${c.name}${suffix}`);
          hardFailures += 1;
        }
      }
      const verdict = hardFailures === 0 ? "PASS" : "FAIL";
      const total = hardPasses + hardFailures;
      const evidenceSuffix = evidence?.screenshot ? `; screenshot: ${evidence.screenshot}` : "";
      console.log(
        `RESULT: ${verdict} (${scriptName}: ${hardPasses}/${total} hard checks passed${evidenceSuffix})`,
      );
      process.exit(hardFailures === 0 ? 0 : 1);
    },
  };
}

export interface WebUiSession {
  page: Page;
  browser: Browser;
  provider: MockAnthropicProvider;
  proc: DhProcess;
  workspace: TestWorkspace;
  webUrl: string;
  stop(): Promise<void>;
}

/**
 * The full launch pattern in one call: builds the real binary (via `spawnDh` →
 * `ensureBuilt`, which shells out to `scripts/build.ts`), starts a scripted mock provider,
 * writes an isolated workspace `dh.json` pointed at it, spawns `dh --web`, parses the served
 * URL off stdout, opens it in headless Chromium, and waits for the SSE connection pill to
 * read "Live" (the UI's own signal that it is fully wired to the server).
 */
export async function launchWebUi(turns: MockTurn[]): Promise<WebUiSession> {
  const provider = startMockAnthropicProvider(turns);
  const workspace = createWorkspace("dh-spike-web-");
  workspace.writeConfig(baseConfig(provider.baseURL));

  const proc = await spawnDh({ args: ["--web"], cwd: workspace.dir });
  const stdout = await proc.waitForStdout(/web UI ready at (\S+)/, 20_000);
  const webUrl = /web UI ready at (\S+)\./.exec(stdout)?.[1];
  if (!webUrl) {
    proc.kill();
    provider.stop();
    workspace.cleanup();
    throw new Error(`could not parse web UI URL from dh stdout: ${stdout}`);
  }

  const executablePath = await resolveChromiumExecutable();
  const { chromium } = await import("playwright");
  // DH-0165: see e2e/web.test.ts's identical chromium.launch call for why these args exist —
  // GitHub Actions' runners have no D-Bus session bus, which some headless Chromium subsystems
  // reach for on launch and hang/crash waiting on.
  const browser = await chromium.launch({
    executablePath,
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
  });
  const page = await browser.newPage();
  await page.goto(webUrl);
  await page.waitForSelector(".dh-app");
  await page.waitForFunction("document.querySelector('.connection-pill')?.textContent === 'Live'");

  return {
    page,
    browser,
    provider,
    proc,
    workspace,
    webUrl,
    async stop() {
      await browser.close().catch(() => {});
      proc.kill();
      provider.stop();
      workspace.cleanup();
    },
  };
}

/** Types into the root composer and clicks Send — the real interactive path, no API shortcut. */
export async function sendMessage(page: Page, text: string): Promise<void> {
  const composer = page.locator(".composer-input");
  await composer.waitFor({ state: "visible" });
  await composer.fill(text);
  await page.getByRole("button", { name: "Send" }).click();
}
