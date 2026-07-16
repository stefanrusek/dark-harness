// DH-0061 spike 1 (core behavior): transcript shows both the user's own sent message and the
// assistant's response, clearly delineated by role, with live status and token/cost figures.
//
// Run from the repo root:   bun e2e/spikes/web/spike-transcript.ts
// Exit code 0 = every hard check passed; stdout carries [PASS]/[FAIL] lines, a final
// RESULT: line, and the absolute screenshot path.

import { artifactPath, createReport, launchWebUi, sendMessage } from "./support.ts";

const ASSISTANT_TEXT = "Verified: the overnight web spike can see me.";
const USER_TEXT = "hello from the overnight verifier";

const report = createReport("spike-transcript");
const session = await launchWebUi([{ text: ASSISTANT_TEXT, stopReason: "end_turn" }]);
const { page } = session;

try {
  await sendMessage(page, USER_TEXT);

  // Wait for the assistant turn to render (the turn-level structure, not just any output).
  await page.waitForFunction(
    "document.querySelectorAll('.agent-transcript .turn-assistant').length >= 1",
    undefined,
    { timeout: 15_000 },
  );

  // User turn: echoed into the transcript, labeled "You".
  const userTurn = page.locator(".agent-transcript .turn-user");
  report.check(
    "user turn is echoed into the transcript",
    (await userTurn.count()) === 1,
    `.turn-user count = ${await userTurn.count()}`,
  );
  const userRole = await userTurn.locator(".turn-role").textContent();
  report.check("user turn is labeled 'You'", userRole === "You", `role label = ${userRole}`);
  const userText = await userTurn.locator(".turn-text").textContent();
  report.check("user turn carries the sent text", userText === USER_TEXT, `text = ${userText}`);

  // Assistant turn: distinct element, labeled "Agent", carrying the mock model's reply.
  const assistantTurn = page.locator(".agent-transcript .turn-assistant");
  const assistantRole = await assistantTurn.locator(".turn-role").textContent();
  report.check(
    "assistant turn is labeled 'Agent'",
    assistantRole === "Agent",
    `role label = ${assistantRole}`,
  );
  const assistantText = await assistantTurn.locator(".turn-text").textContent();
  report.check(
    "assistant turn carries the model reply",
    assistantText === ASSISTANT_TEXT,
    `text = ${assistantText}`,
  );

  // Delineation: the two turns are separate DOM blocks with role-distinct classes.
  const turnCount = await page.locator(".agent-transcript .turn").count();
  report.check(
    "turns are separate role-classed blocks",
    turnCount === 2,
    `.turn count = ${turnCount} (expected 2: one user, one assistant)`,
  );

  // Status: the root agent reaches a terminal/paused state with a matching badge + dot.
  await page.waitForFunction(
    "['done','waiting'].includes(document.querySelector('.agent-row.root')?.getAttribute('data-status') ?? '')",
    undefined,
    { timeout: 15_000 },
  );
  const rowStatus = await page.locator(".agent-row.root").getAttribute("data-status");
  const badge = await page.locator(".agent-header-title .status-badge").textContent();
  report.check(
    "status badge matches the sidebar row status",
    (rowStatus === "done" && badge === "Done") || (rowStatus === "waiting" && badge === "Waiting"),
    `data-status = ${rowStatus}, badge = ${badge}`,
  );

  // Token/cost: per-agent header stats and the session total strip are populated.
  const headerStats = await page.locator(".agent-header-stats").textContent();
  report.check(
    "per-agent token/cost stats are populated",
    /in \/.*out ·/.test(headerStats ?? ""),
    `header stats = ${headerStats}`,
  );
  const sessionStats = await page.locator(".session-stats").textContent();
  report.check(
    "session-total token/cost strip is populated",
    /in \/.*out ·/.test(sessionStats ?? ""),
    `session stats = ${sessionStats}`,
  );

  const screenshot = artifactPath("spike-transcript.png");
  await page.screenshot({ path: screenshot, fullPage: true });
  await session.stop();
  report.finish({ screenshot });
} catch (err) {
  const screenshot = artifactPath("spike-transcript-error.png");
  await page.screenshot({ path: screenshot, fullPage: true }).catch(() => {});
  await session.stop();
  report.check("script completed without an unexpected error", false, String(err));
  report.finish({ screenshot });
}
