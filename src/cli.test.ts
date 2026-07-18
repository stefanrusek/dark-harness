import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { readdirSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ROOT_AGENT_ID } from "./agent/agent-id.constant.ts";
import type { ModelProvider } from "./agent/providers/types.ts";
import {
  ActivityFeed,
  AgentRuntimeLoopAdapter,
  buildStartupPostureNote,
  type CliDeps,
  type CliIo,
  CliUsageError,
  composeMode,
  DEFAULT_PORT,
  type DhServerLike,
  formatDoctorReport,
  main,
  parseArgs,
  parseEnvFile,
  renderHelpText,
  SAMPLE_DH_JSON,
  type WebUiHandleLike,
} from "./cli.ts";
import { BUILD_INFO } from "./config/build-info.ts";
import type {
  DhConfig,
  JobResultLine,
  ProviderConfig,
  ServerSentEvent,
} from "./contracts/index.ts";
import { ExitCode } from "./contracts/index.ts";
import { buildHeaderInfo, formatHeaderLines, formatVersionString } from "./header-info.ts";
import { buildDefaultSystemPrompt, REQUIRED_CONTRACT } from "./prompt/system-prompt.ts";
import type { AgentLoopHandle, AgentLoopLogListener } from "./server/index.ts";
import { DhServer, waitForExitCode } from "./server/index.ts";

const TEST_CONFIG: DhConfig = {
  options: { defaultModel: "sonnet" },
  models: [{ name: "sonnet", provider: "anthropic", model: "sonnet-5" }],
  provider: [{ name: "anthropic", type: "anthropic" }],
};

/** DH-0122: every `main()` run now prints the shared app header first (see `printAppHeader`
 * in cli.ts) — these two helpers build the exact lines it prints for a given config on a
 * non-TTY (`compact`, no logo/color) and TTY (full logo, bold version line) stdout, so tests
 * asserting on `io.stdoutLines`/`process.stdout.write` calls can account for it without
 * hand-duplicating `formatHeaderLines`'s output. */
function expectedHeaderLines(config: DhConfig, configPath = "dh.json"): string[] {
  return formatHeaderLines(buildHeaderInfo(config, configPath, BUILD_INFO), { compact: true });
}
function expectedHeaderLinesTty(config: DhConfig, configPath = "dh.json"): string[] {
  const info = buildHeaderInfo(config, configPath, BUILD_INFO);
  return formatHeaderLines(info).map((line) =>
    line === formatVersionString(info.build) ? `\x1b[1m${line}\x1b[0m` : line,
  );
}

/** Builds a fake Anthropic-shaped SSE streaming HTTP response, matching what DH-0044's real
 * `AnthropicProvider` now decodes (`stream: true` always) — mirrors the identically-named
 * helper in `src/agent/runtime.test.ts`; see that file's doc comment for the full rationale. */
function sseMessageResponse(
  contentBlocks: ReadonlyArray<
    { type: "text"; text: string } | { type: "tool_use"; id: string; name: string; input?: unknown }
  >,
  stopReason: string,
  usage: { input_tokens: number; output_tokens: number } = { input_tokens: 5, output_tokens: 5 },
): Response {
  const events: { type: string; [key: string]: unknown }[] = [
    {
      type: "message_start",
      message: {
        id: "msg_mock",
        type: "message",
        role: "assistant",
        model: "mock",
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: usage.input_tokens, output_tokens: 0 },
      },
    },
  ];
  contentBlocks.forEach((block, index) => {
    if (block.type === "text") {
      events.push({
        type: "content_block_start",
        index,
        content_block: { type: "text", text: "", citations: null },
      });
      events.push({
        type: "content_block_delta",
        index,
        delta: { type: "text_delta", text: block.text },
      });
    } else {
      events.push({
        type: "content_block_start",
        index,
        content_block: { type: "tool_use", id: block.id, name: block.name, input: {} },
      });
      events.push({
        type: "content_block_delta",
        index,
        delta: { type: "input_json_delta", partial_json: JSON.stringify(block.input ?? {}) },
      });
    }
    events.push({ type: "content_block_stop", index });
  });
  events.push({
    type: "message_delta",
    delta: { stop_reason: stopReason, stop_sequence: null },
    usage: { output_tokens: usage.output_tokens },
  });
  events.push({ type: "message_stop" });

  const body = events.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join("");
  return new Response(body, {
    headers: { "content-type": "text/event-stream" },
  });
}

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

/** DH-0011: never install real `process.on("SIGTERM"/"SIGINT")` listeners from a test —
 * they'd leak across the whole suite (hundreds of never-removed listeners) and, worse, a
 * real Ctrl-C during a test run would call the *real* `process.exit` a defaultDeps()
 * installSignalHandlers wires up, killing the test runner outright. Tests that want to
 * exercise the shutdown behavior itself call `main()` with an explicit override capturing
 * the handler instead (see the dedicated describe block below). */
function fakeInstallSignalHandlers(): CliDeps["installSignalHandlers"] {
  return () => () => {};
}

function baseOverrides(io: CliIo): Partial<CliDeps> {
  return {
    loadConfig: async () => TEST_CONFIG,
    io,
    installSignalHandlers: fakeInstallSignalHandlers(),
  };
}

/** A minimal AgentLoopHandle fake — used everywhere the real Server/TUI/Web wiring would
 * otherwise open a real socket or block on real terminal I/O, which unit tests must avoid. */
function fakeAgentLoop(
  overrides: Partial<AgentLoopHandle> & { close?: () => Promise<void> } = {},
): AgentLoopHandle & { close?: () => Promise<void> } {
  return {
    onEvent: () => () => {},
    onLog: () => () => {},
    sendMessage: () => {},
    stopAgent: () => {},
    getAgentTree: () => [],
    listModels: () => [],
    switchModel: () => {},
    listSkills: () => [],
    invokeSkill: () => {},
    ...overrides,
  };
}

function fakeServer(overrides: Partial<DhServerLike> = {}): DhServerLike {
  return { start: () => 51234, stop: () => {}, ...overrides };
}

function fakeWebUi(overrides: Partial<WebUiHandleLike> = {}): WebUiHandleLike {
  return { url: "http://localhost:9999", stop: () => {}, ...overrides };
}

/** Overrides that make every interactive run mode (server/local/connect, web or console)
 * safe to drive in a unit test: no real sockets, no real terminal I/O. Individual tests
 * override specific fields with instrumented fakes to assert on call arguments. */
