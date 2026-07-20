// DH-0174 (Core, extracted from cli.ts): flag parsing + mode composition. The single
// highest-churn concentration in the pre-split cli.ts — kept together since parseArgs calls
// composeMode, avoiding a cross-module cycle.
import { DEFAULT_CONFIG_PATH } from "../config/index.ts";

export const DEFAULT_PORT = 4000;

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
  /** DH-0147: `--job` headless mode — no TUI/Web/server client attaches; the process exits
   * once the root agent finishes (0 success, 1 self-reported failure, 2+ harness error). */
  /** DH-0050/DH-0147: `--job --json` — pure format selector, orthogonal to breadth
   * (`resultOnly`). Default breadth: NDJSON progress stream on stdout, closed by a terminal
   * `job_result` line (`JobResultLine`, src/contracts/outcome.ts) — today's existing `--job
   * --json` behavior, unchanged. `--result-only` breadth: a single `job_result` JSON object
   * printed once at the end, no stream. Invalid without --job. */
  json: boolean;
  /** DH-0147: `--job --result-only` — opts back into the pre-DH-0147 default: only
   * `result.finalOutput` (or, combined with `--json`, a single `job_result` JSON object) is
   * printed, once, at the end — no live transcript stream. Invalid without --job. */
  resultOnly: boolean;
  config: string;
  env: string | null;
  /** DH-0035: `--check` (or the `dh doctor` subcommand, an alias set by main()) — runs one
   * cheap no-op provider call per configured model and exits, never entering the agent loop. */
  check: boolean;
  /** DH-0035: validates config/instructions/provider-client construction and exits 0 without
   * ever calling a model. */
  dryRun: boolean;
  /** DH-0038: `--resume <sessionId>` — reconstructs the root agent's conversation from
   * `.dh-logs/<sessionId>` (walking any `resumedFrom` chain) instead of starting fresh. Null
   * when not resuming. */
  resume: string | null;
  /** DH-0067: suppresses the per-agent-lifecycle-transition activity feed and SSE client
   * connect/disconnect lines that `--server` mode now prints by default (see
   * runInteractiveMode's activity-feed wiring). Does not affect the one-time startup block —
   * that always prints regardless of `--quiet`. */
  quiet: boolean;
  /** DH-0168: pinned listen port for the web UI's static server. `null` means unset — the
   * unchanged default (random ephemeral port), unless `dh.json`'s `security.webPort` sets
   * one. Overrides that config field when both are set. Requires `--web`. */
  webPort: number | null;
  /** DH-0182: overrides `dh.json`'s `security.hostname` (DH-0022) for this invocation only.
   * `null` means unset — `security.hostname` (or its absence) behaves exactly as before. */
  host: string | null;
  /** DH-0189: `--import <path>` — translates a real Claude Code session (a backup-archive
   * directory or a live `<id>.jsonl` file, DH-0187 Decision 1) into a new resumable
   * `.dh-logs/<sessionId>` directory, then hands that session id to the exact same
   * `--resume` launch path used below (never a separate code path of its own). Null when not
   * importing. */
  importPath: string | null;
  /** DH-0189: `--model <alias>` — companion flag to `--import` only, selecting the dh model
   * alias the imported session resumes under (DH-0187 Decision 5). Must resolve against
   * `dh.json`'s `models[]`, checked before any write. Null means unset: import falls back to
   * `dh.json`'s `options.defaultModel`. A usage error (`--model requires --import`) outside
   * an `--import` invocation — it has no meaning anywhere else. */
  model: string | null;
  /** DH-0220: forces the plain-text startup-header fallback (no color, no box-drawing/
   * gradient art) regardless of TTY/size — same effect as `NO_COLOR` being set, expressed as
   * a flag for scripts/CI that can't easily set env vars. See `detectColorLevel`
   * (src/cli/color-context.ts) and the header renderers (src/cli/header.ts). */
  plain: boolean;
}

