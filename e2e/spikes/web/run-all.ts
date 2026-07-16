// DH-0061 orchestrator: runs every spike script in sequence, collects each scenario's
// screenshot and PASS/FAIL/EXPECTED-FAIL verdict, and writes one comprehensive, standalone
// HTML report (`e2e/spikes/web/REPORT.html`) enumerating every Test Plan item from the
// ticket by name, its verdict, and its actual screenshot embedded inline (base64 data URI —
// not just linked, so the report is readable with nothing else open, per the ticket's
// 2026-07-15 owner requirement).
//
// Not a gated e2e test (deliberately not named `*.test.ts`) — this is the overnight
// orchestrator itself. Each spike is spawned as its own `bun <script>.ts` subprocess (not
// imported/inlined) so a crash in one spike (uncaught exception, `process.exit`) can never
// take down the run for the rest — exactly the isolation an unattended overnight run needs.
//
// Run from the repo root:   bun e2e/spikes/web/run-all.ts
// Exit code 0 iff every spike's hard checks passed (matches each spike's own convention).

import { readFileSync } from "node:fs";
import { extname, resolve } from "node:path";
import { ARTIFACTS_DIR, artifactPath } from "./support.ts";

interface SpikeSpec {
  script: string;
  /** Test Plan item(s) (verbatim from tracking/DH-0061-*.md) this spike is evidence for. */
  testPlanItems: string[];
}

// One entry per spike script. Several spikes are evidence for more than one Test Plan item
// (e.g. spike-transcript covers both "transcript shows user+assistant" and "token/cost
// display"); a Test Plan item can also be covered by more than one spike (token/cost
// *accumulation across turns* is spike-multi-turn's job, *display* is spike-transcript's) —
// the report below aggregates by item, not just by script.
const SPIKES: SpikeSpec[] = [
  {
    script: "spike-transcript.ts",
    testPlanItems: [
      "Transcript shows both the user's own sent messages and the assistant's responses, clearly delineated.",
      "Per-agent status (running/waiting/done/failed/stopped) shows the correct label/color and updates live as an agent transitions.",
      "Token/cost figures display per-agent and as a session total.",
    ],
  },
  {
    script: "spike-agent-tree.ts",
    testPlanItems: [
      "Agent tree renders parent/child spawn hierarchy correctly as sub-agents are created.",
      "Per-agent status (running/waiting/done/failed/stopped) shows the correct label/color and updates live as an agent transitions.",
    ],
  },
  {
    script: "spike-liveness.ts",
    testPlanItems: [
      "Liveness/heartbeat indicator updates during a long-running turn (doesn't look frozen).",
    ],
  },
  {
    script: "spike-multi-turn.ts",
    testPlanItems: [
      "Sending a second message after the agent pauses (waiting) continues the same conversation, not a fresh one.",
      "Token/cost figures accumulate correctly across multiple turns.",
    ],
  },
  {
    script: "spike-reconnect.ts",
    testPlanItems: [
      "SSE reconnect: killing/restarting the server mid-session triggers a visible reconnect indicator, then resumes without duplicating or losing transcript content (DH-0024).",
    ],
  },
  {
    script: "spike-log-download.ts",
    testPlanItems: ["Log download works and produces a valid file."],
  },
  {
    script: "spike-markdown.ts",
    testPlanItems: [
      "DH-0056: assistant output renders real HTML formatting via sanitized DOM — never raw Markdown syntax, never raw HTML from model output, links open safely.",
    ],
  },
  {
    script: "spike-accessibility.ts",
    testPlanItems: [
      "DH-0029: keyboard-only navigation reaches the agent list; ARIA live regions announce status changes; 'stopped' has a distinct color from 'failed'/'done'; errors persist in a visible history.",
    ],
  },
  {
    script: "spike-headers.ts",
    testPlanItems: [
      "DH-0023: CORS/CSP/clickjacking headers are present on responses (verified via network inspection).",
    ],
  },
];

// Test Plan items with no spike at all — reported explicitly so the report is honest about
// its own coverage boundary rather than silently omitting them (CLAUDE.md §8's "no silent
// truncation" rule).
const OUT_OF_SCOPE_ITEMS: { item: string; reason: string }[] = [
  {
    item: "DH-0044 (once implemented): a long assistant turn's text visibly streams incrementally rather than appearing all at once when the turn completes.",
    reason:
      "DH-0044 (streaming) is not yet implemented in the product — the ticket itself calls this out as deferred until it ships.",
  },
  {
    item: "DH-0012: 50-entry eviction threshold — can't be visually verified in a short session.",
    reason:
      "Explicitly out-of-scope per the ticket's own Test Plan section; covered by unit tests instead, not by this Playwright suite.",
  },
];

interface ScriptCheck {
  level: "PASS" | "FAIL" | "EXPECTED-FAIL";
  text: string;
}

interface ScriptRun {
  script: string;
  checks: ScriptCheck[];
  verdict: "PASS" | "FAIL" | "CRASH";
  resultLine: string;
  screenshot: string | null;
  durationMs: number;
  stdout: string;
  stderr: string;
}

