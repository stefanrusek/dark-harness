// CLI entry point (docs/handoffs/core.md §5). Parses flags, composes the run mode per
// HANDOFF.md §2 / ADR 0001, and — for the `--instructions` autonomous path — runs the root
// agent directly via AgentRuntime and maps its outcome onto the ExitCode contract.
//
// SCOPE NOTE (status log, docs/handoffs/core.md): this file *composes* the Server/TUI/Web
// entry points but doesn't implement them — those domains haven't landed in this worktree
// yet. Each real run mode below calls a clearly-marked stub instead of importing
// src/server|tui|web (which would violate the ownership boundary even if they existed).
// Replacing the stubs with real imports is a one-line change per TODO once those domains
// land — nothing here should need to change shape.

import { AgentRuntime } from "./agent/runtime.ts";
import { ConfigError, DEFAULT_CONFIG_PATH, loadConfig } from "./config/index.ts";
import type { DhConfig, ExitCode as ExitCodeType } from "./contracts/index.ts";
import { ExitCode } from "./contracts/index.ts";

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

/** TODO(server domain): replace with src/server's real headless server entry point. */
function startHeadlessServerStub(port: number, io: Pick<CliIo, "stdout">): void {
  io.stdout(`dh: [stub] headless server would listen on port ${port} (src/server not landed yet).`);
}

/** TODO(tui domain): replace with src/tui's console client entry point. */
function startConsoleStub(io: Pick<CliIo, "stdout">): void {
  io.stdout("dh: [stub] console TUI would start here (src/tui not landed yet).");
}

/** TODO(web domain): replace with src/web's client-served web UI entry point. */
function startWebStub(io: Pick<CliIo, "stdout">): void {
  io.stdout("dh: [stub] web UI would be served here (src/web not landed yet).");
}

/** TODO(tui/web domains): replace with the real console/web client connecting to a remote
 * headless server over HTTP+SSE (ADR 0002). */
function startConnectStub(
  mode: Extract<RunMode, { kind: "connect" }>,
  io: Pick<CliIo, "stdout">,
): void {
  io.stdout(
    `dh: [stub] would connect to ${mode.host}:${mode.port} with the ${mode.web ? "web" : "console"} client (src/${mode.web ? "web" : "tui"} not landed yet).`,
  );
}

function runStubbedMode(mode: RunMode, io: Pick<CliIo, "stdout">): void {
  if (mode.kind === "server") {
    startHeadlessServerStub(mode.port, io);
    return;
  }
  if (mode.kind === "connect") {
    startConnectStub(mode, io);
    return;
  }
  // mode.kind === "local"
  if (mode.web) {
    startWebStub(io);
  } else {
    startConsoleStub(io);
  }
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
  createRuntime: (config: DhConfig, systemPrompt: string) => Pick<AgentRuntime, "runRoot">;
  io: CliIo;
}

function defaultDeps(): CliDeps {
  return {
    loadConfig,
    readInstructions: readInstructionsFile,
    loadSystemPrompt,
    createRuntime: (config, systemPrompt) => new AgentRuntime({ config, systemPrompt }),
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

  if (options.instructions === null) {
    runStubbedMode(mode, io);
    return ExitCode.Success;
  }

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

  let systemPrompt: string;
  try {
    systemPrompt = await deps.loadSystemPrompt(config);
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
    // §2). There's no real interactive surface to keep it alive with yet — TODO(server/tui/
    // web domains): once those land, this falls through to the same runStubbedMode() call
    // the no-instructions path uses, now with the root agent already having run.
    runStubbedMode(mode, io);
    return ExitCode.Success;
  }

  const code = result.success ? ExitCode.Success : ExitCode.TaskFailure;
  io.exit(code);
  return code;
}

if (import.meta.main) {
  await main(process.argv.slice(2));
}
