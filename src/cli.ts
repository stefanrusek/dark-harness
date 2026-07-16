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
import { createProvider } from "./agent/providers/index.ts";
import type { ModelProvider } from "./agent/providers/types.ts";
import { AgentRuntime, ROOT_AGENT_ID } from "./agent/runtime.ts";
import { BUILD_INFO } from "./config/build-info.ts";
import { ConfigError, DEFAULT_CONFIG_PATH, loadConfig } from "./config/index.ts";
import type {
  AgentTreeNode,
  BuildInfo,
  DhConfig,
  ExitCode as ExitCodeType,
  ProviderConfig,
  SessionClientKind,
} from "./contracts/index.ts";
import { ExitCode } from "./contracts/index.ts";
import {
  type AgentLoopEventListener,
  type AgentLoopHandle,
  type AgentLoopLogListener,
  DhServer,
  type DhServerOptions,
  SessionLogger,
  type Unsubscribe,
  formatSessionLogTree,
  pruneLogDirectories,
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
  env: string | null;
  /** DH-0035: `--check` (or the `dh doctor` subcommand, an alias set by main()) — runs one
   * cheap no-op provider call per configured model and exits, never entering the agent loop. */
  check: boolean;
  /** DH-0035: validates config/instructions/provider-client construction and exits 0 without
   * ever calling a model. */
  dryRun: boolean;
}

const FLAGS_WITH_VALUES = new Set(["--connect", "--port", "--instructions", "--config", "--env"]);

/** DH-0035: the minimal, valid `dh.json` scaffolded by `dh init` — kept byte-for-byte in sync
 * with README.md's own sample config so the two never drift apart. */
export const SAMPLE_DH_JSON = `{
  "options": { "defaultModel": "sonnet", "runInBackgroundDefault": true, "maxTurns": 100 },
  "models": [
    {
      "name": "sonnet",
      "provider": "anthropic",
      "model": "sonnet-5",
      "inputPricePerMToken": 3,
      "outputPricePerMToken": 15
    },
    { "name": "gemma4", "provider": "bedrock", "model": "gemma4" }
  ],
  "provider": [
    { "name": "anthropic", "type": "anthropic" },
    { "name": "bedrock", "type": "bedrock" },
    { "name": "local", "type": "anthropic", "baseURL": "http://localhost:8080" }
  ],
  "skillPaths": ["./skills"],
  "mcpServers": {},
  "systemPrompt": null,
  "security": { "token": null, "tls": null }
}
`;

/** Printed by `--help`/`-h`, handled before flag parsing/config loading so it never depends
 * on a working `dh.json` — mirrors the mode matrix and flag list in README.md / HANDOFF.md §2. */
export const HELP_TEXT = `dh — Dark Harness: an autonomous coding agent harness.

Usage:
  dh                              Local server + console TUI, one process.
  dh --web                        Local server + locally-served web UI.
  dh --server                     Headless server only (port 4000, or --port).
  dh --connect <host>              Console client to a remote server.
  dh --connect <host> --web        Web client, locally served, connected to a remote server.
  dh init                         Scaffold a starter dh.json in the working directory.
  dh doctor                       Alias for --check.
  dh logs <sessionDir>             Print the agent tree (status/cost/duration) for a
                                   ".dh-logs/<sessionId>" directory — DH-0037.

Flags:
  --web                    Serve the web UI instead of (or alongside --connect) the console TUI.
  --server                 Run headless (no client attached).
  --connect <host>         Connect to a remote dh --server instead of starting a local one.
  --port <n>               Listen port for --server, or target port for --connect (default 4000).
  --instructions <file>    Path to an instructions file; starts the root agent on it immediately.
  --job                    Exit when the root agent finishes: 0 success, 1 self-reported failure, 2+ harness error.
  --config <path>          Path to dh.json (default: ./dh.json).
  --env <file>             Load dotenv-style environment variables from <file> before dh.json
                           is loaded, so its $(VAR) interpolation can see them.
  --check                  For each configured model, make one cheap no-op provider call and
                           report pass/fail, then exit. Never enters the agent loop. Same as
                           the "dh doctor" subcommand.
  --dry-run                Validate config parsing, instructions file readability, and
                           provider client construction, then exit 0. Never calls a model.
  --help, -h               Show this help and exit.
  --version                Show build identity (version, git sha, dirty flag) and exit.

Config: dh.json in the working directory (or --config <path>). See README.md for the schema.
`;