function parseCheckLine(line: string): ScriptCheck | null {
  const m = /^\[(PASS|FAIL|EXPECTED-FAIL)\]\s(.+)$/.exec(line);
  if (!m) return null;
  return { level: m[1] as ScriptCheck["level"], text: m[2] ?? "" };
}

async function runSpike(script: string): Promise<ScriptRun> {
  const start = Date.now();
  const proc = Bun.spawn({
    cmd: ["bun", `${import.meta.dir}/${script}`],
    cwd: process.cwd(),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  const durationMs = Date.now() - start;

  const checks: ScriptCheck[] = [];
  for (const line of stdout.split("\n")) {
    const check = parseCheckLine(line);
    if (check) checks.push(check);
  }
  const resultLine = stdout.split("\n").find((l) => l.startsWith("RESULT:")) ?? "";
  const screenshotMatch = /screenshot: (\S+\.png)/.exec(resultLine);
  let screenshot = screenshotMatch?.[1] ?? null;
  if (!screenshot) {
    // The script may have crashed before printing a RESULT line at all (e.g. a thrown error
    // outside its own try/catch, or a Chromium launch failure) — its error-path screenshot
    // convention (`<script>-error.png`) still gives the overnight run something to look at.
    const guess = artifactPath(`${script.replace(/\.ts$/, "")}-error.png`);
    screenshot = existsSyncQuiet(guess) ? guess : null;
  }

  const verdict: ScriptRun["verdict"] = resultLine.startsWith("RESULT: PASS")
    ? "PASS"
    : resultLine.startsWith("RESULT: FAIL")
      ? "FAIL"
      : "CRASH";

  if (verdict === "CRASH" && exitCode !== 0 && checks.length === 0) {
    checks.push({
      level: "FAIL",
      text: `script exited with code ${exitCode} before printing any [PASS]/[FAIL] lines or a RESULT: line — see stderr in the report`,
    });
  }

  return { script, checks, verdict, resultLine, screenshot, durationMs, stdout, stderr };
}

function existsSyncQuiet(path: string): boolean {
  try {
    readFileSync(path);
    return true;
  } catch {
    return false;
  }
}

function toDataUri(pngPath: string | null): string | null {
  if (!pngPath) return null;
  try {
    const bytes = readFileSync(pngPath);
    const ext = extname(pngPath).slice(1) || "png";
    return `data:image/${ext};base64,${bytes.toString("base64")}`;
  } catch {
    return null;
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function main() {
  console.log(`DH-0061 overnight web verification run — ${SPIKES.length} spikes`);
  console.log(`Artifacts dir: ${ARTIFACTS_DIR}\n`);

  const runs: ScriptRun[] = [];
  for (const spec of SPIKES) {
    console.log(`--- running ${spec.script} ---`);
    const run = await runSpike(spec.script);
    console.log(run.stdout.trimEnd());
    if (run.verdict === "CRASH") console.log(`stderr:\n${run.stderr}`);
    runs.push(run);
    console.log("");
  }

  // Aggregate per Test Plan item: an item is PASS iff every contributing script's hard
  // checks all passed; FAIL if any contributing script's verdict was FAIL/CRASH.
  interface ItemRow {
    item: string;
    scripts: { script: string; verdict: ScriptRun["verdict"]; screenshot: string | null }[];
    overall: "PASS" | "FAIL";
  }
  const itemRows = new Map<string, ItemRow>();
  for (const spec of SPIKES) {
    const run = runs.find((r) => r.script === spec.script);
    if (!run) continue;
    for (const item of spec.testPlanItems) {
      const row = itemRows.get(item) ?? { item, scripts: [], overall: "PASS" };
      row.scripts.push({ script: spec.script, verdict: run.verdict, screenshot: run.screenshot });
      if (run.verdict !== "PASS") row.overall = "FAIL";
      itemRows.set(item, row);
    }
  }

  const overallPass = runs.every((r) => r.verdict === "PASS");
  const passCount = runs.filter((r) => r.verdict === "PASS").length;

  const html = renderReport({ runs, itemRows: [...itemRows.values()], overallPass, passCount });
  const reportPath = resolve(ARTIFACTS_DIR, "..", "REPORT.html");
  await Bun.write(reportPath, html);
  console.log(`\nReport written to: ${reportPath}`);
  console.log(
    `RESULT: ${overallPass ? "PASS" : "FAIL"} (${passCount}/${runs.length} spikes fully passed)`,
  );
  process.exit(overallPass ? 0 : 1);
}

function renderReport(data: {
  runs: ScriptRun[];
  itemRows: {
    item: string;
    scripts: { script: string; verdict: ScriptRun["verdict"]; screenshot: string | null }[];
    overall: "PASS" | "FAIL";
  }[];
  overallPass: boolean;
  passCount: number;
}): string {
  const { runs, itemRows, overallPass, passCount } = data;
  const now = new Date().toISOString();

  const summaryRows = itemRows
    .map((row) => {
      const scriptsList = row.scripts
        .map((s) => `${escapeHtml(s.script)} (${s.verdict})`)
        .join(", ");
      return `<tr class="${row.overall === "PASS" ? "row-pass" : "row-fail"}">
        <td>${escapeHtml(row.item)}</td>
        <td class="verdict">${row.overall}</td>
        <td>${scriptsList}</td>
      </tr>`;
    })
    .join("\n");

  const outOfScopeRows = OUT_OF_SCOPE_ITEMS.map(
    (o) => `<tr class="row-skip">
      <td>${escapeHtml(o.item)}</td>
      <td class="verdict">OUT OF SCOPE</td>
      <td>${escapeHtml(o.reason)}</td>
    </tr>`,
  ).join("\n");

  const scriptSections = runs
    .map((run) => {
      const dataUri = toDataUri(run.screenshot);
      const checksHtml = run.checks
        .map(
          (c) =>
            `<li class="check-${c.level.toLowerCase()}">[${c.level}] ${escapeHtml(c.text)}</li>`,
        )
        .join("\n");
      const img = dataUri
        ? `<img src="${dataUri}" alt="${escapeHtml(run.script)} screenshot" loading="lazy" />`
        : `<p class="no-screenshot">No screenshot captured for this run.</p>`;
      const stderrBlock =
        run.verdict === "CRASH" && run.stderr.trim().length > 0
          ? `<details><summary>stderr</summary><pre>${escapeHtml(run.stderr)}</pre></details>`
          : "";
      return `<section class="script-run">
        <h3 class="verdict-${run.verdict.toLowerCase()}">${escapeHtml(run.script)} — ${run.verdict} (${run.durationMs}ms)</h3>
        <p class="result-line">${escapeHtml(run.resultLine || "(no RESULT: line printed)")}</p>
        <ul class="checks">${checksHtml}</ul>
        ${stderrBlock}
        <div class="screenshot">${img}</div>
      </section>`;
    })
    .join("\n");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>DH-0061 Web Overnight Verification Report</title>
<style>
  body { font-family: system-ui, sans-serif; max-width: 1100px; margin: 2rem auto; padding: 0 1rem; color: #1a1a1a; background: #fff; }
  @media (prefers-color-scheme: dark) { body { background: #14161a; color: #e8e8e8; } table { border-color: #333 !important; } th { background: #22252b !important; } tr.row-pass { background: #133018 !important; } tr.row-fail { background: #3a1418 !important; } tr.row-skip { background: #262626 !important; } .script-run { border-color: #333 !important; } img { border-color: #333 !important; } code, pre { background: #22252b !important; } }
  h1 { font-size: 1.6rem; }
  h2 { margin-top: 2.5rem; border-bottom: 2px solid currentColor; padding-bottom: 0.3rem; }
  table { border-collapse: collapse; width: 100%; margin: 1rem 0; }
  th, td { border: 1px solid #999; padding: 0.5rem 0.7rem; text-align: left; vertical-align: top; }
  th { background: #eee; }
  tr.row-pass { background: #eaffef; }
  tr.row-fail { background: #ffecec; }
  tr.row-skip { background: #f2f2f2; }
  td.verdict { font-weight: bold; white-space: nowrap; }
  .banner { font-size: 1.2rem; font-weight: bold; padding: 0.8rem 1rem; border-radius: 6px; }
  .banner-pass { background: #d6ffe0; color: #0a5c1f; }
  .banner-fail { background: #ffd9d9; color: #7a0d0d; }
  .script-run { border: 1px solid #999; border-radius: 8px; padding: 1rem; margin: 1.2rem 0; }
  .checks { list-style: none; padding-left: 0; }
  .checks li { padding: 0.15rem 0; }
  .check-pass { color: #0a5c1f; }
  .check-fail { color: #b30000; font-weight: bold; }
  .check-expected-fail { color: #8a6d00; }
  .verdict-pass { color: #0a5c1f; }
  .verdict-fail, .verdict-crash { color: #b30000; }
  img { max-width: 100%; border: 1px solid #ccc; border-radius: 4px; margin-top: 0.5rem; }
  .result-line { font-family: monospace; font-size: 0.9rem; }
  pre { overflow-x: auto; padding: 0.6rem; background: #f5f5f5; border-radius: 4px; }
  .no-screenshot { font-style: italic; color: #888; }
</style>
</head>
<body>
<h1>DH-0061: Web Overnight Verification Report</h1>
<p>Generated ${escapeHtml(now)} by <code>e2e/spikes/web/run-all.ts</code>, driving the real
compiled <code>dh</code> binary against a mock Anthropic-compatible provider and a headless
Chromium — see <code>tracking/DH-0061-*.md</code> for the full ticket.</p>

<p class="banner ${overallPass ? "banner-pass" : "banner-fail"}">
  Overall: ${overallPass ? "PASS" : "FAIL"} — ${passCount}/${runs.length} spikes fully passed
</p>

<h2>Test Plan coverage (by acceptance criterion)</h2>
<table>
<thead><tr><th>Test Plan item</th><th>Verdict</th><th>Evidence (script(s) : verdict)</th></tr></thead>
<tbody>
${summaryRows}
${outOfScopeRows}
</tbody>
</table>

<h2>Per-scenario detail (checks + screenshot)</h2>
${scriptSections}

</body>
</html>
`;
}

await main();
