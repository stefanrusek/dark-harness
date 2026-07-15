// CLI entry point (docs/handoffs/core.md §5). Parses flags, composes the run mode per
// HANDOFF.md §2 / ADR 0001, and either:
//   - runs the root agent directly via AgentRuntime for the standalone `--instructions`
//     dark-factory path (bypasses Server/TUI/Web entirely — see the Round 2 status log in
//     docs/handoffs/core.md for why that's a deliberate choice, not an oversight), or
//   - wires up the real Server/TUI/Web domains for the four interactive run modes (`--server`,
//     local console, local `--web`, `--connect [--web]`), via a thin AgentLoopHandle adapter
//     (AgentRuntimeLoopAdapter below) bridging Core's AgentRuntime to Server's own interface
//     for exactly this purpose (src/server/agent-loop.ts's doc comment, and Grace's own
//     round-1 status-log note, both call this out as the intended integration point).

import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { AgentRuntime, ROOT_AGENT_ID } from "./agent/runtime.ts";
import { ConfigError, DEFAULT_CONFIG_PATH, loadConfig } from "./config/index.ts";
import type { AgentTreeNode, DhConfig, ExitCode as ExitCodeType } from "./contracts/index.ts";
import { ExitCode } from "./contracts/index.ts";
import {
  type AgentLoopEventListener,
  type AgentLoopHandle,
  type AgentLoopLogListener,
  DhServer,
  type DhServerOptions,
  type Unsubscribe,
} from "./server/index.ts";
import { startTui as startTuiClient } from "./tui/index.ts";
import { serveWebUi as serveWebUiClient } from "./web/server.ts";

export const DEFAULT_PORT = 4000;

/** Placeholder until the Prompt domain lands `src/prompt/`'s built-in system prompt
 * (docs/handoffs/core.md §4: "accept any string for now"). Overridable via
 * `dh.json`'s `systemPrompt` path either way. */
export const DEFAULT_SYSTEM_PROMPT =
  "You are Dark Harness (dh), an autonomous coding agent. " +
  "TODO(prompt domain): replace this placeholder with the real built-in system prompt.";

export class CliUsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CliUsageError";
  }
}

export interface CliOptions {
  web: boolean;
  server: boolean;
  connect: string | null;
  port: number | null;
  instructions: string | null;
  job: boolean;
  config: string;
}

const FLAGS_WITH_VALUES = new Set(["--connect", "--port", "--instructions", "--config"]);

/** Parses argv (excluding the `bun`/script prefix — pass `process.argv.slice(2)`). Throws
 * CliUsageError on anything malformed; never exits or prints — that's main()'s job. */
export function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    web: false,
    server: false,
    connect: null,
    port: null,
    instructions: null,
    job: false,
    config: DEFAULT_CONFIG_PATH,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--web") {
      options.web = true;
      continue;
    }
    if (arg === "--server") {
      options.server = true;
      continue;
    }
    if (arg === "--job") {
      options.job = true;
      continue;
    }
    if (arg !== undefined && FLAGS_WITH_VALUES.has(arg)) {
      i += 1;
      const value = argv[i];
      if (value === undefined) {
        throw new CliUsageError(`${arg} requires a value`);
      }
      if (arg === "--connect") options.connect = value;
      else if (arg === "--instructions") options.instructions = value;
      else if (arg === "--config") options.config = value;
      else {
        const parsed = Number(value);
        if (!Number.isInteger(parsed) || parsed <= 0) {
          throw new CliUsageError(`--port must be a positive integer, got "${value}"`);
        }
        options.port = parsed;
      }
      continue;
    }
    throw new CliUsageError(`unknown flag: ${arg}`);
  }

  return options;
}

export type RunMode =
  | { kind: "local"; web: boolean }
  | { kind: "server"; port: number }
  | { kind: "connect"; host: string; port: number; web: boolean };

/** Mode composition per HANDOFF.md §2's invocation table. Pure function of parsed flags. */
export function composeMode(options: CliOptions): RunMode {
  if (options.connect !== null) {
    return {
      kind: "connect",
      host: options.connect,
      port: options.port ?? DEFAULT_PORT,
      web: options.web,
    };
  }
  if (options.server) {
    return { kind: "server", port: options.port ?? DEFAULT_PORT };
  }
  return { kind: "local", web: options.web };
}

