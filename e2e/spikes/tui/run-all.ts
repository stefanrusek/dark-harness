// DH-0060 orchestrator — the owner's "one comprehensive report" requirement (see the
// ticket's Functional Requirements). Runs every scripted spike in `e2e/spikes/tui/` as a
// real subprocess (`bun e2e/spikes/tui/spike-<name>.ts`), drives the two judgment-only
// Mode B scenarios itself (liveness/heartbeat, resize behavior — see below for why these two
// specifically don't have their own fixed-string-assertable script), and writes a single
// Markdown report enumerating every DH-0060 Test Plan item by name with its verdict and the
// real captured pane text, readable standalone with no other file open.
//
// Run: bun e2e/spikes/tui/run-all.ts [--out <path>]
// Exit code 0 = every item PASSed (or is a documented non-blocking heuristic/out-of-scope
// item); 1 = at least one real FAIL. Always writes the report, pass or fail.

import { ensureBuilt } from "../../support/build.ts";
import { startMockAnthropicProvider, successTurn } from "../../support/mock-provider.ts";
import { startTmuxSession } from "../../support/tmux-pty.ts";
import { baseConfig, createWorkspace } from "../../support/workspace.ts";

interface ScenarioResult {
  /** Stable slug used as the Markdown heading anchor and in the summary table. */
  slug: string;
  /** The exact Test Plan / acceptance-criterion wording this scenario proves, verbatim from
   * tracking/DH-0060-*.md, so the report is greppable against the ticket. */
  testPlanItem: string;
  verdict: "PASS" | "FAIL" | "HEURISTIC-PASS" | "HEURISTIC-FAIL" | "OUT-OF-SCOPE";
  /** One-line summary shown in the top-of-report table. */
  summary: string;
  /** Full evidence block(s) — spike stdout, or an inline capture-pane transcript for the
   * scenarios this script drives directly. Always included, pass or fail. */
  evidence: string;
}

const REPO_ROOT = new URL("../../../", import.meta.url).pathname;

// ---------------------------------------------------------------------------------------
// Part 1: every scripted spike, run as a real subprocess. One spike can prove more than one
// Test Plan item (its own file header documents which); each is listed here once per item it
// proves so the report enumerates every acceptance criterion by name, per the ticket's owner
// requirement, even when several share one underlying script run.
// ---------------------------------------------------------------------------------------

interface SpikeMapping {
  script: string;
  items: string[];
}

const SPIKE_MAPPINGS: SpikeMapping[] = [
  {
    script: "spike-transcript-multiturn.ts",
    items: [
      "Transcript shows both the user's own sent messages and the assistant's responses, clearly delineated (DH-0007-era structured transcript).",
      "Multi-turn conversation: sending a second message after the agent pauses (waiting) continues the same conversation, not a fresh one.",
      "Token/cost figures display per-agent and as a session total, and accumulate correctly across multiple turns (DH-0028).",
    ],
  },
  {
    script: "spike-markdown-render.ts",
    items: [
      "DH-0056: assistant output renders real Markdown formatting (headings, bold, italic, inline code, fenced code blocks, lists, links) via ANSI — never raw Markdown syntax characters, never a raw/garbled escape sequence.",
    ],
  },
  {
    script: "spike-input-editing.ts",
    items: [
      "DH-0026: input box supports cursor movement (arrow keys, home/end), and previously-dead keys now work.",
    ],
  },
  {
    script: "spike-ctrlc-exit-code.ts",
    items: [
      "DH-0059: Ctrl+C in local mode (server+TUI same process) stops the agent and exits cleanly with the correct exit code; a second Ctrl+C or the fallback timer force-quits if the first doesn't complete promptly.",
      "Per-agent status shows the correct label/color and updates live as an agent transitions (waiting/cyan half).",
    ],
  },
  {
    script: "spike-agent-tree-hierarchy.ts",
    items: [
      "Agent tree renders parent/child spawn hierarchy correctly as sub-agents are created.",
      "Per-agent status shows the correct label/color and updates live as an agent transitions (done/green half).",
    ],
  },
  {
    script: "spike-task-failed-status.ts",
    items: [
      "TASK_FAILED/structured-outcome self-report is reflected in the UI's final status marker.",
      "Per-agent status shows the correct label/color and updates live as an agent transitions (failed/red half).",
    ],
  },
  {
    script: "spike-tree-scroll.ts",
    items: [
      "DH-0027: the agent tree view scrolls to keep the selected/highlighted entry visible as you navigate a tree taller than the visible pane.",
    ],
  },
  {
    script: "spike-log-download.ts",
    items: ["Log download/export command works and produces a valid file."],
  },
  {
    script: "spike-wide-char.ts",
    items: [
      "DH-0025 (wide-character half): wide characters (CJK, emoji, combining marks) wrap/pad correctly without corrupting the frame.",
    ],
  },
  {
    script: "spike-sse-reconnect.ts",
    items: [
      "SSE reconnect: killing/restarting the server mid-session triggers a visible reconnect indicator, then resumes without duplicating or losing transcript content (DH-0024).",
    ],
  },
];

