#!/usr/bin/env bun
// DH-0149: per-file process-isolation test orchestrator.
//
// Replaces the old shared-process `bun test src --parallel=1 [--coverage ...]`
// invocation. Running all test files in one OS process let module-load-order
// state bleed between unrelated files (the mechanism behind the "Cannot access
// 'Yoga' before initialization" Ink/yoga-layout crash — see DH-0145/DH-0146).
// This script spawns each `src/**/*.test.ts(x)` file as its own `bun test`
// process, so no two test files ever share a module graph.
//
// No batching/grouping of multiple files per process: per-file startup
// overhead is trivial (~12-35ms measured, ~3.6s aggregate across the whole
// suite) relative to real parallelism, and batching would reintroduce the same
// class of module-order bleed at smaller scale. See DH-0149 Functional
// Requirement 1.
//
// Usage:
//   bun scripts/test-isolated.ts              # plain run, no coverage (mirrors old `test`)
//   bun scripts/test-isolated.ts --coverage    # with coverage + lcov merge (mirrors old `test:coverage`)
//
// Concurrency defaults to os.cpus().length, overridable via TEST_ISOLATED_CONCURRENCY.

import { mkdir, rm } from "node:fs/promises";
import { cpus } from "node:os";
import { join } from "node:path";
import { Glob } from "bun";

const COVERAGE_ROOT = "coverage";
const PARTS_ROOT = join(COVERAGE_ROOT, "parts");
const MERGED_LCOV = join(COVERAGE_ROOT, "lcov.info");

function sanitizeForDirName(relPath: string): string {
  return relPath.replace(/[\\/]/g, "__").replace(/\.\./g, "__");
}

async function findTestFiles(): Promise<string[]> {
  const glob = new Glob("src/**/*.test.{ts,tsx}");
  const files: string[] = [];
  for await (const file of glob.scan(".")) {
    files.push(file);
  }
  return files.sort();
}

interface ChildResult {
  file: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  lcovPart: string | null;
}

