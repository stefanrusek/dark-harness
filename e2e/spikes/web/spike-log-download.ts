// DH-0061 spike 6 (core behavior): the "Download log" and "Download session bundle" buttons
// produce real, valid files — per-agent JSONL (first line a header carrying the agentId) and
// a session tar bundle (non-empty, containing the agent's log filename near its first
// header block). Follows e2e/web.test.ts's proven `page.waitForEvent("download")` pattern.
//
// Run from the repo root:   bun e2e/spikes/web/spike-log-download.ts

import { readFileSync } from "node:fs";
import { artifactPath, createReport, launchWebUi, sendMessage } from "./support.ts";

const report = createReport("spike-log-download");
const session = await launchWebUi([
  { text: "Logged for download verification.", stopReason: "end_turn" },
]);
const { page } = session;

try {
  // acceptDownloads defaults to true on newPage()'s owning context in modern Playwright, but
  // launchWebUi doesn't set it explicitly — verify the download event actually fires before
  // relying on it.
  await sendMessage(page, "please log something");
  await page.waitForFunction(
    "document.querySelectorAll('.agent-transcript .turn-assistant').length >= 1",
    undefined,
    { timeout: 15_000 },
  );
  await page.waitForSelector(".agent-header-actions");

  const [agentDownload] = await Promise.all([
    page.waitForEvent("download", { timeout: 15_000 }),
    page.getByRole("button", { name: "Download log" }).click(),
  ]);
  report.check(
    "per-agent log download suggests the agent-root.jsonl filename",
    agentDownload.suggestedFilename() === "agent-root.jsonl",
    `suggestedFilename = ${agentDownload.suggestedFilename()}`,
  );
  const agentLogPath = await agentDownload.path();
  report.check("per-agent log download materialized a local file", agentLogPath !== null);
  if (agentLogPath) {
    const firstLine = JSON.parse(readFileSync(agentLogPath, "utf8").split("\n")[0] ?? "{}");
    report.check(
      "per-agent log's first line is a header for agent-root",
      firstLine?.type === "header" && firstLine?.agentId === "agent-root",
      `first line = ${JSON.stringify(firstLine)}`,
    );
  }

  const [bundleDownload] = await Promise.all([
    page.waitForEvent("download", { timeout: 15_000 }),
    page.getByRole("button", { name: "Download session bundle" }).click(),
  ]);
  report.check(
    "session bundle download suggests a session-<uuid>.tar filename",
    /^session-[0-9a-f-]+\.tar$/.test(bundleDownload.suggestedFilename()),
    `suggestedFilename = ${bundleDownload.suggestedFilename()}`,
  );
  const bundlePath = await bundleDownload.path();
  report.check("session bundle download materialized a local file", bundlePath !== null);
  if (bundlePath) {
    const bundleBytes = readFileSync(bundlePath);
    report.check(
      "session bundle is non-empty",
      bundleBytes.byteLength > 0,
      `byteLength = ${bundleBytes.byteLength}`,
    );
    report.check(
      "session bundle's first tar header block names the agent-root log",
      bundleBytes.toString("utf8", 0, 100).includes("agent-root"),
      `first 100 bytes = ${JSON.stringify(bundleBytes.toString("utf8", 0, 100))}`,
    );
  }

  const screenshot = artifactPath("spike-log-download.png");
  await page.screenshot({ path: screenshot, fullPage: true });
  await session.stop();
  report.finish({ screenshot });
} catch (err) {
  const screenshot = artifactPath("spike-log-download-error.png");
  await page.screenshot({ path: screenshot, fullPage: true }).catch(() => {});
  await session.stop();
  report.check("script completed without an unexpected error", false, String(err));
  report.finish({ screenshot });
}
