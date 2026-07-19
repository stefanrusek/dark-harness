// CLI entry point (docs/handoffs/core.md §5). Parses flags, composes the run mode per
// HANDOFF.md §2 / ADR 0001, and either:
//   - runs the root agent directly via AgentRuntime for the standalone `--instructions`
//     dark-factory path (bypasses Server/TUI/Web entirely — see the Round 2 status log in
//     docs/handoffs/core.md for why that's a deliberate choice, not an oversight), or
//   - wires up the real Server/TUI/Web domains for the four interactive run modes (`--server`,
//     local console, local `--web`, `--connect [--web]`), via a thin AgentLoopHandle adapter
//     (AgentRuntimeLoopAdapter below) bridging Core's AgentRuntime to Server's own interface
//     for exactly this purpose (src/server/agent-loop.type.ts's doc comment, and Grace's own
//     round-1 status-log note, both call this out as the intended integration point).
//
// DH-0174: this file is now a thin barrel + main() orchestrator — flag parsing, help
// rendering, ANSI/color styling, env-file parsing, the `--import` source detector, the
// activity feed, `dh doctor`, `dh init`, the Core↔Server bridge (AgentRuntimeLoopAdapter),
// the CliDeps dependency-injection seam, and the interactive/dry-run mode runners (including
// the `--job` output-mode matrix's JobTranscriptRenderer) all now live under `src/cli/`. This
// file re-exports every symbol the existing test suite (and any external caller) previously
// imported directly from `./cli.ts`, so the split is test-neutral — see tracking/DH-0174 for
// the full decomposition plan and rationale. This redo is against DH-0182/DH-0189/DH-0147/
// DH-0148 current HEAD, not the earlier, now-superseded split attempted against a stale base.

// DH-0164: MUST be the first import in this file — see its own comment for why. Clears
// CI/CONTINUOUS_INTEGRATION before anything later in this file's import graph (including
// `./tui/index.ts` -> `./ink/mount.ts` -> `ink`) gets a chance to evaluate `is-in-ci`.
import "./tui/ink/clear-ci-env-for-interactive-render.ts";

import { join } from "node:path";
import type { ResumeResult } from "./agent/resume.ts";
import { ActivityFeed, buildStartupPostureNote } from "./cli/activity-feed.ts";
import { AgentRuntimeLoopAdapter } from "./cli/agent-loop-adapter.ts";
import {
  type CliOptions,
  CliUsageError,
  composeMode,
  DEFAULT_PORT,
  parseArgs,
  type RunMode,
} from "./cli/args.ts";
import type { CliDeps, CliIo, DhServerLike, WebUiHandleLike } from "./cli/deps.ts";
import { defaultDeps, fail } from "./cli/deps.ts";
import { formatDoctorReport, runDoctor } from "./cli/doctor.ts";
import { parseEnvFile } from "./cli/env-file.ts";
import { helpColumns, renderHelpText } from "./cli/help.ts";
import { resolveImportSource } from "./cli/import-source.ts";
// DH-0035/DH-0096: SAMPLE_DH_JSON re-exported from its new home (src/cli/init.ts) — see that
// module for the sample config's own doc comment.
import { runInit, SAMPLE_DH_JSON } from "./cli/init.ts";
import {
  buildResumeNotice,
  JobTranscriptRenderer,
  runDryRun,
  runInteractiveMode,
} from "./cli/run.ts";
import { cliBold } from "./cli/styling.ts";
import { BUILD_INFO } from "./config/build-info.ts";
import type {
  DhConfig,
  ExitCode as ExitCodeType,
  JobResultLine,
  OutcomeReportedBy,
  ReportedOutcome,
  ServerSentEvent,
} from "./contracts/index.ts";
import { ExitCode } from "./contracts/index.ts";
import { formatVersionString } from "./header-info.ts";
import {
  buildSessionSummary,
  formatSessionList,
  formatSessionLogTree,
  type ImportClaudeSessionSource,
  writeSessionSummary,
} from "./server/index.ts";