/** Round 8: same motivation as the whole round — "which build produced this?" shouldn't
 * require digging through a log directory. Format: `dh <version> (<sha|unstamped>[
 * dirty][, <releaseTag>])`. */
export function formatVersionString(build: BuildInfo): string {
  let inner = build.gitSha ?? "unstamped";
  if (build.dirty) inner += " dirty";
  if (build.releaseTag) inner += `, ${build.releaseTag}`;
  return `dh ${build.version} (${inner})`;
}

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
    env: null,
    check: false,
    dryRun: false,
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
    if (arg === "--check") {
      options.check = true;
      continue;
    }
    if (arg === "--dry-run") {
      options.dryRun = true;
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
      else if (arg === "--env") options.env = value;
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

async function readEnvFile(path: string): Promise<string> {
  const file = Bun.file(path);
  if (!(await file.exists())) {
    throw new ConfigError(`env file not found: ${path}`);
  }
  return file.text();
}

/** Resolves `\"`, `\\`, `\n`, `\t` escapes inside a double-quoted value's content — the only
 * quoting style that gets escape processing (DH-0015: single-quoted values are deliberately
 * literal, see parseEnvFile's own doc comment). */
function unescapeDoubleQuoted(value: string): string {
  return value.replace(/\\(["\\nt])/g, (_whole, ch: string) => {
    if (ch === "n") return "\n";
    if (ch === "t") return "\t";
    return ch; // \" -> ", \\ -> \
  });
}

/**
 * Parses a dotenv-style file — a deliberately minimal, documented subset (README.md's
 * "Keeping secrets out of dh.json" section states this exact behavior for operators), not a
 * reimplementation of any particular dotenv tool's full dialect:
 *
 * - `KEY=VALUE` per line; blank lines and lines starting with `#` (after trimming leading
 *   whitespace) are skipped as comments. `#` is NOT an inline/trailing comment marker within
 *   a value — DH-0015 fix: previously undocumented and easy to get wrong by assuming common
 *   dotenv-tool behavior; a value containing `#` is always taken literally, in full.
 * - A double-quoted value (`"..."`) has its surrounding quotes stripped, with `\"`, `\\`,
 *   `\n`, `\t` escapes resolved inside it — DH-0015 fix: previously quotes were stripped with
 *   zero escape processing, so there was no way to express a literal embedded `"` or a newline.
 * - A single-quoted value (`'...'`) — DH-0015 addition — has its surrounding quotes stripped
 *   with NO escape processing at all: the one way to express a value containing a literal `#`,
 *   backslash, or double-quote without needing to escape anything.
 * - An unquoted value is used as-is (after trimming surrounding whitespace).
 *
 * Pure function — throws a clear error naming the offending line for anything without an `=`.
 */
export function parseEnvFile(content: string): Record<string, string> {
  const result: Record<string, string> = {};
  const lines = content.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) {
      continue;
    }
    const eqIndex = trimmed.indexOf("=");
    if (eqIndex === -1) {
      throw new Error(`malformed env file line ${i + 1}: expected KEY=VALUE, got "${line}"`);
    }
    const key = trimmed.slice(0, eqIndex).trim();
    let value = trimmed.slice(eqIndex + 1).trim();
    if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
      value = unescapeDoubleQuoted(value.slice(1, -1));
    } else if (value.length >= 2 && value.startsWith("'") && value.endsWith("'")) {
      value = value.slice(1, -1);
    }
    result[key] = value;
  }
  return result;
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

  constructor(options: { config: DhConfig; systemPrompt: string; client: SessionClientKind }) {
    this.runtime = new AgentRuntime({
      config: options.config,
      systemPrompt: options.systemPrompt,
      client: options.client,
      // Round 5 (docs/handoffs/core.md status log): every interactive session — server/TUI/
      // Web, root and sub-agents alike — pauses instead of ending on a non-tool-use turn.
      // The standalone `--instructions`/`--job` path (defaultDeps().createRuntime) never sets
      // this, preserving its original end-on-first-non-tool-call behavior exactly.
      interactive: true,
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
      this.runtime.runRoot(message).catch((err: unknown) => {
        // DH-0017 fix: this used to discard `err` entirely (`.catch(() => { ... })`), so a
        // root-start failure (bad model/provider config, an auth failure before the loop ever
        // produced a self-report) surfaced to an operator as an opaque "failed" status with
        // zero diagnostic detail — exactly the class of failure ADR 0005's JSONL logging
        // exists to make diagnosable. Now logs the real error message (via onLogLine, tagged
        // to the root agent) before/alongside the same synthetic agent_status this always
        // emitted, so the reason reaches the durable log, not just a transient status flip.
        const message = err instanceof Error ? err.message : String(err);
        for (const listener of this.logListeners) {
          listener(ROOT_AGENT_ID, {
            version: 1,
            timestamp: new Date().toISOString(),
            type: "message",
            role: "system",
            content: `Root agent failed to start: ${message}`,
          });
        }
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
      // Round 3 fix (docs/handoffs/core.md status log): this used to be a documented no-op
      // — loop.ts had no cooperative cancellation at all. AgentRuntime.stopRoot() now
      // triggers the root's own AbortController; see loop.ts's AgentLoopParams.signal doc
      // comment for exactly what "stop" does and doesn't interrupt (between-turns and the
      // in-flight provider call, not a tool call already in progress).
      this.runtime.stopRoot();
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
  readEnvFile: (path: string) => Promise<string>;
  applyEnv: (vars: Record<string, string>) => void;
  loadSystemPrompt: (config: DhConfig) => Promise<string>;
  /** DH-0035 (`dh init`): whether a file already exists at `path` — injectable so tests never
   * touch the real filesystem. */
  fileExists: (path: string) => Promise<boolean>;
  /** DH-0035 (`dh init`): writes `contents` to `path`, creating it. */
  writeFile: (path: string, contents: string) => Promise<void>;
  /** DH-0035 (`dh doctor`/`--check`, `--dry-run`): builds the real provider adapter for a
   * `dh.json` provider entry — injectable so tests can supply a fake that never hits the
   * network. Construction itself (as opposed to `.complete()`) is synchronous today for both
   * built-in adapters, but the signature stays sync-or-throw either way. */
  createProvider: (config: ProviderConfig) => ModelProvider;
  /** Used only by the standalone `--instructions` path (see the module doc comment above
   * for why that path never goes through createAgentLoop/createServer). Exposes `stopRoot`
   * too (DH-0011) so this path's SIGTERM/SIGINT handler has something real to call. */
  createRuntime: (
    config: DhConfig,
    systemPrompt: string,
    client: SessionClientKind,
  ) => Pick<AgentRuntime, "runRoot" | "stopRoot">;
  /** Used by every interactive mode (server/local/connect). */
  createAgentLoop: (
    config: DhConfig,
    systemPrompt: string,
    client: SessionClientKind,
  ) => AgentLoopHandle;
  createServer: (options: DhServerOptions) => DhServerLike;
  /** DH-0059: `ownsServer` tells the TUI whether this process also constructed the
   * `DhServer` it's talking to (local mode) — only this module knows, since it's the one
   * that did or didn't build one. Local mode passes `{ ownsServer: true }`; `--connect`
   * mode passes nothing, defaulting to `false` (unchanged detach-only behavior). */
  startTui: (baseUrl: string, token?: string, opts?: { ownsServer?: boolean }) => Promise<void>;
  serveWebUi: (options: {
    port: number;
    targetBaseUrl: string;
    token?: string;
  }) => WebUiHandleLike;
  io: CliIo;
  /**
   * DH-0011 fix (tracking/DH-0011-no-signal-handling-or-process-group-reaping.md): grepping
   * the whole codebase for SIGTERM/SIGINT/process.on used to return nothing — the canonical
   * dark-factory deployment (a container, per HANDOFF.md §1/§11) receives SIGTERM on
   * scale-down/redeploy, and with no handler Bun's default behavior kills the process
   * abruptly with no chance to flush a final log line or stop in-flight work. Installs a
   * handler for both signals; `onSignal` is called (at most once — a second signal during an
   * already-in-progress shutdown is a no-op here, letting the OS's own default disposition
   * take over if the operator insists) with which signal fired. Returns an uninstall
   * function. Injectable so tests never register a real `process.on` listener (which would
   * leak across test files and could fire during unrelated test-runner signal handling).
   */
  installSignalHandlers: (onSignal: (signal: "SIGTERM" | "SIGINT") => void) => () => void;
}

/**
 * Round 6a (docs/handoffs/core.md): the standalone `--instructions`/`--job` path never went
 * through Server's DhServer, so it never got a SessionLogger attached — a crashed or failed
 * unattended container run left no JSONL trail at all, for exactly the headless/unattended/
 * hours-long scenario the product is built around (HANDOFF.md §7 treats logging as
 * first-class, same weight as the agent loop itself). Fix: attach the same JSONL sink here,
 * directly, without starting an HTTP server just to get one — `SessionLogger` (Server's own
 * per-agent JSONL writer, already exported from `./server/index.ts`) is reused rather than
 * reimplemented; `loop.ts` already emits its own `LogHeader` first line per agent, so no
 * separate header-writing logic is needed here either.
 */
function createStandaloneRuntime(config: DhConfig, systemPrompt: string): AgentRuntime {
  const sessionId = randomUUID();
  const logsRoot = join(process.cwd(), ".dh-logs");
  // DH-0037: config-gated `.dh-logs` rotation, off by default (see LogRetentionConfig's own
  // doc comment) — a no-op unless `dh.json` sets `logRetention`. Runs before this session's
  // own directory is created, so it never prunes itself (excludeSessionId).
  pruneLogDirectories(logsRoot, config.logRetention, Date.now(), sessionId);
  const logDir = join(logsRoot, sessionId);
  const logger = new SessionLogger(logDir);
  return new AgentRuntime({
    config,
    systemPrompt,
    sessionId,
    // The standalone `--instructions`/`--job` dark-factory path has no interactive
    // TUI/Web/server client attached — "none" per SessionClientKind's own doc comment.
    client: "none",
    onLogLine: (agentId, line) => logger.append(agentId, line),
  });
}

function defaultDeps(): CliDeps {
  return {
    loadConfig,
    readInstructions: readInstructionsFile,
    readEnvFile,
    applyEnv: (vars) => Object.assign(process.env, vars),
    loadSystemPrompt,
    fileExists: (path) => Bun.file(path).exists(),
    writeFile: async (path, contents) => {
      await Bun.write(path, contents);
    },
    createProvider,
    // The standalone path's own runtime is always constructed with client: "none" directly
    // inside createStandaloneRuntime() (it's not one of the four interactive modes this
    // `client` param maps from), so the value passed here is intentionally unused.
    createRuntime: (config, systemPrompt) => createStandaloneRuntime(config, systemPrompt),
    createAgentLoop: (config, systemPrompt, client) =>
      new AgentRuntimeLoopAdapter({ config, systemPrompt, client }),
    createServer: (options) => new DhServer(options),
    startTui: (baseUrl, token, opts) => startTuiClient(baseUrl, token, opts),
    serveWebUi: (options) => serveWebUiClient(options),
    io: {
      stdout: (message) => console.log(message),
      stderr: (message) => console.error(message),
      exit: (code) => process.exit(code),
    },
    installSignalHandlers: (onSignal) => {
      let firedOnce = false;
      const handler = (signal: "SIGTERM" | "SIGINT") => () => {
        if (firedOnce) return; // let a second signal fall through to the OS default.
        firedOnce = true;
        onSignal(signal);
      };
      const sigterm = handler("SIGTERM");
      const sigint = handler("SIGINT");
      process.on("SIGTERM", sigterm);
      process.on("SIGINT", sigint);
      return () => {
        process.off("SIGTERM", sigterm);
        process.off("SIGINT", sigint);
      };
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
      await deps.startTui(targetBaseUrl, config.security?.token);
      return ExitCode.Success;
    }

    // mode.kind is "local" or "server" — both start a real local DhServer. Round 8: maps
    // the run mode to the SessionClientKind stamped into every agent's log header this
    // process writes — `--server` is headless ("server"); local mode is "web" or "tui"
    // depending on which client attaches to the DhServer this process also starts.
    const clientKind: SessionClientKind =
      mode.kind === "server" ? "server" : mode.web ? "web" : "tui";
    const agentLoop = deps.createAgentLoop(config, systemPrompt, clientKind);
    const sessionId = randomUUID();
    const logsRoot = join(process.cwd(), ".dh-logs");
    // DH-0037: see createStandaloneRuntime's identical call above for the rationale.
    pruneLogDirectories(logsRoot, config.logRetention, Date.now(), sessionId);
    const logDir = join(logsRoot, sessionId);
    const server = deps.createServer({
      agentLoop,
      sessionId,
      logDir,
      port: mode.kind === "server" ? mode.port : 0,
      ...(config.security ? { security: config.security } : {}),
    });
    const boundPort = server.start();

    // DH-0011: this process owns real resources from here on (the DhServer's listening
    // socket, the AgentRuntime driving it) — exactly the "container receives SIGTERM on
    // scale-down" scenario HANDOFF.md's canonical deployment describes. `webHandle` is
    // populated by the `mode.web` branch below (if taken) — declared here, ahead of it, so
    // the shutdown closure captures whichever resources actually ended up live by the time a
    // signal fires, without duplicating this logic per branch.
    let webHandle: WebUiHandleLike | undefined;
    let shuttingDown = false;
    const uninstallSignals = deps.installSignalHandlers((signal) => {
      if (shuttingDown) return;
      shuttingDown = true;
      io.stderr(`dh: received ${signal}; shutting down session ${sessionId}...`);
      try {
        agentLoop.stopAgent(ROOT_AGENT_ID);
      } catch {
        // best-effort — nothing running yet, or already stopped.
      }
      try {
        webHandle?.stop();
      } catch {
        // best-effort.
      }
      try {
        server.stop();
      } catch {
        // best-effort.
      }
      uninstallSignals();
      io.exit(ExitCode.Success);
    });

    if (mode.kind === "server") {
      io.stdout(`dh: headless server listening on port ${boundPort} (session ${sessionId}).`);
      return ExitCode.Success;
    }

    const baseUrl = `http://localhost:${boundPort}`;
    if (mode.web) {
      webHandle = deps.serveWebUi({
        port: 0,
        targetBaseUrl: baseUrl,
        ...(config.security?.token ? { token: config.security.token } : {}),
      });
      io.stdout(`dh: web UI ready at ${webHandle.url}.`);
      return ExitCode.Success;
    }

    await deps.startTui(baseUrl, config.security?.token, { ownsServer: true });
    // DH-0059 backstop: guarantees no orphaned root agent regardless of *how* the TUI
    // resolved — a graceful Ctrl+C shutdown already stopped it (this is then a no-op re-abort
    // of an already-idempotent stopRoot()), but a force quit, the TUI's own fallback timer, or
    // a root that was never started all resolve `startTui` without ever having stopped it.
    try {
      agentLoop.stopAgent(ROOT_AGENT_ID);
    } catch {
      // best-effort — nothing running yet, or already stopped.
    }
    uninstallSignals();
    server.stop();
    return ExitCode.Success;
  } catch (err) {
    return fail(io, `failed to start ${mode.kind} mode: ${(err as Error).message}`);
  }
}

/**
 * `dh init` (DH-0035): scaffolds README.md's sample `dh.json` into the working directory (or
 * wherever `--config <path>` points). Refuses to overwrite an existing config file — fails
 * loudly rather than clobbering an operator's real config. Only `--config` is a meaningful
 * flag here; anything else is a usage error, same as any other unrecognized flag.
 */
async function runInit(argv: string[], deps: CliDeps): Promise<ExitCodeType> {
  const { io } = deps;
  let targetPath = DEFAULT_CONFIG_PATH;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--config") {
      i += 1;
      const value = argv[i];
      if (value === undefined) {
        return fail(io, "--config requires a value");
      }
      targetPath = value;
      continue;
    }
    return fail(io, `unknown flag: ${arg}`);
  }

  let exists: boolean;
  try {
    exists = await deps.fileExists(targetPath);
  } catch (err) {
    return fail(io, `failed to check ${targetPath}: ${(err as Error).message}`);
  }
  if (exists) {
    return fail(
      io,
      `refusing to overwrite existing config file: ${targetPath} (remove it first, or pass --config <path> to scaffold somewhere else)`,
    );
  }

  try {
    await deps.writeFile(targetPath, SAMPLE_DH_JSON);
  } catch (err) {
    return fail(io, `failed to write ${targetPath}: ${(err as Error).message}`);
  }

  io.stdout(
    `dh: wrote a starter config to ${targetPath}. Edit it to add your API key/model, then run "dh" to start (or "dh doctor" to verify it first).`,
  );
  io.exit(ExitCode.Success);
  return ExitCode.Success;
}

/**
 * `dh doctor` / `--check` (DH-0035): for each configured model, makes one cheap no-op provider
 * call (a 1-token completion, no tools) and reports pass/fail — never enters the real agent
 * loop, so a broken credential/model-access problem surfaces before an operator commits to a
 * real (possibly costly, possibly unattended) run.
 */
async function runDoctor(config: DhConfig, deps: CliDeps): Promise<ExitCodeType> {
  const { io } = deps;
  const providersByName = new Map(config.provider.map((p) => [p.name, p]));
  let anyFailed = false;

  for (const model of config.models) {
    const providerConfig = providersByName.get(model.provider);
    if (!providerConfig) {
      // Shouldn't happen post-validateConfig (models reference known providers), but a
      // provider-agnostic guard costs nothing and keeps this loop crash-free either way.
      io.stdout(`FAIL ${model.name}: no provider named "${model.provider}" in config`);
      anyFailed = true;
      continue;
    }
    try {
      const provider = deps.createProvider(providerConfig);
      await provider.complete({
        model: model.model,
        system: "dh doctor: connectivity check.",
        messages: [{ role: "user", content: [{ type: "text", text: "ping" }] }],
        tools: [],
        maxTokens: 1,
      });
      io.stdout(`PASS ${model.name} (provider "${providerConfig.name}")`);
    } catch (err) {
      io.stdout(
        `FAIL ${model.name} (provider "${providerConfig.name}"): ${(err as Error).message}`,
      );
      anyFailed = true;
    }
  }

  const code = anyFailed ? ExitCode.HarnessError : ExitCode.Success;
  io.exit(code);
  return code;
}

/**
 * `--dry-run` (DH-0035): validates everything up to but not including the first real model
 * call — config (already loaded by the time this runs), the instructions file if
 * `--instructions` was given, and provider client construction for every configured provider
 * — then exits 0 without spending any tokens.
 */
async function runDryRun(
  options: CliOptions,
  config: DhConfig,
  deps: CliDeps,
): Promise<ExitCodeType> {
  const { io } = deps;

  if (options.instructions !== null) {
    try {
      await deps.readInstructions(options.instructions);
    } catch (err) {
      return fail(io, (err as Error).message);
    }
  }

  for (const providerConfig of config.provider) {
    try {
      deps.createProvider(providerConfig);
    } catch (err) {
      return fail(
        io,
        `provider "${providerConfig.name}" failed to construct: ${(err as Error).message}`,
      );
    }
  }

  io.stdout(
    "dh: dry run OK — config, instructions file, and provider client construction all " +
      "validated. No model was called.",
  );
  io.exit(ExitCode.Success);
  return ExitCode.Success;
}

/** Runs the CLI end to end. Returns the exit code it either passed to `deps.io.exit` (real
 * process) or would have (tests inject a no-op `exit` and read the return value instead). */
export async function main(
  argv: string[],
  overrides: Partial<CliDeps> = {},
): Promise<ExitCodeType> {
  const deps: CliDeps = { ...defaultDeps(), ...overrides };
  const { io } = deps;

  // DH-0037: `dh logs <sessionDir>` is a standalone subcommand, not one of the interactive
  // run modes composed by flags — it never touches config/provider/AgentRuntime, so it's
  // handled first, before flag parsing and `dh.json` loading, same as --help/--version.
  if (argv[0] === "logs") {
    const sessionDir = argv[1];
    if (sessionDir === undefined) {
      return fail(io, "usage: dh logs <sessionDir>");
    }
    try {
      io.stdout(formatSessionLogTree(sessionDir));
    } catch (err) {
      return fail(io, (err as Error).message);
    }
    io.exit(ExitCode.Success);
    return ExitCode.Success;
  }

  if (argv.includes("--help") || argv.includes("-h")) {
    io.stdout(HELP_TEXT);
    io.exit(ExitCode.Success);
    return ExitCode.Success;
  }

  if (argv.includes("--version")) {
    io.stdout(formatVersionString(BUILD_INFO));
    io.exit(ExitCode.Success);
    return ExitCode.Success;
  }

  // `dh init` (DH-0035): a subcommand, not a flag — handled before parseArgs (which has no
  // concept of positional subcommands) and, like --help/--version, never depends on a working
  // dh.json existing yet.
  if (argv[0] === "init") {
    return runInit(argv.slice(1), deps);
  }

  // `dh doctor` (DH-0035): a documented alias for `--check`, for operators who reach for a
  // subcommand rather than a flag. Strips "doctor" off the front and folds it into the same
  // --check flag path below so it gets the exact same handling (including --config support).
  const isDoctorSubcommand = argv[0] === "doctor";
  const argvForParsing = isDoctorSubcommand ? argv.slice(1) : argv;

  let options: CliOptions;
  try {
    options = parseArgs(argvForParsing);
  } catch (err) {
    return fail(io, (err as Error).message);
  }
  if (isDoctorSubcommand) {
    options.check = true;
  }

  const mode = composeMode(options);

  if (options.env !== null) {
    try {
      const content = await deps.readEnvFile(options.env);
      const vars = parseEnvFile(content);
      deps.applyEnv(vars);
    } catch (err) {
      return fail(io, (err as Error).message);
    }
  }

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

  // DH-0035: both --check/`dh doctor` and --dry-run stop here — config and systemPrompt are
  // already validated by this point, and neither mode ever enters the interactive/standalone
  // agent loop below.
  if (options.check) {
    return runDoctor(config, deps);
  }
  if (options.dryRun) {
    return runDryRun(options, config, deps);
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

  const runtime = deps.createRuntime(config, systemPrompt, "none");

  // DH-0011: the standalone `--instructions`/`--job` path is exactly the unattended
  // dark-factory scenario a container's SIGTERM/SIGINT can interrupt mid-run — best-effort
  // cooperative stop via the same AbortSignal-driven mechanism TaskStop/stopRoot() already
  // use (loop.ts's AgentLoopParams.signal), rather than the process just dying with no
  // chance to log anything.
  let interrupted = false;
  const uninstallSignals = deps.installSignalHandlers((signal) => {
    interrupted = true;
    io.stderr(`dh: received ${signal}; stopping the root agent...`);
    runtime.stopRoot();
  });

  let result: { success: boolean; finalOutput: string };
  try {
    result = await runtime.runRoot(instructionText);
  } catch (err) {
    uninstallSignals();
    return fail(io, `root agent crashed: ${(err as Error).message}`);
  }
  uninstallSignals();
  if (interrupted) {
    io.stdout(result.finalOutput);
    io.exit(ExitCode.HarnessError);
    return ExitCode.HarnessError;
  }

  io.stdout(result.finalOutput);

  if (!options.job) {
    // Without --job the process stays alive after completion for inspection (HANDOFF.md
    // §2) — now via the same real interactive surface the no-instructions path uses. Note
    // this is a fresh AgentRuntime/session, not a continuation of the one that just ran the
    // instruction (unifying those is out of scope this round — see the status log).
    //
    // DH-0038: this transition is otherwise invisible to the operator — the job's final
    // output prints, then a silent, contextless session starts with no indication the
    // conversation didn't just continue. Say so explicitly. Full crash-recovery/session-
    // resume design is separately handled by the architect; out of scope here.
    io.stderr(
      "dh: job complete; starting a new interactive session (prior context is not preserved)",
    );
    return runInteractiveMode(mode, config, systemPrompt, deps);
  }

  const code = result.success ? ExitCode.Success : ExitCode.TaskFailure;
  io.exit(code);
  return code;
}

if (import.meta.main) {
  await main(process.argv.slice(2));
}