function interactiveOverrides(io: CliIo): Partial<CliDeps> {
  return {
    loadConfig: async () => TEST_CONFIG,
    createAgentLoop: () => fakeAgentLoop(),
    createServer: () => fakeServer(),
    startTui: async () => {},
    serveWebUi: () => fakeWebUi(),
    io,
    installSignalHandlers: fakeInstallSignalHandlers(),
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
      json: false,
      config: "dh.json",
      env: null,
      check: false,
      dryRun: false,
      resume: null,
      quiet: false,
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
      "--env",
      "secrets.env",
      "--check",
      "--dry-run",
      "--resume",
      "abc123",
      "--quiet",
    ]);
    expect(options).toEqual({
      web: true,
      server: true,
      connect: "example.com",
      port: 5050,
      instructions: "plan.md",
      job: true,
      json: false,
      config: "custom.json",
      env: "secrets.env",
      check: true,
      dryRun: true,
      resume: "abc123",
      quiet: true,
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

  test("--env without a value throws CliUsageError", () => {
    expect(() => parseArgs(["--env"])).toThrow(CliUsageError);
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

describe("main — dh logs <sessionDir>", () => {
  test("prints the agent tree and exits Success", async () => {
    const dir = await mkdtemp(join(tmpdir(), "dh-cli-logs-"));
    try {
      const header = {
        type: "header",
        version: 1,
        sessionId: "s1",
        agentId: "root",
        parentAgentId: null,
        spawnedAt: "2026-07-15T00:00:00.000Z",
        model: "claude",
        instructionsSummary: "test",
        client: "none",
        build: { version: "0.0.0", gitSha: null, dirty: false, releaseTag: null },
      };
      await Bun.write(join(dir, "root.jsonl"), `${JSON.stringify(header)}\n`);
      const io = fakeIo();
      const code = await main(["logs", dir], {
        io,
        loadConfig: async () => {
          throw new Error("dh logs must not load config");
        },
      });
      expect(code).toBe(ExitCode.Success);
      expect(io.exitCodes).toEqual([ExitCode.Success]);
      expect(io.stdoutLines[0]).toContain("root");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  // DH-0067: `dh logs` with no argument used to be a usage error, forcing the operator to
  // `ls .dh-logs` and copy a UUID by hand. It now lists sessions under `./.dh-logs` instead
  // — real filesystem, driven from a temp cwd (same `process.chdir` pattern the existing
  // "writes a real per-agent JSONL log" test above uses) so this isn't at the mercy of
  // whatever `.dh-logs` happens to already exist in the real working directory.
  test("no sessionDir lists sessions under ./.dh-logs instead of failing", async () => {
    const dir = await mkdtemp(join(tmpdir(), "dh-cli-logs-list-"));
    const originalCwd = process.cwd();
    process.chdir(dir);
    try {
      const logsRoot = join(dir, ".dh-logs");
      const sessionDir = join(logsRoot, "session-1");
      await Bun.write(
        join(sessionDir, "agent-root.jsonl"),
        `${JSON.stringify({
          version: 1,
          type: "header",
          sessionId: "session-1",
          agentId: "agent-root",
          parentAgentId: null,
          spawnedAt: "2026-01-01T00:00:00.000Z",
          model: "sonnet",
          instructionsSummary: "x",
          client: "server",
        })}\n`,
      );
      const io = fakeIo();
      const code = await main(["logs"], {
        io,
        loadConfig: async () => {
          throw new Error("dh logs must not load config");
        },
      });
      expect(code).toBe(ExitCode.Success);
      expect(io.stdoutLines[0]).toContain("session-1");
      expect(io.stdoutLines[0]).toContain("agents=1");
    } finally {
      process.chdir(originalCwd);
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("no sessionDir and no .dh-logs directory at all fails cleanly", async () => {
    const dir = await mkdtemp(join(tmpdir(), "dh-cli-logs-empty-"));
    const originalCwd = process.cwd();
    process.chdir(dir); // a fresh temp dir with no ".dh-logs" subdirectory at all.
    try {
      const io = fakeIo();
      const code = await main(["logs"], {
        io,
        loadConfig: async () => {
          throw new Error("dh logs must not load config");
        },
      });
      expect(code).toBe(ExitCode.HarnessError);
      expect(io.stderrLines[0]).toContain("cannot read logs directory");
    } finally {
      process.chdir(originalCwd);
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("fails cleanly when the session directory doesn't exist", async () => {
    const io = fakeIo();
    const code = await main(["logs", join(tmpdir(), "dh-cli-logs-does-not-exist-xyz")], {
      io,
      loadConfig: async () => {
        throw new Error("dh logs must not load config");
      },
    });
    expect(code).toBe(ExitCode.HarnessError);
    expect(io.stderrLines[0]).toContain("cannot read session log directory");
  });
});

describe("main — --help", () => {
  test("--help prints usage and exits Success without touching config", async () => {
    const io = fakeIo();
    const code = await main(["--help"], {
      io,
      loadConfig: async () => {
        throw new Error("--help must not load config");
      },
    });
    expect(code).toBe(ExitCode.Success);
    expect(io.exitCodes).toEqual([ExitCode.Success]);
    expect(io.stdoutLines[0]).toContain("dh — Dark Harness");
    expect(io.stdoutLines[0]).toContain("--help, -h");
  });

  test("-h behaves the same as --help", async () => {
    const io = fakeIo();
    const code = await main(["-h"], {
      io,
      loadConfig: async () => {
        throw new Error("-h must not load config");
      },
    });
    expect(code).toBe(ExitCode.Success);
  });
});

// biome-ignore lint/suspicious/noControlCharactersInRegex: stripping SGR codes for assertions.
const ANSI_RE = /\x1b\[[0-9;]*m/g;
function stripAnsi(text: string): string {
  return text.replace(ANSI_RE, "");
}

describe("renderHelpText — DH-0103 structured/width-aware layout", () => {
  test("wide terminal (120 cols): two-column layout, name+description present, hang-indented continuation", () => {
    const text = renderHelpText(120, false);
    const plain = stripAnsi(text);
    // Content preserved for every flag/subcommand.
    expect(plain).toContain("dh — Dark Harness");
    expect(plain).toContain("Usage:");
    expect(plain).toContain("Flags:");
    for (const name of ["--web", "--server", "--quiet", "--help, -h", "--version"]) {
      expect(plain).toContain(name);
    }
    expect(plain).toContain("Serve the web UI instead of");
    expect(plain).toContain("Config: dh.json in the working directory");

    // A wrapped multi-line description (--quiet) hang-indents its continuation line to the
    // description column, not back under the flag name.
    const lines = plain.split("\n");
    const quietIdx = lines.findIndex((l) => l.trimStart().startsWith("--quiet"));
    expect(quietIdx).toBeGreaterThan(-1);
    const quietLine = lines[quietIdx] as string;
    const descColumn = quietLine.length - quietLine.trimStart().length + "--quiet".length;
    // find the first continuation line (starts with spaces, no leading flag name, non-empty)
    const continuation = lines[quietIdx + 1] as string;
    expect(continuation.trim().length).toBeGreaterThan(0);
    const contIndent = continuation.length - continuation.trimStart().length;
    expect(contIndent).toBeGreaterThan(0);
    expect(contIndent).toBeGreaterThanOrEqual(2);
    void descColumn;
  });

  test("column width is computed from the longest name, not hardcoded", () => {
    const plain80 = stripAnsi(renderHelpText(80, false));
    const lines = plain80.split("\n");
    // The short "--web" flag and the long "--connect <host>" flag ("--resume <sessionId>" is
    // even longer and sets the column) must have their descriptions start at the same column
    // — proof the gutter is computed from the longest name present, not a fixed offset.
    const webLine = lines.find((l) => l.trim().startsWith("--web ")) as string;
    const connectLine = lines.find((l) => l.trim().startsWith("--connect <host> ")) as string;
    expect(webLine).toBeDefined();
    expect(connectLine).toBeDefined();
    const webDescCol = webLine.indexOf("Serve the web UI");
    const connectDescCol = connectLine.indexOf("Connect to a remote");
    expect(webDescCol).toBeGreaterThan(0);
    expect(webDescCol).toBe(connectDescCol);
  });

  test("narrow terminal (40 cols) degrades to single-column stacked form", () => {
    const plain = stripAnsi(renderHelpText(40, false));
    const lines = plain.split("\n");
    const webIdx = lines.findIndex((l) => l.trim() === "--web");
    expect(webIdx).toBeGreaterThan(-1);
    // In single-column mode the name is alone on its line; the description follows indented
    // on the next line(s).
    const nextLine = lines[webIdx + 1] as string;
    expect(nextLine.trim().length).toBeGreaterThan(0);
    expect(nextLine.startsWith("    ")).toBe(true);
    // Lines never exceed the requested width.
    for (const line of lines) {
      expect(line.length).toBeLessThanOrEqual(40);
    }
  });

  test("mid terminal (80 cols) wraps descriptions to the requested width", () => {
    const plain = stripAnsi(renderHelpText(80, false));
    for (const line of plain.split("\n")) {
      expect(line.length).toBeLessThanOrEqual(80);
    }
  });

  test("non-TTY output has zero ANSI even at a color-eligible width", () => {
    const text = renderHelpText(120, false);
    expect(text).toBe(stripAnsi(text));
  });

  test("TTY output is colorized: bold title, cyan/bold section headers, dim descriptions", () => {
    const text = renderHelpText(120, true);
    expect(text).toContain("\x1b[1mdh — Dark Harness");
    expect(text).toContain("\x1b[1;36mUsage:\x1b[0m");
    expect(text).toContain("\x1b[1;36mFlags:\x1b[0m");
    expect(text).toContain("\x1b[2m"); // some dim description text present
    expect(stripAnsi(text)).toContain("Local server + console TUI");
  });
});

describe("main — --version", () => {
  test("--version prints build identity and exits Success without touching config", async () => {
    const io = fakeIo();
    const code = await main(["--version"], {
      io,
      loadConfig: async () => {
        throw new Error("--version must not load config");
      },
    });
    expect(code).toBe(ExitCode.Success);
    expect(io.exitCodes).toEqual([ExitCode.Success]);
    expect(io.stdoutLines[0]).toMatch(/^dh \d+\.\d+\.\d+ \(/);
  });

  // DH-0101: light emphasis (bold "dh") on a TTY.
  test("TTY: the leading app name is bolded", async () => {
    const isTTYDescriptor = Object.getOwnPropertyDescriptor(process.stdout, "isTTY");
    Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });
    try {
      const io = fakeIo();
      const code = await main(["--version"], {
        io,
        loadConfig: async () => {
          throw new Error("--version must not load config");
        },
      });
      expect(code).toBe(ExitCode.Success);
      expect(io.stdoutLines[0]).toStartWith("\x1b[1mdh\x1b[0m ");
      expect(io.stdoutLines[0]).toMatch(/\d+\.\d+\.\d+ \(/);
    } finally {
      if (isTTYDescriptor) {
        Object.defineProperty(process.stdout, "isTTY", isTTYDescriptor);
      } else {
        delete (process.stdout as { isTTY?: boolean }).isTTY;
      }
    }
  });
});

describe("main — usage/config/systemPrompt failures", () => {
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

  test("a systemPrompt load failure (interactive path) returns HarnessError", async () => {
    const io = fakeIo();
    const code = await main([], {
      ...baseOverrides(io),
      loadSystemPrompt: async () => {
        throw new Error("systemPrompt file not found: nope.md");
      },
    });
    expect(code).toBe(ExitCode.HarnessError);
    expect(io.stderrLines[0]).toContain("systemPrompt file not found");
  });
});

describe("main — interactive modes (real Server/TUI/Web wiring, driven via fakes)", () => {
  test("no --instructions starts local console mode: server on an ephemeral port, then the TUI, then stops the server", async () => {
    const io = fakeIo();
    const calls: string[] = [];
    let receivedBaseUrl: string | undefined;
    const code = await main([], {
      ...interactiveOverrides(io),
      createServer: (options) => {
        calls.push("createServer");
        expect(options.port).toBe(0);
        expect(options.sessionId.length).toBeGreaterThan(0);
        expect(options.logDir).toContain(".dh-logs");
        return fakeServer({
          start: () => {
            calls.push("start");
            return 55123;
          },
          stop: () => calls.push("stop"),
        });
      },
      startTui: async (baseUrl) => {
        calls.push("startTui");
        receivedBaseUrl = baseUrl;
      },
    });
    expect(code).toBe(ExitCode.Success);
    expect(calls).toEqual(["createServer", "start", "startTui", "stop"]);
    expect(receivedBaseUrl).toBe("http://localhost:55123");
  });

  test("--web starts local web mode: server + web UI on ephemeral ports, prints the URL, never calls startTui", async () => {
    const io = fakeIo();
    let startTuiCalled = false;
    let receivedTargetBaseUrl: string | undefined;
    const code = await main(["--web"], {
      ...interactiveOverrides(io),
      createServer: () => fakeServer({ start: () => 55124 }),
      serveWebUi: (options) => {
        expect(options.port).toBe(0);
        receivedTargetBaseUrl = options.targetBaseUrl;
        return fakeWebUi({ url: "http://localhost:60001" });
      },
      startTui: async () => {
        startTuiCalled = true;
      },
    });
    expect(code).toBe(ExitCode.Success);
    expect(receivedTargetBaseUrl).toBe("http://localhost:55124");
    expect(io.stdoutLines.some((l) => l.includes("http://localhost:60001"))).toBe(true);
    expect(startTuiCalled).toBe(false);
  });

  test("--server starts headless server mode on the given port; never calls startTui/serveWebUi", async () => {
    const io = fakeIo();
    let startTuiCalled = false;
    let serveWebUiCalled = false;
    const code = await main(["--server", "--port", "5050"], {
      ...interactiveOverrides(io),
      createServer: (options) => {
        expect(options.port).toBe(5050);
        return fakeServer({ start: () => 5050 });
      },
      startTui: async () => {
        startTuiCalled = true;
      },
      serveWebUi: () => {
        serveWebUiCalled = true;
        return fakeWebUi();
      },
    });
    expect(code).toBe(ExitCode.Success);
    expect(io.stdoutLines.some((l) => l.includes("5050"))).toBe(true);
    expect(startTuiCalled).toBe(false);
    expect(serveWebUiCalled).toBe(false);
  });

  test("--server without --port uses the default port", async () => {
    const io = fakeIo();
    let receivedPort: number | undefined;
    await main(["--server"], {
      ...interactiveOverrides(io),
      createServer: (options) => {
        receivedPort = options.port;
        return fakeServer({ start: () => DEFAULT_PORT });
      },
    });
    expect(receivedPort).toBe(DEFAULT_PORT);
    expect(io.stdoutLines.some((l) => l.includes(String(DEFAULT_PORT)))).toBe(true);
  });

  // DH-0011: a `--server` process is the canonical long-lived container deployment
  // (HANDOFF.md §1/§11) that receives SIGTERM on scale-down/redeploy — proves the handler
  // installed for it actually stops the agent loop and the server, then exits cleanly,
  // instead of the process just dying with no chance to do either.
  test("DH-0011: SIGTERM on a --server process stops the agent loop and the server", async () => {
    const io = fakeIo();
    let capturedOnSignal: ((signal: "SIGTERM" | "SIGINT") => void) | undefined;
    let stopAgentCalled = false;
    let serverStopCalled = false;
    await main(["--server"], {
      ...interactiveOverrides(io),
      installSignalHandlers: (onSignal) => {
        capturedOnSignal = onSignal;
        return () => {};
      },
      createAgentLoop: () =>
        fakeAgentLoop({
          stopAgent: () => {
            stopAgentCalled = true;
          },
        }),
      createServer: () =>
        fakeServer({
          stop: () => {
            serverStopCalled = true;
          },
        }),
    });
    expect(capturedOnSignal).toBeDefined();
    capturedOnSignal?.("SIGTERM");
    expect(stopAgentCalled).toBe(true);
    expect(serverStopCalled).toBe(true);
    // DH-0067: lifecycle notices (SIGTERM) print via stdout now, not stderr — a clean
    // shutdown shouldn't render red/alarming in a typical terminal or `docker logs`.
    expect(io.stdoutLines.some((l) => l.includes("SIGTERM"))).toBe(true);
    expect(io.exitCodes).toContain(ExitCode.Success);
  });

  test(
    "DH-0002: SIGTERM on a --server process also closes the agent loop's MCP manager " +
      "via the handle's optional close()",
    async () => {
      const io = fakeIo();
      let capturedOnSignal: ((signal: "SIGTERM" | "SIGINT") => void) | undefined;
      let closeCalled = false;
      await main(["--server"], {
        ...interactiveOverrides(io),
        installSignalHandlers: (onSignal) => {
          capturedOnSignal = onSignal;
          return () => {};
        },
        createAgentLoop: () =>
          fakeAgentLoop({
            close: async () => {
              closeCalled = true;
            },
          }),
      });
      capturedOnSignal?.("SIGTERM");
      await Promise.resolve();
      expect(closeCalled).toBe(true);
    },
  );

  test("DH-0002: shutdown never throws when the agent loop handle has no close() at all", async () => {
    const io = fakeIo();
    let capturedOnSignal: ((signal: "SIGTERM" | "SIGINT") => void) | undefined;
    await main(["--server"], {
      ...interactiveOverrides(io),
      installSignalHandlers: (onSignal) => {
        capturedOnSignal = onSignal;
        return () => {};
      },
      createAgentLoop: () => fakeAgentLoop(),
    });
    expect(() => capturedOnSignal?.("SIGTERM")).not.toThrow();
  });

  test("--connect starts console client mode with no local server, targeting the given host/port", async () => {
    const io = fakeIo();
    let createServerCalled = false;
    let createAgentLoopCalled = false;
    let receivedBaseUrl: string | undefined;
    const code = await main(["--connect", "example.com"], {
      ...interactiveOverrides(io),
      createAgentLoop: () => {
        createAgentLoopCalled = true;
        return fakeAgentLoop();
      },
      createServer: () => {
        createServerCalled = true;
        return fakeServer();
      },
      startTui: async (baseUrl) => {
        receivedBaseUrl = baseUrl;
      },
    });
    expect(code).toBe(ExitCode.Success);
    expect(receivedBaseUrl).toBe(`http://example.com:${DEFAULT_PORT}`);
    expect(createServerCalled).toBe(false);
    expect(createAgentLoopCalled).toBe(false);
  });

  test("--connect --web starts web client mode targeting the remote host, printing the URL", async () => {
    const io = fakeIo();
    let receivedTargetBaseUrl: string | undefined;
    await main(["--connect", "example.com", "--web", "--port", "9000"], {
      ...interactiveOverrides(io),
      serveWebUi: (options) => {
        receivedTargetBaseUrl = options.targetBaseUrl;
        return fakeWebUi({ url: "http://localhost:60002" });
      },
    });
    expect(receivedTargetBaseUrl).toBe("http://example.com:9000");
    const readyLine = io.stdoutLines.find((l) => l.includes("http://localhost:60002"));
    expect(readyLine).toContain("http://localhost:60002");
    expect(readyLine).toContain("http://example.com:9000");
  });

  test("DH-0111: --connect strips an http:// scheme the caller already included, avoiding a doubled scheme", async () => {
    const io = fakeIo();
    let receivedBaseUrl: string | undefined;
    const code = await main(["--connect", "http://example.com"], {
      ...interactiveOverrides(io),
      startTui: async (baseUrl) => {
        receivedBaseUrl = baseUrl;
      },
    });
    expect(code).toBe(ExitCode.Success);
    expect(receivedBaseUrl).toBe(`http://example.com:${DEFAULT_PORT}`);
  });

  test("DH-0111: --connect --web strips an https:// scheme the caller already included", async () => {
    const io = fakeIo();
    let receivedTargetBaseUrl: string | undefined;
    await main(["--connect", "https://example.com", "--web", "--port", "9000"], {
      ...interactiveOverrides(io),
      serveWebUi: (options) => {
        receivedTargetBaseUrl = options.targetBaseUrl;
        return fakeWebUi({ url: "http://localhost:60002" });
      },
    });
    expect(receivedTargetBaseUrl).toBe("http://example.com:9000");
  });

  test("--connect dials https:// when the connecting side's own security.tls is set", async () => {
    const io = fakeIo();
    let receivedBaseUrl: string | undefined;
    await main(["--connect", "example.com"], {
      ...interactiveOverrides(io),
      loadConfig: async () => ({
        ...TEST_CONFIG,
        security: { tls: { cert: "/c.pem", key: "/k.pem" } },
      }),
      startTui: async (baseUrl) => {
        receivedBaseUrl = baseUrl;
      },
    });
    expect(receivedBaseUrl).toBe(`https://example.com:${DEFAULT_PORT}`);
  });

  test("security.token is passed through to serveWebUi when set, omitted when unset", async () => {
    const io = fakeIo();
    let receivedToken: string | undefined = "unset-sentinel";
    await main(["--web"], {
      ...interactiveOverrides(io),
      loadConfig: async () => ({ ...TEST_CONFIG, security: { token: "shh" } }),
      serveWebUi: (options) => {
        receivedToken = options.token;
        return fakeWebUi();
      },
    });
    expect(receivedToken).toBe("shh");

    let sawTokenKey = true;
    await main(["--web"], {
      ...interactiveOverrides(io),
      serveWebUi: (options) => {
        sawTokenKey = "token" in options;
        return fakeWebUi();
      },
    });
    expect(sawTokenKey).toBe(false);
  });

  test("config.security is passed through to createServer when set, omitted when unset", async () => {
    const io = fakeIo();
    let receivedSecurity: unknown = "unset-sentinel";
    await main([], {
      ...interactiveOverrides(io),
      loadConfig: async () => ({ ...TEST_CONFIG, security: { token: "shh" } }),
      createServer: (options) => {
        receivedSecurity = options.security;
        return fakeServer();
      },
    });
    expect(receivedSecurity).toEqual({ token: "shh" });

    let sawSecurityKey = true;
    await main([], {
      ...interactiveOverrides(io),
      createServer: (options) => {
        sawSecurityKey = "security" in options;
        return fakeServer();
      },
    });
    expect(sawSecurityKey).toBe(false);
  });

  test("DH-0022: security.hostname is passed through to serveWebUi (local --web) when set, omitted when unset", async () => {
    const io = fakeIo();
    let receivedHostname: unknown = "unset-sentinel";
    await main(["--web"], {
      ...interactiveOverrides(io),
      loadConfig: async () => ({ ...TEST_CONFIG, security: { hostname: "127.0.0.1" } }),
      serveWebUi: (options) => {
        receivedHostname = options.hostname;
        return fakeWebUi();
      },
    });
    expect(receivedHostname).toBe("127.0.0.1");

    let sawHostnameKey = true;
    await main(["--web"], {
      ...interactiveOverrides(io),
      serveWebUi: (options) => {
        sawHostnameKey = "hostname" in options;
        return fakeWebUi();
      },
    });
    expect(sawHostnameKey).toBe(false);
  });

  test("DH-0022: security.hostname is passed through to serveWebUi (--connect --web) when set", async () => {
    const io = fakeIo();
    let receivedHostname: unknown;
    await main(["--connect", "example.com", "--web"], {
      ...interactiveOverrides(io),
      loadConfig: async () => ({ ...TEST_CONFIG, security: { hostname: "127.0.0.1" } }),
      serveWebUi: (options) => {
        receivedHostname = options.hostname;
        return fakeWebUi();
      },
    });
    expect(receivedHostname).toBe("127.0.0.1");
  });

  test("DH-0022: config.security (including hostname) is passed through to createServer when set, same as token/tls", async () => {
    const io = fakeIo();
    let receivedSecurity: unknown;
    await main([], {
      ...interactiveOverrides(io),
      loadConfig: async () => ({ ...TEST_CONFIG, security: { hostname: "127.0.0.1" } }),
      createServer: (options) => {
        receivedSecurity = options.security;
        return fakeServer();
      },
    });
    expect(receivedSecurity).toEqual({ hostname: "127.0.0.1" });
  });

  test("a startup failure (e.g. the requested port is already in use) maps to HarnessError, local mode", async () => {
    const io = fakeIo();
    const code = await main([], {
      ...interactiveOverrides(io),
      createServer: () => {
        throw new Error("EADDRINUSE");
      },
    });
    expect(code).toBe(ExitCode.HarnessError);
    expect(io.stderrLines[0]).toContain("failed to start local mode");
    expect(io.stderrLines[0]).toContain("EADDRINUSE");
  });

  test("a startup failure maps to HarnessError, connect mode", async () => {
    const io = fakeIo();
    const code = await main(["--connect", "example.com"], {
      ...interactiveOverrides(io),
      startTui: async () => {
        throw new Error("terminal not available");
      },
    });
    expect(code).toBe(ExitCode.HarnessError);
    expect(io.stderrLines[0]).toContain("failed to start connect mode");
    expect(io.stderrLines[0]).toContain("terminal not available");
  });

  // Round 8: each interactive run mode must map to the right SessionClientKind so every
  // agent's log header (ADR 0005 amendment) can tell which client kind produced it.
  test('no --instructions (local console) passes client: "tui" to createAgentLoop', async () => {
    const io = fakeIo();
    let receivedClient: string | undefined;
    await main([], {
      ...interactiveOverrides(io),
      createAgentLoop: (_config, _systemPrompt, client) => {
        receivedClient = client;
        return fakeAgentLoop();
      },
    });
    expect(receivedClient).toBe("tui");
  });

  test('--web (local web mode) passes client: "web" to createAgentLoop', async () => {
    const io = fakeIo();
    let receivedClient: string | undefined;
    await main(["--web"], {
      ...interactiveOverrides(io),
      createAgentLoop: (_config, _systemPrompt, client) => {
        receivedClient = client;
        return fakeAgentLoop();
      },
    });
    expect(receivedClient).toBe("web");
  });

  test('--server passes client: "server" to createAgentLoop', async () => {
    const io = fakeIo();
    let receivedClient: string | undefined;
    await main(["--server"], {
      ...interactiveOverrides(io),
      createAgentLoop: (_config, _systemPrompt, client) => {
        receivedClient = client;
        return fakeAgentLoop();
      },
    });
    expect(receivedClient).toBe("server");
  });

  // DH-0116: --server mode's AgentRuntime used to generate its own internal sessionId,
  // independently of the outer session/logDir this module uses for DhServer's logger — so
  // every log header AgentRuntime wrote didn't match the directory it landed in. The
  // sessionId createAgentLoop receives must be the SAME one stamped into the "session ..."
  // startup line (and thus the same one DhServer/logDir use).
  test("--server passes the same sessionId to createAgentLoop that it reports as its own session", async () => {
    const io = fakeIo();
    let receivedSessionId: string | undefined;
    const code = await main(["--server"], {
      ...interactiveOverrides(io),
      createAgentLoop: (_config, _systemPrompt, _client, sessionId) => {
        receivedSessionId = sessionId;
        return fakeAgentLoop();
      },
    });
    expect(code).toBe(ExitCode.Success);
    const startupLine = io.stdoutLines.find((line) => line.includes("headless server listening"));
    expect(startupLine).toBeDefined();
    const match = startupLine?.match(/\(session ([^)]+)\)/);
    expect(match?.[1]).toBe(receivedSessionId);
  });
});

describe("main — standalone --instructions path (bypasses Server/TUI/Web entirely)", () => {
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

  test("a root-agent crash returns HarnessError with a clear prefix", async () => {
    const io = fakeIo();
    const code = await main(["--instructions", "plan.md"], {
      ...baseOverrides(io),
      readInstructions: async () => "do the thing",
      createRuntime: () => ({
        runRoot: async () => {
          throw new Error("boom");
        },
        stopRoot: () => {},
      }),
    });
    expect(code).toBe(ExitCode.HarnessError);
    expect(io.stderrLines[0]).toContain("root agent crashed");
    expect(io.stderrLines[0]).toContain("boom");
  });

  test(
    "DH-0002: a successful standalone --job run closes the runtime's MCP manager via " +
      "the optional close()",
    async () => {
      const io = fakeIo();
      let closeCalled = false;
      await main(["--instructions", "plan.md", "--job"], {
        ...baseOverrides(io),
        readInstructions: async () => "do the thing",
        createRuntime: () => ({
          runRoot: async () => ({ success: true, finalOutput: "yay", turns: 1 }),
          stopRoot: () => {},
          close: async () => {
            closeCalled = true;
          },
        }),
      });
      expect(closeCalled).toBe(true);
    },
  );

  test("DH-0002: a crashed standalone run still closes the runtime's MCP manager", async () => {
    const io = fakeIo();
    let closeCalled = false;
    await main(["--instructions", "plan.md"], {
      ...baseOverrides(io),
      readInstructions: async () => "do the thing",
      createRuntime: () => ({
        runRoot: async () => {
          throw new Error("boom");
        },
        stopRoot: () => {},
        close: async () => {
          closeCalled = true;
        },
      }),
    });
    expect(closeCalled).toBe(true);
  });

  test("DH-0002: standalone shutdown never throws when createRuntime's return has no close()", async () => {
    const io = fakeIo();
    const code = await main(["--instructions", "plan.md", "--job"], {
      ...baseOverrides(io),
      readInstructions: async () => "do the thing",
      createRuntime: () => ({
        runRoot: async () => ({ success: true, finalOutput: "yay", turns: 1 }),
        stopRoot: () => {},
      }),
    });
    expect(code).toBe(ExitCode.Success);
  });

  test("--job exits 0 and prints the final output when the root agent succeeds", async () => {
    const io = fakeIo();
    const code = await main(["--instructions", "plan.md", "--job"], {
      ...baseOverrides(io),
      readInstructions: async () => "do the thing",
      createRuntime: () => ({
        runRoot: async () => ({ success: true, finalOutput: "yay", turns: 1 }),
        stopRoot: () => {},
      }),
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
      createRuntime: () => ({
        runRoot: async () => ({ success: false, finalOutput: "nope", turns: 1 }),
        stopRoot: () => {},
      }),
    });
    expect(code).toBe(ExitCode.TaskFailure);
    expect(io.exitCodes).toEqual([ExitCode.TaskFailure]);
  });

  // DH-0050: `--job --json` — NDJSON progress stream + terminal job_result line.
  test("--json without --job is a usage error", () => {
    expect(() => parseArgs(["--instructions", "plan.md", "--json"])).toThrow(CliUsageError);
    expect(() => parseArgs(["--instructions", "plan.md", "--json"])).toThrow(
      /--json requires --job/,
    );
  });

  test(
    "--job --json streams every ServerSentEvent as NDJSON then a terminal job_result line, " +
      "and suppresses the plain-text finalOutput line",
    async () => {
      const io = fakeIo();
      let receivedOnEvent: ((event: ServerSentEvent) => void) | undefined;
      const code = await main(["--instructions", "plan.md", "--job", "--json"], {
        ...baseOverrides(io),
        readInstructions: async () => "do the thing",
        createRuntime: (_config, _systemPrompt, _client, _resume, onEvent) => {
          receivedOnEvent = onEvent;
          return {
            runRoot: async () => {
              // Simulate the runtime emitting a couple of real events mid-run, exactly as
              // AgentRuntime.runRoot() does via its own onEvent callback.
              receivedOnEvent?.({
                version: 1,
                id: "evt-1",
                timestamp: "2026-07-16T00:00:00.000Z",
                type: "agent_status",
                agentId: "agent-root",
                status: "running",
              });
              return {
                success: true,
                finalOutput: "the real answer",
                turns: 3,
                outcome: { status: "success", summary: "did the thing" },
                reportedBy: "tool",
              };
            },
            stopRoot: () => {},
          };
        },
      });
      expect(code).toBe(ExitCode.Success);
      // The plain-text finalOutput line is suppressed in --json mode.
      expect(io.stdoutLines.some((l) => l === "the real answer")).toBe(false);
      const parsed = io.stdoutLines.map((l) => JSON.parse(l) as Record<string, unknown>);
      expect(parsed[0]).toEqual({
        version: 1,
        id: "evt-1",
        timestamp: "2026-07-16T00:00:00.000Z",
        type: "agent_status",
        agentId: "agent-root",
        status: "running",
      });
      const jobResult = parsed[parsed.length - 1] as unknown as JobResultLine;
      expect(jobResult.type).toBe("job_result");
      expect(jobResult.success).toBe(true);
      expect(jobResult.exitCode).toBe(ExitCode.Success);
      expect(jobResult.reportedBy).toBe("tool");
      expect(jobResult.turns).toBe(3);
      expect(jobResult.finalOutput).toBe("the real answer");
      expect(jobResult.outcome).toEqual({ status: "success", summary: "did the thing" });
    },
  );

  test("--job --json on a self-reported failure emits a job_result line with exitCode 1", async () => {
    const io = fakeIo();
    const code = await main(["--instructions", "plan.md", "--job", "--json"], {
      ...baseOverrides(io),
      readInstructions: async () => "do the thing",
      createRuntime: () => ({
        runRoot: async () => ({
          success: false,
          finalOutput: "nope",
          turns: 1,
          reportedBy: "text-marker" as const,
        }),
        stopRoot: () => {},
      }),
    });
    expect(code).toBe(ExitCode.TaskFailure);
    const lastLine = io.stdoutLines[io.stdoutLines.length - 1] ?? "";
    const jobResult = JSON.parse(lastLine) as JobResultLine;
    expect(jobResult.success).toBe(false);
    expect(jobResult.exitCode).toBe(ExitCode.TaskFailure);
    expect(jobResult.reportedBy).toBe("text-marker");
  });

  test("without --job the process doesn't exit and falls through to a real (faked) interactive mode", async () => {
    const io = fakeIo();
    const code = await main(["--instructions", "plan.md"], {
      ...interactiveOverrides(io),
      readInstructions: async () => "do the thing",
      createRuntime: () => ({
        runRoot: async () => ({ success: true, finalOutput: "yay", turns: 1 }),
        stopRoot: () => {},
      }),
    });
    expect(code).toBe(ExitCode.Success);
    expect(io.exitCodes).toEqual([]);
    expect(io.stdoutLines[0]).toBe("yay");
    // DH-0038: the operator gets an explicit message that this is a fresh session, not a
    // continuation of the job that just ran.
    expect(
      io.stdoutLines.some((l) =>
        l.includes("starting a new interactive session (prior context is not preserved)"),
      ),
    ).toBe(true);
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
        return {
          runRoot: async () => ({ success: true, finalOutput: "ok", turns: 1 }),
          stopRoot: () => {},
        };
      },
    });
    expect(received).toEqual({ config: TEST_CONFIG, systemPrompt: "resolved prompt" });
  });

  // Round 8: the standalone path has no interactive TUI/Web/server client attached.
  test('createRuntime is invoked with client: "none"', async () => {
    const io = fakeIo();
    let receivedClient: string | undefined;
    await main(["--instructions", "plan.md", "--job"], {
      ...baseOverrides(io),
      readInstructions: async () => "do the thing",
      createRuntime: (_config, _systemPrompt, client) => {
        receivedClient = client;
        return {
          runRoot: async () => ({ success: true, finalOutput: "ok", turns: 1 }),
          stopRoot: () => {},
        };
      },
    });
    expect(receivedClient).toBe("none");
  });

  // DH-0011 (tracking/DH-0011-no-signal-handling-or-process-group-reaping.md): a SIGTERM
  // during the standalone --instructions/--job run — exactly the "container receives
  // SIGTERM on scale-down" scenario HANDOFF's canonical deployment describes — must call
  // stopRoot() (the same cooperative-cancellation mechanism TaskStop already uses), log
  // that it happened, and report a harness-error exit code, not just die silently.
  test("DH-0011: SIGTERM stops the root agent via stopRoot() and exits HarnessError", async () => {
    const io = fakeIo();
    let stopRootCalled = false;
    let capturedOnSignal: ((signal: "SIGTERM" | "SIGINT") => void) | undefined;
    const code = await main(["--instructions", "plan.md", "--job"], {
      ...baseOverrides(io),
      readInstructions: async () => "do the thing",
      installSignalHandlers: (onSignal) => {
        capturedOnSignal = onSignal;
        return () => {};
      },
      createRuntime: () => ({
        runRoot: async () => {
          // Simulate the signal firing while the root agent is mid-run.
          capturedOnSignal?.("SIGTERM");
          return { success: false, finalOutput: "partial work", turns: 1 };
        },
        stopRoot: () => {
          stopRootCalled = true;
        },
      }),
    });
    expect(stopRootCalled).toBe(true);
    expect(code).toBe(ExitCode.HarnessError);
    expect(io.stdoutLines.some((l) => l.includes("SIGTERM"))).toBe(true);
    expect(io.stdoutLines).toContain("partial work");
  });
});

describe("main — --resume <sessionId> (DH-0038)", () => {
  test("--resume with --connect is rejected as unsupported", async () => {
    const io = fakeIo();
    const code = await main(["--connect", "host1", "--resume", "s1"], baseOverrides(io));
    expect(code).toBe(ExitCode.HarnessError);
    expect(io.stderrLines[0]).toContain("not supported with --connect");
  });

  test("a loadResumeSession failure is reported via the standard fail() path", async () => {
    const io = fakeIo();
    const code = await main(["--resume", "missing-session"], {
      ...baseOverrides(io),
      loadResumeSession: () => {
        throw new Error("session directory not found: /tmp/.dh-logs/missing-session");
      },
    });
    expect(code).toBe(ExitCode.HarnessError);
    expect(io.stderrLines[0]).toContain('cannot resume session "missing-session"');
    expect(io.stderrLines[0]).toContain("session directory not found");
  });

  test("an unresolvable model alias is a clean error, never a silent fallback", async () => {
    const io = fakeIo();
    const code = await main(["--resume", "s1"], {
      ...baseOverrides(io),
      loadResumeSession: () => ({
        messages: [],
        model: "no-longer-configured",
        resumedFromSessionId: "s1",
        lostAgents: [],
      }),
    });
    expect(code).toBe(ExitCode.HarnessError);
    expect(io.stderrLines[0]).toContain('cannot resume session "s1"');
    expect(io.stderrLines[0]).toContain('model alias "no-longer-configured"');
    expect(io.stderrLines[0]).toContain("sonnet"); // names the known models
  });

  test("--resume with --instructions: notice + file content become the standalone instruction, seeded runtime", async () => {
    const io = fakeIo();
    let receivedInstruction: string | undefined;
    let receivedResume: unknown;
    const code = await main(["--instructions", "plan.md", "--resume", "s1", "--job"], {
      ...baseOverrides(io),
      readInstructions: async () => "keep going",
      loadResumeSession: () => ({
        messages: [{ role: "user", content: [{ type: "text", text: "old turn" }] }],
        model: "sonnet",
        resumedFromSessionId: "s1",
        lostAgents: [],
      }),
      createRuntime: (_config, _systemPrompt, _client, resume) => {
        receivedResume = resume;
        return {
          runRoot: async (instruction: string) => {
            receivedInstruction = instruction;
            return { success: true, finalOutput: "done", turns: 1 };
          },
          stopRoot: () => {},
        };
      },
    });
    expect(code).toBe(ExitCode.Success);
    expect(receivedInstruction).toContain('resumed after a restart from session "s1"');
    expect(receivedInstruction).toContain("keep going");
    expect(receivedResume).toEqual({
      messages: [{ role: "user", content: [{ type: "text", text: "old turn" }] }],
      fromSessionId: "s1",
      model: "sonnet",
    });
  });

  test("--resume with --instructions lists lost in-flight sub-agents in the composed instruction", async () => {
    const io = fakeIo();
    let receivedInstruction: string | undefined;
    await main(["--instructions", "plan.md", "--resume", "s1", "--job"], {
      ...baseOverrides(io),
      readInstructions: async () => "keep going",
      loadResumeSession: () => ({
        messages: [],
        model: "sonnet",
        resumedFromSessionId: "s1",
        lostAgents: [
          {
            agentId: "agent-child-1",
            parentAgentId: ROOT_AGENT_ID,
            description: "worker",
            model: "sonnet",
            spawnedAt: "2026-07-15T00:00:00.000Z",
            status: "running",
          },
        ],
      }),
      createRuntime: () => ({
        runRoot: async (instruction: string) => {
          receivedInstruction = instruction;
          return { success: true, finalOutput: "done", turns: 1 };
        },
        stopRoot: () => {},
      }),
    });
    expect(receivedInstruction).toContain("agent-child-1 (worker)");
    expect(receivedInstruction).toContain("[running]");
  });

  test("--resume without --instructions auto-kicks the resumed root via sendMessage in interactive mode", async () => {
    const io = fakeIo();
    let receivedNotice: string | undefined;
    let receivedResume: unknown;
    const code = await main(["--resume", "s1"], {
      ...interactiveOverrides(io),
      loadResumeSession: () => ({
        messages: [],
        model: "sonnet",
        resumedFromSessionId: "s1",
        lostAgents: [],
      }),
      createAgentLoop: (_config, _systemPrompt, _client, _sessionId, resume) => {
        receivedResume = resume;
        return fakeAgentLoop({
          sendMessage: (agentId, message) => {
            if (agentId === ROOT_AGENT_ID) receivedNotice = message;
          },
        });
      },
    });
    expect(code).toBe(ExitCode.Success);
    expect(receivedResume).toEqual({ messages: [], fromSessionId: "s1", model: "sonnet" });
    expect(receivedNotice).toContain('resumed after a restart from session "s1"');
  });

  test("model resolution: resume's model alias must exist among the *current* config's models", async () => {
    const io = fakeIo();
    const code = await main(["--resume", "s1"], {
      ...interactiveOverrides(io),
      loadResumeSession: () => ({
        messages: [],
        model: "sonnet",
        resumedFromSessionId: "s1",
        lostAgents: [],
      }),
    });
    expect(code).toBe(ExitCode.Success);
  });
});

describe("parseEnvFile", () => {
  test("parses simple KEY=VALUE lines", () => {
    expect(parseEnvFile("FOO=bar\nBAZ=qux")).toEqual({ FOO: "bar", BAZ: "qux" });
  });

  test("skips blank lines and comments", () => {
    expect(parseEnvFile("# a comment\n\nFOO=bar\n  # another\nBAZ=qux\n")).toEqual({
      FOO: "bar",
      BAZ: "qux",
    });
  });

  test("strips optional surrounding double-quotes from the value", () => {
    expect(parseEnvFile('FOO="bar baz"')).toEqual({ FOO: "bar baz" });
  });

  test("leaves unquoted or partially-quoted values untouched", () => {
    expect(parseEnvFile('FOO=bar"baz')).toEqual({ FOO: 'bar"baz' });
  });

  test("DH-0015: resolves backslash escapes inside a double-quoted value", () => {
    expect(
      parseEnvFile(String.raw`FOO="line one\nline two\ttabbed \"quoted\" back\\slash"`),
    ).toEqual({ FOO: 'line one\nline two\ttabbed "quoted" back\\slash' });
  });

  test("DH-0015: a single-quoted value is used completely literally, no escape processing", () => {
    expect(
      parseEnvFile(String.raw`FOO='a # not a comment \n literal backslash-n "quotes" too'`),
    ).toEqual({ FOO: 'a # not a comment \\n literal backslash-n "quotes" too' });
  });

  test("DH-0015: '#' inside an unquoted value is never treated as an inline comment marker", () => {
    expect(parseEnvFile("FOO=bar#not-a-comment")).toEqual({ FOO: "bar#not-a-comment" });
  });

  test("throws a clear error naming the malformed line", () => {
    expect(() => parseEnvFile("FOO=bar\nnotanassignment\n")).toThrow(/line 2/);
    expect(() => parseEnvFile("notanassignment")).toThrow(/notanassignment/);
  });
});

describe("main — --env flag", () => {
  test("loads env vars before dh.json is loaded, so $(VAR) interpolation can see them", async () => {
    const io = fakeIo();
    const calls: string[] = [];
    let appliedVars: Record<string, string> | undefined;
    const code = await main(["--env", "secrets.env", "--server", "--job"], {
      ...interactiveOverrides(io),
      readEnvFile: async (path) => {
        calls.push(`readEnvFile:${path}`);
        expect(path).toBe("secrets.env");
        return "ANTHROPIC_API_KEY=sk-test-123";
      },
      applyEnv: (vars) => {
        calls.push("applyEnv");
        appliedVars = vars;
      },
      loadConfig: async () => {
        calls.push("loadConfig");
        expect(appliedVars).toEqual({ ANTHROPIC_API_KEY: "sk-test-123" });
        return TEST_CONFIG;
      },
    });
    expect(calls).toEqual(["readEnvFile:secrets.env", "applyEnv", "loadConfig"]);
    void code;
  });

  test("a missing env file returns HarnessError via the standard fail() path", async () => {
    const io = fakeIo();
    const code = await main(["--env", "missing.env"], {
      ...baseOverrides(io),
      readEnvFile: async () => {
        throw new Error("env file not found: missing.env");
      },
    });
    expect(code).toBe(ExitCode.HarnessError);
    expect(io.stderrLines[0]).toContain("env file not found: missing.env");
  });

  test("a malformed env file returns HarnessError with the parse error", async () => {
    const io = fakeIo();
    const code = await main(["--env", "bad.env"], {
      ...baseOverrides(io),
      readEnvFile: async () => "notanassignment",
    });
    expect(code).toBe(ExitCode.HarnessError);
    expect(io.stderrLines[0]).toContain("malformed env file line 1");
  });

  test("the real readEnvFile/applyEnv deps work end to end against a real file", async () => {
    const dir = await mkdtemp(join(tmpdir(), "dh-cli-env-test-"));
    try {
      const envPath = join(dir, "secrets.env");
      await Bun.write(envPath, "MY_TEST_VAR=hello-from-file\n");
      const io = fakeIo();
      process.env.MY_TEST_VAR = undefined;
      let seenDuringLoadConfig: string | undefined;
      await main(["--env", envPath, "--server", "--job"], {
        ...interactiveOverrides(io),
        loadConfig: async () => {
          seenDuringLoadConfig = process.env.MY_TEST_VAR;
          return TEST_CONFIG;
        },
      });
      expect(seenDuringLoadConfig).toBe("hello-from-file");
      process.env.MY_TEST_VAR = undefined;
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
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
          return { success: true, finalOutput: "ok", turns: 1 };
        },
        stopRoot: () => {},
      }),
      io,
      installSignalHandlers: fakeInstallSignalHandlers(),
    });
    expect(received).toEqual({ instruction: "the real instruction text", systemPrompt: "sp" });
  });

  test("the real readInstructions dep reports a clear error when the file is missing", async () => {
    const io = fakeIo();
    const code = await main(["--instructions", join(dir, "missing.md")], {
      loadConfig: async () => TEST_CONFIG,
      io,
      installSignalHandlers: fakeInstallSignalHandlers(),
    });
    expect(code).toBe(ExitCode.HarnessError);
    expect(io.stderrLines[0]).toContain("instructions file not found");
  });

  test("the real loadSystemPrompt dep falls back to the real built-in prompt when unset", async () => {
    // DH-0055: the real loadSystemPrompt dep reads CLAUDE.md from process.cwd(), so this
    // must run from `dir` (empty, no CLAUDE.md) rather than the repo root's real process
    // cwd — the repo's own CLAUDE.md would otherwise get injected and break the exact
    // equality check below.
    const io = fakeIo();
    const instructionsPath = join(dir, "plan.md");
    await Bun.write(instructionsPath, "go");
    let received: unknown;
    const originalCwd = process.cwd();
    process.chdir(dir);
    try {
      await main(["--instructions", instructionsPath, "--job"], {
        loadConfig: async () => TEST_CONFIG,
        createRuntime: (_config, systemPrompt) => {
          received = systemPrompt;
          return {
            runRoot: async () => ({ success: true, finalOutput: "ok", turns: 1 }),
            stopRoot: () => {},
          };
        },
        io,
        installSignalHandlers: fakeInstallSignalHandlers(),
      });
    } finally {
      process.chdir(originalCwd);
    }
    expect(received).toBe(await buildDefaultSystemPrompt(TEST_CONFIG));
  });

  test("the real loadSystemPrompt dep reads the configured systemPrompt file", async () => {
    // See the chdir note in the previous test — same CLAUDE.md-leak reason.
    const io = fakeIo();
    const instructionsPath = join(dir, "plan.md");
    await Bun.write(instructionsPath, "go");
    const systemPromptPath = join(dir, "system.md");
    await Bun.write(systemPromptPath, "custom system prompt");
    let received: unknown;
    const originalCwd = process.cwd();
    process.chdir(dir);
    try {
      await main(["--instructions", instructionsPath, "--job"], {
        loadConfig: async () => ({ ...TEST_CONFIG, systemPrompt: systemPromptPath }),
        createRuntime: (_config, systemPrompt) => {
          received = systemPrompt;
          return {
            runRoot: async () => ({ success: true, finalOutput: "ok", turns: 1 }),
            stopRoot: () => {},
          };
        },
        io,
        installSignalHandlers: fakeInstallSignalHandlers(),
      });
    } finally {
      process.chdir(originalCwd);
    }
    expect(received).toBe(`custom system prompt\n\n${REQUIRED_CONTRACT}`);
  });

  test("the real loadSystemPrompt dep reports a clear error when the configured file is missing", async () => {
    const io = fakeIo();
    const code = await main([], {
      loadConfig: async () => ({ ...TEST_CONFIG, systemPrompt: join(dir, "nope.md") }),
      io,
      installSignalHandlers: fakeInstallSignalHandlers(),
    });
    expect(code).toBe(ExitCode.HarnessError);
    expect(io.stderrLines[0]).toContain("nope.md");
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
      installSignalHandlers: fakeInstallSignalHandlers(),
    });
    expect(code).toBe(ExitCode.HarnessError);
    expect(io.stderrLines[0]).toContain("root agent crashed");
  });

  // Round 6a (docs/handoffs/core.md): the standalone --instructions/--job path used to
  // construct a bare AgentRuntime with no SessionLogger attached at all — a crashed or
  // failed unattended run left no JSONL trail. Proves the real (default) createRuntime dep
  // now writes a real per-agent JSONL file under .dh-logs/<sessionId>/, using a real mock
  // Anthropic-compatible HTTP endpoint (not a faked runtime), from the actual default dep
  // (no createRuntime override at all) so this exercises the exact code path a real `dh
  // --instructions --job` invocation would.
  test("the real (default) createRuntime dep writes a real per-agent JSONL log for a standalone run", async () => {
    const mockProvider = Bun.serve({
      port: 0,
      fetch() {
        return sseMessageResponse([{ type: "text", text: "all done" }], "end_turn", {
          input_tokens: 3,
          output_tokens: 5,
        });
      },
    });
    const instructionsPath = join(dir, "plan.md");
    await Bun.write(instructionsPath, "do the thing");
    const originalCwd = process.cwd();
    process.chdir(dir);
    try {
      const io = fakeIo();
      const code = await main(["--instructions", instructionsPath, "--job"], {
        loadConfig: async () => ({
          options: { defaultModel: "mock-model" },
          models: [{ name: "mock-model", provider: "mock", model: "mock-1" }],
          provider: [
            {
              name: "mock",
              type: "anthropic",
              baseURL: mockProvider.url.toString(),
              apiKey: "sk-test",
            },
          ],
        }),
        loadSystemPrompt: async () => "sp",
        io,
        installSignalHandlers: fakeInstallSignalHandlers(),
      });
      expect(code).toBe(ExitCode.Success);

      const logsRoot = join(dir, ".dh-logs");
      const sessions = readdirSync(logsRoot);
      expect(sessions.length).toBe(1);
      const rootLogPath = join(logsRoot, sessions[0] ?? "", "agent-root.jsonl");
      const contents = await Bun.file(rootLogPath).text();
      const lines = contents
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));
      expect(lines[0].type).toBe("header");
      expect(lines.some((line: { type: string }) => line.type === "token_usage")).toBe(true);
    } finally {
      process.chdir(originalCwd);
      mockProvider.stop(true);
    }
  });

  // DH-0037: `summary.json` — reuses the exact real-runtime setup as the JSONL test above
  // (real mock Anthropic-compatible HTTP endpoint, real default createRuntime dep) to prove
  // the standalone `--instructions --job` path writes a real summary.json alongside the
  // per-agent JSONL it already writes, not just under `--json`.
  test("the real (default) createRuntime dep writes summary.json for a standalone --job run", async () => {
    const mockProvider = Bun.serve({
      port: 0,
      fetch() {
        return sseMessageResponse([{ type: "text", text: "all done" }], "end_turn", {
          input_tokens: 3,
          output_tokens: 5,
        });
      },
    });
    const instructionsPath = join(dir, "plan.md");
    await Bun.write(instructionsPath, "do the thing");
    const originalCwd = process.cwd();
    process.chdir(dir);
    try {
      const io = fakeIo();
      const code = await main(["--instructions", instructionsPath, "--job"], {
        loadConfig: async () => ({
          options: { defaultModel: "mock-model" },
          models: [{ name: "mock-model", provider: "mock", model: "mock-1" }],
          provider: [
            {
              name: "mock",
              type: "anthropic",
              baseURL: mockProvider.url.toString(),
              apiKey: "sk-test",
            },
          ],
        }),
        loadSystemPrompt: async () => "sp",
        io,
        installSignalHandlers: fakeInstallSignalHandlers(),
      });
      expect(code).toBe(ExitCode.Success);

      const logsRoot = join(dir, ".dh-logs");
      const sessions = readdirSync(logsRoot);
      expect(sessions.length).toBe(1);
      const summaryPath = join(logsRoot, sessions[0] ?? "", "summary.json");
      const summary = JSON.parse(await Bun.file(summaryPath).text());
      expect(summary.version).toBe(1);
      expect(summary.sessionId).toBe(sessions[0]);
      expect(summary.success).toBe(true);
      expect(summary.exitCode).toBe(0);
      // 2, not 1: the mock provider's plain-text response never calls ReportOutcome, so
      // DH-0050's nudge-then-fall-back-to-clean-end path (loop.ts) burns one extra real turn
      // before accepting the text as a clean finish.
      expect(summary.turns).toBe(2);
      expect(summary.agentCount).toBe(1);
      // costUsd stays undefined: this test's model config has no `pricing`, so
      // computeCostUsd never has a rate to apply (see loop.ts's costUsd derivation).
      expect(summary.costUsd).toBeUndefined();
      expect(typeof summary.durationMs).toBe("number");
    } finally {
      process.chdir(originalCwd);
      mockProvider.stop(true);
    }
  });

  test("the real createAgentLoop + createServer defaults wire up without a real terminal (startTui faked)", async () => {
    const io = fakeIo();
    const code = await main([], {
      loadConfig: async () => TEST_CONFIG,
      startTui: async () => {},
      io,
      installSignalHandlers: fakeInstallSignalHandlers(),
    });
    expect(code).toBe(ExitCode.Success);
  });

  test("the real serveWebUi default serves a real ephemeral web UI", async () => {
    const io = fakeIo();
    const code = await main(["--web"], {
      loadConfig: async () => TEST_CONFIG,
      createAgentLoop: () => fakeAgentLoop(),
      createServer: () => fakeServer(),
      io,
      installSignalHandlers: fakeInstallSignalHandlers(),
    });
    expect(code).toBe(ExitCode.Success);
    expect(
      io.stdoutLines.some((l) => /^dh: web UI ready at http:\/\/localhost:\d+\.$/.test(l)),
    ).toBe(true);
    // Deliberately left running: main() doesn't expose the handle for cleanup (interactive
    // "--web" mode never stops itself in production either — the process just keeps the
    // socket open). Ephemeral port, harmless for the rest of this test run.
  });
});

describe("main — default io wired to console/process.exit", () => {
  test("the default stdout dep writes to console.log", async () => {
    const logSpy = spyOn(console, "log").mockImplementation(() => {});
    try {
      const code = await main(["--server"], {
        loadConfig: async () => TEST_CONFIG,
        createAgentLoop: () => fakeAgentLoop(),
        createServer: () => fakeServer(),
        installSignalHandlers: fakeInstallSignalHandlers(),
      });
      expect(code).toBe(ExitCode.Success);
      expect(logSpy).toHaveBeenCalled();
    } finally {
      logSpy.mockRestore();
    }
  });

  // DH-0011: exercises the REAL defaultDeps().installSignalHandlers implementation (not the
  // fakeInstallSignalHandlers() test double every other test uses) — but stubs process.on/
  // process.off for its duration so no real listener is ever registered on the actual
  // process, keeping this test as safe as every other one in the file while still covering
  // the production code path.
  test("the default installSignalHandlers dep registers real process.on listeners and fires onSignal at most once", async () => {
    const originalOn = process.on.bind(process);
    const originalOff = process.off.bind(process);
    const registered: Array<{ event: string; handler: (...args: unknown[]) => void }> = [];
    const removed: string[] = [];
    // biome-ignore lint/suspicious/noExplicitAny: stubbing process.on/off for this test only
    (process as any).on = (event: string, handler: (...args: unknown[]) => void) => {
      registered.push({ event, handler });
      return process;
    };
    // biome-ignore lint/suspicious/noExplicitAny: stubbing process.on/off for this test only
    (process as any).off = (event: string) => {
      removed.push(event);
      return process;
    };
    try {
      const io = fakeIo();
      let signalsReceived = 0;
      let stopAgentCalled = false;
      await main(["--server"], {
        loadConfig: async () => TEST_CONFIG,
        createAgentLoop: () =>
          fakeAgentLoop({
            stopAgent: () => {
              stopAgentCalled = true;
            },
          }),
        createServer: () => fakeServer(),
        io,
      });
      expect(registered.map((r) => r.event).sort()).toEqual(["SIGINT", "SIGTERM"]);
      const sigterm = registered.find((r) => r.event === "SIGTERM");
      expect(sigterm).toBeDefined();
      // Simulate the real signal firing twice — proves "at most once" (the second call is a
      // no-op, letting a second real signal fall through to the OS default per the dep's own
      // doc comment) without ever sending a real OS signal.
      sigterm?.handler();
      sigterm?.handler();
      signalsReceived += 1;
      expect(signalsReceived).toBe(1);
      expect(stopAgentCalled).toBe(true);
      expect(io.stdoutLines.filter((l) => l.includes("SIGTERM"))).toHaveLength(1);
    } finally {
      process.on = originalOn;
      process.off = originalOff;
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

describe("AgentRuntimeLoopAdapter", () => {
  function startMockAnthropicServer() {
    return Bun.serve({
      port: 0,
      async fetch(req) {
        const body = (await req.json()) as {
          messages: { content: { type: string; text?: string }[] }[];
        };
        const text = body.messages
          .at(-1)
          ?.content.filter((c): c is { type: "text"; text: string } => c.type === "text")
          .map((c) => c.text)
          .join("");
        return sseMessageResponse([{ type: "text", text: `handled: ${text ?? ""}` }], "end_turn", {
          input_tokens: 1,
          output_tokens: 1,
        });
      },
    });
  }

  function adapterConfig(server: ReturnType<typeof startMockAnthropicServer>): DhConfig {
    return {
      options: { defaultModel: "test-model" },
      models: [{ name: "test-model", provider: "mock", model: "mock-1" }],
      provider: [
        { name: "mock", type: "anthropic", baseURL: server.url.toString(), apiKey: "sk-test" },
      ],
    };
  }

  test("DH-0002: close() delegates to the wrapped AgentRuntime.close()", async () => {
    const server = startMockAnthropicServer();
    try {
      const adapter = new AgentRuntimeLoopAdapter({
        config: adapterConfig(server),
        systemPrompt: "sp",
        client: "tui",
      });
      await expect(adapter.close()).resolves.toBeUndefined();
    } finally {
      server.stop(true);
    }
  });

  test("getAgentTree() delegates to the wrapped runtime — a 'waiting' root node before start", () => {
    const server = startMockAnthropicServer();
    try {
      const adapter = new AgentRuntimeLoopAdapter({
        config: adapterConfig(server),
        systemPrompt: "sp",
        client: "tui",
      });
      // Round 2 fix: a "waiting" root node (not an empty tree) is what makes
      // sendMessage(ROOT_AGENT_ID, ...) reachable at all through the real command handler
      // (src/server/commands.ts validates against getAgentTree() before delegating) — see
      // runtime.ts's rootStatus field doc comment for how this was found (a live
      // integration test against a real DhServer, not a hypothetical).
      expect(adapter.getAgentTree()).toEqual([
        {
          agentId: ROOT_AGENT_ID,
          parentAgentId: null,
          model: "test-model",
          status: "waiting",
          children: [],
        },
      ]);
    } finally {
      server.stop(true);
    }
  });

  test("listModels()/switchModel()/listSkills()/invokeSkill() delegate to the wrapped AgentRuntime", async () => {
    const server = startMockAnthropicServer();
    try {
      const adapter = new AgentRuntimeLoopAdapter({
        config: adapterConfig(server),
        systemPrompt: "sp",
        client: "tui",
      });
      expect(adapter.listModels().map((m) => m.name)).toEqual(["test-model"]);

      // Round-trips through AgentRuntime.switchModel() — root hasn't started yet, so this
      // exercises the pending-switch path rather than a live binding swap.
      expect(() => adapter.switchModel(ROOT_AGENT_ID, "test-model")).not.toThrow();

      // Builtin cli-tools skill is always present (runtime.ts's skillsCache seed).
      expect(adapter.listSkills().some((s) => s.name === "cli-tools")).toBe(true);

      // An unknown skill name throws UnknownSkillError before any message delivery is
      // attempted, so this delegation is provable without spinning up the root agent.
      await expect(
        adapter.invokeSkill(ROOT_AGENT_ID, "no-such-skill", undefined),
      ).rejects.toThrow();
    } finally {
      server.stop(true);
    }
  });

  test("sendMessage(ROOT_AGENT_ID, ...) lazily starts the root agent on the first call", async () => {
    const server = startMockAnthropicServer();
    const adapter = new AgentRuntimeLoopAdapter({
      config: adapterConfig(server),
      systemPrompt: "sp",
      client: "tui",
    });
    try {
      const events: ServerSentEvent[] = [];
      const unsubscribe = adapter.onEvent((e) => events.push(e));
      adapter.sendMessage(ROOT_AGENT_ID, "hello");
      // Round 5 (docs/handoffs/core.md status log): an interactive root never reaches a
      // terminal "done"/session_ended on a plain conversational turn anymore — it pauses in
      // "waiting" for the next message instead. Wait for that transition rather than
      // session_ended, which correctly never fires here.
      await new Promise<void>((resolve) => {
        const check = setInterval(() => {
          if (
            events.some(
              (e) =>
                e.type === "agent_status" && e.agentId === ROOT_AGENT_ID && e.status === "waiting",
            )
          ) {
            clearInterval(check);
            resolve();
          }
        }, 5);
      });
      unsubscribe();
      expect(
        events.some((e) => e.type === "agent_output" && e.chunk.includes("handled: hello")),
      ).toBe(true);
      expect(events.some((e) => e.type === "session_ended")).toBe(false);
      expect(adapter.getAgentTree()).toEqual([
        {
          agentId: ROOT_AGENT_ID,
          parentAgentId: null,
          model: "test-model",
          status: "waiting",
          children: [],
        },
      ]);
    } finally {
      adapter.stopAgent(ROOT_AGENT_ID);
      server.stop(true);
    }
  });

  test("sendMessage(ROOT_AGENT_ID, ...) emits a synthetic failed status if the root agent can't even start", async () => {
    const adapter = new AgentRuntimeLoopAdapter({
      config: {
        options: { defaultModel: "nope" },
        models: [],
        provider: [],
      },
      systemPrompt: "sp",
      client: "tui",
    });
    const events: ServerSentEvent[] = [];
    adapter.onEvent((e) => events.push(e));
    adapter.sendMessage(ROOT_AGENT_ID, "hello");
    await new Promise<void>((resolve) => {
      const check = setInterval(() => {
        if (events.some((e) => e.type === "agent_status")) {
          clearInterval(check);
          resolve();
        }
      }, 5);
    });
    const statusEvent = events.find((e) => e.type === "agent_status");
    expect(statusEvent).toMatchObject({
      type: "agent_status",
      agentId: ROOT_AGENT_ID,
      status: "failed",
    });
  });

  // Round 4 (docs/handoffs/core.md status log): the coordinator found this bug specifically
  // through this exact path — a real dh --server, a real bad-apiKey-shaped crash, then
  // polling request_agent_tree well after the transient event had already fired and been
  // missed. This test drives the same path (adapter -> getAgentTree(), not a raw
  // AgentRuntime call) with real delays between polls, matching that manual repro.
  test("getAgentTree() reports 'failed' when polled well after a real provider crash, not stuck 'running'", async () => {
    const unauthorizedServer = Bun.serve({
      port: 0,
      fetch() {
        return Response.json({ error: "unauthorized" }, { status: 401 });
      },
    });
    try {
      const adapter = new AgentRuntimeLoopAdapter({
        config: adapterConfig(unauthorizedServer),
        systemPrompt: "sp",
        client: "tui",
      });
      const loggedLines: string[] = [];
      const statusChangeLines: string[] = [];
      adapter.onLog((_agentId, line) => {
        if (line.type === "message") loggedLines.push(line.content);
        if (line.type === "status_change") statusChangeLines.push(line.status);
      });
      adapter.sendMessage(ROOT_AGENT_ID, "hello"); // lazily starts the root; the crash is async
      for (let i = 0; i < 3; i += 1) {
        await new Promise((resolve) => setTimeout(resolve, 30));
        expect(adapter.getAgentTree()[0]?.status).toBe("failed");
      }
      // DH-0017 fix: the real error reason reaches the log instead of being discarded — this
      // used to be `.catch(() => { ...only a synthetic agent_status... })`, silently dropping
      // the actual Error entirely, so an operator saw only an opaque "failed" with zero detail.
      // DH-0131: this crash happens mid-run (inside runAgentLoop(), after the loop already
      // started), which AgentRuntime.runRoot() now distinguishes from a pre-loop
      // resolveModel()/providerFor() failure via "Root agent failed:" vs. "Root agent failed
      // to start:" — see runtime.ts's two catch blocks.
      expect(loggedLines.some((l) => l.includes("Root agent failed"))).toBe(true);
      // DH-0131: the whole point of the fix — a "failed" agent_status transition must always
      // reach the JSONL log as a structured status_change line, not just a plain message and
      // a transient SSE event (which getAgentTree()'s "failed" assertion above already
      // covered, and would have kept passing even with the gap this ticket fixes).
      expect(statusChangeLines).toContain("failed");
    } finally {
      unauthorizedServer.stop(true);
    }
  });

  test("DH-0131: a root agent that fails to start (unknown model in config) emits a structured status_change:failed log line, not just a message", async () => {
    const adapter = new AgentRuntimeLoopAdapter({
      config: {
        options: { defaultModel: "does-not-exist" },
        models: [],
        provider: [],
      },
      systemPrompt: "sp",
      client: "tui",
    });
    const loggedLines: string[] = [];
    const statusChangeLines: string[] = [];
    adapter.onLog((_agentId, line) => {
      if (line.type === "message") loggedLines.push(line.content);
      if (line.type === "status_change") statusChangeLines.push(line.status);
    });
    adapter.sendMessage(ROOT_AGENT_ID, "hello"); // lazily starts the root; resolveModel() throws synchronously inside the fire-and-forget .catch()
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(adapter.getAgentTree()[0]?.status).toBe("failed");
    expect(loggedLines.some((l) => l.includes("Root agent failed to start"))).toBe(true);
    expect(statusChangeLines).toContain("failed");
  });

  test("sendMessage on a non-root agentId delegates to the task registry", () => {
    const server = startMockAnthropicServer();
    try {
      const adapter = new AgentRuntimeLoopAdapter({
        config: adapterConfig(server),
        systemPrompt: "sp",
        client: "tui",
      });
      expect(() => adapter.sendMessage("agent-unknown", "hi")).toThrow(/unknown task id/);
    } finally {
      server.stop(true);
    }
  });

  test("stopAgent(ROOT_AGENT_ID) really stops the root agent (Round 3 — used to be a no-op)", async () => {
    // A dedicated never-responding mock server, not the shared fast-answering one above —
    // this proves stopAgent actually reaches AgentRuntime.stopRoot()'s AbortController
    // (interrupting a genuinely in-flight provider call), not just that it doesn't throw.
    // If the wiring regressed to a no-op, this test would hang until bun's default per-test
    // timeout and fail — that failure mode *is* the test.
    const neverRespondingServer = Bun.serve({
      port: 0,
      fetch() {
        return new Promise<Response>(() => {});
      },
    });
    try {
      const adapter = new AgentRuntimeLoopAdapter({
        config: adapterConfig(neverRespondingServer),
        systemPrompt: "sp",
        client: "tui",
      });
      const events: ServerSentEvent[] = [];
      adapter.onEvent((e) => events.push(e));
      adapter.sendMessage(ROOT_AGENT_ID, "hello"); // lazily starts the root
      await new Promise((resolve) => setTimeout(resolve, 20));
      adapter.stopAgent(ROOT_AGENT_ID);
      await new Promise<void>((resolve) => {
        const check = setInterval(() => {
          if (events.some((e) => e.type === "session_ended")) {
            clearInterval(check);
            resolve();
          }
        }, 5);
      });
      const statusEvent = events.find((e) => e.type === "agent_status");
      // DH-0017 fix: a deliberate stop reports "stopped", not "failed".
      expect(statusEvent).toMatchObject({
        type: "agent_status",
        agentId: ROOT_AGENT_ID,
        status: "stopped",
      });
    } finally {
      neverRespondingServer.stop(true);
    }
  });

  test("stopAgent on a non-root agentId delegates to the task registry", () => {
    const server = startMockAnthropicServer();
    try {
      const adapter = new AgentRuntimeLoopAdapter({
        config: adapterConfig(server),
        systemPrompt: "sp",
        client: "tui",
      });
      expect(() => adapter.stopAgent("agent-unknown")).toThrow(/unknown task id/);
    } finally {
      server.stop(true);
    }
  });

  test("onLog fans a single onLogLine callback out to every subscriber, with unsubscribe", async () => {
    const server = startMockAnthropicServer();
    try {
      const adapter = new AgentRuntimeLoopAdapter({
        config: adapterConfig(server),
        systemPrompt: "sp",
        client: "tui",
      });
      const seenByA: string[] = [];
      const seenByB: string[] = [];
      const listenerA: AgentLoopLogListener = (agentId) => seenByA.push(agentId);
      const listenerB: AgentLoopLogListener = (agentId) => seenByB.push(agentId);
      adapter.onLog(listenerA);
      const unsubscribeB = adapter.onLog(listenerB);
      unsubscribeB();
      // Round 5: adapter.runtime is always interactive, so runRoot() on a plain conversational
      // turn now pauses in "waiting" instead of resolving — stop it once it's produced some
      // log lines rather than awaiting a completion that no longer happens.
      const runPromise = adapter.runtime.runRoot("hi");
      while (seenByA.length === 0) {
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      adapter.runtime.stopRoot();
      await runPromise;
      expect(seenByA.length).toBeGreaterThan(0);
      expect(seenByA.every((id) => id === ROOT_AGENT_ID)).toBe(true);
      expect(seenByB).toEqual([]);
    } finally {
      server.stop(true);
    }
  });
});

describe("AgentRuntimeLoopAdapter + DhServer + waitForExitCode (Round 2 DoD: real local DhServer + mock provider)", () => {
  function startMockAnthropicServer(finalText: string) {
    return Bun.serve({
      port: 0,
      fetch() {
        return sseMessageResponse([{ type: "text", text: finalText }], "end_turn", {
          input_tokens: 1,
          output_tokens: 1,
        });
      },
    });
  }

  // Round 5 (docs/handoffs/core.md status log): before this round, a plain conversational
  // turn (no tool call) ended the loop and fired session_ended — which is exactly the bug
  // this round fixes for interactive sessions (server/TUI/Web). Interactive sessions no
  // longer have any "natural" success/failure completion at all: they only end via a real
  // stop (or the maxTurns safety valve). The old "resolves 0 ... self-reports success" and
  // "resolves 1 ... self-reports TASK_FAILED" tests here tested exactly the removed
  // behavior and have been replaced by the single test below, which proves waitForExitCode
  // still resolves correctly through a real DhServer for the one way an interactive
  // session's exit code is actually determined post-Round-5: an explicit stop. (The
  // standalone `--instructions`/`--job` dark-factory path's own success/TASK_FAILED
  // self-report handling is unaffected by this round — see loop.test.ts and
  // runtime.test.ts's non-interactive-by-default coverage, and cli.test.ts's `--job` tests
  // above using a real createRuntime dep.)
  test("waitForExitCode resolves Success through a real DhServer when the operator stops an interactive root paused 'waiting' for its next message", async () => {
    const mockProvider = startMockAnthropicServer("all good");
    const config: DhConfig = {
      options: { defaultModel: "test-model" },
      models: [{ name: "test-model", provider: "mock", model: "mock-1" }],
      provider: [
        {
          name: "mock",
          type: "anthropic",
          baseURL: mockProvider.url.toString(),
          apiKey: "sk-test",
        },
      ],
    };
    const adapter = new AgentRuntimeLoopAdapter({ config, systemPrompt: "sp", client: "tui" });
    const dhServer = new DhServer({
      agentLoop: adapter,
      sessionId: "s1",
      logDir: `/tmp/dh-test-${Date.now()}`,
      // Round (post-DH-0044 test-mock fixup): explicit ephemeral port — this constructor
      // used to omit `port` entirely, silently defaulting to the real 4000 (DhServerOptions'
      // doc comment) and colliding with any other test/process bound to that fixed port
      // ("Failed to start server. Is port 4000 in use?"). Every other real Bun.serve() mock
      // in this suite already uses `port: 0`; DhServer just needed the same treatment.
      port: 0,
    });
    const port = dhServer.start();
    try {
      const exitCodePromise = waitForExitCode(adapter);
      await fetch(`http://localhost:${port}/api/commands`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type: "send_message", agentId: ROOT_AGENT_ID, message: "go" }),
      });
      // Wait until the conversational turn has actually completed and the root is paused
      // "waiting" for its next message, proving it did NOT end the session on its own.
      let tree: unknown;
      do {
        await new Promise((resolve) => setTimeout(resolve, 5));
        tree = await fetch(`http://localhost:${port}/api/commands`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ type: "request_agent_tree" }),
        }).then((r) => r.json());
      } while (!(tree as { tree: { status: string }[] }).tree.some((n) => n.status === "waiting"));

      await fetch(`http://localhost:${port}/api/commands`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type: "stop_agent", agentId: ROOT_AGENT_ID }),
      });
      // DH-0059: stopping an agent paused "waiting" (idle between turns, not mid-work) is a
      // graceful end of the conversation, not an interrupted task — exitCode 0, not 1.
      expect(await exitCodePromise).toBe(ExitCode.Success);
    } finally {
      dhServer.stop();
      mockProvider.stop(true);
    }
  });

  // Regression test for a real bug this Round 2 pass found via a live subprocess smoke
  // test, not a hypothetical: src/server/commands.ts's send_message handler validates the
  // target agentId against getAgentTree() *before* ever calling AgentLoopHandle.
  // sendMessage() — so if getAgentTree() were empty until the root starts (the adapter's
  // original design), the very first message meant to *start* the root would be rejected
  // as "unknown agentId" by the real command handler, never reaching the adapter's lazy-
  // start logic at all. Fixed in runtime.ts (root node is always present, "waiting" before
  // start); this test drives the exact real HTTP path that caught it.
  //
  // Round 5 addition: this is also the live-verification DoD for the actual bug this round
  // fixes — proving a *second* send_message to the same root produces new output that
  // references context from the first, i.e. it's really the same ongoing conversation, not
  // two independent ones and not a silently-dropped no-op (the exact symptom the owner and
  // coordinator reproduced against a real LM Studio instance).
  test("send_message to a not-yet-started root reaches the real HTTP command handler, starts it, and a second send_message continues the same conversation", async () => {
    const mockProvider = Bun.serve({
      port: 0,
      async fetch(req) {
        const body = (await req.json()) as {
          messages: { content: { type: string; text?: string }[] }[];
        };
        const text = body.messages
          .at(-1)
          ?.content.filter((c): c is { type: "text"; text: string } => c.type === "text")
          .map((c) => c.text)
          .join("");
        return sseMessageResponse([{ type: "text", text: `handled: ${text ?? ""}` }], "end_turn", {
          input_tokens: 1,
          output_tokens: 1,
        });
      },
    });
    const config: DhConfig = {
      options: { defaultModel: "test-model" },
      models: [{ name: "test-model", provider: "mock", model: "mock-1" }],
      provider: [
        {
          name: "mock",
          type: "anthropic",
          baseURL: mockProvider.url.toString(),
          apiKey: "sk-test",
        },
      ],
    };
    const adapter = new AgentRuntimeLoopAdapter({ config, systemPrompt: "sp", client: "tui" });
    const dhServer = new DhServer({
      agentLoop: adapter,
      sessionId: "s3",
      logDir: `/tmp/dh-test-${Date.now()}`,
      // See the "s1" DhServer above for why: explicit ephemeral port, not the real 4000.
      port: 0,
    });
    const port = dhServer.start();
    try {
      const treeBefore = await fetch(`http://localhost:${port}/api/commands`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type: "request_agent_tree" }),
      }).then((r) => r.json());
      expect(treeBefore).toMatchObject({
        ok: true,
        tree: [{ agentId: ROOT_AGENT_ID, status: "waiting" }],
      });

      const events: ServerSentEvent[] = [];
      adapter.onEvent((e) => events.push(e));

      const sendResult = await fetch(`http://localhost:${port}/api/commands`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type: "send_message",
          agentId: ROOT_AGENT_ID,
          message: "first message",
        }),
      }).then((r) => r.json());
      expect(sendResult).toEqual({ ok: true });

      // Round 5: this used to poll for session_ended/"done" — that's exactly the bug. The
      // exchange completes by pausing "waiting", not by ending the session.
      while (
        !events.some((e) => e.type === "agent_output" && e.chunk.includes("handled: first message"))
      ) {
        await new Promise((resolve) => setTimeout(resolve, 5));
      }

      const treeAfterFirst = await fetch(`http://localhost:${port}/api/commands`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type: "request_agent_tree" }),
      }).then((r) => r.json());
      expect(treeAfterFirst).toMatchObject({
        ok: true,
        tree: [{ agentId: ROOT_AGENT_ID, status: "waiting" }],
      });

      // The actual bug this round fixes: before the fix, this second send_message returned
      // {"ok":true} but silently did nothing — no new turn, no new output. Now it must
      // produce real new output, and that output must be provably the same conversation:
      // the mock provider echoes back the full concatenated text of every prior turn it
      // received, so "second message" only appears in the response if the second message's
      // text actually reached the provider as part of the same ongoing exchange history.
      const secondSendResult = await fetch(`http://localhost:${port}/api/commands`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type: "send_message",
          agentId: ROOT_AGENT_ID,
          message: "second message",
        }),
      }).then((r) => r.json());
      expect(secondSendResult).toEqual({ ok: true });

      while (
        !events.some(
          (e) => e.type === "agent_output" && e.chunk.includes("handled: second message"),
        )
      ) {
        await new Promise((resolve) => setTimeout(resolve, 5));
      }

      const treeAfterSecond = await fetch(`http://localhost:${port}/api/commands`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type: "request_agent_tree" }),
      }).then((r) => r.json());
      expect(treeAfterSecond).toMatchObject({
        ok: true,
        tree: [{ agentId: ROOT_AGENT_ID, status: "waiting" }],
      });
    } finally {
      adapter.stopAgent(ROOT_AGENT_ID);
      dhServer.stop();
      mockProvider.stop(true);
    }
  });
});