async function readInstructionsFile(path: string): Promise<string> {
  const file = Bun.file(path);
  if (!(await file.exists())) {
    throw new ConfigError(`instructions file not found: ${path}`);
  }
  return file.text();
}

async function loadSystemPrompt(config: DhConfig): Promise<string> {
  if (!config.systemPrompt) {
    return DEFAULT_SYSTEM_PROMPT;
  }
  const file = Bun.file(config.systemPrompt);
  if (!(await file.exists())) {
    throw new ConfigError(`systemPrompt file not found: ${config.systemPrompt}`);
  }
  return file.text();
}

/**
 * Bridges Core's AgentRuntime (a single fixed onEvent/onLogLine callback pair, set at
 * construction) to Server's AgentLoopHandle (multi-subscriber onEvent/onLog, plus
 * sendMessage/stopAgent/getAgentTree) — the integration point flagged in both
 * src/server/agent-loop.ts's doc comment and Grace's round-1 status-log note ("(b) a thin
 * wrapper in src/cli.ts bridges Core's actual shape to this one").
 *
 * Identifier space (docs/handoffs/core.md Round 2 status log): "agentId" here is always the
 * SAME string AgentRuntime already uses for its own SSE events/log lines — ROOT_AGENT_ID for
 * the root, and (as of this round) the task registry's own id for every sub-agent, since
 * AgentRuntime.spawnAgent() now passes its loop-internal id as the task's id too. No
 * translation table needed.
 *
 * Root agent lifecycle: interactive mode has no `--instructions` file, so the root agent
 * doesn't start until the operator's first message arrives (matches HANDOFF.md §8's "text
 * input for sending it messages" — there's nothing to show until something is sent).
 * sendMessage(ROOT_AGENT_ID, ...) lazily starts it on the first call (fire-and-forget; a
 * synthetic `agent_status: failed` event covers a harness error that prevents it from ever
 * starting, so a broken provider/config doesn't silently vanish) and steers the
 * already-running loop on every call after that.
 */
export class AgentRuntimeLoopAdapter implements AgentLoopHandle {
  readonly runtime: AgentRuntime;
  private readonly eventListeners = new Set<AgentLoopEventListener>();
  private readonly logListeners = new Set<AgentLoopLogListener>();

  constructor(options: { config: DhConfig; systemPrompt: string }) {
    this.runtime = new AgentRuntime({
      config: options.config,
      systemPrompt: options.systemPrompt,
      onEvent: (event) => {
        for (const listener of this.eventListeners) listener(event);
      },
      onLogLine: (agentId, line) => {
        for (const listener of this.logListeners) listener(agentId, line);
      },
    });
  }

  onEvent(listener: AgentLoopEventListener): Unsubscribe {
    this.eventListeners.add(listener);
    return () => this.eventListeners.delete(listener);
  }

  onLog(listener: AgentLoopLogListener): Unsubscribe {
    this.logListeners.add(listener);
    return () => this.logListeners.delete(listener);
  }

  sendMessage(agentId: string, message: string): void {
    if (agentId !== ROOT_AGENT_ID) {
      this.runtime.tasks.sendMessage(agentId, message);
      return;
    }
    if (!this.runtime.rootHasStarted) {
      // Fire-and-forget: the command handler (POST /api/commands) shouldn't block on the
      // whole root agent run just to acknowledge "message accepted" — progress streams via
      // onEvent/onLog as normal. A harness error before the loop ever gets going (bad
      // model/provider config) would otherwise be an unhandled rejection; surface it as a
      // synthetic agent_status instead of crashing the process.
      this.runtime.runRoot(message).catch(() => {
        const event = {
          version: 1 as const,
          id: randomUUID(),
          timestamp: new Date().toISOString(),
          type: "agent_status" as const,
          agentId: ROOT_AGENT_ID,
          status: "failed" as const,
        };
        for (const listener of this.eventListeners) listener(event);
      });
      return;
    }
    this.runtime.sendMessageToRoot(message);
  }

  stopAgent(agentId: string): void {
    if (agentId === ROOT_AGENT_ID) {
      // Known limitation, not new this round (docs/handoffs/core.md Round 2 status log):
      // loop.ts has no cooperative cancellation at all yet — TaskStop's abort signal only
      // ever interrupted a run_in_background Bash call, never a loop mid-turn, for
      // sub-agents either. A safe no-op here is honest about what's actually supported
      // rather than throwing and failing the command handler for an operation the loop
      // can't actually perform yet.
      return;
    }
    this.runtime.tasks.stop(agentId);
  }

