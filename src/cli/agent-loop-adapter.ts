// DH-0174 (Core, extracted from cli.ts): the Core↔Server bridge — AgentRuntimeLoopAdapter
// (wraps AgentRuntime as an AgentLoopHandle for the interactive server/TUI/web modes) and
// createStandaloneRuntime (the standalone --instructions/--job path's own JSONL-attached
// AgentRuntime, with no HTTP server involved).
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { ROOT_AGENT_ID } from "../agent/agent-id.constant.ts";
import { AgentRuntime, type AgentRuntimeOptions } from "../agent/runtime.ts";
import type {
  AgentTreeNode,
  DhConfig,
  ModelInfo,
  ServerSentEvent,
  SessionClientKind,
  SkillInfo,
} from "../contracts/index.ts";
import {
  type AgentLoopEventListener,
  type AgentLoopHandle,
  type AgentLoopLogListener,
  pruneLogDirectories,
  SessionLogger,
  type Unsubscribe,
} from "../server/index.ts";

/**
 * Bridges Core's AgentRuntime (a single fixed onEvent/onLogLine callback pair, set at
 * construction) to Server's AgentLoopHandle (multi-subscriber onEvent/onLog, plus
 * sendMessage/stopAgent/getAgentTree) — the integration point flagged in both
 * src/server/agent-loop.type.ts's doc comment and Grace's round-1 status-log note ("(b) a thin
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

  constructor(options: {
    config: DhConfig;
    systemPrompt: string;
    client: SessionClientKind;
    // DH-0116: runInteractiveMode() (src/cli/run.ts) generates this once and uses it as the
    // logDir/DhServer sessionId too — passed through so AgentRuntime stamps the SAME id into
    // every log header it writes, instead of defaulting to a fresh randomUUID() of its own
    // that would mismatch the directory those headers land in (breaking --resume's
    // header/directory consistency check, resume.ts's loadHop). Optional here only so unit
    // tests constructing this adapter directly (not through runInteractiveMode()) don't all
    // need an unused id — AgentRuntime's own randomUUID() fallback covers that case, same as
    // before this fix.
    sessionId?: string;
    resume?: AgentRuntimeOptions["resume"];
  }) {
    this.runtime = new AgentRuntime({
      config: options.config,
      systemPrompt: options.systemPrompt,
      client: options.client,
      ...(options.sessionId !== undefined ? { sessionId: options.sessionId } : {}),
      // Round 5 (docs/handoffs/core.md status log): every interactive session — server/TUI/
      // Web, root and sub-agents alike — pauses instead of ending on a non-tool-use turn.
      // The standalone `--instructions`/`--job` path (defaultDeps().createRuntime) never sets
      // this, preserving its original end-on-first-non-tool-call behavior exactly.
      interactive: true,
      ...(options.resume ? { resume: options.resume } : {}),
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
      this.runtime.sendMessage(agentId, message);
      return;
    }
    if (!this.runtime.rootHasStarted) {
      // Fire-and-forget: the command handler (POST /api/commands) shouldn't block on the
      // whole root agent run just to acknowledge "message accepted" — progress streams via
      // onEvent/onLog as normal. A harness error before the loop ever gets going (bad
      // model/provider config) would otherwise be an unhandled rejection.
      //
      // DH-0131 fix: this used to hand-construct a synthetic agent_status:"failed" SSE event
      // here (and, before that, only a plain "message" log line — never a structured
      // status_change) because AgentRuntime.runRoot() itself didn't emit anything but
      // session_ended on this failure class. AgentRuntime.runRoot() now emits the full
      // message/status_change/agent_status/session_ended sequence itself (runtime.ts) via the
      // same onEvent/onLogLine callbacks this adapter's constructor already forwards into
      // eventListeners/logListeners — duplicating that here would double-log the failure, so
      // this just needs to swallow the rejection (already thrown/logged upstream) rather than
      // let it become an unhandled promise rejection.
      this.runtime.runRoot(message).catch(() => {});
      return;
    }
    this.runtime.sendMessageToRoot(message);
  }

  /** DH-0207/DH-0208: unlike `sendMessage()` above, the root agent has no special-case here —
   * `AgentRuntime.cancelQueuedMessage()` already handles the root-vs-sub-agent split
   * internally (see its own doc comment), and there's no "lazily start the root" branch to
   * mirror since cancelling against a not-yet-started root is trivially "nothing to cancel". */
  cancelQueuedMessage(agentId: string, messageId: string): boolean {
    return this.runtime.cancelQueuedMessage(agentId, messageId);
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

  /** DH-0093: thin delegations to AgentRuntime — the adapter's job here is only to bridge
   * the wire-facing AgentLoopHandle shape onto Core's actual methods, same as every other
   * method in this class. */
  listModels(): ModelInfo[] {
    return this.runtime.listModels();
  }

  switchModel(agentId: string, model: string): void {
    this.runtime.switchModel(agentId, model);
  }

  listSkills(): Promise<SkillInfo[]> {
    return this.runtime.listSkills();
  }

  invokeSkill(agentId: string, skill: string, args: string | undefined): Promise<void> {
    return this.runtime.invokeSkill(agentId, skill, args);
  }

  /** DH-0002: delegates to the underlying AgentRuntime.close() (closes the shared
   * McpManager, terminating any stdio MCP child processes) — called from this module's own
   * SIGTERM/SIGINT shutdown handling below, not a separate mechanism. */
  async close(): Promise<void> {
    await this.runtime.close();
  }
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
export function createStandaloneRuntime(
  config: DhConfig,
  systemPrompt: string,
  resume?: AgentRuntimeOptions["resume"],
  onEvent?: (event: ServerSentEvent) => void,
): AgentRuntime {
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
    ...(resume ? { resume } : {}),
    ...(onEvent ? { onEvent } : {}),
    onLogLine: (agentId, line) => logger.append(agentId, line),
  });
}