function fakeModelProvider(overrides: Partial<ModelProvider> = {}): ModelProvider {
  return {
    complete: async () => ({
      stopReason: "end_turn",
      content: [{ type: "text", text: "pong" }],
      usage: { inputTokens: 1, outputTokens: 1 },
    }),
    ...overrides,
  };
}

describe("main — dh init", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "dh-cli-init-test-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test("writes the sample config to the default path and exits 0", async () => {
    const io = fakeIo();
    const target = join(dir, "dh.json");
    const code = await main(["init", "--config", target], { io });
    expect(code).toBe(ExitCode.Success);
    expect(io.exitCodes).toEqual([ExitCode.Success]);
    const written = await Bun.file(target).text();
    expect(written).toBe(SAMPLE_DH_JSON);
    expect(io.stdoutLines[0]).toContain(target);
  });

  // DH-0090: dh init used to scaffold anthropic/bedrock provider entries with no
  // credential fields at all, leaving a first-time operator to discover apiKey/region
  // from README on their own. The scaffolded config should come with $(VAR) interpolation
  // placeholders already in place.
  test("scaffolds anthropic apiKey and bedrock region as $(VAR) placeholders", () => {
    const parsed = JSON.parse(SAMPLE_DH_JSON);
    const anthropic = parsed.provider.find((p: { name: string }) => p.name === "anthropic");
    const bedrock = parsed.provider.find((p: { name: string }) => p.name === "bedrock");
    const local = parsed.provider.find((p: { name: string }) => p.name === "local");
    expect(anthropic.apiKey).toBe("$(ANTHROPIC_API_KEY)");
    expect(bedrock.region).toBe("$(AWS_REGION)");
    expect(local.apiKey).toBeUndefined();
    expect(local.region).toBeUndefined();
  });

  // DH-0119: Amazon Bedrock Mantle is a separate endpoint from bedrock-runtime with two
  // model-vendor-routed API surfaces (live-tested 2026-07-17): "mantle-anthropic" (Anthropic
  // Messages shape, .../anthropic) and "mantle-openai" (Chat Completions shape, .../v1) —
  // both bearer-apiKey authenticated, reusing the existing "anthropic"/"openai-compatible"
  // provider types rather than a bespoke adapter.
  test("scaffolds mantle-anthropic and mantle-openai provider entries alongside bedrock", () => {
    const parsed = JSON.parse(SAMPLE_DH_JSON);
    const mantleAnthropic = parsed.provider.find(
      (p: { name: string }) => p.name === "mantle-anthropic",
    );
    const mantleOpenai = parsed.provider.find((p: { name: string }) => p.name === "mantle-openai");
    expect(mantleAnthropic).toBeDefined();
    expect(mantleAnthropic.type).toBe("anthropic");
    expect(mantleAnthropic.baseURL).toBe("https://bedrock-mantle.$(AWS_REGION).api.aws/anthropic");
    expect(mantleAnthropic.apiKey).toBe("$(BEDROCK_MANTLE_API_KEY)");
    expect(mantleOpenai).toBeDefined();
    expect(mantleOpenai.type).toBe("openai-compatible");
    // DH-0119: the "/openai" prefix is required for models like gemma4 -- the unprefixed
    // path rejects them with a misleading "Berm is not enabled for this account" error.
    expect(mantleOpenai.baseURL).toBe("https://bedrock-mantle.$(AWS_REGION).api.aws/openai/v1");
    expect(mantleOpenai.apiKey).toBe("$(BEDROCK_MANTLE_API_KEY)");

    const gemma = parsed.models.find((m: { name: string }) => m.name === "gemma4");
    expect(gemma.provider).toBe("mantle-openai");
    const haikuMantle = parsed.models.find((m: { name: string }) => m.name === "haiku-mantle");
    expect(haikuMantle.provider).toBe("mantle-anthropic");
  });

  // DH-0096: the scaffolded catalog should cover all four Claude tiers on both providers,
  // a working default gemma model on Bedrock, a few OpenAI-on-Bedrock and open-weight
  // Bedrock models, and the local provider's baseURL as an env-var interpolation placeholder
  // rather than a hardcoded localhost URL.
  test("scaffolds a richer, real model catalog (DH-0096)", () => {
    const parsed = JSON.parse(SAMPLE_DH_JSON);
    const names = (parsed.models as Array<{ name: string; provider: string; model: string }>).map(
      (m) => m.name,
    );

    // All four Claude tiers, both providers.
    for (const tier of ["fable", "opus", "sonnet", "haiku"]) {
      expect(names).toContain(`${tier}-anthropic`);
      expect(names).toContain(`${tier}-bedrock`);
    }

    // DH-0106: default model kept on a Claude tier confirmed reliable for agentic tool use,
    // not gemma4 (whose tool-use reliability is unverified against real Gemma 4 — DH-0118).
    expect(parsed.options.defaultModel).toBe("haiku-bedrock");
    const gemma = parsed.models.find((m: { name: string }) => m.name === "gemma4");
    // DH-0119: gemma4 routes through "mantle-openai" (Amazon Bedrock Mantle's Chat
    // Completions surface), not the standard "bedrock" Converse path -- live-tested: Mantle
    // recognizes this exact model id, blocked only on an account-side entitlement, not code.
    expect(gemma.provider).toBe("mantle-openai");
    expect(gemma.model).not.toBe("gemma4"); // real Bedrock model id, not the DH-0092 mistake shape
    expect(gemma.model).toMatch(/^google\.gemma-/);

    // A few OpenAI-on-Bedrock and open-weight (Llama/Mistral) Bedrock models.
    const bedrockModelIds = parsed.models
      .filter((m: { provider: string }) => m.provider === "bedrock")
      .map((m: { model: string }) => m.model);
    expect(bedrockModelIds.some((id: string) => id.startsWith("openai."))).toBe(true);
    expect(bedrockModelIds.some((id: string) => /(^|\.)meta\.llama/.test(id))).toBe(true);
    expect(bedrockModelIds.some((id: string) => id.startsWith("mistral."))).toBe(true);

    // local provider baseURL is an env-var interpolation placeholder, not a hardcoded URL.
    const local = parsed.provider.find((p: { name: string }) => p.name === "local");
    expect(local.baseURL).toBe("$(LOCAL_AI_PROVIDER)");
  });

  test("refuses to overwrite an existing config file", async () => {
    const io = fakeIo();
    const target = join(dir, "dh.json");
    await Bun.write(target, '{"already":"here"}');
    const code = await main(["init", "--config", target], { io });
    expect(code).toBe(ExitCode.HarnessError);
    expect(io.stderrLines[0]).toContain("refusing to overwrite");
    const stillThere = await Bun.file(target).text();
    expect(stillThere).toBe('{"already":"here"}');
  });

  test("the scaffolded config parses and validates cleanly via the real loadConfig", async () => {
    const io = fakeIo();
    const target = join(dir, "dh.json");
    await main(["init", "--config", target], { io });
    const { loadConfig } = await import("./config/index.ts");
    // DH-0090: the scaffolded anthropic/bedrock entries now use $(VAR) interpolation
    // placeholders, so loadConfig needs the referenced env vars set to resolve cleanly.
    const prevApiKey = process.env.ANTHROPIC_API_KEY;
    const prevRegion = process.env.AWS_REGION;
    const prevLocalProvider = process.env.LOCAL_AI_PROVIDER;
    const prevMantleKey = process.env.BEDROCK_MANTLE_API_KEY;
    process.env.ANTHROPIC_API_KEY = "test-key";
    process.env.AWS_REGION = "us-west-2";
    // DH-0096: the local provider's baseURL is now a $(LOCAL_AI_PROVIDER) placeholder too.
    process.env.LOCAL_AI_PROVIDER = "http://localhost:8080";
    // DH-0118: the mantle provider's apiKey is a $(BEDROCK_MANTLE_API_KEY) placeholder too.
    process.env.BEDROCK_MANTLE_API_KEY = "test-mantle-key";
    try {
      const config = await loadConfig(target);
      expect(config.options.defaultModel).toBe("haiku-bedrock");
    } finally {
      if (prevApiKey === undefined) delete process.env.ANTHROPIC_API_KEY;
      else process.env.ANTHROPIC_API_KEY = prevApiKey;
      if (prevRegion === undefined) delete process.env.AWS_REGION;
      else process.env.AWS_REGION = prevRegion;
      if (prevLocalProvider === undefined) delete process.env.LOCAL_AI_PROVIDER;
      else process.env.LOCAL_AI_PROVIDER = prevLocalProvider;
      if (prevMantleKey === undefined) delete process.env.BEDROCK_MANTLE_API_KEY;
      else process.env.BEDROCK_MANTLE_API_KEY = prevMantleKey;
    }
  });

  test("--config requires a value", async () => {
    const io = fakeIo();
    const code = await main(["init", "--config"], { io });
    expect(code).toBe(ExitCode.HarnessError);
    expect(io.stderrLines[0]).toContain("--config requires a value");
  });

  test("rejects an unknown flag", async () => {
    const io = fakeIo();
    const code = await main(["init", "--bogus"], { io });
    expect(code).toBe(ExitCode.HarnessError);
    expect(io.stderrLines[0]).toContain("unknown flag: --bogus");
  });

  test("surfaces a fileExists failure via fail()", async () => {
    const io = fakeIo();
    const code = await main(["init"], {
      io,
      fileExists: async () => {
        throw new Error("boom");
      },
    });
    expect(code).toBe(ExitCode.HarnessError);
    expect(io.stderrLines[0]).toContain("failed to check dh.json: boom");
  });

  test("surfaces a writeFile failure via fail()", async () => {
    const io = fakeIo();
    const code = await main(["init"], {
      io,
      fileExists: async () => false,
      writeFile: async () => {
        throw new Error("disk full");
      },
    });
    expect(code).toBe(ExitCode.HarnessError);
    expect(io.stderrLines[0]).toContain("failed to write dh.json: disk full");
  });

  // DH-0101: success headline (✓) + indented dim caveats + a set-off next-step callout, TTY
  // only — off-TTY (every test above) keeps the same plain `dh: ` lines.
  describe("TTY styling (DH-0101)", () => {
    let isTTYDescriptor: PropertyDescriptor | undefined;

    beforeEach(() => {
      isTTYDescriptor = Object.getOwnPropertyDescriptor(process.stdout, "isTTY");
      Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });
    });

    afterEach(() => {
      if (isTTYDescriptor) {
        Object.defineProperty(process.stdout, "isTTY", isTTYDescriptor);
      } else {
        delete (process.stdout as { isTTY?: boolean }).isTTY;
      }
    });

    test("success headline gets a green ✓, caveats are dimmed, next step is a distinct callout", async () => {
      const io = fakeIo();
      const target = join(dir, "dh.json");
      const code = await main(["init", "--config", target], { io });
      expect(code).toBe(ExitCode.Success);
      expect(io.stdoutLines[0]).toBe(`dh: \x1b[32m✓\x1b[0m wrote a starter config to ${target}.`);
      expect(io.stdoutLines[1]).toStartWith("\x1b[2mdh:");
      expect(io.stdoutLines[2]).toStartWith("\x1b[2mdh:");
      expect(io.stdoutLines[2]).toEndWith("\x1b[0m");
      expect(io.stdoutLines[3]).toStartWith("\x1b[2mdh:");
      expect(io.stdoutLines[3]).toContain("gemma4");
      expect(io.stdoutLines[3]).toEndWith("\x1b[0m");
      expect(io.stdoutLines[4]).toBe(
        'dh: Next: run "dh doctor" to probe credentials, then "dh" to start.',
      );
    });
  });
});