  getAgentTree(): AgentTreeNode[] {
    return this.runtime.getAgentTree();
  }
}

export interface DhServerLike {
  start(): number;
  stop(): void;
}

export interface WebUiHandleLike {
  url: string;
  stop(): void;
}

export interface CliIo {
  stdout: (message: string) => void;
  stderr: (message: string) => void;
  exit: (code: ExitCodeType) => void;
}

export interface CliDeps {
  loadConfig: (path: string) => Promise<DhConfig>;
  readInstructions: (path: string) => Promise<string>;
  loadSystemPrompt: (config: DhConfig) => Promise<string>;
  /** Used only by the standalone `--instructions` path (see the module doc comment above
   * for why that path never goes through createAgentLoop/createServer). */
  createRuntime: (config: DhConfig, systemPrompt: string) => Pick<AgentRuntime, "runRoot">;
  /** Used by every interactive mode (server/local/connect). */
  createAgentLoop: (config: DhConfig, systemPrompt: string) => AgentLoopHandle;
  createServer: (options: DhServerOptions) => DhServerLike;
  startTui: (baseUrl: string) => Promise<void>;
  serveWebUi: (options: {
    port: number;
    targetBaseUrl: string;
    token?: string;
  }) => WebUiHandleLike;
  io: CliIo;
}

function defaultDeps(): CliDeps {
  return {
    loadConfig,
    readInstructions: readInstructionsFile,
    loadSystemPrompt,
    createRuntime: (config, systemPrompt) => new AgentRuntime({ config, systemPrompt }),
    createAgentLoop: (config, systemPrompt) =>
      new AgentRuntimeLoopAdapter({ config, systemPrompt }),
    createServer: (options) => new DhServer(options),
    startTui: (baseUrl) => startTuiClient(baseUrl),
    serveWebUi: (options) => serveWebUiClient(options),
    io: {
      stdout: (message) => console.log(message),
      stderr: (message) => console.error(message),
      exit: (code) => process.exit(code),
    },
  };
}

function fail(io: CliIo, message: string): ExitCodeType {
  io.stderr(`dh: ${message}`);
  io.exit(ExitCode.HarnessError);
  return ExitCode.HarnessError;
}

/**
 * Starts whichever of the four interactive run modes `mode` composes to and returns the
 * exit code to report (Success unless starting the mode itself fails — e.g. the requested
 * `--server`/`--connect` port is already in use, a harness-error class per ADR 0006, not a
 * crash).
 *
 * Judgment call (docs/handoffs/core.md Round 2 status log, `--port` scope): only `--server`'s
 * own listen port and `--connect`'s remote target port are operator-configurable via
 * `--port`, matching ADR 0001's "listen port for --server, target port for --connect" — every
 * locally-started service that exists purely so an in-process TUI/Web client has something
 * to talk to (local mode's own DhServer; either mode's web-UI static server) binds an
 * ephemeral port (0) and prints/returns the URL instead, since HANDOFF.md never documents
 * `--port` as applying to local mode at all.
 *
 * Judgment call (client TLS): `--connect`'s targetBaseUrl dials `https://` when the
 * *connecting side's own* `dh.json` sets `security.tls` — ADR 0004 says "clients connect
 * with https:// when the target uses TLS" but leaves the "auto-detect or a client-side flag"
 * choice to the fleet. Reusing `security.tls`'s presence (already how "clients supply their
 * own token via their own dh.json" works for the bearer-token side) avoids inventing a new
 * flag or a probe-the-server-first mechanism; flagged in the status log in case a future
 * round wants true auto-detection instead.
 */