async function runOne(file: string, withCoverage: boolean): Promise<ChildResult> {
  const args = ["test", file];
  let lcovPart: string | null = null;

  if (withCoverage) {
    const partDir = join(PARTS_ROOT, sanitizeForDirName(file));
    lcovPart = join(partDir, "lcov.info");
    args.push("--coverage", "--coverage-reporter=lcov", `--coverage-dir=${partDir}`);
  }

  const proc = Bun.spawn(["bun", ...args], {
    stdout: "pipe",
    stderr: "pipe",
    env: process.env,
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  return { file, exitCode, stdout, stderr, lcovPart };
}

async function runPool(
  files: string[],
  concurrency: number,
  withCoverage: boolean,
): Promise<ChildResult[]> {
  const results: ChildResult[] = new Array(files.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (true) {
      const i = nextIndex++;
      if (i >= files.length) return;
      results[i] = await runOne(files[i], withCoverage);
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, files.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

// DH-0150: Bun's per-file lcov line data is execution-path-dependent, not a
// static property of the source file. A function a given test file never
// executes falls back to marking every physical line — including comments —
// as `DA:line,0`; a function it does execute gets real basic-block data that
// omits comment lines. Plain `lcov -a` unions the *worst* (most
// comment-polluted) line set per file across all merged parts, inflating LF
// and tanking the reported percentage even though the union of *hit* lines
// was always correct. Fix: per source file, take the DA line-set from the
// part with the maximum LH (most executed, cleanest data) as the
// authoritative set of instrumentable lines, then mark a line hit if any
// part reports it hit. This also preserves LF:0 records for type-only files
// instead of `lcov -a --ignore-errors empty` silently dropping them.
interface FileCoverage {
  /** line number -> hit count, from this one part's DA records */
  lines: Map<number, number>;
  /** this part's own reported LH for the file */
  lh: number;
}

async function parseLcovParts(path: string): Promise<Map<string, FileCoverage>> {
  const text = await Bun.file(path).text();
  const files = new Map<string, FileCoverage>();
  let currentFile: string | null = null;
  let currentLines: Map<number, number> = new Map();
  let currentLH = 0;

  for (const line of text.split("\n")) {
    if (line.startsWith("SF:")) {
      currentFile = line.slice(3).trim();
      currentLines = new Map();
      currentLH = 0;
    } else if (line.startsWith("DA:")) {
      const [lineNumStr, hitStr] = line.slice(3).split(",");
      const lineNum = Number.parseInt(lineNumStr ?? "", 10);
      const hit = Number.parseInt(hitStr ?? "", 10);
      if (Number.isFinite(lineNum) && Number.isFinite(hit)) {
        currentLines.set(lineNum, (currentLines.get(lineNum) ?? 0) + hit);
      }
    } else if (line.startsWith("LH:")) {
      currentLH = Number.parseInt(line.slice(3).trim(), 10);
    } else if (line.startsWith("end_of_record")) {
      if (currentFile !== null) {
        files.set(currentFile, { lines: currentLines, lh: currentLH });
      }
      currentFile = null;
    }
  }

  return files;
}

async function mergeLcov(parts: string[]): Promise<void> {
  const existingParts: string[] = [];
  for (const part of parts) {
    if (await Bun.file(part).exists()) {
      existingParts.push(part);
    }
  }

  if (existingParts.length === 0) {
    console.error("::error::No per-file lcov.info parts were produced — nothing to merge.");
    process.exitCode = 1;
    return;
  }

  const perFile = new Map<string, FileCoverage[]>();
  for (const part of existingParts) {
    const parsed = await parseLcovParts(part);
    for (const [file, cov] of parsed) {
      const arr = perFile.get(file);
      if (arr) {
        arr.push(cov);
      } else {
        perFile.set(file, [cov]);
      }
    }
  }

  const output: string[] = [];
  let totalLF = 0;
  let totalLH = 0;

  for (const file of [...perFile.keys()].sort()) {
    const covs = perFile.get(file) as FileCoverage[];

    let authoritative = covs[0] as FileCoverage;
    for (const cov of covs) {
      if (cov.lh > authoritative.lh) authoritative = cov;
    }

    const hitLines = new Set<number>();
    for (const cov of covs) {
      for (const [ln, hits] of cov.lines) {
        if (hits > 0) hitLines.add(ln);
      }
    }

    const authoritativeLines = [...authoritative.lines.keys()].sort((a, b) => a - b);
    let fileLF = 0;
    let fileLH = 0;
    output.push("TN:", `SF:${file}`, "FNF:0", "FNH:0");
    for (const ln of authoritativeLines) {
      const hit = hitLines.has(ln) ? 1 : 0;
      output.push(`DA:${ln},${hit}`);
      fileLF += 1;
      fileLH += hit;
    }
    output.push(`LF:${fileLF}`, `LH:${fileLH}`, "end_of_record");

    totalLF += fileLF;
    totalLH += fileLH;
  }

  await Bun.write(MERGED_LCOV, `${output.join("\n")}\n`);

  const pct = totalLF > 0 ? ((totalLH / totalLF) * 100).toFixed(2) : "0.00";
  console.log(`Merged coverage: lines=${pct}% (${totalLH}/${totalLF})`);

  // Print a readable human summary via the real lcov CLI (informational only —
  // gate.yml's own LH/LF sum over coverage/lcov.info is authoritative for the gate).
  const summaryProc = Bun.spawn(["lcov", "--summary", MERGED_LCOV], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const [summaryOut, summaryErr] = await Promise.all([
    new Response(summaryProc.stdout).text(),
    new Response(summaryProc.stderr).text(),
  ]);
  await summaryProc.exited;
  if (summaryOut) console.log(summaryOut);
  if (summaryErr) console.error(summaryErr);
}

async function main(): Promise<void> {
  const withCoverage = process.argv.includes("--coverage");
  const concurrencyEnv = process.env.TEST_ISOLATED_CONCURRENCY;
  const concurrency = concurrencyEnv ? Number.parseInt(concurrencyEnv, 10) : cpus().length;

  if (!Number.isFinite(concurrency) || concurrency < 1) {
    console.error(`::error::Invalid TEST_ISOLATED_CONCURRENCY value: ${concurrencyEnv}`);
    process.exit(2);
  }

  // Fresh state: clean up any previous per-file coverage parts.
  await rm(PARTS_ROOT, { recursive: true, force: true });
  if (withCoverage) {
    await mkdir(PARTS_ROOT, { recursive: true });
  }

  const files = await findTestFiles();
  if (files.length === 0) {
    console.error("::error::No src/**/*.test.ts(x) files found.");
    process.exit(2);
  }

  console.log(
    `Running ${files.length} test file(s) in isolated processes (concurrency=${concurrency}, coverage=${withCoverage})...`,
  );

  const results = await runPool(files, concurrency, withCoverage);

  const failed = results.filter((r) => r.exitCode !== 0);
  const passed = results.filter((r) => r.exitCode === 0);

  console.log("");
  console.log("=== Per-file summary ===");
  for (const r of results) {
    console.log(`${r.exitCode === 0 ? "PASS" : "FAIL"}  ${r.file}`);
  }

  if (failed.length > 0) {
    console.log("");
    console.log(`=== ${failed.length} failed file(s) — output ===`);
    for (const r of failed) {
      console.log("");
      console.log(`----- ${r.file} (exit ${r.exitCode}) -----`);
      if (r.stdout) console.log(r.stdout);
      if (r.stderr) console.error(r.stderr);
    }
  }

  if (withCoverage) {
    // Merge whatever coverage exists even on failure, so partial data isn't lost.
    const parts = results.filter((r) => r.lcovPart).map((r) => r.lcovPart as string);
    await mergeLcov(parts);
  }

  console.log("");
  console.log(`=== Result: ${passed.length}/${results.length} passed ===`);

  if (failed.length > 0) {
    process.exitCode = 1;
  }
}

await main();
