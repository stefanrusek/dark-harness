import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type CliDeps,
  type CliIo,
  CliUsageError,
  DEFAULT_PORT,
  DEFAULT_SYSTEM_PROMPT,
  composeMode,
  main,
  parseArgs,
} from "./cli.ts";
import type { DhConfig } from "./contracts/index.ts";
import { ExitCode } from "./contracts/index.ts";

const TEST_CONFIG: DhConfig = {
  options: { defaultModel: "sonnet" },
  models: [{ name: "sonnet", provider: "anthropic", model: "sonnet-5" }],
  provider: [{ name: "anthropic", type: "anthropic" }],
};

function fakeIo(): CliIo & { stdoutLines: string[]; stderrLines: string[]; exitCodes: number[] } {
  const stdoutLines: string[] = [];
  const stderrLines: string[] = [];
  const exitCodes: number[] = [];
  return {
    stdoutLines,
    stderrLines,
    exitCodes,
    stdout: (m) => stdoutLines.push(m),
    stderr: (m) => stderrLines.push(m),
    exit: (c) => exitCodes.push(c),
  };
}

function baseOverrides(io: CliIo): Partial<CliDeps> {
  return {
    loadConfig: async () => TEST_CONFIG,
    io,
  };
}

describe("parseArgs", () => {
  test("defaults when given no flags", () => {
    const options = parseArgs([]);
    expect(options).toEqual({
      web: false,
      server: false,
      connect: null,
      port: null,
      instructions: null,
      job: false,
      config: "dh.json",
    });
  });

  test("parses every documented flag together", () => {
    const options = parseArgs([
      "--web",
      "--server",
      "--job",
      "--connect",
      "example.com",
      "--port",
      "5050",
      "--instructions",
      "plan.md",
      "--config",
      "custom.json",
    ]);
    expect(options).toEqual({
      web: true,
      server: true,
      connect: "example.com",
      port: 5050,
      instructions: "plan.md",
      job: true,
      config: "custom.json",
    });
  });

  test("--connect without a value throws CliUsageError", () => {
    expect(() => parseArgs(["--connect"])).toThrow(CliUsageError);
    expect(() => parseArgs(["--connect"])).toThrow(/--connect requires a value/);
  });

  test("--port without a value throws CliUsageError", () => {
    expect(() => parseArgs(["--port"])).toThrow(CliUsageError);
  });

  test("--instructions without a value throws CliUsageError", () => {
    expect(() => parseArgs(["--instructions"])).toThrow(CliUsageError);
  });

  test("--config without a value throws CliUsageError", () => {
    expect(() => parseArgs(["--config"])).toThrow(CliUsageError);
  });

  test("--port with a non-integer value throws CliUsageError", () => {
    expect(() => parseArgs(["--port", "abc"])).toThrow(/positive integer/);
  });

  test("--port with a zero or negative value throws CliUsageError", () => {
    expect(() => parseArgs(["--port", "0"])).toThrow(/positive integer/);
    expect(() => parseArgs(["--port", "-5"])).toThrow(/positive integer/);
  });

  test("an unknown flag throws CliUsageError", () => {
    expect(() => parseArgs(["--nope"])).toThrow(/unknown flag: --nope/);
  });
});

describe("composeMode", () => {
  test("no flags composes local console mode", () => {
    expect(composeMode(parseArgs([]))).toEqual({ kind: "local", web: false });
  });

  test("--web composes local web mode", () => {
    expect(composeMode(parseArgs(["--web"]))).toEqual({ kind: "local", web: true });
  });

  test("--server composes headless server mode on the default port", () => {
    expect(composeMode(parseArgs(["--server"]))).toEqual({ kind: "server", port: DEFAULT_PORT });
  });

  test("--server --port overrides the listen port", () => {
    expect(composeMode(parseArgs(["--server", "--port", "9090"]))).toEqual({
      kind: "server",
      port: 9090,
    });
  });

  test("--connect composes console client mode on the default port", () => {
    expect(composeMode(parseArgs(["--connect", "host1"]))).toEqual({
      kind: "connect",
      host: "host1",
      port: DEFAULT_PORT,
      web: false,
    });
  });

  test("--connect --web --port composes web client mode with an overridden port", () => {
    expect(composeMode(parseArgs(["--connect", "host1", "--web", "--port", "9999"]))).toEqual({
      kind: "connect",
      host: "host1",
      port: 9999,
      web: true,
    });
  });

  test("--connect takes precedence over --server", () => {
    expect(composeMode(parseArgs(["--connect", "host1", "--server"]))).toEqual({
      kind: "connect",
      host: "host1",
      port: DEFAULT_PORT,
      web: false,
    });
  });
});