describe("main — dh doctor / --check", () => {
  // DH-0106: the fake provider below answers the connectivity ping with plain text (no
  // tools requested) and the tool-use capability probe (request.tools non-empty) with a
  // real tool_use block, so the model reads as a fully tool-capable PASS — same shape as a
  // real Claude-tier model.
  const fakeToolCapableProvider = () =>
    fakeModelProvider({
      complete: async (request) => {
        if (request.tools.length > 0) {
          return {
            stopReason: "tool_use",
            content: [{ type: "tool_use", id: "1", name: "noop", input: {} }],
            usage: { inputTokens: 1, outputTokens: 1 },
          };
        }
        return {
          stopReason: "end_turn",
          content: [{ type: "text", text: "pong" }],
          usage: { inputTokens: 1, outputTokens: 1 },
        };
      },
    });

  test("reports PASS for every model when every provider call succeeds, exits 0", async () => {
    const io = fakeIo();
    const calls: Array<{ model: string; maxTokens: number | undefined; tools: unknown[] }> = [];
    const code = await main(["--check"], {
      ...baseOverrides(io),
      createProvider: (config: ProviderConfig) =>
        fakeModelProvider({
          complete: async (request) => {
            calls.push({
              model: request.model,
              maxTokens: request.maxTokens,
              tools: request.tools,
            });
            expect(config.name).toBe("anthropic");
            if (request.tools.length > 0) {
              return {
                stopReason: "tool_use",
                content: [{ type: "tool_use", id: "1", name: "noop", input: {} }],
                usage: { inputTokens: 1, outputTokens: 1 },
              };
            }
            return {
              stopReason: "end_turn",
              content: [{ type: "text", text: "pong" }],
              usage: { inputTokens: 1, outputTokens: 1 },
            };
          },
        }),
    });
    expect(code).toBe(ExitCode.Success);
    expect(io.stdoutLines).toEqual([
      ...expectedHeaderLines(TEST_CONFIG),
      'PASS sonnet (provider "anthropic")',
      "1 model: 1 pass, 0 fail",
    ]);
    expect(calls).toEqual([
      { model: "sonnet-5", maxTokens: 1, tools: [] },
      {
        model: "sonnet-5",
        maxTokens: 64,
        tools: [
          {
            name: "noop",
            description:
              "A no-op probe tool. Call it with no arguments to confirm you can call tools.",
            inputSchema: { type: "object", properties: {}, additionalProperties: false },
          },
        ],
      },
    ]);
  });

  test("reports a distinct 'no tool-use' PASS when a model connects but never emits a real tool_use block (DH-0106)", async () => {
    const io = fakeIo();
    const code = await main(["--check"], {
      ...baseOverrides(io),
      createProvider: () =>
        fakeModelProvider({
          complete: async () => ({
            stopReason: "end_turn",
            content: [{ type: "text", text: "I would call the tool now: tool_code Agent(...)" }],
            usage: { inputTokens: 1, outputTokens: 1 },
          }),
        }),
    });
    expect(code).toBe(ExitCode.Success);
    expect(io.stdoutLines).toEqual([
      ...expectedHeaderLines(TEST_CONFIG),
      'PASS (no tool-use) sonnet (provider "anthropic")',
      "1 model: 1 pass, 0 fail",
    ]);
  });

  test("a throwing tool-use probe still reports as 'no tool-use' rather than FAIL (DH-0106)", async () => {
    const io = fakeIo();
    const code = await main(["--check"], {
      ...baseOverrides(io),
      createProvider: () =>
        fakeModelProvider({
          complete: async (request) => {
            if (request.tools.length > 0) {
              throw new Error("boom during probe");
            }
            return {
              stopReason: "end_turn",
              content: [{ type: "text", text: "pong" }],
              usage: { inputTokens: 1, outputTokens: 1 },
            };
          },
        }),
    });
    expect(code).toBe(ExitCode.Success);
    expect(io.stdoutLines).toEqual([
      ...expectedHeaderLines(TEST_CONFIG),
      'PASS (no tool-use) sonnet (provider "anthropic")',
      "1 model: 1 pass, 0 fail",
    ]);
  });

  test("the dh doctor subcommand is an alias for --check", async () => {
    const io = fakeIo();
    const code = await main(["doctor"], {
      ...baseOverrides(io),
      createProvider: () => fakeToolCapableProvider(),
    });
    expect(code).toBe(ExitCode.Success);
    expect(io.stdoutLines).toEqual([
      ...expectedHeaderLines(TEST_CONFIG),
      'PASS sonnet (provider "anthropic")',
      "1 model: 1 pass, 0 fail",
    ]);
  });

  test("dh doctor still honors --config", async () => {
    const io = fakeIo();
    const seenPaths: string[] = [];
    const code = await main(["doctor", "--config", "custom.json"], {
      ...baseOverrides(io),
      loadConfig: async (path) => {
        seenPaths.push(path);
        return TEST_CONFIG;
      },
      createProvider: () => fakeModelProvider(),
    });
    expect(code).toBe(ExitCode.Success);
    expect(seenPaths).toEqual(["custom.json"]);
  });

  test("reports FAIL and a non-zero exit code when a provider call throws", async () => {
    const io = fakeIo();
    const code = await main(["--check"], {
      ...baseOverrides(io),
      createProvider: () =>
        fakeModelProvider({
          complete: async () => {
            throw new Error("401 unauthorized");
          },
        }),
    });
    expect(code).toBe(ExitCode.HarnessError);
    expect(io.stdoutLines).toEqual([
      ...expectedHeaderLines(TEST_CONFIG),
      'FAIL sonnet (provider "anthropic"): 401 unauthorized',
      "1 model: 0 pass, 1 fail",
    ]);
  });

  test("reports FAIL per model without throwing when a model references an unknown provider", async () => {
    const io = fakeIo();
    const ghostConfig: DhConfig = {
      options: { defaultModel: "sonnet" },
      models: [{ name: "sonnet", provider: "ghost", model: "sonnet-5" }],
      provider: [{ name: "anthropic", type: "anthropic" }],
    };
    const code = await main(["--check"], {
      ...baseOverrides(io),
      loadConfig: async () => ghostConfig,
      createProvider: () => fakeModelProvider(),
    });
    expect(code).toBe(ExitCode.HarnessError);
    expect(io.stdoutLines).toEqual([
      ...expectedHeaderLines(ghostConfig),
      'FAIL sonnet: no provider named "ghost" in config',
      "1 model: 0 pass, 1 fail",
    ]);
  });

  test("never enters the interactive agent loop", async () => {
    const io = fakeIo();
    let loopStarted = false;
    await main(["--check"], {
      ...baseOverrides(io),
      createProvider: () => fakeModelProvider(),
      createAgentLoop: () => {
        loopStarted = true;
        return fakeAgentLoop();
      },
    });
    expect(loopStarted).toBe(false);
  });

  describe("TTY live progress (DH-0099)", () => {
    let isTTYDescriptor: PropertyDescriptor | undefined;
    let writeSpy: ReturnType<typeof spyOn<typeof process.stdout, "write">>;

    beforeEach(() => {
      isTTYDescriptor = Object.getOwnPropertyDescriptor(process.stdout, "isTTY");
      Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });
      writeSpy = spyOn(process.stdout, "write").mockImplementation(() => true);
    });

    afterEach(() => {
      writeSpy.mockRestore();
      if (isTTYDescriptor) {
        Object.defineProperty(process.stdout, "isTTY", isTTYDescriptor);
      } else {
        delete (process.stdout as { isTTY?: boolean }).isTTY;
      }
    });

    test("prints a pending row before the check resolves, then rewrites it in place on PASS", async () => {
      const io = fakeIo();
      const code = await main(["--check"], {
        ...baseOverrides(io),
        createProvider: () =>
          fakeModelProvider({
            complete: async () => {
              // The pending row must already be on screen by the time the provider call is
              // in flight — this is the "prints immediately, before resolving" requirement.
              expect(
                writeSpy.mock.calls.some(([chunk]) => String(chunk).includes("checking")),
              ).toBe(true);
              return {
                stopReason: "end_turn",
                content: [{ type: "text", text: "pong" }],
                usage: { inputTokens: 1, outputTokens: 1 },
              };
            },
          }),
      });
      expect(code).toBe(ExitCode.Success);

      const writes = writeSpy.mock.calls.map(([chunk]) => String(chunk));
      expect(writes[0]).toContain("checking");
      expect(writes[0]).not.toContain("\r");
      expect(writes[1]).toContain("\r\x1b[K");
      expect(writes[1]).toContain("PASS");
      expect(writes[1]).toContain("sonnet");
      expect(writes[1]?.endsWith("\n")).toBe(true);
      expect(writes.at(-1)).toContain("1 model: 1 pass, 0 fail");
      // Non-TTY io.stdout must not also fire the doctor report itself — the app header
      // (DH-0122) is the only thing that goes through io.stdout on this path.
      expect(io.stdoutLines).toEqual(expectedHeaderLinesTty(TEST_CONFIG));
    });

    test("advances the spinner frame on a timer while a single check is outstanding, and always clears it (DH-0102)", async () => {
      const io = fakeIo();
      const code = await main(["--check"], {
        ...baseOverrides(io),
        createProvider: () =>
          fakeModelProvider({
            complete: async () => {
              // Long enough to guarantee at least one SPINNER_FRAME_MS (120ms) tick fires
              // before this resolves, so the animation timer is exercised, not just armed.
              await new Promise((resolve) => setTimeout(resolve, 260));
              return {
                stopReason: "end_turn",
                content: [{ type: "text", text: "pong" }],
                usage: { inputTokens: 1, outputTokens: 1 },
              };
            },
          }),
      });
      expect(code).toBe(ExitCode.Success);

      const writes = writeSpy.mock.calls.map(([chunk]) => String(chunk));
      // First write is the initial pending row (frame 0); at least one more `\r\x1b[K`-prefixed
      // pending rewrite from the timer must appear before the final resolved-row rewrite.
      const pendingRewrites = writes
        .slice(1, -1)
        .filter((w) => w.startsWith("\r\x1b[K") && w.includes("checking"));
      expect(pendingRewrites.length).toBeGreaterThan(0);
      // The very last write is still the resolved PASS row, not a stray pending tick — proof
      // the timer was cleared before (or synchronously with) the final rewrite, per the
      // ticket's no-race requirement.
      const finalRow = writes.at(-2) as string;
      expect(finalRow).toContain("PASS");
      expect(finalRow).not.toContain("checking");
    }, 5000);

    test("rewrites the pending row to FAIL in place when the provider call throws", async () => {
      const io = fakeIo();
      const code = await main(["--check"], {
        ...baseOverrides(io),
        createProvider: () =>
          fakeModelProvider({
            complete: async () => {
              throw new Error("401 unauthorized");
            },
          }),
      });
      expect(code).toBe(ExitCode.HarnessError);

      const writes = writeSpy.mock.calls.map(([chunk]) => String(chunk));
      expect(writes[0]).toContain("checking");
      expect(writes[1]).toContain("\r\x1b[K");
      expect(writes[1]).toContain("FAIL");
      expect(writes[1]).toContain("sonnet");
      expect(writes[1]).toContain("401 unauthorized");
      expect(writes.at(-1)).toContain("0 pass, 1 fail");
      expect(io.stdoutLines).toEqual(expectedHeaderLinesTty(TEST_CONFIG));
    });
  });
});

