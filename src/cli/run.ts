// DH-0174 (Core, extracted from cli.ts): the mode-dispatch bodies — runInteractiveMode (the
// four interactive run modes: --server, local, --web, --connect [--web]) and runDryRun
// (--dry-run), plus buildResumeNotice (the --resume synthetic wake-up message shared by both
// the interactive and standalone --instructions paths), and JobTranscriptRenderer (DH-0147's
// `--job` full markdown-transcript live-stream renderer, used by cli.ts's main() output-mode
// matrix).
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { ROOT_AGENT_ID } from "../agent/agent-id.constant.ts";
import type { ResumeResult } from "../agent/resume.ts";
import { BUILD_INFO } from "../config/build-info.ts";
import type {
  DhConfig,
  ExitCode as ExitCodeType,
  ServerSentEvent,
  SessionClientKind,
} from "../contracts/index.ts";
import { ExitCode } from "../contracts/index.ts";
import { buildHeaderInfo, formatVersionString } from "../header-info.ts";
import { pruneLogDirectories } from "../server/index.ts";
// DH-0101: reuse Web's short-id formatter for the transcript renderer rather than forking the
// logic — same reasoning as ActivityFeed's own import of it (activity-feed.ts).
import { shortAgentId } from "../web/client/format.ts";
import { ActivityFeed, buildStartupPostureNote, printAppHeader } from "./activity-feed.ts";
import type { CliOptions, RunMode } from "./args.ts";
import type { CliDeps, CliIo, WebUiHandleLike } from "./deps.ts";
import { fail } from "./deps.ts";
import { cliBold, cliCautionGlyph, cliSuccessGlyph } from "./styling.ts";

/**
 * DH-0038: the synthetic wake-up message a `--resume`d root agent's conversation gets
 * appended (D3) when no `--instructions` file supplies one instead. States plainly what
 * happened (restart + reconstruction), names any sub-agent/task that didn't survive the
 * restart (D3's "list lost in-flight sub-agents"), and flags the two things the replayed
 * history can't fully vouch for: a dangling tool call's real outcome (D1's synthesized
 * interrupted-tool_result marker covers the *shape*, not the truth) and any `[REDACTED:...]`
 * placeholder standing in for a secret DH-0020's logging redaction stripped (D5) — re-read
 * either from source if still needed, rather than trusting what's in the reconstructed text.
 */
export function buildResumeNotice(resumeResult: ResumeResult): string {
  const lines = [
    `dh: this session was resumed after a restart from session "${resumeResult.resumedFromSessionId}". The conversation above was reconstructed from that session's JSONL logs.`,
  ];
  if (resumeResult.lostAgents.length > 0) {
    lines.push(
      "The following sub-agents/tasks were still running or waiting when the restart " +
        "happened and did not survive it — their in-flight work and any background process " +
        "is gone; re-verify what they'd done and re-spawn them if the work still needs doing:",
    );
    for (const agent of resumeResult.lostAgents) {
      const label = agent.description ? `${agent.agentId} (${agent.description})` : agent.agentId;
      lines.push(`  - ${label} [${agent.status}]`);
    }
  }
  lines.push(
    "Any tool call the restart interrupted mid-execution is marked as such above, not as " +
      "having completed successfully — its real outcome is unknown; verify before trusting or " +
      'repeating it. Any "[REDACTED:...]" placeholder above stands in for a secret that ' +
      "logging never wrote to disk — re-read the real value from its original source if you " +
      "need it again.",
  );
  return lines.join("\n");
}

/**
 * DH-0147: `--job`'s new default breadth — a full markdown-rendered transcript of the
 * conversation (turns, tool calls, sub-agent activity), streamed to stdout live, turn-by-turn,
 * as the run progresses (owner-resolved Open Question: live streaming, not end-of-run
 * rendering — the whole point is watching a long unattended run in progress). Renders from the
 * exact same `ServerSentEvent` stream `--json` already taps (DH-0147's own Assumption) — this
 * is a new rendering of existing data, not new instrumentation.
 *
 * `agent_output` chunks arrive incrementally (per `AgentOutputEvent`'s own doc comment,
 * clients must accumulate consecutive chunks into one logical turn) — this renderer buffers
 * them per-agent and flushes as one markdown block at the next natural turn boundary (a
 * `tool_call`, `agent_status` transition, `session_ended`, or a different agent producing
 * output), rather than emitting a stdout line per raw chunk (which would fragment a single
 * sentence across dozens of unreadable lines). `io.stdout` always appends its own line break
 * (matches every other CliIo caller in this file), so "streamed live" here means "flushed at
 * each turn boundary" rather than character-by-character — turn-by-turn, per the ticket.
 */
