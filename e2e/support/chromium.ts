// DH-0177: promoted out of `e2e/spikes/web/support.ts` — real CI-gated tests (`web.test.ts`,
// `streaming.test.ts`, `connect-web.test.ts`) depended on this helper despite `spikes/`'s own
// header declaring that whole tree is NOT part of the `bun run e2e` gate, inverting the
// dependency direction. Lives here in `e2e/support/` (the gated tree) instead; the spikes
// support module now imports it back from here.

import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

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