describe("main — --dry-run", () => {
  test("validates config and provider construction, exits 0, without calling a model", async () => {
    const io = fakeIo();
    let providerConstructed = false;
    let completeCalled = false;
    const code = await main(["--dry-run"], {
      ...baseOverrides(io),
      createProvider: (config: ProviderConfig) => {
        providerConstructed = true;
        expect(config.name).toBe("anthropic");
        return fakeModelProvider({
          complete: async () => {
            completeCalled = true;
            throw new Error("should never be called by --dry-run");
          },
        });
      },
    });
    expect(code).toBe(ExitCode.Success);
    expect(providerConstructed).toBe(true);
    expect(completeCalled).toBe(false);
    expect(io.stdoutLines[0]).toContain("dry run OK");
  });

  // DH-0101: ✓ glyph on TTY success.
  test("TTY: success line leads with a green ✓", async () => {
    const isTTYDescriptor = Object.getOwnPropertyDescriptor(process.stdout, "isTTY");
    Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });
    try {
      const io = fakeIo();
      const code = await main(["--dry-run"], {
        ...baseOverrides(io),
        createProvider: () => fakeModelProvider(),
      });
      expect(code).toBe(ExitCode.Success);
      expect(io.stdoutLines[0]).toStartWith("dh: \x1b[32m✓\x1b[0m dry run OK");
    } finally {
      if (isTTYDescriptor) {
        Object.defineProperty(process.stdout, "isTTY", isTTYDescriptor);
      } else {
        delete (process.stdout as { isTTY?: boolean }).isTTY;
      }
    }
  });

  test("also validates the instructions file when --instructions is given", async () => {
    const io = fakeIo();
    const code = await main(["--dry-run", "--instructions", "plan.md"], {
      ...baseOverrides(io),
      createProvider: () => fakeModelProvider(),
      readInstructions: async (path) => {
        expect(path).toBe("plan.md");
        return "do the thing";
      },
    });
    expect(code).toBe(ExitCode.Success);
  });

  test("fails when the instructions file is missing", async () => {
    const io = fakeIo();
    const code = await main(["--dry-run", "--instructions", "missing.md"], {
      ...baseOverrides(io),
      createProvider: () => fakeModelProvider(),
      readInstructions: async () => {
        throw new Error("instructions file not found: missing.md");
      },
    });
    expect(code).toBe(ExitCode.HarnessError);
    expect(io.stderrLines[0]).toContain("instructions file not found: missing.md");
  });

  test("fails when a provider fails to construct", async () => {
    const io = fakeIo();
    const code = await main(["--dry-run"], {
      ...baseOverrides(io),
      createProvider: () => {
        throw new Error("missing credentials");
      },
    });
    expect(code).toBe(ExitCode.HarnessError);
    expect(io.stderrLines[0]).toContain(
      'provider "anthropic" failed to construct: missing credentials',
    );
  });

  test("never enters the interactive agent loop", async () => {
    const io = fakeIo();
    let loopStarted = false;
    await main(["--dry-run"], {
      ...baseOverrides(io),
      createProvider: () => fakeModelProvider(),
      createAgentLoop: () => {
        loopStarted = true;
        return fakeAgentLoop();
      },
    });
    expect(loopStarted).toBe(false);
  });
});