function runSpikeScript(script: string): { exitCode: number; stdout: string } {
  const result = Bun.spawnSync({
    cmd: ["bun", `e2e/spikes/tui/${script}`],
    cwd: REPO_ROOT,
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdout =
    result.stdout.toString() +
    (result.stderr.toString() ? `\n[stderr]\n${result.stderr.toString()}` : "");
  return { exitCode: result.exitCode ?? 1, stdout };
}

function verdictFromSpikeOutput(exitCode: number, stdout: string): "PASS" | "FAIL" {
  return exitCode === 0 && /RESULT: PASS/.test(stdout) ? "PASS" : "FAIL";
}

async function runScriptedSpikes(): Promise<ScenarioResult[]> {
  const results: ScenarioResult[] = [];
  for (const mapping of SPIKE_MAPPINGS) {
    const { exitCode, stdout } = runSpikeScript(mapping.script);
    const verdict = verdictFromSpikeOutput(exitCode, stdout);
    for (const item of mapping.items) {
      results.push({
        slug: `${mapping.script.replace(/\.ts$/, "")}`,
        testPlanItem: item,
        verdict,
        summary: `${mapping.script} exited ${exitCode}`,
        evidence: stdout,
      });
    }
  }
  return results;
}

// ---------------------------------------------------------------------------------------
// Part 2: Mode B scenarios driven directly by this orchestrator (no separate spike-*.ts
// file) — per the ticket's own guidance, genuinely judgment-based items ("doesn't look
// frozen", "no visible flicker") get Mode B instead of a forced rigid script. This
// orchestrator still drives the steps and applies a best-effort mechanical heuristic so the
// report has a verdict, not just raw evidence — but these are explicitly labeled
// HEURISTIC-PASS/FAIL rather than PASS/FAIL, since a text capture can't fully substitute for
// a human's visual judgment of "flicker."
// ---------------------------------------------------------------------------------------

/** Liveness/heartbeat: a genuinely slow turn (mock provider delayed via MockTurn.delayMs, the
 * DH-0060 addition to e2e/support/mock-provider.ts) lets us poll the tree view's per-agent
 * elapsed counter (`[Ns]`, src/tui/render.ts's formatElapsed) twice, a couple of seconds
 * apart, and confirm it actually advanced — a plain mechanical proxy for "doesn't look
 * frozen" that doesn't require human judgment at all, so this one is reported as a normal
 * PASS/FAIL, not a heuristic. */
async function runLivenessScenario(): Promise<ScenarioResult> {
  const testPlanItem =
    "Liveness/heartbeat indicator updates during a long-running turn (doesn't look frozen).";
  const provider = startMockAnthropicProvider([
    { text: "Finally done.", stopReason: "end_turn", delayMs: 6000 },
  ]);
  const ws = createWorkspace("dh-spike-liveness-");
  ws.writeConfig(baseConfig(provider.baseURL));
  const binaryPath = await ensureBuilt();
  const session = startTmuxSession([binaryPath], { cwd: ws.dir, cols: 100, rows: 30 });
  const stop = () => {
    session.kill();
    provider.stop();
    ws.cleanup();
  };
  let evidence = "";
  try {
    await session.waitFor((screen) => screen.includes("Dark Harness"));
    await session.waitFor((screen) => screen.includes("Root Agent"));
    session.sendText("take your time");
    await session.waitFor((screen) => screen.includes("> take your time"));
    session.sendKeys("Enter");
    // Open the tree immediately (empty input) so the elapsed counter is on screen while the
    // 3s-delayed reply is still in flight.
    session.sendKeys("Left");
    await session.waitFor((screen) => screen.includes("Agent Tree"));

    const firstRead = await session.waitFor((screen) => /\[\d+s\]/.test(screen), 5_000);
    const firstElapsed = Number(firstRead.match(/\[(\d+)s\]/)?.[1] ?? "-1");
    // The elapsed label only advances once per 1s tick (src/tui/app.ts's TICK_INTERVAL_MS)
    // and rounds down, so a gap of ~1.8s can land within the same rounded second depending on
    // exactly where the first read fell in its tick cycle — 3.5s comfortably guarantees at
    // least one full tick boundary is crossed regardless of phase.
    await Bun.sleep(3500);
    const secondRead = session.capture();
    const secondElapsed = Number(secondRead.match(/\[(\d+)s\]/)?.[1] ?? "-1");

    evidence = [
      `first read (elapsed=${firstElapsed}s):\n${firstRead.trimEnd()}`,
      `second read ~3.5s later (elapsed=${secondElapsed}s):\n${secondRead.trimEnd()}`,
    ].join("\n\n");

    const advanced = firstElapsed >= 0 && secondElapsed > firstElapsed;
    return {
      slug: "liveness-heartbeat",
      testPlanItem,
      verdict: advanced ? "PASS" : "FAIL",
      summary: advanced
        ? `elapsed counter advanced from ${firstElapsed}s to ${secondElapsed}s during the in-flight turn`
        : `elapsed counter did not advance (first=${firstElapsed}s, second=${secondElapsed}s)`,
      evidence,
    };
  } catch (err) {
    return {
      slug: "liveness-heartbeat",
      testPlanItem,
      verdict: "FAIL",
      summary: `scenario threw: ${err}`,
      evidence: evidence || String(err),
    };
  } finally {
    stop();
  }
}

/** DH-0025 resize/flicker: two distinct sub-claims live in one Test Plan bullet.
 * (a) "resizing the terminal rapidly doesn't flicker/corrupt" — rapid `tmux resize-window`
 * calls (delivers real SIGWINCH) followed by a row-count/title-bar sanity check per size is a
 * clean mechanical proxy for "not corrupted"; reported as a normal PASS/FAIL.
 * (b) "no visible full-redraw flicker on the once-per-second idle tick" — genuinely a
 * temporal visual judgment call a single text capture can't settle; this orchestrator still
 * captures repeatedly through at least one idle tick and checks the static parts of the frame
 * never go blank/garbled between reads, but reports it as HEURISTIC-PASS/FAIL and says so
 * plainly — a human should still eyeball the embedded evidence. */
async function runResizeScenario(): Promise<ScenarioResult> {
  const testPlanItem =
    "DH-0025: resizing the terminal rapidly doesn't flicker/corrupt; no visible full-redraw flicker on the once-per-second idle tick.";
  const provider = startMockAnthropicProvider([successTurn("Steady state reply.")]);
  const ws = createWorkspace("dh-spike-resize-");
  ws.writeConfig(baseConfig(provider.baseURL));
  const binaryPath = await ensureBuilt();
  const session = startTmuxSession([binaryPath], { cwd: ws.dir, cols: 100, rows: 30 });
  const stop = () => {
    session.kill();
    provider.stop();
    ws.cleanup();
  };
  const evidenceParts: string[] = [];
  try {
    await session.waitFor((screen) => screen.includes("Dark Harness"));
    await session.waitFor((screen) => screen.includes("Root Agent"));
    session.sendText("hello");
    await session.waitFor((screen) => screen.includes("> hello"));
    session.sendKeys("Enter");
    await session.waitFor((screen) => screen.includes("Steady state reply."), 15_000);

    // (a) rapid resize sequence, checking row-count/title-bar integrity after each.
    const sizes: [number, number][] = [
      [80, 24],
      [120, 40],
      [60, 20],
      [100, 30],
    ];
    let resizeCorrupted = false;
    for (const [cols, rows] of sizes) {
      session.resize(cols, rows);
      await Bun.sleep(300);
      const screen = session.capture();
      const rowCount = (screen.endsWith("\n") ? screen.slice(0, -1) : screen).split("\n").length;
      const ok = screen.includes("Dark Harness") && rowCount === rows;
      evidenceParts.push(
        `resize to ${cols}x${rows}: title present=${screen.includes("Dark Harness")}, rowCount=${rowCount} (expected ${rows})\n${screen.trimEnd()}`,
      );
      if (!ok) resizeCorrupted = true;
    }

    // (b) idle-tick flicker heuristic: capture several times ~300ms apart (spans at least one
    // 1s tick) and confirm the steady-state reply text and title bar are present in every
    // read — a transient full-redraw glitch would show as one of these reads missing content
    // that's present in its neighbors.
    const idleReads: string[] = [];
    for (let i = 0; i < 6; i += 1) {
      idleReads.push(session.capture());
      await Bun.sleep(300);
    }
    const idleStable = idleReads.every(
      (screen) => screen.includes("Dark Harness") && screen.includes("Steady state reply."),
    );
    evidenceParts.push(
      `idle-tick reads (6x, ~300ms apart): all stable=${idleStable}\n${idleReads.map((s, i) => `--- read ${i} ---\n${s.trimEnd()}`).join("\n")}`,
    );

    const evidence = evidenceParts.join("\n\n");
    const resizeVerdict: "PASS" | "FAIL" = resizeCorrupted ? "FAIL" : "PASS";
    const flickerHeuristicVerdict: "HEURISTIC-PASS" | "HEURISTIC-FAIL" = idleStable
      ? "HEURISTIC-PASS"
      : "HEURISTIC-FAIL";

    // One scenario, two sub-claims — combine into the single Test Plan bullet's verdict,
    // conservatively (a real FAIL on either half fails the whole item), but keep both halves'
    // detail visible in the summary so a reader can tell which half is which.
    const combinedVerdict: ScenarioResult["verdict"] =
      resizeVerdict === "FAIL"
        ? "FAIL"
        : flickerHeuristicVerdict === "HEURISTIC-FAIL"
          ? "HEURISTIC-FAIL"
          : "HEURISTIC-PASS";

    return {
      slug: "resize-flicker",
      testPlanItem,
      verdict: combinedVerdict,
      summary: `resize-no-corruption: ${resizeVerdict}; idle-tick-stability (heuristic, not a substitute for human visual judgment): ${flickerHeuristicVerdict}`,
      evidence,
    };
  } catch (err) {
    return {
      slug: "resize-flicker",
      testPlanItem,
      verdict: "FAIL",
      summary: `scenario threw: ${err}`,
      evidence: evidenceParts.join("\n\n") || String(err),
    };
  } finally {
    stop();
  }
}

// ---------------------------------------------------------------------------------------
// Part 3: explicitly out-of-scope items, per the ticket itself — still enumerated in the
// report (never silently dropped), per this project's "no silent truncation" workflow rule.
// ---------------------------------------------------------------------------------------

const OUT_OF_SCOPE: ScenarioResult[] = [
  {
    slug: "dh-0044-streaming",
    testPlanItem:
      "DH-0044 (once implemented): a long assistant turn's text visibly streams incrementally rather than appearing all at once when the turn completes.",
    verdict: "OUT-OF-SCOPE",
    summary:
      "DH-0044 (incremental streaming) is not yet implemented — explicitly deferred per this round's task order.",
    evidence: "(not applicable — feature not yet implemented)",
  },
  {
    slug: "dh-0012-eviction",
    testPlanItem:
      "DH-0012: this can't be visually verified in a short session (it's a 50-entry eviction threshold) — note as out-of-scope for this suite, covered by unit tests instead.",
    verdict: "OUT-OF-SCOPE",
    summary:
      "Ticket itself marks this out-of-scope for the TUI verification suite; covered by unit tests instead.",
    evidence:
      "(not applicable — ticket marks this out-of-scope; see src/tui unit tests for eviction coverage)",
  },
];

// ---------------------------------------------------------------------------------------
// Report assembly
// ---------------------------------------------------------------------------------------

function verdictBadge(verdict: ScenarioResult["verdict"]): string {
  switch (verdict) {
    case "PASS":
      return "✅ PASS";
    case "FAIL":
      return "❌ FAIL";
    case "HEURISTIC-PASS":
      return "🟡 HEURISTIC-PASS (mechanical proxy, not a substitute for human judgment)";
    case "HEURISTIC-FAIL":
      return "🟠 HEURISTIC-FAIL (mechanical proxy flagged an issue — human should verify)";
    case "OUT-OF-SCOPE":
      return "⚪ OUT-OF-SCOPE";
  }
}

function buildReport(results: ScenarioResult[], startedAt: Date, finishedAt: Date): string {
  const lines: string[] = [];
  lines.push("# DH-0060 TUI overnight verification — comprehensive report");
  lines.push("");
  lines.push(
    `Generated by \`e2e/spikes/tui/run-all.ts\` — ${startedAt.toISOString()} to ${finishedAt.toISOString()} (${((finishedAt.getTime() - startedAt.getTime()) / 1000).toFixed(1)}s).`,
  );
  lines.push("");
  lines.push(
    'Every DH-0060 Test Plan item is listed below by name with its verdict and the actual captured tmux pane text ("text screenshot") used to reach it — this file is readable standalone, with no other file needed.',
  );
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  lines.push("| # | Test Plan item | Verdict |");
  lines.push("| --- | --- | --- |");
  results.forEach((r, i) => {
    const shortItem =
      r.testPlanItem.length > 100 ? `${r.testPlanItem.slice(0, 97)}...` : r.testPlanItem;
    lines.push(`| ${i + 1} | ${shortItem.replace(/\|/g, "\\|")} | ${verdictBadge(r.verdict)} |`);
  });
  lines.push("");
  const passCount = results.filter((r) => r.verdict === "PASS").length;
  const failCount = results.filter((r) => r.verdict === "FAIL").length;
  const heuristicPass = results.filter((r) => r.verdict === "HEURISTIC-PASS").length;
  const heuristicFail = results.filter((r) => r.verdict === "HEURISTIC-FAIL").length;
  const outOfScope = results.filter((r) => r.verdict === "OUT-OF-SCOPE").length;
  lines.push(
    `**${passCount} PASS, ${failCount} FAIL, ${heuristicPass} HEURISTIC-PASS, ${heuristicFail} HEURISTIC-FAIL, ${outOfScope} OUT-OF-SCOPE** (${results.length} Test Plan items total).`,
  );
  lines.push("");
  lines.push("## Detail (every item, verdict, and evidence)");
  lines.push("");
  results.forEach((r, i) => {
    lines.push(`### ${i + 1}. ${r.testPlanItem}`);
    lines.push("");
    lines.push(`**Verdict:** ${verdictBadge(r.verdict)}`);
    lines.push("");
    lines.push(`**Summary:** ${r.summary}`);
    lines.push("");
    lines.push("<details><summary>Captured evidence (click to expand)</summary>");
    lines.push("");
    lines.push("```");
    lines.push(r.evidence.trimEnd());
    lines.push("```");
    lines.push("");
    lines.push("</details>");
    lines.push("");
  });
  return lines.join("\n");
}

// ---------------------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------------------

function parseOutPath(argv: string[]): string {
  const idx = argv.indexOf("--out");
  if (idx !== -1 && argv[idx + 1]) return argv[idx + 1] as string;
  return `${REPO_ROOT}e2e/spikes/tui/REPORT.md`;
}

const startedAt = new Date();
const outPath = parseOutPath(process.argv.slice(2));

console.log("DH-0060 orchestrator: running scripted spikes...");
const scriptedResults = await runScriptedSpikes();
console.log(
  `  ${scriptedResults.length} Test Plan items covered by ${SPIKE_MAPPINGS.length} scripted spikes.`,
);

console.log("DH-0060 orchestrator: driving Mode B scenario 'liveness-heartbeat'...");
const livenessResult = await runLivenessScenario();
console.log(`  ${livenessResult.verdict}`);

console.log("DH-0060 orchestrator: driving Mode B scenario 'resize-flicker'...");
const resizeResult = await runResizeScenario();
console.log(`  ${resizeResult.verdict}`);

const allResults = [...scriptedResults, livenessResult, resizeResult, ...OUT_OF_SCOPE];
const finishedAt = new Date();

const report = buildReport(allResults, startedAt, finishedAt);
await Bun.write(outPath, report);
console.log(`\nReport written to ${outPath}`);

const hardFailures = allResults.filter((r) => r.verdict === "FAIL");
console.log(
  `\n=== DH-0060 ORCHESTRATOR SUMMARY: ${allResults.length} items, ${hardFailures.length} hard FAIL ===`,
);
for (const r of allResults) {
  console.log(`[${r.verdict}] ${r.testPlanItem}`);
}

process.exit(hardFailures.length === 0 ? 0 : 1);