const FLAGS_WITH_VALUES = Object.freeze(
  new Set([
    "--connect",
    "--port",
    "--instructions",
    "--config",
    "--env",
    "--resume",
    "--web-port",
    "--host",
    "--import",
    "--model",
  ]),
);

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
    json: false,
    resultOnly: false,
    config: DEFAULT_CONFIG_PATH,
    env: null,
    check: false,
    dryRun: false,
    resume: null,
    quiet: false,
    webPort: null,
    host: null,
    importPath: null,
    model: null,
    plain: false,
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
    if (arg === "--json") {
      options.json = true;
      continue;
    }
    if (arg === "--result-only") {
      options.resultOnly = true;
      continue;
    }
    if (arg === "--quiet") {
      options.quiet = true;
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
    if (arg === "--plain") {
      options.plain = true;
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
      else if (arg === "--resume") options.resume = value;
      else if (arg === "--host") options.host = value;
      else if (arg === "--import") options.importPath = value;
      else if (arg === "--model") options.model = value;
      else if (arg === "--port" || arg === "--web-port") {
        const parsed = Number(value);
        if (!Number.isInteger(parsed) || parsed <= 0) {
          throw new CliUsageError(`${arg} must be a positive integer, got "${value}"`);
        }
        if (arg === "--port") options.port = parsed;
        else options.webPort = parsed;
      }
      continue;
    }
    throw new CliUsageError(`unknown flag: ${arg}`);
  }

  // DH-0050: --json is only meaningful alongside --job (the NDJSON stream's terminal
  // job_result line is exactly the --job exit-code decision, expressed as data) — a usage
  // error here, not a silent no-op, so an operator's misconfigured invocation fails loudly.
  if (options.json && !options.job) {
    throw new CliUsageError("--json requires --job");
  }
  // DH-0147: --result-only, like --json, is only meaningful alongside --job — it opts back
  // into --job's pre-DH-0147 default breadth (final result only, not the new full-stream
  // default); it has no meaning outside --job.
  if (options.resultOnly && !options.job) {
    throw new CliUsageError("--result-only requires --job");
  }

  // DH-0168: --web-port only means anything on a mode that actually starts the web UI's
  // static server — reuses composeMode's own connect/server/local precedence (a function
  // declaration, hoisted, so it's safe to call from here even though it's defined below)
  // rather than re-deriving that precedence a second time.
  if (options.webPort !== null) {
    const mode = composeMode(options);
    const isWebMode = (mode.kind === "local" || mode.kind === "connect") && mode.web;
    if (!isWebMode) {
      throw new CliUsageError("--web-port requires --web");
    }
  }

  // DH-0189: --model is only meaningful as --import's companion flag (DH-0187 Decision 5) —
  // same "requires" pattern as --json/--web-port above.
  if (options.model !== null && options.importPath === null) {
    throw new CliUsageError("--model requires --import");
  }

  // DH-0189: --import's own mutual-exclusion rules, checked here (pure, no filesystem/config
  // needed) rather than deep in main() — --resume and --check/--dry-run are checked directly
  // since parseArgs already knows about them; --connect reuses composeMode the same way
  // --web-port's check above does. All three mirror --resume's own existing --connect
  // rejection (logs/model resolution happen against *this* process's local filesystem/config,
  // so there is nothing for a remote --connect target to do with an import).
  if (options.importPath !== null) {
    if (options.resume !== null) {
      throw new CliUsageError("--import cannot be combined with --resume");
    }
    if (options.check) {
      throw new CliUsageError("--import is not supported with --check");
    }
    if (options.dryRun) {
      throw new CliUsageError("--import is not supported with --dry-run");
    }
    const mode = composeMode(options);
    if (mode.kind === "connect") {
      throw new CliUsageError(
        "--import is not supported with --connect (the session is written to this process's local .dh-logs, not the remote server's).",
      );
    }
  }

  return options;
}
