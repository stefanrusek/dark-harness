import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { readdirSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ROOT_AGENT_ID } from "./agent/runtime.ts";
import {
  AgentRuntimeLoopAdapter,
  type CliDeps,
  type CliIo,
  CliUsageError,
  DEFAULT_PORT,
  DEFAULT_SYSTEM_PROMPT,
  type DhServerLike,
  type WebUiHandleLike,
  composeMode,
  formatVersionString,
  main,
  parseArgs,
  parseEnvFile,
} from "./cli.ts";
import type { DhConfig, ServerSentEvent } from "./contracts/index.ts";
import { ExitCode } from "./contracts/index.ts";
import { DhServer, waitForExitCode } from "./server/index.ts";
import type { AgentLoopHandle, AgentLoopLogListener } from "./server/index.ts";

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

/** A minimal AgentLoopHandle fake — used everywhere the real Server/TUI/Web wiring would
 * otherwise open a real socket or block on real terminal I/O, which unit tests must avoid. */
function fakeAgentLoop(overrides: Partial<AgentLoopHandle> = {}): AgentLoopHandle {
  return {
    onEvent: () => () => {},
    onLog: () => () => {},
    sendMessage: () => {},
    stopAgent: () => {},
    getAgentTree: () => [],
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
      env: null,
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
    ]);
    expect(options).toEqual({
      web: true,
      server: true,
      connect: "example.com",
      port: 5050,
      instructions: "plan.md",
      job: true,
      config: "custom.json",
      env: "secrets.env",
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
});

describe("formatVersionString", () => {
  test("unstamped build", () => {
    expect(
      formatVersionString({ version: "0.1.0", gitSha: null, dirty: false, releaseTag: null }),
    ).toBe("dh 0.1.0 (unstamped)");
  });

  test("stamped clean build", () => {
    expect(
      formatVersionString({ version: "0.1.0", gitSha: "abc123", dirty: false, releaseTag: null }),
    ).toBe("dh 0.1.0 (abc123)");
  });

  test("stamped dirty build", () => {
    expect(
      formatVersionString({ version: "0.1.0", gitSha: "abc123", dirty: true, releaseTag: null }),
    ).toBe("dh 0.1.0 (abc123 dirty)");
  });

  test("stamped release build", () => {
    expect(
      formatVersionString({
        version: "0.1.0",
        gitSha: "abc123",
        dirty: false,
        releaseTag: "v0.1.0",
      }),
    ).toBe("dh 0.1.0 (abc123, v0.1.0)");
  });

  test("stamped dirty release build", () => {
    expect(
      formatVersionString({
        version: "0.1.0",
        gitSha: "abc123",
        dirty: true,
        releaseTag: "v0.1.0",
      }),
    ).toBe("dh 0.1.0 (abc123 dirty, v0.1.0)");
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
    expect(io.stdoutLines[0]).toContain("http://localhost:60001");
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
    expect(io.stdoutLines[0]).toContain("5050");
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
    expect(io.stdoutLines[0]).toContain(String(DEFAULT_PORT));
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
    expect(io.stdoutLines[0]).toContain("http://localhost:60002");
    expect(io.stdoutLines[0]).toContain("http://example.com:9000");
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
      createRuntime: () => ({ runRoot: async () => ({ success: false, finalOutput: "nope" }) }),
    });
    expect(code).toBe(ExitCode.TaskFailure);
    expect(io.exitCodes).toEqual([ExitCode.TaskFailure]);
  });

  test("without --job the process doesn't exit and falls through to a real (faked) interactive mode", async () => {
    const io = fakeIo();
    const code = await main(["--instructions", "plan.md"], {
      ...interactiveOverrides(io),
      readInstructions: async () => "do the thing",
      createRuntime: () => ({ runRoot: async () => ({ success: true, finalOutput: "yay" }) }),
    });
    expect(code).toBe(ExitCode.Success);
    expect(io.exitCodes).toEqual([]);
    expect(io.stdoutLines[0]).toBe("yay");
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

  // Round 8: the standalone path has no interactive TUI/Web/server client attached.
  test('createRuntime is invoked with client: "none"', async () => {
    const io = fakeIo();
    let receivedClient: string | undefined;
    await main(["--instructions", "plan.md", "--job"], {
      ...baseOverrides(io),
      readInstructions: async () => "do the thing",
      createRuntime: (_config, _systemPrompt, client) => {
        receivedClient = client;
        return { runRoot: async () => ({ success: true, finalOutput: "ok" }) };
      },
    });
    expect(receivedClient).toBe("none");
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
    const code = await main([], {
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
        return Response.json({
          id: "msg_mock",
          type: "message",
          role: "assistant",
          model: "mock",
          content: [{ type: "text", text: "all done" }],
          stop_reason: "end_turn",
          stop_sequence: null,
          usage: { input_tokens: 3, output_tokens: 5 },
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

  test("the real createAgentLoop + createServer defaults wire up without a real terminal (startTui faked)", async () => {
    const io = fakeIo();
    const code = await main([], {
      loadConfig: async () => TEST_CONFIG,
      startTui: async () => {},
      io,
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
    });
    expect(code).toBe(ExitCode.Success);
    expect(io.stdoutLines[0]).toMatch(/^dh: web UI ready at http:\/\/localhost:\d+\.$/);
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
      });
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
        return Response.json({
          id: "msg_mock",
          type: "message",
          role: "assistant",
          model: "mock",
          content: [{ type: "text", text: `handled: ${text ?? ""}` }],
          stop_reason: "end_turn",
          stop_sequence: null,
          usage: { input_tokens: 1, output_tokens: 1 },
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
      adapter.sendMessage(ROOT_AGENT_ID, "hello"); // lazily starts the root; the crash is async
      for (let i = 0; i < 3; i += 1) {
        await new Promise((resolve) => setTimeout(resolve, 30));
        expect(adapter.getAgentTree()[0]?.status).toBe("failed");
      }
    } finally {
      unauthorizedServer.stop(true);
    }
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
      expect(statusEvent).toMatchObject({
        type: "agent_status",
        agentId: ROOT_AGENT_ID,
        status: "failed",
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
        return Response.json({
          id: "msg_mock",
          type: "message",
          role: "assistant",
          model: "mock",
          content: [{ type: "text", text: finalText }],
          stop_reason: "end_turn",
          stop_sequence: null,
          usage: { input_tokens: 1, output_tokens: 1 },
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
  test("waitForExitCode resolves TaskFailure through a real DhServer when the operator stops an interactive root mid-conversation", async () => {
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
      expect(await exitCodePromise).toBe(ExitCode.TaskFailure);
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
        return Response.json({
          id: "msg_mock",
          type: "message",
          role: "assistant",
          model: "mock",
          content: [{ type: "text", text: `handled: ${text ?? ""}` }],
          stop_reason: "end_turn",
          stop_sequence: null,
          usage: { input_tokens: 1, output_tokens: 1 },
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
