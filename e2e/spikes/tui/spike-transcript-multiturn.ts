// DH-0060 spike — Test Plan items: "Transcript shows both the user's own sent messages and
// the assistant's responses, clearly delineated", "Multi-turn conversation: sending a second
// message after the agent pauses continues the same conversation, not a fresh one", and
// "Token/cost figures display … and accumulate correctly across multiple turns" (DH-0028).
//
// Run: bun e2e/spikes/tui/spike-transcript-multiturn.ts
// Exit code 0 = all checks passed; 1 = at least one failed. Full report on stdout.

import { successTurn } from "../../support/mock-provider.ts";
import type { SpikeCheck } from "./spike-support.ts";
import { bootLocalTui, expectContains, expectTrue, reportAndExit } from "./spike-support.ts";

const { session, provider, stop } = await bootLocalTui([
  successTurn("The capital of France is Paris."),
  successTurn("And the capital of Germany is Berlin."),
]);

let checks: SpikeCheck[] = [];
let pane = "";
try {
  // Turn 1: type, confirm the input box echoes it, send, wait for the scripted reply.
  session.sendText("first question");
  await session.waitFor((screen) => screen.includes("> first question"));
  session.sendKeys("Enter");
  await session.waitFor((screen) => screen.includes("Paris"), 15_000);

  // Turn 2: the agent is now paused ("waiting" — interactive sessions don't end between
  // exchanges). A second message must continue the SAME conversation.
  session.sendText("second question");
  await session.waitFor((screen) => screen.includes("> second question"));
  session.sendKeys("Enter");
  await session.waitFor((screen) => screen.includes("Berlin"), 15_000);

  pane = session.capture();
  checks = [
    // User turns are echoed with the "> " role marker; assistant turns render beneath them.
    expectContains(pane, "> first question", "turn 1 user message is in the transcript"),
    expectContains(pane, "The capital of France is Paris.", "turn 1 assistant reply rendered"),
    expectContains(pane, "> second question", "turn 2 user message is in the transcript"),
    expectContains(
      pane,
      "And the capital of Germany is Berlin.",
      "turn 2 assistant reply rendered",
    ),
    // Same conversation, not a fresh one: turn 1 is still on screen after turn 2 completes,
    // and the provider was called exactly twice (once per exchange, one shared history).
    expectTrue(
      provider.callCount === 2,
      "mock provider called exactly twice (one shared conversation)",
      provider.callCount === 2 ? undefined : `callCount was ${provider.callCount}`,
    ),
    // DH-0028: header shows session token totals; two turns at the mock's default
    // 10 input + 10 output tokens each accumulate to 40.
    expectContains(pane, "40 tok", "session token total accumulated across both turns (40 tok)"),
  ];
} finally {
  // reportAndExit calls process.exit, which would skip this finally — clean up first,
  // report after (see spike-support.ts).
  stop();
}

reportAndExit("transcript-multiturn", checks, pane);
