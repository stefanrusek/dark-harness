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
import { ActivityFeed, buildStartupPostureNote } from "./activity-feed.ts";
import type { CliOptions, RunMode } from "./args.ts";
import { detectColorLevel } from "./color-context.ts";
import type { CliDeps, CliIo, WebUiHandleLike } from "./deps.ts";
import { fail } from "./deps.ts";
import type { HeaderStatusFacts } from "./header.ts";
import { renderHeaderA2, renderHeaderB, styleDhPrefix } from "./header.ts";
import { cliBold, cliCautionGlyph, cliSuccessGlyph } from "./styling.ts";

/** DH-0166: the single source of truth for local/TUI-only mode's bind address AND the TUI's
 * own client target — one constant so the bound interface and the dialed address cannot
 * drift apart (the original bug: server bound `security.hostname`'s interface, TUI dialed a
 * hardcoded `localhost`). Local mode always binds — and dials — loopback; see the
 * `localTuiOnly` block in `runInteractiveMode`. */
export const LOCAL_LOOPBACK_HOST = "127.0.0.1";

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
  // DH-0220: `--plain` — forces the plain-text startup-header fallback, same effect as
  // NO_COLOR, threaded into `detectColorLevel` below alongside the real TTY/env values.
  plain = false,
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
  // DH-0220: startup header redesign — replaces the old flat figlet-banner + status-line
  // block this function used to print via `printAppHeader` (activity-feed.ts; still used
  // by `dh doctor`/`--check`, out of this ticket's scope) with two mode-selected headers
  // (Header A2: interactive TTY/in-app chat window; Header B: web-serve or `--server`
  // "headless" mode).
  // `level` is resolved once, here, from the real TTY/env/`--plain` inputs and threaded into
  // every renderer and into `styleDhPrefix` for the "extend Header B's styling to subsequent
  // `dh:` log lines" owner decision (DH-0220 Summary #3) — see src/cli/header.ts.
  const level = detectColorLevel({ isTTY: process.stdout.isTTY === true, env: process.env, plain });
  const configLine = `${configPath} — ${config.models.length} model${config.models.length === 1 ? "" : "s"}`;
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
        const facts: HeaderStatusFacts = {
          version: BUILD_INFO.version,
          gitSha: BUILD_INFO.gitSha,
          configLine,
          bindHost: `${host}:${mode.port}`,
          hasToken: Boolean(config.security?.token),
          webUiUrl: handle.url,
        };
        for (const line of renderHeaderB(facts, level).slice(0, -1)) io.stdout(line);
        // DH-0101: glyph wraps around the grepped "web UI ready at <url>" substring, never
        // rewrites it — the color/glyph sit before "web" and the reset lands before the URL
        // so `\S+` captures in e2e regexes (web.test.ts, connect-web.test.ts, spikes) stay
        // exactly the plain URL, no embedded ANSI. DH-0220: the "dh: " prefix itself now
        // restyles to match Header B (owner decision #3) — text is byte-identical, only the
        // surrounding color changes.
        io.stdout(
          `${styleDhPrefix(level)}${cliSuccessGlyph(process.stdout.isTTY === true)}web UI ready at ${handle.url} (connected to ${targetBaseUrl}).`,
        );
        return ExitCode.Success;
      }
      const a2Facts: HeaderStatusFacts = {
        version: BUILD_INFO.version,
        gitSha: BUILD_INFO.gitSha,
        configLine,
        bindHost: `${host}:${mode.port}`,
        hasToken: Boolean(config.security?.token),
      };
      const term = { columns: process.stdout.columns ?? 0, rows: process.stdout.rows ?? 0 };
      // `--connect` without `--web` is always the interactive TUI/chat-window path — Header
      // A2 unconditionally. (DH-0223: each call site below already knows statically which
      // header it wants — a `chooseHeaderMode(isServer, isWeb)` helper existed here briefly
      // but was dead code, since none of these branches actually gate on those booleans at
      // runtime; removed rather than force a call that could only ever return one constant.)
      for (const line of renderHeaderA2(a2Facts, level, term)) io.stdout(line);
      const connectResult = await deps.startTui(targetBaseUrl, config.security?.token);
      if (connectResult.fatalError !== undefined) {
        io.stderr(`dh: error: ${connectResult.fatalError}`);
        return ExitCode.HarnessError;
      }
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
    // DH-0166: local/TUI-only mode's server exists solely so this same process's own TUI has
    // something to talk to — it has no legitimate remote-reachability use case, so it binds
    // loopback unconditionally, ignoring `security.hostname` (whose entire purpose is remote
    // reachability for `--server`/`--web`, DH-0022/DH-0182). Before this, forwarding
    // `config.security` unmodified meant a configured `hostname` bound *only* that interface
    // while the TUI dialed loopback — plain `dh` hung in an infinite reconnect loop — and an
    // *unset* hostname bound every interface (Bun's default), an unnecessary exposure for a
    // same-process IPC channel. `--web` local mode keeps honoring `hostname`: its browser
    // dials the DhServer directly (src/web/server.ts's `resolveConfig`), so remote
    // reachability there is the operator's actual intent.
    const localTuiOnly = mode.kind === "local" && !mode.web;
    const serverSecurity = localTuiOnly
      ? { ...config.security, hostname: LOCAL_LOOPBACK_HOST }
      : config.security;
    const server = deps.createServer({
      agentLoop,
      sessionId,
      logDir,
      port: mode.kind === "server" ? mode.port : 0,
      ...(serverSecurity ? { security: serverSecurity } : {}),
      ...(quiet
        ? {}
        : {
            onClientConnect: (addr: string) =>
              io.stdout(`${styleDhPrefix(level)}client connected from ${addr}`),
            onClientDisconnect: (addr: string) =>
              io.stdout(`${styleDhPrefix(level)}client disconnected from ${addr}`),
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
        if (line !== undefined) io.stdout(`${styleDhPrefix(level)}${line}`);
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
      io.stdout(`${styleDhPrefix(level)}received ${signal}; shutting down session ${sessionId}...`);
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
      const boundHost = config.security?.hostname ?? "0.0.0.0";
      // DH-0220: Header B (the framed instrument panel) prints first, established as the
      // "headless mode" identity moment; the pre-existing byte-stable status lines below
      // (grepped by e2e's `waitForStdout` helpers, dh-process.ts and multiple spike scripts)
      // still follow it unchanged — only their "dh: " prefix now restyles via
      // `styleDhPrefix` (owner decision #3), never the grepped substrings themselves
      // ("listening on port ...", "bound to ...", "connect with: dh --connect ...").
      const bFacts: HeaderStatusFacts = {
        version: BUILD_INFO.version,
        gitSha: BUILD_INFO.gitSha,
        configLine,
        bindHost: `${boundHost}:${boundPort}`,
        hasToken: Boolean(config.security?.token),
        logDir,
      };
      for (const line of renderHeaderB(bFacts, level).slice(0, -1)) io.stdout(line);
      io.stdout(
        `${styleDhPrefix(level)}${cliSuccessGlyph(panelTty)}headless server listening on port ${boundPort} (session ${sessionId}).`,
      );
      io.stdout(
        `${styleDhPrefix(level)}${cliBold(formatVersionString(BUILD_INFO), panelTty)} — bound to ${boundHost}:${boundPort} — logs: ${logDir}`,
      );
      io.stdout(`${styleDhPrefix(level)}connect with: dh --connect <host> --port ${boundPort}`);
      const posture = buildStartupPostureNote(config.security);
      // DH-0101: caution-marked (⚠, yellow/dim) rather than just another sentence in the
      // stack, per style-guide §5's "startup blocks read as a panel" convention — the glyph
      // is prepended after the existing "dh: " prefix, the note's own text is untouched.
      if (posture)
        io.stdout(
          `${styleDhPrefix(level)}${cliCautionGlyph(panelTty)}${posture.replace(/^dh: /, "")}`,
        );
      return ExitCode.Success;
    }

    // DH-0166: in TUI-only mode the client address is derived from the same bind decision as
    // the server (`LOCAL_LOOPBACK_HOST` above), not an independently-hardcoded literal — the
    // two can no longer drift apart the way `hostname`-bound-server vs `localhost`-dialing-TUI
    // did. The `--web` path keeps `localhost`: `resolveConfig` (src/web/server.ts) rewrites a
    // loopback target host to whatever Host the browser actually used.
    const baseUrl = localTuiOnly
      ? `http://${LOCAL_LOOPBACK_HOST}:${boundPort}`
      : `http://localhost:${boundPort}`;
    if (mode.web) {
      webHandle = deps.serveWebUi({
        port: webPort,
        targetBaseUrl: baseUrl,
        headerInfo,
        ...(config.security?.token ? { token: config.security.token } : {}),
        ...(config.security?.hostname ? { hostname: config.security.hostname } : {}),
      });
      const bFacts: HeaderStatusFacts = {
        version: BUILD_INFO.version,
        gitSha: BUILD_INFO.gitSha,
        configLine,
        bindHost: config.security?.hostname ?? "all interfaces",
        hasToken: Boolean(config.security?.token),
        webUiUrl: webHandle.url,
        logDir,
      };
      for (const line of renderHeaderB(bFacts, level).slice(0, -1)) io.stdout(line);
      // DH-0067/DH-0101: this exact "web UI ready at <url>." line is grepped by e2e
      // (web.test.ts, connect-web.test.ts, several spikes) — stays byte-stable; styling only
      // wraps the "dh: " prefix, never the substring itself.
      io.stdout(
        `${styleDhPrefix(level)}${cliSuccessGlyph(process.stdout.isTTY === true)}web UI ready at ${webHandle.url}.`,
      );
      io.stdout(`${styleDhPrefix(level)}logs: ${logDir}`);
      return ExitCode.Success;
    }

    // DH-0220: this is the interactive local TUI's own startup moment — Header A2 (the full
    // wordmark + status tree), printed before Ink takes the alt-screen (same "visible in
    // scrollback" rationale the old `printAppHeader` comment documented).
    const a2Facts: HeaderStatusFacts = {
      version: BUILD_INFO.version,
      gitSha: BUILD_INFO.gitSha,
      configLine,
      bindHost: baseUrl,
      hasToken: Boolean(config.security?.token),
      logDir,
    };
    const term = { columns: process.stdout.columns ?? 0, rows: process.stdout.rows ?? 0 };
    for (const line of renderHeaderA2(a2Facts, level, term)) io.stdout(line);

    const tuiResult = await deps.startTui(baseUrl, config.security?.token, { ownsServer: true });
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
    // DH-0166: the TUI tearing itself down because it could never (re)connect is a harness
    // fault, not a clean quit — print the actionable error the TUI built and exit per the
    // ADR 0005 contract.
    if (tuiResult.fatalError !== undefined) {
      io.stderr(`dh: error: ${tuiResult.fatalError}`);
      return ExitCode.HarnessError;
    }
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