describe("main", () => {
  test("a usage error returns HarnessError without touching config", async () => {
    const io = fakeIo();
    const code = await main(["--nope"], baseOverrides(io));
    expect(code).toBe(ExitCode.HarnessError);
    expect(io.exitCodes).toEqual([ExitCode.HarnessError]);
    expect(io.stderrLines[0]).toContain("unknown flag");
  });

  test("a config load failure returns HarnessError", async () => {
    const io = fakeIo();
    const code = await main([], {
      io,
      loadConfig: async () => {
        throw new Error("bad config");
      },
    });
    expect(code).toBe(ExitCode.HarnessError);
    expect(io.stderrLines[0]).toContain("bad config");
  });

  test("no --instructions runs the stubbed local console mode", async () => {
    const io = fakeIo();
    const code = await main([], baseOverrides(io));
    expect(code).toBe(ExitCode.Success);
    expect(io.exitCodes).toEqual([]);
    expect(io.stdoutLines[0]).toContain("console TUI");
  });

  test("--web runs the stubbed local web mode", async () => {
    const io = fakeIo();
    const code = await main(["--web"], baseOverrides(io));
    expect(code).toBe(ExitCode.Success);
    expect(io.stdoutLines[0]).toContain("web UI");
  });

  test("--server runs the stubbed headless server mode with the resolved port", async () => {
    const io = fakeIo();
    const code = await main(["--server", "--port", "5050"], baseOverrides(io));
    expect(code).toBe(ExitCode.Success);
    expect(io.stdoutLines[0]).toContain("5050");
  });

  test("--server without --port stubs the default port", async () => {
    const io = fakeIo();
    await main(["--server"], baseOverrides(io));
    expect(io.stdoutLines[0]).toContain(String(DEFAULT_PORT));
  });

  test("--connect runs the stubbed console client mode", async () => {
    const io = fakeIo();
    const code = await main(["--connect", "example.com"], baseOverrides(io));
    expect(code).toBe(ExitCode.Success);
    expect(io.stdoutLines[0]).toContain("example.com");
    expect(io.stdoutLines[0]).toContain("console");
  });

  test("--connect --web runs the stubbed web client mode", async () => {
    const io = fakeIo();
    await main(["--connect", "example.com", "--web", "--port", "9000"], baseOverrides(io));
    expect(io.stdoutLines[0]).toContain("9000");
    expect(io.stdoutLines[0]).toContain("web");
  });

  test("--instructions with --connect is rejected as unsupported this round", async () => {
    const io = fakeIo();
    const code = await main(["--connect", "host1", "--instructions", "plan.md"], baseOverrides(io));
    expect(code).toBe(ExitCode.HarnessError);
    expect(io.stderrLines[0]).toContain("not supported with --connect");
  });

  test("a missing instructions file returns HarnessError", async () => {
    const io = fakeIo();
    const code = await main(["--instructions", "plan.md"], {
      ...baseOverrides(io),
      readInstructions: async () => {
        throw new Error("instructions file not found: plan.md");
      },
    });
    expect(code).toBe(ExitCode.HarnessError);
    expect(io.stderrLines[0]).toContain("instructions file not found");
  });

  test("a missing systemPrompt file returns HarnessError", async () => {
    const io = fakeIo();
    const code = await main(["--instructions", "plan.md"], {
      ...baseOverrides(io),
      readInstructions: async () => "do the thing",
      loadSystemPrompt: async () => {
        throw new Error("systemPrompt file not found: nope.md");
      },
    });
    expect(code).toBe(ExitCode.HarnessError);
    expect(io.stderrLines[0]).toContain("systemPrompt file not found");
  });

  test("a root-agent crash returns HarnessError with a clear prefix", async () => {
    const io = fakeIo();
    const code = await main(["--instructions", "plan.md"], {
      ...baseOverrides(io),
      readInstructions: async () => "do the thing",
      loadSystemPrompt: async () => "sp",
      createRuntime: () => ({
        runRoot: async () => {
          throw new Error("boom");
        },
      }),
    });
    expect(code).toBe(ExitCode.HarnessError);
    expect(io.stderrLines[0]).toContain("root agent crashed");
    expect(io.stderrLines[0]).toContain("boom");
  });

  test("--job exits 0 and prints the final output when the root agent succeeds", async () => {
    const io = fakeIo();
    const code = await main(["--instructions", "plan.md", "--job"], {
      ...baseOverrides(io),
      readInstructions: async () => "do the thing",
      loadSystemPrompt: async () => "sp",
      createRuntime: () => ({ runRoot: async () => ({ success: true, finalOutput: "yay" }) }),
    });
    expect(code).toBe(ExitCode.Success);
    expect(io.exitCodes).toEqual([ExitCode.Success]);
    expect(io.stdoutLines).toContain("yay");
  });

  test("--job exits 1 when the root agent self-reports failure", async () => {
    const io = fakeIo();
    const code = await main(["--instructions", "plan.md", "--job"], {
      ...baseOverrides(io),
      readInstructions: async () => "do the thing",
      loadSystemPrompt: async () => "sp",
      createRuntime: () => ({ runRoot: async () => ({ success: false, finalOutput: "nope" }) }),
    });
    expect(code).toBe(ExitCode.TaskFailure);
    expect(io.exitCodes).toEqual([ExitCode.TaskFailure]);
  });

  test("without --job the process doesn't exit and falls through to the stubbed mode", async () => {
    const io = fakeIo();
    const code = await main(["--instructions", "plan.md"], {
      ...baseOverrides(io),
      readInstructions: async () => "do the thing",
      loadSystemPrompt: async () => "sp",
      createRuntime: () => ({ runRoot: async () => ({ success: true, finalOutput: "yay" }) }),
    });
    expect(code).toBe(ExitCode.Success);
    expect(io.exitCodes).toEqual([]);
    expect(io.stdoutLines).toEqual(["yay", expect.stringContaining("console TUI")]);
  });

  test("createRuntime is invoked with the loaded config and resolved system prompt", async () => {
    const io = fakeIo();
    let received: unknown;
    await main(["--instructions", "plan.md", "--job"], {
      ...baseOverrides(io),
      readInstructions: async () => "do the thing",
      loadSystemPrompt: async () => "resolved prompt",
      createRuntime: (config, systemPrompt) => {
        received = { config, systemPrompt };
        return { runRoot: async () => ({ success: true, finalOutput: "ok" }) };
      },
    });
    expect(received).toEqual({ config: TEST_CONFIG, systemPrompt: "resolved prompt" });
  });
});

