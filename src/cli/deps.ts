// DH-0174 (Core, extracted from cli.ts): the dependency-injection seam every mode runner and
// every test's `main(argv, overrides)` call depends on — CliIo/CliDeps/DhServerLike/
// WebUiHandleLike types, the real defaultDeps() implementation, and the shared fail() helper.
import { createProvider } from "../agent/providers/index.ts";
import type { ModelProvider } from "../agent/providers/types.ts";
import { loadResumeSession, type ResumeResult } from "../agent/resume.ts";
import type { AgentRuntime, AgentRuntimeOptions } from "../agent/runtime.ts";
import { BUILD_INFO } from "../config/build-info.ts";
import { ConfigError, loadConfig } from "../config/index.ts";
import type {
  DhConfig,
  ExitCode as ExitCodeType,
  ProviderConfig,
  ServerSentEvent,
  SessionClientKind,
} from "../contracts/index.ts";
import { ExitCode } from "../contracts/index.ts";
import type { HeaderInfo } from "../header-info.ts";
import { loadSystemPrompt } from "../prompt/system-prompt.ts";
import {
  type AgentLoopHandle,
  DhServer,
  type DhServerOptions,
  type ImportClaudeSessionResult,
  type ImportClaudeSessionSource,
  importClaudeSession,
} from "../server/index.ts";
import { startTui as startTuiClient } from "../tui/index.ts";
import { serveWebUi as serveWebUiClient } from "../web/server.ts";
import { AgentRuntimeLoopAdapter, createStandaloneRuntime } from "./agent-loop-adapter.ts";
import { readEnvFile } from "./env-file.ts";

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
  /** DH-0038: reconstructs a `--resume <sessionId>` session's replayed history + metadata
   * from `.dh-logs/<sessionId>` (walking any `resumedFrom` chain). Synchronous, throws
   * `ResumeError` (see src/agent/resume.ts) for every documented failure mode (D6) — callers
   * route it through the standard `fail()` path, never letting it crash the process.
   * Injectable so tests never touch the real filesystem. */
  loadResumeSession: (logsRoot: string, sessionId: string) => ResumeResult;
  /** DH-0189: the Server (DH-0188) translator that turns a resolved Claude Code source (a
   * root transcript + optional sidecar, already path-kind-detected by
   * `resolveImportSource`) into a new `.dh-logs/<sessionId>` directory. Injectable so
   * tests never touch the real filesystem; the produced `sessionId` is fed straight into the
   * existing `loadResumeSession` above — import never gets its own replay/launch logic. */
  importClaudeSession: (
    source: ImportClaudeSessionSource,
    opts: { logsRoot: string; model: string },
  ) => ImportClaudeSessionResult;
  /** Used only by the standalone `--instructions` path (see cli.ts's module doc comment for
   * why that path never goes through createAgentLoop/createServer). Exposes `stopRoot`
   * too (DH-0011) so this path's SIGTERM/SIGINT handler has something real to call.
   * `resume` (DH-0038) is threaded straight into `AgentRuntimeOptions.resume` when a
   * `--resume` was requested; omitted for a normal (non-resumed) run. */
  createRuntime: (
    config: DhConfig,
    systemPrompt: string,
    client: SessionClientKind,
    resume?: AgentRuntimeOptions["resume"],
    /** DH-0050 (`--job --json`): forwarded straight into `AgentRuntimeOptions.onEvent` so the
     * NDJSON stream can write every `ServerSentEvent` as it happens; omitted (as before this
     * ticket) on every non-`--json` standalone run. */
    onEvent?: (event: ServerSentEvent) => void,
  ) => Pick<AgentRuntime, "runRoot" | "stopRoot"> & {
    close?: () => Promise<void>;
    /** DH-0037 (`summary.json`): the real `createStandaloneRuntime` dep's `AgentRuntime`
     * always carries its own `sessionId` — this is only optional here so the many
     * hand-written fakes in cli.test.ts that stub `createRuntime` without a session/log
     * directory (they don't exercise `summary.json`) don't all need updating just to satisfy
     * the type. Absent, `summary.json` writing is skipped (see `runInstructionsMode`).
     */
    sessionId?: string;
  };
  /** Used by every interactive mode (server/local/connect). `resume` (DH-0038): same shape
   * and purpose as `createRuntime`'s. DH-0002: the returned handle's optional `close()` —
   * present on the real `AgentRuntimeLoopAdapter` (delegates to its `AgentRuntime.close()`,
   * which in turn closes the shared McpManager, terminating any stdio MCP child processes)
   * — is called from cli.ts's own SIGTERM/SIGINT handling, coordinating with the
   * existing shutdown path (DH-0011) rather than adding a second one; `AgentLoopHandle`
   * itself (Server's own cross-domain contract, src/server/agent-loop.type.ts) is untouched. */
  createAgentLoop: (
    config: DhConfig,
    systemPrompt: string,
    client: SessionClientKind,
    // DH-0116: authoritative sessionId, sourced from the same id the caller uses for
    // logDir/the server's own advertised session — see AgentRuntimeLoopAdapter's doc
    // comment for why this must be threaded through rather than left to AgentRuntime's
    // own default.
    sessionId: string,
    resume?: AgentRuntimeOptions["resume"],
  ) => AgentLoopHandle & { close?: () => Promise<void> };
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
    /** DH-0022: opt-in bind address, sourced from `dh.json`'s `security.hostname`. */
    hostname?: string;
    /** DH-0122: app header content forwarded to the browser via `WEB_CONFIG_PATH`. */
    headerInfo?: HeaderInfo;
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

async function readInstructionsFile(path: string): Promise<string> {
  const file = Bun.file(path);
  if (!(await file.exists())) {
    throw new ConfigError(`instructions file not found: ${path}`);
  }
  return file.text();
}

export function defaultDeps(): CliDeps {
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
    loadResumeSession,
    importClaudeSession: (source, opts) =>
      importClaudeSession(source, { ...opts, client: "none", build: BUILD_INFO }),
    // The standalone path's own runtime is always constructed with client: "none" directly
    // inside createStandaloneRuntime() (it's not one of the four interactive modes this
    // `client` param maps from), so the value passed here is intentionally unused.
    createRuntime: (config, systemPrompt, _client, resume, onEvent) =>
      createStandaloneRuntime(config, systemPrompt, resume, onEvent),
    createAgentLoop: (config, systemPrompt, client, sessionId, resume) =>
      new AgentRuntimeLoopAdapter({
        config,
        systemPrompt,
        client,
        sessionId,
        ...(resume ? { resume } : {}),
      }),
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

export function fail(io: CliIo, message: string): ExitCodeType {
  io.stderr(`dh: ${message}`);
  io.exit(ExitCode.HarnessError);
  return ExitCode.HarnessError;
}
