// DH-0174: small coverage-completeness companion to cli.test.ts (deliberately not modifying
// that file, per the ticket's "test-neutral" split constraint) for two branches that moving
// code out of the monolithic src/cli.ts left without a dedicated real-invocation test:
//   - `--result-only` without `--job` (args.ts's own "requires --job" usage-error branch,
//     the `--result-only` sibling of the existing "--json without --job" test).
//   - the standalone `--job` path's best-effort `summary.json` write-failure catch (main()'s
//     own `writeSessionSummary` try/catch in src/cli.ts) — the existing summary.json test only
//     exercises the success path.
import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CliDeps, CliIo } from "./cli/deps.ts";
import { readEnvFile } from "./cli/env-file.ts";
import { CliUsageError, main, parseArgs } from "./cli.ts";
import { ExitCode } from "./contracts/index.ts";

function fakeIo(): CliIo & { stdoutLines: string[]; stderrLines: string[]; exitCodes: number[] } {
  const stdoutLines: string[] = [];
  const stderrLines: string[] = [];
  const exitCodes: number[] = [];
  return {
    stdout: (m) => stdoutLines.push(m),
    stderr: (m) => stderrLines.push(m),
    exit: (c) => exitCodes.push(c),
    stdoutLines,
    stderrLines,
    exitCodes,
  };
}

describe("DH-0174 split — args.ts --result-only validation", () => {
  test("--result-only without --job is a usage error", () => {
    expect(() => parseArgs(["--instructions", "plan.md", "--result-only"])).toThrow(CliUsageError);
    expect(() => parseArgs(["--instructions", "plan.md", "--result-only"])).toThrow(
      /--result-only requires --job/,
    );
  });
});

describe("DH-0174 split — env-file.ts's real readEnvFile", () => {
  test("a missing env file throws a ConfigError naming the path", async () => {
    await expect(readEnvFile("/definitely/does/not/exist.env")).rejects.toThrow(
      /env file not found: \/definitely\/does\/not\/exist\.env/,
    );
  });
});

describe("DH-0174 split — main()'s best-effort summary.json write-failure catch", () => {
  test("a summary.json write failure is reported to stderr but doesn't change the run's exit code", async () => {
    const dir = await mkdtemp(join(tmpdir(), "dh-cli-summary-fail-"));
    const originalCwd = process.cwd();
    process.chdir(dir);
    try {
      const io = fakeIo();
      const overrides: Partial<CliDeps> = {
        loadConfig: async () => ({
          options: { defaultModel: "mock-model" },
          models: [{ name: "mock-model", provider: "mock", model: "mock-1" }],
          provider: [{ name: "mock", type: "anthropic", apiKey: "sk-test" }],
        }),
        loadSystemPrompt: async () => "sp",
        readInstructions: async () => "do the thing",
        io,
        // DH-0011: no real process.on listeners in a unit test.
        installSignalHandlers: () => () => {},
        // No real .dh-logs/<sessionId> directory is ever created for this fake sessionId —
        // writeSessionSummary's real writeFileSync (src/server/summary.ts) throws ENOENT
        // trying to write into a directory that was never created, exercising main()'s own
        // best-effort catch around it.
        createRuntime: () => ({
          sessionId: "session-with-no-real-log-dir",
          runRoot: async () => ({ success: true, finalOutput: "done", turns: 1 }),
          stopRoot: () => {},
        }),
      };
      const code = await main(["--instructions", "plan.md", "--job"], overrides);
      expect(code).toBe(ExitCode.Success);
      expect(io.stderrLines.some((line) => line.includes("failed to write summary.json"))).toBe(
        true,
      );
    } finally {
      process.chdir(originalCwd);
      await rm(dir, { recursive: true, force: true });
    }
  });
});