describe("main — real filesystem-backed default deps", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "dh-cli-test-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test("the real readInstructions dep reads a real file from disk", async () => {
    const io = fakeIo();
    const instructionsPath = join(dir, "plan.md");
    await Bun.write(instructionsPath, "the real instruction text");
    let received: unknown;
    await main(["--instructions", instructionsPath, "--job"], {
      loadConfig: async () => TEST_CONFIG,
      loadSystemPrompt: async () => "sp",
      createRuntime: (_config, systemPrompt) => ({
        runRoot: async (instruction: string) => {
          received = { instruction, systemPrompt };
          return { success: true, finalOutput: "ok" };
        },
      }),
      io,
    });
    expect(received).toEqual({ instruction: "the real instruction text", systemPrompt: "sp" });
  });

  test("the real readInstructions dep reports a clear error when the file is missing", async () => {
    const io = fakeIo();
    const code = await main(["--instructions", join(dir, "missing.md")], {
      loadConfig: async () => TEST_CONFIG,
      io,
    });
    expect(code).toBe(ExitCode.HarnessError);
    expect(io.stderrLines[0]).toContain("instructions file not found");
  });

  test("the real loadSystemPrompt dep falls back to DEFAULT_SYSTEM_PROMPT when unset", async () => {
    const io = fakeIo();
    const instructionsPath = join(dir, "plan.md");
    await Bun.write(instructionsPath, "go");
    let received: unknown;
    await main(["--instructions", instructionsPath, "--job"], {
      loadConfig: async () => TEST_CONFIG,
      createRuntime: (_config, systemPrompt) => {
        received = systemPrompt;
        return { runRoot: async () => ({ success: true, finalOutput: "ok" }) };
      },
      io,
    });
    expect(received).toBe(DEFAULT_SYSTEM_PROMPT);
  });

  test("the real loadSystemPrompt dep reads the configured systemPrompt file", async () => {
    const io = fakeIo();
    const instructionsPath = join(dir, "plan.md");
    await Bun.write(instructionsPath, "go");
    const systemPromptPath = join(dir, "system.md");
    await Bun.write(systemPromptPath, "custom system prompt");
    let received: unknown;
    await main(["--instructions", instructionsPath, "--job"], {
      loadConfig: async () => ({ ...TEST_CONFIG, systemPrompt: systemPromptPath }),
      createRuntime: (_config, systemPrompt) => {
        received = systemPrompt;
        return { runRoot: async () => ({ success: true, finalOutput: "ok" }) };
      },
      io,
    });
    expect(received).toBe("custom system prompt");
  });

  test("the real loadSystemPrompt dep reports a clear error when the configured file is missing", async () => {
    const io = fakeIo();
    const instructionsPath = join(dir, "plan.md");
    await Bun.write(instructionsPath, "go");
    const code = await main(["--instructions", instructionsPath], {
      loadConfig: async () => ({ ...TEST_CONFIG, systemPrompt: join(dir, "nope.md") }),
      io,
    });
    expect(code).toBe(ExitCode.HarnessError);
    expect(io.stderrLines[0]).toContain("systemPrompt file not found");
  });

  test("the real createRuntime dep constructs an AgentRuntime and surfaces a real connection failure", async () => {
    const io = fakeIo();
    const instructionsPath = join(dir, "plan.md");
    await Bun.write(instructionsPath, "go");
    const code = await main(["--instructions", instructionsPath], {
      loadConfig: async () => ({
        options: { defaultModel: "sonnet" },
        models: [{ name: "sonnet", provider: "unreachable", model: "sonnet-5" }],
        provider: [{ name: "unreachable", type: "anthropic", baseURL: "http://127.0.0.1:1" }],
      }),
      loadSystemPrompt: async () => "sp",
      io,
    });
    expect(code).toBe(ExitCode.HarnessError);
    expect(io.stderrLines[0]).toContain("root agent crashed");
  });
});

describe("main — default io wired to console/process.exit", () => {
  test("the default stdout dep writes to console.log", async () => {
    const logSpy = spyOn(console, "log").mockImplementation(() => {});
    try {
      const code = await main([], { loadConfig: async () => TEST_CONFIG });
      expect(code).toBe(ExitCode.Success);
      expect(logSpy).toHaveBeenCalled();
    } finally {
      logSpy.mockRestore();
    }
  });

  test("the default stderr and exit deps write to console.error and process.exit", async () => {
    const errorSpy = spyOn(console, "error").mockImplementation(() => {});
    const originalExit = process.exit;
    let capturedCode: number | undefined;
    // biome-ignore lint/suspicious/noExplicitAny: overriding process.exit for a test double
    (process as any).exit = ((code?: number) => {
      capturedCode = code;
    }) as never;
    try {
      const code = await main(["--nope"]);
      expect(code).toBe(ExitCode.HarnessError);
      expect(capturedCode).toBe(ExitCode.HarnessError);
      expect(errorSpy).toHaveBeenCalled();
    } finally {
      process.exit = originalExit;
      errorSpy.mockRestore();
    }
  });
});