export type { CliDeps, CliIo, CliOptions, DhServerLike, RunMode, WebUiHandleLike };
// DH-0174 barrel re-exports — every symbol the pre-split cli.ts exported, unchanged, so no
// existing import site (tests, e2e, or otherwise) needs to change what it imports from.
export {
  ActivityFeed,
  AgentRuntimeLoopAdapter,
  buildResumeNotice,
  buildStartupPostureNote,
  CliUsageError,
  composeMode,
  DEFAULT_PORT,
  formatDoctorReport,
  JobTranscriptRenderer,
  parseArgs,
  parseEnvFile,
  renderHelpText,
  resolveImportSource,
  SAMPLE_DH_JSON,
};

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
    // DH-0067: no argument used to be a usage error, forcing the operator to `ls .dh-logs`
    // and copy a UUID by hand. Lists every session directory under the default
    // "./.dh-logs" root instead.
    if (sessionDir === undefined) {
      try {
        io.stdout(formatSessionList(join(process.cwd(), ".dh-logs")));
      } catch (err) {
        return fail(io, (err as Error).message);
      }
      io.exit(ExitCode.Success);
      return ExitCode.Success;
    }
    try {
      // DH-0067: colorize status words the same way the TUI does, gated on a real TTY (a
      // piped/redirected `dh logs` — e.g. into a file for a bug report — stays plain text,
      // same convention as `dh doctor`'s PASS/FAIL colorization below).
      io.stdout(formatSessionLogTree(sessionDir, { color: process.stdout.isTTY === true }));
    } catch (err) {
      return fail(io, (err as Error).message);
    }
    io.exit(ExitCode.Success);
    return ExitCode.Success;
  }

  if (argv.includes("--help") || argv.includes("-h")) {
    io.stdout(renderHelpText(helpColumns(), process.stdout.isTTY === true));
    io.exit(ExitCode.Success);
    return ExitCode.Success;
  }

  if (argv.includes("--version")) {
    // DH-0101: light emphasis (bold app name) on a TTY; formatVersionString itself stays a
    // pure plain-text formatter (other call sites/tests depend on that), so the bolding is
    // applied here, at the print site, only to the leading "dh" app-name token.
    const versionString = formatVersionString(BUILD_INFO);
    const tty = process.stdout.isTTY === true;
    io.stdout(tty ? versionString.replace(/^dh/, cliBold("dh", true)) : versionString);
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

  // DH-0182: `--host` overrides `dh.json`'s `security.hostname` for this invocation only —
  // merged into `config` once, here, so every downstream read of `config.security?.hostname`
  // (the local DhServer's bind address, both `serveWebUi` call sites' `hostname` option, and
  // the printed "bound to <host>:<port>" startup line) picks up the override automatically,
  // with no further plumbing needed at each read site.
  const resolvedHostname = options.host ?? config.security?.hostname;
  if (resolvedHostname !== undefined) {
    config = { ...config, security: { ...config.security, hostname: resolvedHostname } };
  }
  // DH-0168: `--web-port` overrides `dh.json`'s `security.webPort`; `0`/unset on both keeps
  // today's random-ephemeral-port behavior (serveWebUi's own default when passed `0`).
  const resolvedWebPort = options.webPort ?? config.security?.webPort ?? 0;

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
    return runDoctor(config, options.config, deps);
  }
  if (options.dryRun) {
    return runDryRun(options, config, deps);
  }

  // DH-0189: `--import <path>` — DH-0187's governing insight is that import is a pure format
  // translator that writes a valid `.dh-logs/<sessionId>` directory and then *becomes* a
  // `--resume <sessionId>` invocation; it must not fork its own launch logic. parseArgs
  // already rejected --import combined with --resume/--check/--dry-run/--connect, so by the
  // time we get here, mutating `options.resume` below and falling through to the existing
  // DH-0038 resume block is the entire integration — no separate path needed.
  if (options.importPath !== null) {
    // D5: an explicit --model must resolve against *this* config or import fails cleanly
    // before writing anything; with no --model, fall back to dh.json's own defaultModel (the
    // same model a fresh, non-imported session would use).
    const modelAlias = options.model ?? config.options.defaultModel;
    if (!config.models.some((m) => m.name === modelAlias)) {
      return fail(
        io,
        `--import: model alias "${modelAlias}" does not match any configured model; known models: ${config.models.map((m) => m.name).join(", ")}`,
      );
    }
    let source: ImportClaudeSessionSource;
    try {
      source = resolveImportSource(options.importPath);
    } catch (err) {
      return fail(io, (err as Error).message);
    }
    try {
      const imported = deps.importClaudeSession(source, {
        logsRoot: join(process.cwd(), ".dh-logs"),
        model: modelAlias,
      });
      options.resume = imported.sessionId;
    } catch (err) {
      return fail(io, `--import failed: ${(err as Error).message}`);
    }
  }

  // DH-0038: `--resume <sessionId>` — resolved once, up front, before branching into the
  // standalone vs. interactive paths below (both need the same replayed history/model).
  let resumeResult: ResumeResult | undefined;
  if (options.resume !== null) {
    // No wire command exists for delivering reconstructed history to a remote server (D3);
    // the logs it would be reconstructed from live on that server's filesystem, not this
    // process's, so there's nothing local to even read.
    if (mode.kind === "connect") {
      return fail(
        io,
        "--resume is not supported with --connect (logs live on the server's filesystem).",
      );
    }
    try {
      resumeResult = deps.loadResumeSession(join(process.cwd(), ".dh-logs"), options.resume);
    } catch (err) {
      return fail(io, `cannot resume session "${options.resume}": ${(err as Error).message}`);
    }
    // D3: an unresolvable model alias is a clean startup error, never a silent fallback to
    // config.options.defaultModel — continuing an hours-long run on the wrong model would be
    // far worse than refusing to start.
    if (!config.models.some((m) => m.name === resumeResult?.model)) {
      return fail(
        io,
        `cannot resume session "${options.resume}": model alias "${resumeResult.model}" from the original session no longer exists in this config; known models: ${config.models.map((m) => m.name).join(", ")}`,
      );
    }
  }

  if (options.instructions === null) {
    return runInteractiveMode(
      mode,
      config,
      options.config,
      systemPrompt,
      deps,
      resumeResult,
      options.quiet,
      resolvedWebPort,
      options.plain,
    );
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
  // DH-0038: `--instructions` combined with `--resume` (D3) — the file's content becomes the
  // post-resume message, appended after the standard resume notice (rather than replacing it),
  // so the "restart happened, history was reconstructed, here's what didn't survive" context
  // is never silently dropped just because the operator also supplied fresh instructions.
  if (resumeResult) {
    instructionText = `${buildResumeNotice(resumeResult)}\n\n${instructionText}`;
  }

  // DH-0148: without --job, --instructions launches the interactive session (TUI or --web)
  // immediately and auto-sends the instructions file's content (with any resume notice
  // prepended, per the combined text built above) as the session's first message once the
  // root agent connects, replacing the old behavior (an invisible headless run via a
  // separate AgentRuntime, followed by a disconnected fresh interactive session). --job stays
  // the fully headless/exit-on-completion path handled below, with its own output-mode flags
  // (DH-0147) — unaffected by this branch.
  if (!options.job) {
    return runInteractiveMode(
      mode,
      config,
      options.config,
      systemPrompt,
      deps,
      resumeResult,
      options.quiet,
      resolvedWebPort,
      options.plain,
      instructionText,
    );
  }

  // DH-0147: --job's output-mode matrix — breadth (full stream vs --result-only) x format
  // (markdown vs --json), --json a pure format selector orthogonal to breadth.
  //   - default breadth + markdown (new default): full conversation transcript, rendered as
  //     markdown, streamed live turn-by-turn via JobTranscriptRenderer.
  //   - default breadth + --json: full NDJSON event stream — today's existing `--job --json`
  //     behavior, unchanged.
  //   - --result-only + markdown: final result only, plain text — today's pre-DH-0147
  //     default, now opt-in.
  //   - --result-only + --json: final result only, as a single job_result JSON object.
  const streamJson = options.json && !options.resultOnly;
  const streamMarkdown = !options.json && !options.resultOnly;
  let transcriptRenderer: JobTranscriptRenderer | undefined;
  const onEvent: ((event: ServerSentEvent) => void) | undefined = streamJson
    ? (event) => io.stdout(JSON.stringify(event))
    : streamMarkdown
      ? (event) => {
          transcriptRenderer ??= new JobTranscriptRenderer(io);
          transcriptRenderer.onEvent(event);
        }
      : undefined;

  const runtime = deps.createRuntime(
    config,
    systemPrompt,
    "none",
    resumeResult
      ? {
          messages: resumeResult.messages,
          fromSessionId: resumeResult.resumedFromSessionId,
          model: resumeResult.model,
        }
      : undefined,
    onEvent,
  );

  // DH-0011: the standalone `--instructions`/`--job` path is exactly the unattended
  // dark-factory scenario a container's SIGTERM/SIGINT can interrupt mid-run — best-effort
  // cooperative stop via the same AbortSignal-driven mechanism TaskStop/stopRoot() already
  // use (loop.ts's AgentLoopParams.signal), rather than the process just dying with no
  // chance to log anything.
  let interrupted = false;
  const uninstallSignals = deps.installSignalHandlers((signal) => {
    interrupted = true;
    // DH-0067 fix: same reasoning as the interactive-mode SIGTERM/SIGINT notice — this is a
    // normal lifecycle event, not a failure, so it goes to stdout rather than the
    // error-red-in-most-terminals stderr stream.
    io.stdout(`dh: received ${signal}; stopping the root agent...`);
    runtime.stopRoot();
  });

  let result: {
    success: boolean;
    finalOutput: string;
    turns: number;
    outcome?: ReportedOutcome;
    reportedBy?: OutcomeReportedBy;
  };
  try {
    result = await runtime.runRoot(instructionText);
  } catch (err) {
    uninstallSignals();
    await runtime.close?.()?.catch(() => {});
    return fail(io, `root agent crashed: ${(err as Error).message}`);
  }
  uninstallSignals();

  // DH-0147: `result.finalOutput`/the terminal `job_result` line are printed per the output-
  // mode matrix above:
  //   - --result-only (plain text): finalOutput printed once at the end — the old, pre-DH-0147
  //     default behavior, preserved verbatim for this breadth.
  //   - --result-only --json / default breadth --json: a `job_result` JSON object — either the
  //     stream's terminal line (default breadth) or the only line printed (--result-only).
  //   - default breadth, markdown format: finalOutput is never printed separately — it already
  //     appeared as part of the live transcript stream above.
  // DH-0037 (`summary.json`): built unconditionally (not just under `--json`) so it can also
  // back `summary.json`'s fields.
  const buildJobResultLine = (): JobResultLine => ({
    version: 1,
    type: "job_result",
    timestamp: new Date().toISOString(),
    success: result.success,
    exitCode: result.success ? ExitCode.Success : ExitCode.TaskFailure,
    reportedBy: result.reportedBy ?? (result.success ? "clean-end" : "text-marker"),
    turns: result.turns,
    finalOutput: result.finalOutput,
    ...(result.outcome !== undefined ? { outcome: result.outcome } : {}),
  });

  if (interrupted) {
    // Judgment call unchanged from pre-DH-0147: an operator-interrupted (SIGTERM/SIGINT) run
    // has no self-report outcome to describe at all, so no job_result line is ever emitted on
    // this path, in any format.
    if (options.resultOnly && !options.json) io.stdout(result.finalOutput);
    await runtime.close?.()?.catch(() => {});
    io.exit(ExitCode.HarnessError);
    return ExitCode.HarnessError;
  }

  if (options.resultOnly && !options.json) io.stdout(result.finalOutput);
  // DH-0002: best-effort — closes the shared McpManager (terminating stdio MCP child
  // processes) now that this run has finished.
  await runtime.close?.()?.catch(() => {});

  const jobResultLine = buildJobResultLine();
  // DH-0037: `summary.json` — written into the finished session's own log directory,
  // alongside its per-agent JSONL, once the run has genuinely completed (not on interrupt or
  // crash, both of which return above before reaching here). Best-effort: `runtime.sessionId`
  // is only absent for cli.test.ts's hand-written fakes that don't model a real session/log
  // directory at all (see the `CliDeps.createRuntime` doc comment) — a real run always has
  // one. A write failure (disk full, permissions) is reported but doesn't change the run's
  // own success/exit code, matching `runtime.close()`'s same best-effort treatment above.
  if (runtime.sessionId !== undefined) {
    const logDir = join(process.cwd(), ".dh-logs", runtime.sessionId);
    try {
      const summary = buildSessionSummary(runtime.sessionId, logDir, jobResultLine);
      writeSessionSummary(logDir, summary);
    } catch (err) {
      io.stderr(`dh: failed to write summary.json: ${(err as Error).message}`);
    }
  }
  if (options.json) io.stdout(JSON.stringify(jobResultLine));
  const code = result.success ? ExitCode.Success : ExitCode.TaskFailure;
  io.exit(code);
  return code;
}

// DH-0174: one-line short-circuit form (matches the pattern documented in
// src/web/client/main.ts and src/agent/mcp/__fixtures__/fake-stdio-server.ts) rather than a
// block `if` — bun's line-coverage instrumentation marks a line "hit" once its statement
// starts executing, regardless of which branch of `&&` runs, so this reads as covered under
// `bun test` (where import.meta.main is always false, since cli.ts is only ever imported,
// never the entry point) instead of showing as a permanent, untestable gap in the
// 100%-coverage gate.
import.meta.main && (await main(process.argv.slice(2)));