describe("loadConfig — DH-0035 missing-file error message", () => {
  test("points the operator at dh init, --config, and README.md", async () => {
    const { loadConfig } = await import("./config/index.ts");
    const dir = await mkdtemp(join(tmpdir(), "dh-cli-missing-config-test-"));
    try {
      await expect(loadConfig(join(dir, "dh.json"))).rejects.toThrow(/dh init/);
      await expect(loadConfig(join(dir, "dh.json"))).rejects.toThrow(/--config/);
      await expect(loadConfig(join(dir, "dh.json"))).rejects.toThrow(/README\.md/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("buildStartupPostureNote (DH-0067)", () => {
  test("no security config at all: plaintext/no-auth note", () => {
    expect(buildStartupPostureNote(undefined)).toBe(
      "dh: plaintext HTTP, no auth — see README security posture.",
    );
  });

  test("security config with neither token nor tls: same note", () => {
    expect(buildStartupPostureNote({})).toBe(
      "dh: plaintext HTTP, no auth — see README security posture.",
    );
  });

  test("a bearer token configured: no note", () => {
    expect(buildStartupPostureNote({ token: "shh" })).toBeUndefined();
  });

  test("TLS configured: no note", () => {
    expect(buildStartupPostureNote({ tls: { cert: "cert.pem", key: "key.pem" } })).toBeUndefined();
  });
});

describe("ActivityFeed (DH-0067)", () => {
  const TS = "2026-07-16T12:04:11.000Z";

  test("token_usage accumulates silently — no line produced", () => {
    const feed = new ActivityFeed();
    const line = feed.onEvent({
      version: 1,
      id: "1",
      timestamp: TS,
      type: "token_usage",
      agentId: "agent-root",
      inputTokens: 100,
      outputTokens: 20,
      costUsd: 0.01,
    });
    expect(line).toBeUndefined();
  });

  test("agent_spawned with a description includes it; without, just the id", () => {
    const feed = new ActivityFeed();
    expect(
      feed.onEvent({
        version: 1,
        id: "1",
        timestamp: TS,
        type: "agent_spawned",
        agentId: "agent-1",
        parentAgentId: "agent-root",
        model: "sonnet",
        description: "run the tests",
      }),
    ).toBe("12:04:11 agent-1 (run the tests) spawned (sonnet)");

    expect(
      feed.onEvent({
        version: 1,
        id: "2",
        timestamp: TS,
        type: "agent_spawned",
        agentId: "agent-root",
        parentAgentId: null,
        model: "sonnet",
      }),
    ).toBe("12:04:11 agent-root spawned (sonnet)");
  });

  test("agent_status with no prior token_usage has no usage suffix", () => {
    const feed = new ActivityFeed();
    expect(
      feed.onEvent({
        version: 1,
        id: "1",
        timestamp: TS,
        type: "agent_status",
        agentId: "agent-root",
        status: "running",
      }),
    ).toBe("12:04:11 agent-root running");
  });

  test("agent_status after token_usage shows cumulative tokens and cost", () => {
    const feed = new ActivityFeed();
    feed.onEvent({
      version: 1,
      id: "1",
      timestamp: TS,
      type: "token_usage",
      agentId: "agent-root",
      inputTokens: 1000,
      outputTokens: 204,
      costUsd: 0.0213,
    });
    expect(
      feed.onEvent({
        version: 1,
        id: "2",
        timestamp: TS,
        type: "agent_status",
        agentId: "agent-root",
        status: "waiting",
      }),
    ).toBe("12:04:11 agent-root waiting — 1,204 tok / $0.0213");
  });

  test("agent_status after token_usage with no costUsd shows tokens only", () => {
    const feed = new ActivityFeed();
    feed.onEvent({
      version: 1,
      id: "1",
      timestamp: TS,
      type: "token_usage",
      agentId: "agent-root",
      inputTokens: 10,
      outputTokens: 5,
    });
    expect(
      feed.onEvent({
        version: 1,
        id: "2",
        timestamp: TS,
        type: "agent_status",
        agentId: "agent-root",
        status: "done",
      }),
    ).toBe("12:04:11 agent-root done — 15 tok");
  });

  test("session_ended reports the exit code", () => {
    const feed = new ActivityFeed();
    expect(
      feed.onEvent({ version: 1, id: "1", timestamp: TS, type: "session_ended", exitCode: 0 }),
    ).toBe("12:04:11 session ended (exit code 0)");
  });

  test("resync (server-internal SSE-resume detail) produces no line", () => {
    const feed = new ActivityFeed();
    expect(feed.onEvent({ version: 1, id: "1", timestamp: TS, type: "resync" })).toBeUndefined();
  });

  // DH-0101: TTY-gated short id + status-colored dot + dim timestamp. Explicit `tty: true`
  // argument, no process.stdout monkeypatching needed since ActivityFeed's caller threads the
  // gate in as a parameter rather than reading process.stdout.isTTY itself.
  describe("tty styling (DH-0101)", () => {
    test("agent_spawned: long id shortened, timestamp dimmed", () => {
      const feed = new ActivityFeed();
      expect(
        feed.onEvent(
          {
            version: 1,
            id: "1",
            timestamp: TS,
            type: "agent_spawned",
            agentId: "0123456789abcdef",
            parentAgentId: "agent-root",
            model: "sonnet",
          },
          true,
        ),
      ).toBe("\x1b[2m12:04:11\x1b[0m 01234567… spawned (sonnet)");
    });

    test("agent_status: status-colored dot precedes the shortened id, per status", () => {
      const feed = new ActivityFeed();
      expect(
        feed.onEvent(
          {
            version: 1,
            id: "1",
            timestamp: TS,
            type: "agent_status",
            agentId: "0123456789abcdef",
            status: "running",
          },
          true,
        ),
      ).toBe("\x1b[2m12:04:11\x1b[0m \x1b[34m●\x1b[0m 01234567… running");

      expect(
        feed.onEvent(
          {
            version: 1,
            id: "2",
            timestamp: TS,
            type: "agent_status",
            agentId: "agent-root",
            status: "stopped",
          },
          true,
        ),
      ).toBe("\x1b[2m12:04:11\x1b[0m \x1b[35m●\x1b[0m agent-root stopped");
    });

    test("tty: false (the default) matches the plain non-TTY output exactly", () => {
      const feed = new ActivityFeed();
      expect(
        feed.onEvent({
          version: 1,
          id: "1",
          timestamp: TS,
          type: "agent_status",
          agentId: "agent-root",
          status: "running",
        }),
      ).toBe("12:04:11 agent-root running");
    });
  });
});

describe("formatDoctorReport (DH-0067)", () => {
  test("plain (non-TTY) output, no color codes", () => {
    const lines = formatDoctorReport(
      [{ modelName: "sonnet", ok: true, detail: '(provider "anthropic")' }],
      false,
    );
    expect(lines).toEqual(['PASS sonnet (provider "anthropic")', "1 model: 1 pass, 0 fail"]);
  });

  test("color: true wraps PASS in green and FAIL in red, with a leading ✓/✗ glyph (DH-0102)", () => {
    const lines = formatDoctorReport(
      [
        { modelName: "sonnet", ok: true, detail: '(provider "anthropic")' },
        { modelName: "gemma4", ok: false, detail: '(provider "bedrock"): boom' },
      ],
      true,
    );
    expect(lines[0]).toBe('\x1b[32m✓ PASS\x1b[0m sonnet (provider "anthropic")');
    expect(lines[1]).toBe('\x1b[31m✗ FAIL\x1b[0m gemma4 (provider "bedrock"): boom');
    // DH-0102: the trailing summary line is also colorized on the TTY path — red here since
    // one of the two results failed.
    expect(lines[2]).toBe("\x1b[31m2 models: 1 pass, 1 fail\x1b[0m");
  });

  test("color: true, all-pass summary line is colored green (DH-0102)", () => {
    const lines = formatDoctorReport(
      [{ modelName: "sonnet", ok: true, detail: '(provider "anthropic")' }],
      true,
    );
    expect(lines.at(-1)).toBe("\x1b[32m1 model: 1 pass, 0 fail\x1b[0m");
  });

  test("plain (non-TTY) path has no ✓/✗ glyph and no color codes anywhere, including the summary (DH-0102)", () => {
    const lines = formatDoctorReport(
      [
        { modelName: "sonnet", ok: true, detail: '(provider "anthropic")' },
        { modelName: "gemma4", ok: false, detail: '(provider "bedrock"): boom' },
      ],
      false,
    );
    for (const line of lines) {
      expect(line).not.toContain("✓");
      expect(line).not.toContain("✗");
      expect(line).not.toContain("\x1b[");
    }
  });

  test("aligns model names to the widest one in the run", () => {
    const lines = formatDoctorReport(
      [
        { modelName: "s", ok: true, detail: "x" },
        { modelName: "longer-name", ok: true, detail: "y" },
      ],
      false,
    );
    expect(lines[0]).toBe("PASS s           x");
    expect(lines[1]).toBe("PASS longer-name y");
  });

  test("zero results: summary line still prints, singular 'model'", () => {
    expect(formatDoctorReport([], false)).toEqual(["0 models: 0 pass, 0 fail"]);
    expect(formatDoctorReport([{ modelName: "a", ok: true, detail: "x" }], false).at(-1)).toBe(
      "1 model: 1 pass, 0 fail",
    );
  });
});

describe("main — --server startup block (DH-0067)", () => {
  test("default (plaintext, no auth): posture note, version/logs line, and connect hint all print after the byte-stable listening line", async () => {
    const io = fakeIo();
    const code = await main(["--server"], {
      ...interactiveOverrides(io),
    });
    expect(code).toBe(ExitCode.Success);
    const h = expectedHeaderLines(TEST_CONFIG).length;
    expect(io.stdoutLines[h]).toMatch(/^dh: headless server listening on port \d+/);
    expect(io.stdoutLines[h + 1]).toMatch(
      /^dh: dh \d+\.\d+\.\d+ \(.*\) — bound to 0\.0\.0\.0:\d+ — logs: .*\.dh-logs/,
    );
    expect(io.stdoutLines[h + 2]).toMatch(/^dh: connect with: dh --connect <host> --port \d+$/);
    expect(io.stdoutLines[h + 3]).toBe(
      "dh: plaintext HTTP, no auth — see README security posture.",
    );
  });

  test("DH-0022: a configured security.hostname is reflected in the startup 'bound to' line", async () => {
    const io = fakeIo();
    const hostConfig = { ...TEST_CONFIG, security: { hostname: "127.0.0.1" } };
    const code = await main(["--server"], {
      ...interactiveOverrides(io),
      loadConfig: async () => hostConfig,
    });
    expect(code).toBe(ExitCode.Success);
    const h = expectedHeaderLines(hostConfig).length;
    expect(io.stdoutLines[h + 1]).toMatch(
      /^dh: dh \d+\.\d+\.\d+ \(.*\) — bound to 127\.0\.0\.1:\d+ — logs: .*\.dh-logs/,
    );
  });

  test("a configured bearer token suppresses the posture note", async () => {
    const io = fakeIo();
    const code = await main(["--server"], {
      ...interactiveOverrides(io),
      loadConfig: async () => ({ ...TEST_CONFIG, security: { token: "shh" } }),
    });
    expect(code).toBe(ExitCode.Success);
    expect(io.stdoutLines.some((l) => l.includes("plaintext HTTP"))).toBe(false);
  });

  test("local --web mode prints the log directory line after the byte-stable 'web UI ready at' line", async () => {
    const io = fakeIo();
    const code = await main(["--web"], {
      ...interactiveOverrides(io),
    });
    expect(code).toBe(ExitCode.Success);
    const h = expectedHeaderLines(TEST_CONFIG).length;
    expect(io.stdoutLines[h]).toMatch(/^dh: web UI ready at http:\/\/localhost:\d+\.$/);
    expect(io.stdoutLines[h + 1]).toMatch(/^dh: logs: .*\.dh-logs/);
  });

  // DH-0101: on a TTY, styling wraps around the two e2e-grepped substrings without breaking
  // them — verified here at the unit level (in addition to the real e2e run against the
  // compiled binary) via a regex anchored on the exact byte-stable substrings.
  describe("TTY styling wraps, never rewrites, the byte-stable substrings (DH-0101)", () => {
    let isTTYDescriptor: PropertyDescriptor | undefined;

    beforeEach(() => {
      isTTYDescriptor = Object.getOwnPropertyDescriptor(process.stdout, "isTTY");
      Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });
    });

    afterEach(() => {
      if (isTTYDescriptor) {
        Object.defineProperty(process.stdout, "isTTY", isTTYDescriptor);
      } else {
        delete (process.stdout as { isTTY?: boolean }).isTTY;
      }
    });

    test("--server: headless line keeps its exact substring; version bolded; posture caution-marked", async () => {
      const io = fakeIo();
      const code = await main(["--server"], {
        ...interactiveOverrides(io),
      });
      expect(code).toBe(ExitCode.Success);
      const h = expectedHeaderLinesTty(TEST_CONFIG).length;
      expect(io.stdoutLines[h]).toContain("headless server listening on port");
      expect(io.stdoutLines[h]).toStartWith(
        "dh: \x1b[32m✓\x1b[0m headless server listening on port ",
      );
      expect(io.stdoutLines[h + 1]).toStartWith("dh: \x1b[1mdh ");
      expect(io.stdoutLines[h + 1]).toContain("\x1b[0m — bound to");
      expect(io.stdoutLines[h + 3]).toStartWith("dh: \x1b[33m⚠\x1b[0m plaintext HTTP, no auth");
    });

    test("--web: 'web UI ready at <url>' substring survives styling intact, URL uncolored", async () => {
      const io = fakeIo();
      const code = await main(["--web"], {
        ...interactiveOverrides(io),
      });
      expect(code).toBe(ExitCode.Success);
      const h = expectedHeaderLinesTty(TEST_CONFIG).length;
      const line = io.stdoutLines[h] ?? "";
      expect(line).toStartWith("dh: \x1b[32m✓\x1b[0m web UI ready at ");
      expect(line).toEndWith(".");
      // Everything between "ready at " and the trailing "." is the captured URL e2e's own
      // regex feeds straight into `fetch()` — it must be free of embedded ANSI.
      const url = line.slice(line.indexOf("ready at ") + "ready at ".length, -1);
      expect(url).toStartWith("http://localhost:");
      expect(url).not.toContain("\x1b");
    });

    test("--connect --web: 'web UI ready at <url>' substring survives styling intact", async () => {
      const io = fakeIo();
      const code = await main(["--connect", "example.com", "--web"], {
        ...interactiveOverrides(io),
      });
      expect(code).toBe(ExitCode.Success);
      const h = expectedHeaderLinesTty(TEST_CONFIG).length;
      expect(io.stdoutLines[h]).toStartWith("dh: \x1b[32m✓\x1b[0m web UI ready at ");
      expect(io.stdoutLines[h]).toContain(" (connected to ");
    });
  });
});

describe("main — --server activity feed and client connect/disconnect lines (DH-0067)", () => {
  test("by default, agent lifecycle events print an activity-feed line to stdout", async () => {
    const io = fakeIo();
    let capturedListener: ((event: ServerSentEvent) => void) | undefined;
    await main(["--server"], {
      ...interactiveOverrides(io),
      createAgentLoop: () =>
        fakeAgentLoop({
          onEvent: (listener) => {
            capturedListener = listener;
            return () => {};
          },
        }),
    });
    expect(capturedListener).toBeDefined();
    capturedListener?.({
      version: 1,
      id: "1",
      timestamp: "2026-07-16T12:00:00.000Z",
      type: "agent_status",
      agentId: "agent-root",
      status: "running",
    });
    expect(io.stdoutLines.some((l) => l.includes("agent-root running"))).toBe(true);
  });

  test("--quiet suppresses the activity feed subscription entirely", async () => {
    const io = fakeIo();
    let onEventCallCount = 0;
    await main(["--server", "--quiet"], {
      ...interactiveOverrides(io),
      createAgentLoop: () =>
        fakeAgentLoop({
          onEvent: () => {
            onEventCallCount += 1;
            return () => {};
          },
        }),
    });
    // The fake DhServer in interactiveOverrides never itself calls onEvent, so any call at
    // all here must have come from the --server activity-feed subscription this test is
    // asserting is skipped under --quiet.
    expect(onEventCallCount).toBe(0);
  });

  test("by default, createServer receives onClientConnect/onClientDisconnect callbacks that print stdout lines", async () => {
    const io = fakeIo();
    let captured: {
      onClientConnect?: (addr: string) => void;
      onClientDisconnect?: (addr: string) => void;
    } = {};
    await main(["--server"], {
      ...interactiveOverrides(io),
      createServer: (options) => {
        captured = options;
        return fakeServer();
      },
    });
    expect(captured.onClientConnect).toBeDefined();
    expect(captured.onClientDisconnect).toBeDefined();
    captured.onClientConnect?.("127.0.0.1");
    captured.onClientDisconnect?.("127.0.0.1");
    expect(io.stdoutLines.some((l) => l.includes("client connected from 127.0.0.1"))).toBe(true);
    expect(io.stdoutLines.some((l) => l.includes("client disconnected from 127.0.0.1"))).toBe(true);
  });

  test("--quiet omits onClientConnect/onClientDisconnect from the createServer options entirely", async () => {
    const io = fakeIo();
    let sawConnectKey = true;
    let sawDisconnectKey = true;
    await main(["--server", "--quiet"], {
      ...interactiveOverrides(io),
      createServer: (options) => {
        sawConnectKey = "onClientConnect" in options;
        sawDisconnectKey = "onClientDisconnect" in options;
        return fakeServer();
      },
    });
    expect(sawConnectKey).toBe(false);
    expect(sawDisconnectKey).toBe(false);
  });
});
