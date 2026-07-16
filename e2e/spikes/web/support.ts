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

import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import type { Browser, Page } from "playwright";
import { type DhProcess, spawnDh } from "../../support/dh-process.ts";
import {
  type MockAnthropicProvider,
  type MockTurn,
  startMockAnthropicProvider,
} from "../../support/mock-provider.ts";
import { type TestWorkspace, baseConfig, createWorkspace } from "../../support/workspace.ts";

export const ARTIFACTS_DIR = resolve(import.meta.dir, "artifacts");

/** Absolute path for a screenshot/evidence file; ensures the artifacts dir exists. */
export function artifactPath(name: string): string {
  mkdirSync(ARTIFACTS_DIR, { recursive: true });
  return join(ARTIFACTS_DIR, name);
}

/**
 * Finds a runnable Chromium, in priority order: the CI sandbox's pre-installed binary,
 * playwright's own version-matched download, then any revision present in the local
 * playwright browser cache (newest first — a revision-adjacent Chromium is fine for these
 * behavioral checks even when it isn't the exact pinned one).
 */
export async function resolveChromiumExecutable(): Promise<string> {
  const { chromium } = await import("playwright");
  const candidates: string[] = ["/opt/pw-browsers/chromium"];
  try {
    candidates.push(chromium.executablePath());
  } catch {
    // no download registered for this playwright version — fall through to cache scan
  }
  for (const candidate of candidates) {
    if (candidate && existsSync(candidate)) return candidate;
  }

  const cacheRoots = [
    process.env.PLAYWRIGHT_BROWSERS_PATH,
    join(homedir(), "Library", "Caches", "ms-playwright"),
    join(homedir(), ".cache", "ms-playwright"),
  ].filter((root): root is string => typeof root === "string" && root.length > 0);
  const launchers = [
    join(
      "chrome-mac-arm64",
      "Google Chrome for Testing.app",
      "Contents",
      "MacOS",
      "Google Chrome for Testing",
    ),
    join(
      "chrome-mac",
      "Google Chrome for Testing.app",
      "Contents",
      "MacOS",
      "Google Chrome for Testing",
    ),
    join("chrome-linux", "chrome"),
  ];
  for (const root of cacheRoots) {
    if (!existsSync(root)) continue;
    const revisions = readdirSync(root)
      .filter((entry) => /^chromium-\d+$/.test(entry))
      .sort((a, b) => Number(b.split("-")[1]) - Number(a.split("-")[1]));
    for (const revision of revisions) {
      for (const launcher of launchers) {
        const path = join(root, revision, launcher);
        if (existsSync(path)) return path;
      }
    }
  }
  throw new Error(
    "No Chromium found. Install one with `bunx playwright install chromium`, or set " +
      "PLAYWRIGHT_BROWSERS_PATH, or provide /opt/pw-browsers/chromium (CI sandbox convention).",
  );
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
  const browser = await chromium.launch({ executablePath, headless: true });
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