async function runInteractiveMode(
  mode: RunMode,
  config: DhConfig,
  systemPrompt: string,
  deps: CliDeps,
): Promise<ExitCodeType> {
  const { io } = deps;
  try {
    if (mode.kind === "connect") {
      const scheme = config.security?.tls ? "https" : "http";
      const targetBaseUrl = `${scheme}://${mode.host}:${mode.port}`;
      if (mode.web) {
        const handle = deps.serveWebUi({
          port: 0,
          targetBaseUrl,
          ...(config.security?.token ? { token: config.security.token } : {}),
        });
        io.stdout(`dh: web UI ready at ${handle.url} (connected to ${targetBaseUrl}).`);
        return ExitCode.Success;
      }
      await deps.startTui(targetBaseUrl);
      return ExitCode.Success;
    }

    // mode.kind is "local" or "server" — both start a real local DhServer.
    const agentLoop = deps.createAgentLoop(config, systemPrompt);
    const sessionId = randomUUID();
    const logDir = join(process.cwd(), ".dh-logs", sessionId);
    const server = deps.createServer({
      agentLoop,
      sessionId,
      logDir,
      port: mode.kind === "server" ? mode.port : 0,
      ...(config.security ? { security: config.security } : {}),
    });
    const boundPort = server.start();

    if (mode.kind === "server") {
      io.stdout(`dh: headless server listening on port ${boundPort} (session ${sessionId}).`);
      return ExitCode.Success;
    }

    const baseUrl = `http://localhost:${boundPort}`;
    if (mode.web) {
      const handle = deps.serveWebUi({
        port: 0,
        targetBaseUrl: baseUrl,
        ...(config.security?.token ? { token: config.security.token } : {}),
      });
      io.stdout(`dh: web UI ready at ${handle.url}.`);
      return ExitCode.Success;
    }

    await deps.startTui(baseUrl);
    server.stop();
    return ExitCode.Success;
  } catch (err) {
    return fail(io, `failed to start ${mode.kind} mode: ${(err as Error).message}`);
  }
}

/** Runs the CLI end to end. Returns the exit code it either passed to `deps.io.exit` (real
 * process) or would have (tests inject a no-op `exit` and read the return value instead). */
export async function main(
  argv: string[],
  overrides: Partial<CliDeps> = {},
): Promise<ExitCodeType> {
  const deps: CliDeps = { ...defaultDeps(), ...overrides };
  const { io } = deps;

  let options: CliOptions;
  try {
    options = parseArgs(argv);
  } catch (err) {
    return fail(io, (err as Error).message);
  }

  const mode = composeMode(options);

  let config: DhConfig;
  try {
    config = await deps.loadConfig(options.config);
  } catch (err) {
    return fail(io, (err as Error).message);
  }

  let systemPrompt: string;
  try {
    systemPrompt = await deps.loadSystemPrompt(config);
  } catch (err) {
    return fail(io, (err as Error).message);
  }

  if (options.instructions === null) {
    return runInteractiveMode(mode, config, systemPrompt, deps);
  }

  // Standalone dark-factory path: deliberately bypasses Server/TUI/Web entirely, even in
  // this round with all three landed (docs/handoffs/core.md Round 2 status log, point 3 —
  // "don't regress the exit-code path you already built and verified via live subprocess
  // runs"). `--connect` has no wire-protocol command to start a brand-new root agent
  // remotely (ClientCommand only covers send_message/stop_agent/request_agent_tree/
  // download_logs against an *already-running* session), so it stays unsupported here.
  if (mode.kind === "connect") {
    return fail(
      io,
      "--instructions is not supported with --connect yet (remote instruction delivery is a " +
        "Server-domain feature not landed in this round).",
    );
  }

  let instructionText: string;
  try {
    instructionText = await deps.readInstructions(options.instructions);
  } catch (err) {
    return fail(io, (err as Error).message);
  }

  const runtime = deps.createRuntime(config, systemPrompt);

  let result: { success: boolean; finalOutput: string };
  try {
    result = await runtime.runRoot(instructionText);
  } catch (err) {
    return fail(io, `root agent crashed: ${(err as Error).message}`);
  }

  io.stdout(result.finalOutput);

  if (!options.job) {
    // Without --job the process stays alive after completion for inspection (HANDOFF.md
    // §2) — now via the same real interactive surface the no-instructions path uses. Note
    // this is a fresh AgentRuntime/session, not a continuation of the one that just ran the
    // instruction (unifying those is out of scope this round — see the status log).
    return runInteractiveMode(mode, config, systemPrompt, deps);
  }

  const code = result.success ? ExitCode.Success : ExitCode.TaskFailure;
  io.exit(code);
  return code;
}

if (import.meta.main) {
  await main(process.argv.slice(2));
}
