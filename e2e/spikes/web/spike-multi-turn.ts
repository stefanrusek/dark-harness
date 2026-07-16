// DH-0061 spike 7 (core behavior): sending a second message after the root agent parks at
// "waiting" continues the same conversation — not a fresh one. Asserts the transcript
// accumulates to 4 turns (2 user + 2 assistant) rather than resetting to 2, that both
// exchanges are visible together, and that the mock provider actually saw two separate
// completions (not one turn replayed).
//
// Run from the repo root:   bun e2e/spikes/web/spike-multi-turn.ts

import { artifactPath, createReport, launchWebUi, sendMessage } from "./support.ts";

const FIRST_REPLY = "First reply from the mock model.";
const SECOND_REPLY = "Second reply — same conversation continues.";

const report = createReport("spike-multi-turn");
const session = await launchWebUi([
  { text: FIRST_REPLY, stopReason: "end_turn" },
  { text: SECOND_REPLY, stopReason: "end_turn" },
]);
const { page, provider } = session;

try {
  await sendMessage(page, "first message");
  await page.waitForFunction(
    "document.querySelectorAll('.agent-transcript .turn-assistant').length >= 1",
    undefined,
    { timeout: 15_000 },
  );
  // Root parks at "waiting" after a turn with no tool call (Core Round 5's interactive
  // semantics) — the precondition for sending a second message into the same conversation.
  await page.waitForFunction(
    "document.querySelector('.agent-row.root')?.getAttribute('data-status') === 'waiting'",
    undefined,
    { timeout: 15_000 },
  );

  const turnsAfterFirst = await page.locator(".agent-transcript .turn").count();
  report.check(
    "after the first exchange, transcript shows 2 turns (1 user + 1 assistant)",
    turnsAfterFirst === 2,
    `turn count = ${turnsAfterFirst}`,
  );

  await sendMessage(page, "second message");
  await page.waitForFunction(
    `document.querySelector('.agent-transcript')?.textContent?.includes(${JSON.stringify(
      SECOND_REPLY,
    )})`,
    undefined,
    { timeout: 15_000 },
  );

  const turnsAfterSecond = await page.locator(".agent-transcript .turn").count();
  report.check(
    "after the second exchange, transcript accumulates to 4 turns (not reset to 2)",
    turnsAfterSecond === 4,
    `turn count = ${turnsAfterSecond}`,
  );

  const firstReplyStillVisible = (await page.locator(".agent-transcript").textContent())?.includes(
    FIRST_REPLY,
  );
  report.check(
    "the first exchange's assistant reply is still visible after the second turn",
    firstReplyStillVisible === true,
  );

  const userTurns = await page.locator(".agent-transcript .turn-user").count();
  const assistantTurns = await page.locator(".agent-transcript .turn-assistant").count();
  report.check(
    "exactly 2 user turns and 2 assistant turns are present",
    userTurns === 2 && assistantTurns === 2,
    `user = ${userTurns}, assistant = ${assistantTurns}`,
  );

  report.check(
    "the mock provider received exactly 2 separate completion requests (not 1 replayed)",
    provider.callCount === 2,
    `callCount = ${provider.callCount}`,
  );

  // The second request's message history includes the first exchange, proving continuity
  // of the same conversation rather than a fresh session.
  const secondRequestBody = provider.requests[1];
  const historyText = JSON.stringify(secondRequestBody ?? {});
  report.check(
    "the second provider request's message history includes the first user message",
    historyText.includes("first message"),
    `contains 'first message': ${historyText.includes("first message")}`,
  );

  const screenshot = artifactPath("spike-multi-turn.png");
  await page.screenshot({ path: screenshot, fullPage: true });
  await session.stop();
  report.finish({ screenshot });
} catch (err) {
  const screenshot = artifactPath("spike-multi-turn-error.png");
  await page.screenshot({ path: screenshot, fullPage: true }).catch(() => {});
  await session.stop();
  report.check("script completed without an unexpected error", false, String(err));
  report.finish({ screenshot });
}