export class JobTranscriptRenderer {
  private readonly buffers = new Map<string, string>();

  constructor(private readonly io: CliIo) {}

  private flush(agentId: string): void {
    const text = this.buffers.get(agentId);
    this.buffers.delete(agentId);
    if (text !== undefined && text.trim().length > 0) {
      this.io.stdout(text.replace(/\n+$/, ""));
    }
  }

  private flushAll(): void {
    for (const agentId of [...this.buffers.keys()]) this.flush(agentId);
  }

  onEvent(event: ServerSentEvent): void {
    switch (event.type) {
      case "agent_spawned": {
        const id = shortAgentId(event.agentId);
        const label = event.description ? `${id} (${event.description})` : id;
        this.io.stdout(`\n### ${label} — model ${event.model}`);
        return;
      }
      case "agent_output":
        this.buffers.set(event.agentId, (this.buffers.get(event.agentId) ?? "") + event.chunk);
        return;
      case "agent_thinking":
        // Extended-thinking content is never rendered to the transcript, same as every other
        // client — see AgentThinkingEvent's own doc comment ("an unaware client degrades to
        // invisible").
        return;
      case "tool_call":
        this.flush(event.agentId);
        this.io.stdout(`\n\`${event.toolName}\`: ${event.inputSummary}`);
        return;
      case "tool_result":
        this.io.stdout(`  → ${event.isError ? "error" : "ok"} (${event.durationMs}ms)`);
        return;
      case "agent_status":
        this.flush(event.agentId);
        this.io.stdout(`\n_${shortAgentId(event.agentId)}: ${event.status}_`);
        return;
      case "model_switched":
        this.io.stdout(
          `\n_${shortAgentId(event.agentId)}: switched model ${event.from} → ${event.to}_`,
        );
        return;
      case "session_ended":
        this.flushAll();
        this.io.stdout(`\n---\nSession ended (exit code ${event.exitCode})`);
        return;
      case "token_usage":
      case "resync":
        // token_usage is surfaced by ActivityFeed (--server mode) only, not the transcript;
        // resync is an SSE-resume detail with nothing to render — no client of this standalone
        // path ever resumes a stream mid-run.
        return;
      default:
        return;
    }
  }
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
export async function runInteractiveMode(
  mode: RunMode,
  config: DhConfig,
  configPath: string,
  systemPrompt: string,
  deps: CliDeps,
  resumeResult?: ResumeResult,
  quiet = false,
  // DH-0168: resolved (flag-overrides-config) pinned web-UI port; `0` (the default) preserves
  // today's random-ephemeral-port behavior unchanged.
  webPort = 0,
  /** DH-0148: `--instructions` (no `--job`) — the instructions file's content, sent as the
   * session's first message once the root agent connects, indistinguishable from a normally-
   * typed message (no special badge/label/rendering). When `resumeResult` is also set, this
   * already has `buildResumeNotice(resumeResult)` prepended by the caller (matching the
   * standalone `--job` path's own combined-text convention) — takes priority over sending the
   * resume notice on its own. Undefined for every other call site (plain interactive start,
   * or `--resume` with no `--instructions`). */
  autoSendMessage?: string,
): Promise<ExitCodeType> {
  const { io } = deps;
  // DH-0122: the app header prints once per invocation, before anything else — including
  // before the TUI takes the alt-screen — so it's visible in scrollback on every run mode,
  // not just the console-only ones (--server, --web, --connect). Ink's own `<Header>` (see
  // src/tui/ink/Header.tsx) additionally keeps a compact form of the same content live
  // inside the full-screen TUI view itself.
  printAppHeader(config, configPath, io);
  const headerInfo = buildHeaderInfo(config, configPath, BUILD_INFO);
  try {
    if (mode.kind === "connect") {
      const scheme = config.security?.tls ? "https" : "http";
      // DH-0111: `--connect <host>` documents `<host>` as a bare hostname, but an operator
      // pasting a value from e.g. "web UI ready at http://..." output (or just guessing at
      // the flag's shape) can hand it a full origin instead. Stripping any scheme the
      // caller already supplied before prepending our own avoids a doubled
      // "http://http://host:port" target that fails to resolve.
      const host = mode.host.replace(/^https?:\/\//, "");
      const targetBaseUrl = `${scheme}://${host}:${mode.port}`;
      if (mode.web) {
        const handle = deps.serveWebUi({
          port: webPort,
          targetBaseUrl,
          headerInfo,
          ...(config.security?.token ? { token: config.security.token } : {}),
          ...(config.security?.hostname ? { hostname: config.security.hostname } : {}),
        });
        // DH-0101: glyph wraps around the grepped "web UI ready at <url>" substring, never
        // rewrites it — the color/glyph sit before "web" and the reset lands before the URL
        // so `\S+` captures in e2e regexes (web.test.ts, connect-web.test.ts, spikes) stay
        // exactly the plain URL, no embedded ANSI.
        io.stdout(
          `dh: ${cliSuccessGlyph(process.stdout.isTTY === true)}web UI ready at ${handle.url} (connected to ${targetBaseUrl}).`,
        );
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
    // DH-0116: sessionId is generated once, here, and is authoritative — it's what
    // determines logDir/the server's own advertised sessionId below, so it must be the same
    // id AgentRuntime stamps into every log header it writes (via createAgentLoop), not an
    // independently-generated one. Previously AgentRuntime generated its own internal
    // sessionId, so log headers in --server mode didn't match the directory they were
    // written into, breaking --resume's header/directory consistency check (resume.ts).
    const sessionId = randomUUID();
    const logsRoot = join(process.cwd(), ".dh-logs");
    // DH-0037: see createStandaloneRuntime's identical call (src/cli/agent-loop-adapter.ts)
    // for the rationale.
    pruneLogDirectories(logsRoot, config.logRetention, Date.now(), sessionId);
    const logDir = join(logsRoot, sessionId);
    const agentLoop = deps.createAgentLoop(
      config,
      systemPrompt,
      clientKind,
      sessionId,
      resumeResult
        ? {
            messages: resumeResult.messages,
            fromSessionId: resumeResult.resumedFromSessionId,
            model: resumeResult.model,
          }
        : undefined,
    );
    // DH-0067: operators repeatedly ask "is my TUI even connected?" with nothing on either
    // side to confirm — a dim one-liner per SSE connect/disconnect. `--quiet` suppresses it
    // along with the agent activity feed below (the startup block itself always prints).
    const server = deps.createServer({
      agentLoop,
      sessionId,
      logDir,
      port: mode.kind === "server" ? mode.port : 0,
      ...(config.security ? { security: config.security } : {}),
      ...(quiet
        ? {}
        : {
            onClientConnect: (addr: string) => io.stdout(`dh: client connected from ${addr}`),
            onClientDisconnect: (addr: string) => io.stdout(`dh: client disconnected from ${addr}`),
          }),
    });
    const boundPort = server.start();

    // DH-0067: `--server` mode used to print exactly one line at startup and then nothing,
    // ever, through real agent activity — the only way to know anything happened was to
    // already know where the JSONL logs lived. One concise stdout line per agent lifecycle
    // transition; never full output (that stays the clients'/JSONL logs' job). Scoped to
    // `--server` specifically — local/web/connect modes already have a real client (TUI or
    // web UI) providing their own moment-to-moment feedback.
    if (mode.kind === "server" && !quiet) {
      const feed = new ActivityFeed();
      const feedTty = process.stdout.isTTY === true;
      agentLoop.onEvent((event) => {
        const line = feed.onEvent(event, feedTty);
        if (line !== undefined) io.stdout(`dh: ${line}`);
      });
    }

    // DH-0038/DH-0148: an interactive session doesn't wait for the operator's first message to
    // start the root the way a fresh session does (no operator has attached yet when this
    // runs) — a resumed root should pick up where it crashed off immediately, and a fresh
    // `--instructions` (no `--job`) root should start on those instructions immediately, not
    // sit idle in "waiting" for someone to notice and type something. Reuses the exact same
    // lazy-start sendMessage() path a real operator's first message would take
    // (AgentRuntimeLoopAdapter's doc comment) — from the loop's point of view this is
    // indistinguishable from an operator kicking things off themselves, and (DH-0148) the
    // rendered transcript is indistinguishable from a normally-typed message too, by design.
    // `autoSendMessage` (DH-0148's instructions-derived first message) takes priority when
    // both it and a bare `resumeResult` notice are candidates — see this function's own param
    // doc comment for why the caller already folds the resume notice into it when both apply.
    const firstMessage =
      autoSendMessage ?? (resumeResult ? buildResumeNotice(resumeResult) : undefined);
    if (firstMessage !== undefined) {
      agentLoop.sendMessage(ROOT_AGENT_ID, firstMessage);
    }

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
      // DH-0067 fix: this used to go through io.stderr, which in a typical terminal/`docker
      // logs` viewer renders red — indistinguishable at a glance from an actual failure. A
      // clean SIGTERM/SIGINT shutdown is an ordinary lifecycle event, not a fault; printing
      // it via stdout (rather than inventing an ANSI-styling layer just to force a neutral
      // color on stderr) keeps it looking like what it is.
      io.stdout(`dh: received ${signal}; shutting down session ${sessionId}...`);
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
      // DH-0002: best-effort — closes the shared McpManager (terminating stdio MCP child
      // processes); `.close` is optional on the handle type so tests injecting a bare fake
      // AgentLoopHandle (no MCP involved) don't need to implement it.
      void agentLoop.close?.()?.catch(() => {});
      uninstallSignals();
      io.exit(ExitCode.Success);
    });

    if (mode.kind === "server") {
      const panelTty = process.stdout.isTTY === true;
      // DH-0067/DH-0101: this exact line — including the "listening on port" substring — is
      // grepped by e2e's `waitForStdout` helpers (dh-process.ts and multiple spike scripts);
      // it stays byte-stable. The DH-0101 styling only wraps around it (a colored headline
      // glyph before "headless", nothing between/inside the grepped words), never rewrites
      // it — verified against every e2e grep site before landing this (search performed:
      // `grep -rn "listening on port" e2e/`).
      io.stdout(
        `dh: ${cliSuccessGlyph(panelTty)}headless server listening on port ${boundPort} (session ${sessionId}).`,
      );
      // DH-0067: `DhServer` only passes a `hostname` to `Bun.serve()` when the opt-in
      // `security.hostname` config field (DH-0022) is set — unset (the common case) is
      // still every interface, not just loopback — worth spelling out explicitly since
      // that's exactly the fact the posture note below depends on.
      const boundHost = config.security?.hostname ?? "0.0.0.0";
      io.stdout(
        `dh: ${cliBold(formatVersionString(BUILD_INFO), panelTty)} — bound to ${boundHost}:${boundPort} — logs: ${logDir}`,
      );
      io.stdout(`dh: connect with: dh --connect <host> --port ${boundPort}`);
      const posture = buildStartupPostureNote(config.security);
      // DH-0101: caution-marked (⚠, yellow/dim) rather than just another sentence in the
      // stack, per style-guide §5's "startup blocks read as a panel" convention — the glyph
      // is prepended after the existing "dh: " prefix, the note's own text is untouched.
      if (posture) io.stdout(`dh: ${cliCautionGlyph(panelTty)}${posture.replace(/^dh: /, "")}`);
      return ExitCode.Success;
    }

    const baseUrl = `http://localhost:${boundPort}`;
    if (mode.web) {
      webHandle = deps.serveWebUi({
        port: webPort,
        targetBaseUrl: baseUrl,
        headerInfo,
        ...(config.security?.token ? { token: config.security.token } : {}),
        ...(config.security?.hostname ? { hostname: config.security.hostname } : {}),
      });
      // DH-0067/DH-0101: this exact "web UI ready at <url>." line is grepped by e2e
      // (web.test.ts, connect-web.test.ts, several spikes) — stays byte-stable; styling only
      // wraps the "dh: " prefix, never the substring itself.
      io.stdout(
        `dh: ${cliSuccessGlyph(process.stdout.isTTY === true)}web UI ready at ${webHandle.url}.`,
      );
      io.stdout(`dh: logs: ${logDir}`);
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
 * `--dry-run` (DH-0035): validates everything up to but not including the first real model
 * call — config (already loaded by the time this runs), the instructions file if
 * `--instructions` was given, and provider client construction for every configured provider
 * — then exits 0 without spending any tokens.
 */
export async function runDryRun(
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
    `dh: ${cliSuccessGlyph(process.stdout.isTTY === true)}dry run OK — config, instructions file, and provider client construction all validated. No model was called.`,
  );
  io.exit(ExitCode.Success);
  return ExitCode.Success;
}
