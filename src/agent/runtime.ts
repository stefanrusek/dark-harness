// Composition root: wires dh.json config, provider adapters, the tool set, and the task
// registry together so a root agent (and any sub-agents it spawns via the Agent tool) can
// actually run. This is where the tools -> loop -> tools cycle is broken: tools only ever
// see a ToolContext.spawnAgent function; only this module imports both loop.ts and
// tools/index.ts.

import { randomUUID } from "node:crypto";
import { join } from "node:path";
import {
  type AgentStatus,
  type AgentTreeNode,
  type DhConfig,
  ExitCode,
  type LogLine,
  type ModelConfig,
  type ModelInfo,
  type OutcomeReportedBy,
  type ReportedOutcome,
  type ServerSentEvent,
  type SessionClientKind,
  type SkillInfo,
} from "../contracts/index.ts";
import { composeSkillInvocation } from "../prompt/index.ts";
import { renderJobModeSection, renderSelfInfoSection } from "../prompt/system-prompt.ts";
import { ROOT_AGENT_ID } from "./agent-id.constant.ts";
import { type AgentLoopResult, computeCostUsd, type ModelBinding, runAgentLoop } from "./loop.ts";
import { McpManager } from "./mcp/manager.ts";
import { loadProjectMcpServers } from "./mcp/project-config.ts";
import { mergeMcpTools } from "./mcp-tools-merge.ts";
import {
  buildPricing,
  cacheOverride,
  compactionOverride,
  contextWindowOverride,
  pricingOverride,
  thinkingOverride,
} from "./model-overrides.ts";
import { ModelRegistry } from "./model-registry.ts";
import type { ModelProvider, ProviderMessage } from "./providers/types.ts";
import { reconstructSubAgentHistory } from "./resume.ts";
import { SessionBudget, sessionBudgetOptionsFromConfig } from "./session-budget.ts";
import { loadSkillFromPaths } from "./skills.ts";
import { SkillsCache } from "./skills-cache.ts";
import { TaskFinishedError, TaskRegistry, type TaskRunHandle, type TaskSnapshot } from "./tasks.ts";
import { TodoStore } from "./todos.ts";
import { buildToolMap, composeTools, reportOutcomeTool } from "./tools/index.ts";
import { runToolSearch } from "./tools/tool-search.ts";
import type { Tool, ToolContext } from "./tools/types.type.ts";
import { type CreatedWorktree, hasChanges, isGitRepo, removeWorktree } from "./worktree.ts";
import { WorktreeRegistry } from "./worktree-registry.ts";

export interface AgentRuntimeOptions {
  config: DhConfig;
  systemPrompt: string;
  cwd?: string;
  sessionId?: string;
  tools?: Tool[];
  /** Round 8 (ADR 0005 amendment): how the process constructing this runtime was invoked —
   * required (not defaulted) so no call site can silently record a wrong value in every
   * agent's log header. Threaded unchanged into every runAgentLoop() call this runtime makes
   * (root and sub-agents alike — a session's client kind is fixed for its whole lifetime). */
  client: SessionClientKind;
  onEvent?: (event: ServerSentEvent) => void;
  /** Cross-domain note (docs/handoffs/core.md Round 2 status log): takes `agentId` as a
   * separate first argument — unlike `LogLine` itself, most `LogEvent` variants don't
   * self-describe which agent produced them (only `LogHeader` does), and Server's
   * `AgentLoopLogListener` (`(agentId, line) => void`) needs it to route to the right
   * per-agent JSONL file. AgentRuntime is the layer that knows the agentId for every
   * runAgentLoop() call (loop.ts's own onLogLine stays `(line) => void`), so it threads it
   * through here rather than pushing that responsibility onto loop.ts or its caller. */
  onLogLine?: (agentId: string, line: LogLine) => void;
  /** Round 5 (docs/handoffs/core.md status log): selects the mode every `runAgentLoop()` call
   * this runtime makes — root (`runRoot()`) and every sub-agent it spawns (`spawnAgent()`)
   * alike, since they must behave consistently (see loop.ts's module doc comment). `false`
   * (the default) is the standalone `--instructions`/`--job` dark-factory path — a
   * non-tool-use turn ends the run, unchanged from before this round. `true` is for
   * interactive sessions (server/TUI/Web, via `src/cli.ts`'s `AgentRuntimeLoopAdapter`,
   * which always constructs its `AgentRuntime` with `interactive: true`) — a non-tool-use
   * turn instead marks the agent "waiting" and pauses for the next message. This is a
   * per-runtime-instance setting, not per-call, because a single `AgentRuntime` is always
   * entirely one or the other in practice (one process, one CLI invocation, one mode). */
  interactive?: boolean;
  /** DH-0038 (`--resume <sessionId>`): when present, `runRoot()` seeds the root agent's
   * conversation from replayed history (`src/agent/resume.ts`'s `loadResumeSession`) instead
   * of starting fresh, and defaults `runRoot()`'s own model resolution to `model` (the
   * original session's alias, resolved by the caller against the *current* config — src/
   * cli.ts's job, not this class's) rather than `config.options.defaultModel`, unless an
   * explicit `modelName` is still passed to `runRoot()` itself. Root agent only (v1 scope,
   * D1) — never threaded into `spawnAgent()`'s sub-agent calls. */
  resume?: { messages: ProviderMessage[]; fromSessionId: string; model: string };
  /** DH-0003: the `.dh-logs` root directory this runtime's own session lives under — needed
   * so SendMessage's finished-sub-agent-resume path (`sendMessage()` below) can read that
   * sub-agent's own JSONL log back via `reconstructSubAgentHistory()` (src/agent/resume.ts)
   * before re-invoking spawnAgent() with its history seeded. Defaults to `./.dh-logs`
   * (relative to `cwd`), matching every other call site's own `.dh-logs` convention
   * (src/cli.ts) — only needs overriding by tests that use a different logs root. */
  logsRoot?: string;
}

// DH-0173: pure per-model AgentLoopParams override helpers (buildPricing/pricingOverride/
// thinkingOverride/cacheOverride/contextWindowOverride/compactionOverride) now live in
// model-overrides.ts; ConfigModelError/model+provider resolution now lives in
// model-registry.ts. Re-exported below so existing external imports of `ConfigModelError`
// from this module (src/agent/runtime.test.ts) keep working unchanged.
export { ConfigModelError } from "./model-registry.ts";

export class RootNotListeningError extends Error {
  constructor() {
    super(
      "the root agent has not started yet, or is not currently listening for messages " +
        "(it finished a turn and is between runAgentLoop() calls — this shouldn't normally " +
        "be observable from outside since registerSendMessage is (re-)installed at the top " +
        "of every runAgentLoop() invocation)",
    );
    this.name = "RootNotListeningError";
  }
}

/** DH-0093: `switchModel()` v1 scope is root-only (see the ticket's design section — no
 * operator story requires retargeting an ad-hoc, short-lived sub-agent's model mid-run).
 * Server (src/server/commands.ts) catches this and translates it to a 400 ack, the same
 * pattern as ConfigModelError elsewhere. */
export class RootOnlyModelSwitchError extends Error {
  constructor(agentId: string) {
    super(
      `switch_model is root-only in v1; "${agentId}" is not the root agent (sub-agents are ad-hoc and short-lived — no operator story needs mid-run retargeting of one).`,
    );
    this.name = "RootOnlyModelSwitchError";
  }
}

/** DH-0093: thrown by `invokeSkill()` when the named skill can't be found via
 * `loadSkillFromPaths` — Server (src/server/commands.ts) catches this and translates it to a
 * 404 ack, per the ticket's design section. */
export class UnknownSkillError extends Error {
  constructor(name: string) {
    super(`unknown skill "${name}"`);
    this.name = "UnknownSkillError";
  }
}

/** Wires dh.json into a runnable agent runtime: providers, tools, and the task registry that
 * lets Agent/Monitor/TaskOutput/SendMessage/TaskStop cooperate in-process. */
export class AgentRuntime {
  readonly sessionId: string;
  // Round 12 (docs/handoffs/core.md): wired to handleTaskSettled() so every *background*
  // Bash/Agent task's completion pushes a notification into its parent's conversation — see
  // that method's doc comment for the full design, including the orphaned-grandchild case.
  // DH-0012: retention cap threaded from config.limits.completedRetention (constructor body,
  // not a field initializer, since it needs `options` — see constructor below).
  readonly tasks: TaskRegistry;
  private readonly config: DhConfig;
  private readonly systemPrompt: string;
  private readonly cwd: string;
  private readonly toolMap: Map<string, Tool>;
  /** DH-0002: one shared McpManager per runtime (per process), constructed from
   * `config.mcpServers` and connected eagerly, in parallel, at construction time — see the
   * constructor body. Its discovered tools are merged into `toolMap` in place as each
   * server's connect+discovery cycle resolves; `loop.ts`'s per-turn `toolDefs` read makes
   * newly-added entries visible without any further plumbing. */
  private readonly mcpManager: McpManager;
  /** DH-0173: model-alias resolution + per-provider-name provider caching, extracted from
   * this class into model-registry.ts. */
  private readonly models: ModelRegistry;
  private readonly onEvent: ((event: ServerSentEvent) => void) | undefined;
  private readonly onLogLine: ((agentId: string, line: LogLine) => void) | undefined;
  private readonly interactive: boolean;
  private readonly client: SessionClientKind;
  private readonly resume: AgentRuntimeOptions["resume"];
  /** DH-0003: see AgentRuntimeOptions.logsRoot's doc comment. */
  private readonly logsRoot: string;

  // Root-agent bookkeeping: runRoot() isn't tracked in `tasks` (it IS the session, per its
  // own doc comment below), so getAgentTree()/sendMessageToRoot() need their own small
  // amount of state to mirror what TaskRegistry already tracks per sub-agent.
  //
  // Round 2 correction (docs/handoffs/core.md status log — found via a live integration
  // test against a real DhServer, not a hypothetical): getAgentTree() must include a root
  // node even before runRoot() has ever been called. Server's own command handler
  // (src/server/commands.ts) validates a send_message's agentId against getAgentTree()
  // *before* ever calling AgentLoopHandle.sendMessage() — an empty tree makes the very
  // first message to the root agent unreachable through the real wire protocol, since
  // there's nothing for `findAgent` to find yet. "waiting" (an existing AgentStatus value,
  // not a new one) represents "not started yet" for this purpose.
  private rootStarted = false;
  private rootModel: string | undefined;
  private rootStatus: AgentStatus = "waiting";
  private rootSendMessage: ((message: string) => void) | undefined;
  /** DH-0093: root-not-started-yet model switch — set by `switchModel()` when
   * `!this.rootStarted`, consulted by `runRoot()`'s own model-resolution precedence chain (an
   * explicit `runRoot(instruction, modelName)` argument still wins over this; this wins over
   * `this.resume?.model`/`config.options.defaultModel`). */
  private pendingInitialModel: string | undefined;
  /** DH-0093: mirrors `rootSendMessage` above — installed via `registerModelSwitch` on every
   * `runRoot()` call so `switchModel()` can push a live binding into the root's currently-
   * running loop (see loop.ts's `ModelBinding`/`registerModelSwitch` doc comments). */
  private rootModelSwitch: ((binding: ModelBinding) => void) | undefined;
  // Round 3 (docs/handoffs/core.md status log): the root isn't a TaskRegistry entry, so it
  // needs its own AbortController — mirrors the one TaskRegistry.start() already creates
  // per task, which is what makes stopAgent(subAgentId) reach the loop after this round's
  // AgentLoopParams.signal addition.
  private rootController: AbortController | undefined;

  // DH-0013 (tracking/DH-0013-no-cost-turn-time-or-fanout-budgets.md) — session-wide budget
  // bookkeeping. `maxTurns` (existing) was the only safety valve on a running session; these
  // extend that to cumulative cost/tokens, wall-clock duration, and sub-agent fan-out, all
  // optional (config.options.max*) and all enforced here since AgentRuntime, not loop.ts, is
  // the layer that sees every agent in the session, not just one loop's own turns.
  // DH-0173: cumulative cost/token state + cap-crossing math extracted into session-budget.ts
  // (SessionBudget) — this class still owns *reacting* to a trip (stopping every live agent),
  // since only it has the task registry/root state needed to do that.
  private readonly budget: SessionBudget;
  /** DH-0173: separate from `budget.isTripped` (which guards the cheap `recordUsage()`
   * early-return) — this guards `tripBudget()`'s own one-time "log + stop everything" action,
   * since the wall-clock timer path calls `tripBudget()` directly without going through
   * `recordUsage()` first, so it needs its own idempotency flag rather than assuming
   * `budget.isTripped` was already true when it fires. */
  private budgetActionTaken = false;
  private sessionStartMs: number | undefined;
  private wallClockTimer: ReturnType<typeof setTimeout> | undefined;
  /** agentId -> nesting depth (root is 0). Populated by spawnAgent(); never evicted (mirrors
   * TaskRegistry's own "tasks are never evicted" policy) — depth lookups only ever need a
   * *live* agent's own depth (to compute its children's), so a stale entry for an already-
   * finished agent is harmless, just unused. */
  private readonly agentDepth = new Map<string, number>([[ROOT_AGENT_ID, 0]]);
  /** DH-0070: agentId -> that agent's own cwd, captured once at spawn time from the spawning
   * agent's own entry in this same map (root's own entry is seeded in the constructor from
   * `this.cwd`). Replaces a single process-wide `this.cwd` read by every agent's
   * ToolContext — each agent gets its own fixed value, inherited from its parent at spawn
   * time, the same "own everything else" precedent as `agentDepth` above. Never evicted, same
   * rationale as `agentDepth`. This ticket does not add cross-call `cd` persistence (see
   * tracking/DH-0070) — an agent's entry here never changes after it's set, so every Bash
   * call for that agent still resolves against the same fixed value, exactly as before this
   * fix; the only change is that value is no longer read from one field shared by every agent
   * in the runtime. */
  private readonly agentCwd = new Map<string, string>();
  private liveAgentCount = 0;
  /** DH-0077: isolation-worktree lifecycle (agentId -> its CreatedWorktree, plus the
   * concurrency budget) — extracted into worktree-registry.ts (WorktreeRegistry). */
  private readonly worktrees = new WorktreeRegistry();
  /** DH-0093: eager skills scan, extracted into skills-cache.ts (SkillsCache) — see that
   * class's own doc comment for the "builtin-first, replaced once discoverSkills() resolves"
   * timing this preserves unchanged. */
  private readonly skills: SkillsCache;

  constructor(options: AgentRuntimeOptions) {
    this.config = options.config;
    this.systemPrompt = options.systemPrompt;
    this.cwd = options.cwd ?? process.cwd();
    // DH-0070: root's own per-agent cwd entry — everything else (spawnAgent) inherits
    // transitively from here via the same map, never from `this.cwd` directly.
    this.agentCwd.set(ROOT_AGENT_ID, this.cwd);
    this.sessionId = options.sessionId ?? randomUUID();
    // DH-0050: set ahead of toolMap construction (moved up from its original position further
    // down this constructor) so the conditional ReportOutcome registration just below can read
    // it — every other use of `this.interactive` elsewhere in this class is unaffected by the
    // reordering, it's a plain readonly field assigned once.
    this.interactive = options.interactive ?? false;
    // DH-0074: composeTools() adds WebFetch/WebSearch on top of ALL_TOOLS only when the
    // matching `dh.json` `web.fetch`/`web.search` block is present — see its own doc comment.
    this.toolMap = buildToolMap(options.tools ?? composeTools(this.config));
    // DH-0050: ReportOutcome is registered only for non-interactive runtimes (the standalone
    // `--instructions`/`--job` dark-factory path) — see tools/index.ts's own doc comment for
    // why it's deliberately excluded from composeTools()/ALL_TOOLS itself. A caller supplying
    // an explicit `options.tools` list (tests) opts out of this automatic addition, same as it
    // already opts out of composeTools() above.
    if (!this.interactive && !options.tools) {
      this.toolMap.set(reportOutcomeTool.name, reportOutcomeTool);
    }
    // DH-0002: constructed and connected here, not lazily on first ToolSearch call — eager
    // connection keeps ToolSearch fast and surfaces misconfigured servers in the startup
    // logs. connectAll() never throws/rejects (every per-server failure is caught inside
    // McpConnection itself), so this fire-and-forget `.then()` is safe: it never produces an
    // unhandled rejection, and startup never blocks on or fails because of it.
    this.mcpManager = new McpManager(this.config.mcpServers);
    this.models = new ModelRegistry(this.config);
    void this.mcpManager.connectAll().then(() => mergeMcpTools(this.mcpManager, this.toolMap));
    // DH-0091: pick up a project's own `.mcp.json` (working-directory root only, same scoping
    // DH-0055 assumes for CLAUDE.md) alongside dh.json's own `mcpServers` — read once here at
    // construction time, consistent with connectAll()'s own eager-at-startup timing above.
    // `McpManager.addServers()` skips any name already configured via dh.json, which is what
    // gives dh.json's own definition precedence on a collision (see project-config.ts's doc
    // comment for the full rationale). Never throws into the constructor: a missing file is a
    // silent no-op (loadProjectMcpServers() itself returns undefined), and a malformed file
    // logs a clear error to stderr rather than crashing startup — the same "degrade
    // gracefully, never block startup" contract connectAll() already has.
    void this.loadAndMergeProjectMcpServers();
    // DH-0093: eager, fire-and-forget scan at construction time — same timing precedent as
    // connectAll() above; see SkillsCache's own doc comment.
    this.skills = new SkillsCache(options.config.skillPaths);
    this.onEvent = options.onEvent;
    this.onLogLine = options.onLogLine;
    this.client = options.client;
    this.resume = options.resume;
    this.logsRoot = options.logsRoot ?? join(this.cwd, ".dh-logs");
    this.budget = new SessionBudget(sessionBudgetOptionsFromConfig(this.config));
    // DH-0012: wired to handleTaskSettled() so every *background* Bash/Agent task's
    // completion pushes a notification into its parent's conversation — see that method's
    // doc comment for the full design, including the orphaned-grandchild case. Retention cap
    // comes from config.limits.completedRetention (TaskRegistry defaults to
    // DEFAULT_COMPLETED_RETENTION when omitted).
    this.tasks = new TaskRegistry(
      (snapshot) => this.handleTaskSettled(snapshot),
      this.config.limits?.completedRetention,
    );
  }

  /** DH-0013: records a `token_usage` event's contribution to the session-wide cumulative
   * cost/token budgets and trips them if exceeded. Called from every onEvent path (root and
   * every sub-agent) — see spawnAgent()'s/runRoot()'s onEvent handlers below.
   *
   * DH-0010 Part A fix: the cumulative token count must include cache-read/cache-write
   * tokens, not just input+output — otherwise enabling caching would silently inflate
   * `maxTotalTokens`'s effective budget (cache tokens are real provider-reported usage, just
   * priced/reported separately). */
  private recordUsageAndCheckBudgets(
    inputTokens: number,
    outputTokens: number,
    costUsd: number | undefined,
    cacheReadTokens = 0,
    cacheWriteTokens = 0,
  ): void {
    const tripReason = this.budget.recordUsage(
      inputTokens,
      outputTokens,
      costUsd,
      cacheReadTokens,
      cacheWriteTokens,
    );
    if (tripReason !== undefined) this.tripBudget(tripReason);
  }

  /** DH-0013: stops every live agent in the session (root + every running/waiting sub-agent
   * task) exactly once, logging the reason to each live agent's own JSONL stream first (the
   * same "log before/alongside the stop" pattern DH-0017's error-logging fix uses) so the
   * budget-exceeded reason is distinguishable from a normal completion or an
   * operator-initiated TaskStop/stopRoot() when reading the log back. Idempotent — a second
   * budget crossing (e.g. both cost and wall-clock firing close together) is a no-op. */
  private tripBudget(reason: string): void {
    if (this.budgetActionTaken) return;
    this.budgetActionTaken = true;
    this.budget.markTripped();

    const logReason = (agentId: string) => {
      this.onLogLine?.(agentId, {
        version: 1,
        timestamp: new Date().toISOString(),
        type: "message",
        role: "system",
        content: `Session budget exceeded: ${reason}. Stopping.`,
      });
    };

    if (this.rootStarted && this.isLiveStatus(this.rootStatus)) {
      logReason(ROOT_AGENT_ID);
    }
    for (const task of this.tasks.list()) {
      if (this.isLiveStatus(task.status)) {
        logReason(task.id);
      }
    }

    this.stopRoot();
    for (const task of this.tasks.list()) {
      if (this.isLiveStatus(task.status)) {
        try {
          this.tasks.stop(task.id);
        } catch {
          // Already reached a terminal status between the isLiveStatus check above and here
          // (e.g. it finished naturally in the same tick) — nothing left to stop.
        }
      }
    }

    if (this.wallClockTimer) {
      clearTimeout(this.wallClockTimer);
      this.wallClockTimer = undefined;
    }
  }

  /** DH-0094: the base system prompt (`this.systemPrompt`, fixed for the runtime's lifetime)
   * plus a self-awareness section computed fresh for *this* agent's resolved model — a
   * sub-agent may run a different `ModelConfig` than its parent/root, so this can't be baked
   * into `this.systemPrompt` once; every `runAgentLoop()` call site (`runRoot()`,
   * `spawnAgent()`) calls this with the model it just resolved for that specific agent. */
  private buildAgentSystemPrompt(model: ModelConfig): string {
    // DH-0194: `this.interactive` is `false` for the standalone `--instructions`/`--job`
    // path (no live operator) and `true` for every interactive session (server/TUI/Web) —
    // see AgentRuntimeOptions.interactive's doc comment above. Sub-agents always run under
    // this same runtime instance, so they get the same job-mode section as the root when the
    // whole runtime is non-interactive.
    const jobModeSection = this.interactive ? "" : `\n\n${renderJobModeSection()}`;
    return `${this.systemPrompt}\n\n${renderSelfInfoSection(this.config, model)}${jobModeSection}`;
  }

  private buildToolContext(agentId: string): ToolContext {
    // DH-0002: fresh per agent lifetime (declared here, closed over by both the returned
    // object's own field and the searchDeferredTools closure below).
    const activatedTools = new Set<string>();
    return {
      // DH-0070: this agent's own fixed cwd, captured at spawn time (root: constructor;
      // sub-agent: spawnAgent() below) — never a single shared/process-wide value. The
      // fallback to `this.cwd` only guards a defensive/unreachable case (an agentId with no
      // recorded entry, e.g. a future caller of buildToolContext that bypasses runRoot()/
      // spawnAgent()); every real call site seeds this map before buildToolContext runs.
      cwd: this.agentCwd.get(agentId) ?? this.cwd,
      runInBackgroundDefault: this.config.options.runInBackgroundDefault ?? true,
      agentId,
      config: this.config,
      tasks: this.tasks,
      sendMessage: (taskId: string, message: string) => this.sendMessage(taskId, message),
      spawnAgent: (params: { model: string; prompt: string }) => this.spawnAgent(agentId, params),
      loadSkill: (name: string) => loadSkillFromPaths(name, this.config.skillPaths ?? []),
      searchDeferredTools: async (query: string, searchOptions?: { maxResults?: number }) => {
        // DH-0002 §6 lazy retry: any corpus-touching ToolSearch call gives every currently-
        // failed MCP server one throttled (>=60s since its last attempt) reconnect attempt
        // before the search runs, so a server that's recovered becomes visible again without
        // waiting for the next runtime restart. Never throws (McpManager.
        // reconnectFailedServers() swallows per-server errors internally).
        await this.mcpManager.reconnectFailedServers();
        mergeMcpTools(this.mcpManager, this.toolMap);

        const { tools: mcpTools, unreachable } = this.mcpManager.listAllTools();
        const corpus = [
          ...[...this.toolMap.values()]
            .filter((t) => !t.deferred)
            .map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })),
          ...mcpTools.map((t) => ({
            name: `mcp__${t.serverName}__${t.name}`,
            description: t.description,
            inputSchema: {
              type: "object" as const,
              properties: (t.inputSchema.properties as Record<string, unknown>) ?? {},
              ...(t.inputSchema.required ? { required: t.inputSchema.required } : {}),
              ...(t.inputSchema.additionalProperties !== undefined
                ? { additionalProperties: t.inputSchema.additionalProperties }
                : {}),
            },
            deferred: true,
            serverName: t.serverName,
          })),
        ];

        const { results, notFound } = runToolSearch(corpus, query, searchOptions?.maxResults);
        for (const result of results) {
          if (result.deferred) activatedTools.add(result.name);
        }

        return {
          results,
          ...(notFound ? { notFound } : {}),
          ...(unreachable.length > 0 ? { unreachableServers: unreachable } : {}),
        };
      },
      // Round 13 (docs/handoffs/core.md): fresh per agent lifetime, matching this
      // ToolContext's own lifetime — see readRegistry's doc comment in tools/types.ts.
      readRegistry: new Map(),
      // DH-0002: fresh per agent lifetime, same scoping precedent as readRegistry above —
      // captured by this closure so searchDeferredTools (above) can mutate it directly.
      activatedTools,
      // DH-0076: fresh per agent lifetime, same scoping precedent as readRegistry/
      // activatedTools above — this agent's own self-authored todo/plan store.
      todos: new TodoStore(),
      // DH-0074: WebFetch's `extractionModel` step (and any future tool needing a one-off
      // model inference) goes through here rather than calling a provider directly — this is
      // what makes its token usage feed the same session-wide cumulative cost/token budgets
      // (DH-0013) and `token_usage` SSE/log reporting every agent turn already gets.
      completeWithModel: async (modelName, request) => {
        const model = this.models.resolveModel(modelName);
        const provider = this.models.providerFor(model);
        const result = await provider.complete({ ...request, model: model.model });
        const costUsd = computeCostUsd(
          buildPricing(model),
          result.usage.inputTokens,
          result.usage.outputTokens,
          result.usage.cacheReadTokens ?? 0,
          result.usage.cacheWriteTokens ?? 0,
        );
        this.recordUsageAndCheckBudgets(
          result.usage.inputTokens,
          result.usage.outputTokens,
          costUsd,
          result.usage.cacheReadTokens ?? 0,
          result.usage.cacheWriteTokens ?? 0,
        );
        this.onEvent?.({
          version: 1,
          id: randomUUID(),
          timestamp: new Date().toISOString(),
          type: "token_usage",
          agentId,
          inputTokens: result.usage.inputTokens,
          outputTokens: result.usage.outputTokens,
          ...(result.usage.cacheReadTokens !== undefined
            ? { cacheReadTokens: result.usage.cacheReadTokens }
            : {}),
          ...(result.usage.cacheWriteTokens !== undefined
            ? { cacheWriteTokens: result.usage.cacheWriteTokens }
            : {}),
          ...(costUsd !== undefined ? { costUsd } : {}),
        });
        return result;
      },
    };
  }

  /** DH-0091: reads `<cwd>/.mcp.json` (if any) and adds its `mcpServers` to `mcpManager` —
   * see the constructor's call site and project-config.ts's doc comment for the full
   * precedence rationale. Never throws: a missing file is a no-op (per
   * `loadProjectMcpServers()`'s own contract), and any other failure (malformed JSON, a
   * `mcpServers` shape that fails validation) is logged to stderr and otherwise swallowed —
   * a bad `.mcp.json` must never prevent the rest of the runtime from starting. */
  private async loadAndMergeProjectMcpServers(): Promise<void> {
    let projectServers: Awaited<ReturnType<typeof loadProjectMcpServers>>;
    try {
      projectServers = await loadProjectMcpServers(this.cwd);
    } catch (err) {
      console.error(`dh: failed to load .mcp.json: ${(err as Error).message}`);
      return;
    }
    if (projectServers === undefined) return;
    await this.mcpManager.addServers(projectServers);
    mergeMcpTools(this.mcpManager, this.toolMap);
  }

  /** DH-0002: closes every MCP connection (terminating stdio children). Coordinates with
   * cli.ts's existing SIGTERM/SIGINT handling (see `installSignalHandlers` there) rather
   * than installing a second, independent shutdown mechanism — call this from whatever
   * shutdown path already exists for the owning process (see cli.ts call sites). */
  async close(): Promise<void> {
    await this.mcpManager.close();
  }

  /** Spawns a sub-agent as a task; returns immediately with the task id.
   *
   * The task registry's id for this task IS the loop's own `agentId` (passed as
   * `StartTaskParams.id`, overriding the registry's counter-based default) — deliberately
   * unifying two identifier spaces that used to be independent (task ids like "agent-2" vs.
   * loop-internal ids like "agent-<uuid>"). Cross-domain rationale (docs/handoffs/core.md
   * Round 2 status log): Server's `AgentLoopHandle`/wire contract addresses agents by one
   * "agentId" for everything — the tree, sendMessage, stopAgent, and every SSE
   * event/log-line's own `agentId` field. Keeping two separate id spaces would have forced
   * the cli.ts adapter to maintain a bidirectional translation table between them (task id
   * <-> loop id), which is exactly the kind of extra state/bug surface worth designing
   * away instead of working around. */
  spawnAgent(
    parentAgentId: string,
    params: {
      model: string;
      prompt: string;
      background?: boolean;
      description?: string;
      isolation?: "worktree";
      /** DH-0003: reuse this id instead of minting a fresh `agent-<uuid>` — the
       * finished-sub-agent SendMessage-resume path (`sendMessage()` below) re-invokes
       * spawnAgent() for the *same* agent identity, not a new one, so its SSE events/log
       * lines stay attributed to the same id it always had. Only ever set internally by
       * `sendMessage()`'s resume path — never by the `Agent` tool (ToolContext.spawnAgent
       * never exposes this param). */
      id?: string;
      /** DH-0003: seeds this run's conversation history, the same way AgentRuntimeOptions.
       * resume seeds the root's — sourced from `reconstructSubAgentHistory()` on the resume
       * path, never set on a fresh spawn. */
      seedHistory?: ProviderMessage[];
    },
  ): string {
    const depth = this.checkFanoutBudget(parentAgentId);
    const maxConcurrentAgents = this.config.options.maxConcurrentAgents;

    const model = this.models.resolveModel(params.model);
    const provider = this.models.providerFor(model);
    const agentId = params.id ?? `agent-${randomUUID()}`;
    this.agentDepth.set(agentId, depth);

    let worktree: CreatedWorktree | undefined;
    try {
      worktree = this.reserveWorktreeIfRequested(
        parentAgentId,
        agentId,
        params.isolation,
        maxConcurrentAgents,
      );
    } catch (err) {
      this.agentDepth.delete(agentId);
      throw err;
    }

    if (worktree) {
      // DH-0077: this sub-agent runs against its isolated worktree, not the parent's cwd.
      this.agentCwd.set(agentId, worktree.path);
    } else {
      // DH-0070: inherit the spawning agent's own cwd at spawn time — not the runtime's
      // process-wide `this.cwd` — so a sub-agent spawned from a sub-agent (grandchild) would
      // inherit its immediate parent's cwd, not the root's, if those ever diverged. Falls
      // back to `this.cwd` only if the parent somehow has no recorded entry (defensive;
      // every real parent — root or sub-agent — always has one by the time it can spawn
      // anything).
      this.agentCwd.set(agentId, this.agentCwd.get(parentAgentId) ?? this.cwd);
    }
    this.liveAgentCount += 1;

    return this.tasks.start({
      kind: "agent",
      parentAgentId,
      model: model.name,
      id: agentId,
      background: params.background ?? true,
      ...(params.description !== undefined ? { description: params.description } : {}),
      run: (handle) => this.runSubAgent(agentId, parentAgentId, model, provider, params, handle),
    });
  }

  /** DH-0013: fan-out budget checks — depth first (cheaper, no model/provider resolution
   * needed to reject), then concurrency. Both throw synchronously; the Agent tool
   * (tools/agent.ts) catches and surfaces this as a normal tool-error result. Returns the
   * depth the new sub-agent would be at (parent's own depth + 1) for the caller to record. */
  private checkFanoutBudget(parentAgentId: string): number {
    const parentDepth = this.agentDepth.get(parentAgentId) ?? 0;
    const depth = parentDepth + 1;
    const maxAgentDepth = this.config.options.maxAgentDepth;
    if (maxAgentDepth !== undefined && depth > maxAgentDepth) {
      throw new Error(
        `spawn refused: this sub-agent would be at nesting depth ${depth}, exceeding the ` +
          `configured options.maxAgentDepth (${maxAgentDepth}).`,
      );
    }
    const maxConcurrentAgents = this.config.options.maxConcurrentAgents;
    if (maxConcurrentAgents !== undefined && this.liveAgentCount >= maxConcurrentAgents) {
      throw new Error(
        `spawn refused: ${this.liveAgentCount} sub-agent(s) already live, at the configured ` +
          `options.maxConcurrentAgents (${maxConcurrentAgents}) limit.`,
      );
    }
    return depth;
  }

  /** DH-0077: worktree isolation requested — validated (and, if valid, actually created)
   * synchronously here, so a bad request (not a git repo, budget exceeded, git failure)
   * refuses synchronously exactly like `checkFanoutBudget()`'s checks, rather than silently
   * no-oping or only failing once the sub-agent's task starts running. Returns undefined when
   * `isolation` wasn't requested. */
  private reserveWorktreeIfRequested(
    parentAgentId: string,
    agentId: string,
    isolation: "worktree" | undefined,
    maxConcurrentAgents: number | undefined,
  ): CreatedWorktree | undefined {
    if (isolation !== "worktree") return undefined;
    const parentCwd = this.agentCwd.get(parentAgentId) ?? this.cwd;
    if (!isGitRepo(parentCwd)) {
      throw new Error(
        `spawn refused: isolation: "worktree" requires the parent agent's cwd (${parentCwd}) to be inside a git repository.`,
      );
    }
    return this.worktrees.reserve(agentId, parentCwd, maxConcurrentAgents);
  }

  /** The `run` callback passed to `tasks.start()` for a sub-agent — runs its `runAgentLoop()`
   * call to completion, then settles bookkeeping (live-agent count, isolation worktree)
   * regardless of success/failure. Split out of `spawnAgent()` (DH-0173) so that method is
   * just id/budget/worktree setup + task registration, not also owning the full run body. */
  private async runSubAgent(
    agentId: string,
    parentAgentId: string,
    model: ModelConfig,
    provider: ModelProvider,
    params: { prompt: string; description?: string; seedHistory?: ProviderMessage[] },
    handle: TaskRunHandle,
  ): Promise<void> {
    // DH-0013: decrement liveAgentCount once this sub-agent's own loop settles
    // (success or failure alike) — see spawnAgent()'s increment above and its own doc
    // comment for why this lives here rather than a `background`-gated hook (TaskRegistry's
    // `onSettled` only fires for background tasks; `run` itself is awaited unconditionally).
    try {
      const result = await runAgentLoop({
        sessionId: this.sessionId,
        agentId,
        parentAgentId,
        model: model.name,
        providerModel: model.model,
        systemPrompt: this.buildAgentSystemPrompt(model),
        instruction: params.prompt,
        ...(params.description !== undefined ? { description: params.description } : {}),
        provider,
        tools: this.toolMap,
        toolContext: this.buildToolContext(agentId),
        registerSendMessage: handle.registerSendMessage,
        // Round 3 (docs/handoffs/core.md status log): this AbortSignal was already sitting
        // right here in scope — TaskRegistry.stop(id) calls this same task's
        // AbortController, which previously only reached the Bash tool's own
        // run_in_background subprocess handling. Passing it through here is what makes
        // stopAgent(subAgentId) actually stop the sub-agent's *loop*, not just bookkeeping.
        signal: handle.signal,
        ...(params.seedHistory
          ? { resume: { messages: params.seedHistory, fromSessionId: this.sessionId } }
          : {}),
        // Round 7 fix (docs/handoffs/core.md status log): sub-agents never inherit the
        // root/runtime's `interactive` flag. Round 5's "pause instead of end" semantics
        // exist so an operator can keep talking to an interactive root — but a sub-agent
        // spawned via the `Agent` tool has no operator; if it inherited `interactive: true`
        // from an interactive server/TUI/Web root, it would pause in "waiting" forever on
        // its first non-tool-use turn instead of reaching "done"/"failed", hanging the
        // `Agent` tool's blocking (`run_in_background: false`) `awaitDone` wait. Sub-agents
        // always get non-interactive (terminate-on-first-non-tool-use-turn) semantics,
        // regardless of the root's mode. This does NOT affect `SendMessage`-driven
        // steering of a still-running sub-agent — `registerSendMessage`'s sink is wired up
        // unconditionally in loop.ts regardless of `interactive`, so a sub-agent can still
        // be steered mid-conversation while it's actively looping; `interactive` only
        // controls what happens when the model itself produces a non-tool-use turn.
        interactive: false,
        hasPendingChildren: () => this.tasks.hasNonTerminalChildren(agentId),
        client: this.client,
        ...(this.config.options.maxTurns !== undefined
          ? { maxTurns: this.config.options.maxTurns }
          : {}),
        ...pricingOverride(model),
        ...thinkingOverride(model),
        ...cacheOverride(model),
        ...contextWindowOverride(model),
        ...compactionOverride(this.config),
        onEvent: (event) => {
          if (event.type === "agent_output") handle.append(event.chunk);
          // Round 5: an interactive sub-agent's loop no longer returns on a non-tool-use
          // turn, so the task registry's own status (what getAgentTree() actually reads —
          // see TaskRegistry.snapshot()) needs to track the loop's mid-conversation
          // waiting/running transitions explicitly instead of only being set once when
          // `run()` resolves/rejects.
          if (event.type === "agent_status" && event.agentId === agentId) {
            this.tasks.setStatus(agentId, event.status);
          }
          // DH-0013: this sub-agent's own token usage counts toward the session-wide
          // cumulative cost/token budgets, same as the root's.
          if (event.type === "token_usage") {
            this.recordUsageAndCheckBudgets(
              event.inputTokens,
              event.outputTokens,
              event.costUsd,
              event.cacheReadTokens ?? 0,
              event.cacheWriteTokens ?? 0,
            );
          }
          this.onEvent?.(event);
        },
        ...(this.onLogLine
          ? { onLogLine: (line: LogLine) => this.onLogLine?.(agentId, line) }
          : {}),
      });
      if (!result.success) {
        throw new Error(result.finalOutput || "sub-agent reported failure");
      }
    } finally {
      this.liveAgentCount -= 1;
      this.settleSubAgentWorktree(agentId, handle);
    }
  }

  /** DH-0077: settles this sub-agent's isolation worktree, if any — clean it up
   * automatically when it ends up with no changes, or otherwise leave it in place and
   * append a note to this sub-agent's own output (surfaced via TaskSnapshot.output —
   * Monitor/TaskOutput/the Agent tool's blocking result all read it) so the dispatching
   * agent can review/merge the changes itself. Runs regardless of whether the loop above
   * succeeded or failed — a failed sub-agent may still have left useful partial work in its
   * worktree worth surfacing. Split out of `runSubAgent()`'s `finally` block (DH-0173). */
  private settleSubAgentWorktree(agentId: string, handle: TaskRunHandle): void {
    const worktreeForAgent = this.worktrees.release(agentId);
    if (!worktreeForAgent) return;
    try {
      if (hasChanges(worktreeForAgent)) {
        handle.append(
          `\n[isolation worktree] changes retained at ${worktreeForAgent.path} on branch ${worktreeForAgent.branch} — review/merge manually, then remove the worktree/branch yourself when done.`,
        );
      } else {
        removeWorktree(worktreeForAgent);
      }
    } catch (err) {
      handle.append(
        `\n[isolation worktree] warning: failed to inspect/clean up worktree at ${worktreeForAgent.path} (branch ${worktreeForAgent.branch}): ${(err as Error).message}`,
      );
    }
  }

  /** Runs the root agent to completion (not tracked as a task — it IS the session).
   *
   * Cross-domain note (docs/handoffs/core.md status log): emits a `session_ended`
   * ServerSentEvent on the normal return path (whether the root agent self-reported success
   * or failure) — this is what src/server/exit.ts's `waitForExitCode` (Server domain, main
   * branch) subscribes to for `--job` mode. It does NOT cover a harness error that prevents
   * the loop from ever starting (bad config, provider/auth failure) — callers (src/cli.ts)
   * must still wrap this call in their own try/catch for that class of failure, exactly as
   * src/server/exit.ts's own doc comment already assumes.
   *
   * Also registers a root-level sendMessage sink (mirroring what spawnAgent() already does
   * for sub-agents via the task registry) so a running root agent can be steered by
   * sendMessageToRoot() — needed for interactive mode (TUI/Web), where the operator's input
   * box delivers messages into an already-running root loop, not just a one-shot
   * `--instructions` file.
   *
   * Round 3: creates a fresh AbortController for this run and passes its signal into the
   * loop — stopRoot() (below) is what triggers it, giving src/cli.ts's AgentLoopHandle
   * adapter something real to call for `stopAgent(ROOT_AGENT_ID)` instead of the previous
   * no-op.
   *
   * Round 4 fix (docs/handoffs/core.md status log): `runAgentLoop` itself can *throw*
   * rather than resolve — a harness-level failure (bad `apiKey`, unreachable `baseURL`, any
   * error the provider adapter's own try/catch doesn't itself convert into a normal
   * `AgentLoopResult`) before the loop ever produces a self-report. The `runAgentLoop` call
   * is wrapped in try/catch specifically so `this.rootStatus` and the `session_ended` event
   * both still update on *that* path too, not only the normal resolve path — otherwise
   * `getAgentTree()` (which reads `this.rootStatus`) reports a permanently `"running"`
   * zombie root agent to any client that asks *after* the crash (a transient
   * `agent_status`-shaped event at the moment of the crash, which `src/cli.ts`'s adapter
   * does emit via its own `.catch()`, doesn't help a client that connects or polls later —
   * confirmed live: the coordinator found this by hand, root stayed `"running"` in
   * `request_agent_tree` for 20+ seconds after a real crash). Rethrows afterward so every
   * existing caller's own error handling (`src/cli.ts`'s standalone `--instructions` path's
   * try/catch, the adapter's `.catch()` for the interactive path) is unaffected — this is
   * purely making `AgentRuntime`'s own state consistent before the error leaves this
   * method, not a behavior change for callers. */
  async runRoot(
    instruction: string,
    modelName?: string,
  ): Promise<{
    success: boolean;
    finalOutput: string;
    /** DH-0050: threaded straight through from `AgentLoopResult` — total turns consumed,
     * for `--job --json`'s terminal `job_result` line. */
    turns: number;
    /** DH-0050: threaded straight through from `AgentLoopResult` — present iff the model
     * self-reported via `ReportOutcome`. */
    outcome?: ReportedOutcome;
    /** DH-0050: which of the detection precedence tiers actually produced `success` above. */
    reportedBy?: OutcomeReportedBy;
  }> {
    // DH-0131 fix: resolveModel()/providerFor() below can throw synchronously (bad/unknown
    // model or provider name in config) *before* rootStarted/rootStatus are ever set —
    // previously this whole block sat outside the try/catch a few lines down, so this class
    // of "failed to start" error reached neither a status_change log line nor an agent_status
    // SSE event from AgentRuntime itself; only src/cli.ts's own .catch() on the interactive
    // path happened to notice (and, until this fix, only logged a plain "message" line, never
    // structured status_change — the gap DH-0131 was filed for). The standalone `--instructions`/
    // `--job` path (cli.ts's `main()`) has no equivalent handling at all, so it
    // logged nothing whatsoever for this failure class. Wrapping model/provider resolution in
    // the same try/catch as runAgentLoop() makes AgentRuntime itself the single place this is
    // handled, for every caller.
    let model: ModelConfig;
    let provider: ModelProvider;
    try {
      ({ model, provider } = this.resolveRootModel(modelName));
    } catch (err) {
      this.reportRootStartFailure(err);
      throw err;
    }

    this.rootStarted = true;
    this.rootModel = model.name;
    this.rootStatus = "running";
    this.rootController = new AbortController();
    this.startWallClockBudgetIfNeeded();

    let result: AgentLoopResult;
    try {
      result = await this.runRootLoop(instruction, model, provider);
    } catch (err) {
      this.reportRootLoopFailure(err);
      throw err;
    }

    return this.finalizeRootRun(result);
  }

  /** DH-0038/DH-0093: resolves the model+provider `runRoot()` should use for this run — an
   * explicit `modelName` argument always wins; otherwise a resumed session defaults to the
   * original root header's model alias (D3) rather than `config.options.defaultModel`, so a
   * resume never silently switches models; a pending `switchModel()` call made before the
   * root ever started wins over the resume/defaultModel fallback (but not over an explicit
   * `modelName` argument) — see `pendingInitialModel`'s own doc comment. Split out of
   * `runRoot()` (DH-0173) as its own named phase; still throws `ConfigModelError` synchronously
   * on an unknown alias, same as before — `runRoot()`'s own try/catch handles that. */
  private resolveRootModel(modelName: string | undefined): {
    model: ModelConfig;
    provider: ModelProvider;
  } {
    const model = this.models.resolveModel(
      modelName ??
        this.pendingInitialModel ??
        this.resume?.model ??
        this.config.options.defaultModel,
    );
    const provider = this.models.providerFor(model);
    return { model, provider };
  }

  /** Emits the "root failed to start" status_change/agent_status/session_ended trio for a
   * synchronous model/provider resolution failure (before the loop ever started) — split out
   * of `runRoot()`'s catch block (DH-0173). */
  private reportRootStartFailure(err: unknown): void {
    this.rootStarted = true;
    this.rootStatus = "failed";
    const message = err instanceof Error ? err.message : String(err);
    this.onLogLine?.(ROOT_AGENT_ID, {
      version: 1,
      timestamp: new Date().toISOString(),
      type: "message",
      role: "system",
      content: `Root agent failed to start: ${message}`,
    });
    this.onLogLine?.(ROOT_AGENT_ID, {
      version: 1,
      timestamp: new Date().toISOString(),
      type: "status_change",
      status: "failed",
    });
    this.onEvent?.({
      version: 1,
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      type: "agent_status",
      agentId: ROOT_AGENT_ID,
      status: "failed",
    });
    this.onEvent?.({
      version: 1,
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      type: "session_ended",
      exitCode: ExitCode.HarnessError,
    });
  }

  /** DH-0131 fix: this path (runAgentLoop() itself throwing mid-run — a harness error after
   * the loop already wrote its header line) needs the same status_change/agent_status/
   * session_ended trio as `reportRootStartFailure()` above, just further along (the loop had
   * already started). Split out of `runRoot()`'s second catch block (DH-0173). */
  private reportRootLoopFailure(err: unknown): void {
    this.rootStatus = "failed";
    const message = err instanceof Error ? err.message : String(err);
    this.onLogLine?.(ROOT_AGENT_ID, {
      version: 1,
      timestamp: new Date().toISOString(),
      type: "message",
      role: "system",
      content: `Root agent failed: ${message}`,
    });
    this.onLogLine?.(ROOT_AGENT_ID, {
      version: 1,
      timestamp: new Date().toISOString(),
      type: "status_change",
      status: "failed",
    });
    this.onEvent?.({
      version: 1,
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      type: "agent_status",
      agentId: ROOT_AGENT_ID,
      status: "failed",
    });
    this.onEvent?.({
      version: 1,
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      type: "session_ended",
      exitCode: ExitCode.HarnessError,
    });
  }

  /** DH-0013: wall-clock budget, started once per runtime instance (runRoot() is only
   * meaningfully called once per session in practice — see AgentRuntimeOptions' own doc
   * comments). Unref'd so a configured cap alone never keeps the process alive past whatever
   * would otherwise have ended it. Split out of `runRoot()` (DH-0173). */
  private startWallClockBudgetIfNeeded(): void {
    if (this.sessionStartMs !== undefined) return;
    this.sessionStartMs = Date.now();
    const maxWallClockMs = this.config.options.maxWallClockMs;
    if (maxWallClockMs === undefined) return;
    this.wallClockTimer = setTimeout(() => {
      this.tripBudget(
        `wall-clock duration exceeded the configured options.maxWallClockMs (${maxWallClockMs}ms)`,
      );
    }, maxWallClockMs);
    (this.wallClockTimer as unknown as { unref?: () => void }).unref?.();
  }

  /** The actual `runAgentLoop()` call for the root agent, with its onEvent/onLogLine wiring —
   * split out of `runRoot()` (DH-0173) as its own named phase. Does not itself catch/report
   * failures; `runRoot()`'s own try/catch around this call does that via
   * `reportRootLoopFailure()`. */
  private async runRootLoop(
    instruction: string,
    model: ModelConfig,
    provider: ModelProvider,
  ): Promise<AgentLoopResult> {
    // biome-ignore lint/style/noNonNullAssertion: runRoot() always sets rootController just before calling this method.
    const rootController = this.rootController!;
    return runAgentLoop({
      sessionId: this.sessionId,
      agentId: ROOT_AGENT_ID,
      parentAgentId: null,
      model: model.name,
      providerModel: model.model,
      systemPrompt: this.buildAgentSystemPrompt(model),
      instruction,
      provider,
      tools: this.toolMap,
      toolContext: this.buildToolContext(ROOT_AGENT_ID),
      registerSendMessage: (fn) => {
        this.rootSendMessage = fn;
      },
      // DH-0093: mirrors registerSendMessage above — lets switchModel() push a new binding
      // into the root's currently-running loop once it's live.
      registerModelSwitch: (fn) => {
        this.rootModelSwitch = fn;
      },
      signal: rootController.signal,
      interactive: this.interactive,
      hasPendingChildren: () => this.tasks.hasNonTerminalChildren(ROOT_AGENT_ID),
      client: this.client,
      ...(this.config.options.maxTurns !== undefined
        ? { maxTurns: this.config.options.maxTurns }
        : {}),
      ...pricingOverride(model),
      ...thinkingOverride(model),
      ...cacheOverride(model),
      ...contextWindowOverride(model),
      ...compactionOverride(this.config),
      ...(this.resume
        ? { resume: { messages: this.resume.messages, fromSessionId: this.resume.fromSessionId } }
        : {}),
      onEvent: (event) => {
        // Round 5: keep rootStatus (what getAgentTree() reads) in sync with the loop's own
        // mid-conversation waiting/running transitions, the same way spawnAgent() keeps the
        // task registry in sync for sub-agents — runRoot() isn't a TaskRegistry entry, so it
        // needs the same bookkeeping done by hand here.
        if (event.type === "agent_status" && event.agentId === ROOT_AGENT_ID) {
          this.rootStatus = event.status;
        }
        // DH-0013: the root's own token usage counts toward the session-wide cumulative
        // cost/token budgets, same as every sub-agent's.
        if (event.type === "token_usage") {
          this.recordUsageAndCheckBudgets(
            event.inputTokens,
            event.outputTokens,
            event.costUsd,
            event.cacheReadTokens ?? 0,
            event.cacheWriteTokens ?? 0,
          );
        }
        this.onEvent?.(event);
      },
      ...(this.onLogLine
        ? { onLogLine: (line: LogLine) => this.onLogLine?.(ROOT_AGENT_ID, line) }
        : {}),
    });
  }

  /** Finalizes root status + emits `session_ended` once the loop itself has resolved
   * (success or self-reported failure) — split out of `runRoot()` (DH-0173) as its own named
   * phase. */
  private finalizeRootRun(result: AgentLoopResult): {
    success: boolean;
    finalOutput: string;
    turns: number;
    outcome?: ReportedOutcome;
    reportedBy?: OutcomeReportedBy;
  } {
    // DH-0017 fix: this used to unconditionally set "failed" on any non-success result,
    // clobbering the "stopped" status the loop's own reportStopped() (loop.ts) already wrote
    // via the onEvent handler above moments earlier for a deliberate TaskStop/stopRoot(). Only
    // fall back to "failed" when the loop didn't already report a more specific terminal
    // status — mirrors TaskRegistry.start()'s own `if (task.status !== "stopped")` guard for
    // exactly the same reason.
    if (this.rootStatus !== "stopped") {
      this.rootStatus = result.success ? "done" : "failed";
    }
    // DH-0013: the root loop itself has ended (success, failure, or stop) — the wall-clock
    // budget timer no longer has anything to guard, whether or not it ever fired.
    if (this.wallClockTimer) {
      clearTimeout(this.wallClockTimer);
      this.wallClockTimer = undefined;
    }
    this.onEvent?.({
      version: 1,
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      type: "session_ended",
      exitCode: result.success ? ExitCode.Success : ExitCode.TaskFailure,
    });
    return {
      success: result.success,
      finalOutput: result.finalOutput,
      turns: result.turns,
      ...(result.outcome !== undefined ? { outcome: result.outcome } : {}),
      ...(result.reportedBy !== undefined ? { reportedBy: result.reportedBy } : {}),
    };
  }

  /** True once runRoot() has been called at least once (even if it has since finished) —
   * lets a caller (the cli.ts AgentLoopHandle adapter) tell "root hasn't started" apart from
   * "root already ran/is running," e.g. to decide whether an incoming sendMessage should
   * lazily start the root agent or steer an already-running one. */
  get rootHasStarted(): boolean {
    return this.rootStarted;
  }

  /** Delivers a message into the currently-running root agent's conversation (mirrors
   * TaskRegistry.sendMessage's semantics/error shape for sub-agents). Throws
   * RootNotListeningError if runRoot() hasn't been called yet, or isn't currently between
   * turns with its sink registered. */
  sendMessageToRoot(message: string): void {
    if (!this.rootSendMessage) {
      throw new RootNotListeningError();
    }
    this.rootSendMessage(message);
  }

  /** Round 3 (docs/handoffs/core.md status log): triggers the root agent's AbortController,
   * if it has one yet (a no-op before runRoot() has ever been called — there's nothing
   * running to stop). Cooperative, not forceful — see AgentLoopParams.signal's doc comment
   * in loop.ts for exactly what this does and doesn't interrupt. Safe to call more than
   * once or after the root has already finished (AbortController.abort() is itself
   * idempotent). */
  stopRoot(): void {
    this.rootController?.abort();
  }

  /** DH-0003: delivers a message into `agentId`'s conversation, resuming a finished sub-agent
   * task rather than just refusing (real Claude Code semantics — HANDOFF.md). Every caller
   * that used to reach `TaskRegistry.sendMessage()` directly (the `SendMessage` tool via
   * `ToolContext.sendMessage`, the wire-facing `AgentLoopHandle.sendMessage` in src/cli.ts for
   * a non-root `agentId`) now goes through here instead, so both entry points share the one
   * resume decision. `TaskRegistry.sendMessage()` itself stays the dumb status/sink check its
   * own doc comment describes — this is the layer that reacts to its `TaskFinishedError`.
   *
   * Only `kind === "agent"` tasks are eligible for resume (a finished `bash`-kind task has no
   * conversation to resume — its `TaskFinishedError` propagates unchanged, same as before this
   * ticket). `failed`/`stopped` sub-agents resume identically to `done` ones — see
   * `reconstructSubAgentHistory()`'s own doc comment for why. */
  sendMessage(agentId: string, message: string): void {
    try {
      this.tasks.sendMessage(agentId, message);
    } catch (err) {
      if (err instanceof TaskFinishedError) {
        const snapshot = this.tasks.trySnapshot(agentId);
        if (snapshot?.kind === "agent") {
          this.resumeFinishedAgent(agentId, snapshot, message);
          return;
        }
      }
      throw err;
    }
  }

  /** DH-0003: reconstructs `agentId`'s prior conversation from its own JSONL log (this
   * session — a finished sub-agent lived and died entirely inside it, no chain to walk),
   * clears its terminal `TaskRegistry` bookkeeping so the id can be reused, then re-invokes
   * `spawnAgent()` for the *same* agent identity with that history seeded and `message` as the
   * new turn's instruction — `loop.ts`'s existing trailing-role merge (the same one
   * `AgentRuntimeOptions.resume` uses for the root) appends it, no second merge path. */
  private resumeFinishedAgent(agentId: string, snapshot: TaskSnapshot, message: string): void {
    const history = reconstructSubAgentHistory(this.logsRoot, this.sessionId, agentId);
    this.tasks.clearTerminal(agentId);
    this.spawnAgent(snapshot.parentAgentId, {
      model: snapshot.model ?? this.config.options.defaultModel,
      prompt: message,
      id: agentId,
      seedHistory: history,
      ...(snapshot.description !== undefined ? { description: snapshot.description } : {}),
    });
  }

  /** DH-0093: wire-facing `ModelInfo[]` for the `list_models` command — maps `config.models`
   * into the display shape the `/model` picker (TUI/Web, a later round) needs. `isActive`
   * reflects the *root's* currently-active model (`this.rootModel`, kept in sync immediately
   * by both `runRoot()` and `switchModel()` below) — v1 has no notion of a sub-agent's model
   * being "the" active one for this purpose. */
  listModels(): ModelInfo[] {
    const activeModel = this.rootModel ?? this.config.options.defaultModel;
    return this.config.models.map((model) => ({
      name: model.name,
      provider: model.provider,
      model: model.model,
      isDefault: model.name === this.config.options.defaultModel,
      isActive: model.name === activeModel,
    }));
  }

  /** DH-0093: v1 scope is root-only — see `RootOnlyModelSwitchError`'s doc comment. Resolves
   * `modelName` via the existing `resolveModel` (propagates `ConfigModelError` on an unknown
   * alias, same as every other method here), then either records a pending initial model (root
   * not started yet) or pushes a live binding through the registered sink (root already
   * running) — see `pendingInitialModel`/`rootModelSwitch`'s own doc comments for the two
   * branches. Either way, `this.rootModel` is updated immediately so `getAgentTree()` reflects
   * the switch even before the root actually starts/before the loop's next turn picks it up. */
  switchModel(agentId: string, modelName: string): void {
    if (agentId !== ROOT_AGENT_ID) {
      throw new RootOnlyModelSwitchError(agentId);
    }
    const model = this.models.resolveModel(modelName);

    if (!this.rootStarted) {
      this.pendingInitialModel = modelName;
      this.rootModel = model.name;
      return;
    }

    const provider = this.models.providerFor(model);
    this.rootModel = model.name;
    this.rootModelSwitch?.({
      model: model.name,
      providerModel: model.model,
      provider,
      ...pricingOverride(model),
      ...thinkingOverride(model),
      ...cacheOverride(model),
      ...contextWindowOverride(model),
    });
  }

  /** DH-0093: the wire-facing `SkillInfo[]` for the `list_skills` command — drops the
   * `source` field `Skill` (src/prompt/skills.ts) carries internally, which isn't part of the
   * wire `SkillInfo` shape. Backed by the eager `skillsCache` scan (see its own doc comment),
   * never re-scanned per call. */
  async listSkills(): Promise<SkillInfo[]> {
    await this.skills.ready;
    return this.skills.list().map(({ name, description }) => ({ name, description }));
  }

  /** DH-0093: loads the named skill (via `loadSkillFromPaths`, the same lookup the `Skill`
   * tool itself uses — so `/name` and `Skill(skill: "name")` always agree on what "name"
   * resolves to) and delivers the composed invocation text through the same message-delivery
   * path `send_message` uses for that `agentId`: the root (lazily starting it if it hasn't
   * started yet, mirroring `AgentRuntimeLoopAdapter.sendMessage`'s own root-lazy-start
   * convention in src/cli.ts) or an existing sub-agent task. Throws `UnknownSkillError` when
   * the skill can't be found, for Server to translate into a 404 ack. */
  async invokeSkill(agentId: string, skillName: string, args: string | undefined): Promise<void> {
    const loaded = await loadSkillFromPaths(skillName, this.config.skillPaths ?? []);
    if (!loaded) {
      throw new UnknownSkillError(skillName);
    }
    const composed = composeSkillInvocation({ name: loaded.name, content: loaded.content }, args);

    if (agentId === ROOT_AGENT_ID) {
      if (!this.rootStarted) {
        // Fire-and-forget, mirroring AgentRuntimeLoopAdapter.sendMessage()'s own lazy-start
        // convention for a fresh root (src/cli.ts) — a harness-level start failure still
        // surfaces via runRoot()'s own onEvent/session_ended handling, not swallowed here.
        this.runRoot(composed).catch(() => {
          // Deliberately swallowed here: runRoot()'s own try/catch already updates
          // rootStatus/emits a synthetic agent_status + session_ended for this class of
          // failure (see its doc comment) — nothing further to do at this call site.
        });
        return;
      }
      this.sendMessageToRoot(composed);
      return;
    }

    this.tasks.sendMessage(agentId, composed);
  }

  /** Builds the nested AgentTreeNode[] shape Server's AgentLoopHandle.getAgentTree() needs,
   * from the task registry's flat TaskSnapshot[] plus the root's own tracked state (the
   * root isn't itself a task — see runRoot()'s doc comment).
   *
   * Judgment call (docs/handoffs/core.md Round 2 status log, flagged as asked): only
   * agent-kind tasks appear in the tree, not bash-kind ones. The tree is specifically about
   * the sub-agent hierarchy (what the TUI/Web agent-tree view and stopAgent/sendMessage
   * target) — a `run_in_background` Bash call isn't an agent and was never addressable by
   * agentId in the wire protocol to begin with (Bash tool output surfaces as a tool_result
   * on its *parent* agent's own event/log stream, not as a node of its own).
   *
   * Always includes a root node, even before runRoot() has ever been called (status
   * "waiting" until then) — see the `rootStatus` field's doc comment for why an empty tree
   * pre-start is actually a bug, not a simplification: it makes the root unreachable by the
   * very first send_message that's supposed to start it. */
  getAgentTree(): AgentTreeNode[] {
    const agentSnapshots = this.tasks.list().filter((task) => task.kind === "agent");
    const nodeById = new Map<string, AgentTreeNode>();
    for (const snapshot of agentSnapshots) {
      nodeById.set(snapshot.id, {
        agentId: snapshot.id,
        parentAgentId: snapshot.parentAgentId,
        model: snapshot.model ?? "",
        status: snapshot.status,
        ...(snapshot.description !== undefined ? { description: snapshot.description } : {}),
        children: [],
      });
    }
    const rootChildren: AgentTreeNode[] = [];
    for (const snapshot of agentSnapshots) {
      // biome-ignore lint/style/noNonNullAssertion: snapshot.id was just set as a key above
      const node = nodeById.get(snapshot.id)!;
      const parent = nodeById.get(snapshot.parentAgentId);
      if (parent) {
        parent.children.push(node);
      } else {
        // Either the root itself, or (not currently reachable — tasks are never evicted)
        // an unknown parent; either way this node belongs directly under the root.
        rootChildren.push(node);
      }
    }

    return [
      {
        agentId: ROOT_AGENT_ID,
        parentAgentId: null,
        model: this.rootModel ?? this.config.options.defaultModel,
        status: this.rootStatus,
        children: rootChildren,
      },
    ];
  }

  /** Round 12 (docs/handoffs/core.md): reacts to a *background* task's completion by pushing
   * a notification into the parent agent's conversation, the same way real Claude Code
   * proactively tells whoever's waiting rather than relying on the model to poll
   * Monitor/TaskOutput on its own (confirmed live this round: small/local models reliably
   * don't poll, and even after Prompt round 3's discipline fix, a root never checked back on
   * a finished sub-agent unprompted). Reuses Round 5's existing pending-message queue —
   * `tryDeliverToAgent` below calls exactly the same `sendMessage` sink SendMessage itself
   * uses, so from the receiving loop's point of view this is indistinguishable from an
   * operator/parent message arriving.
   *
   * Orphaned-grandchild case, designed for deliberately (not left unconsidered — raised by
   * the owner directly): a child can spawn its own grandchild and then have its own turn (or
   * its whole loop) end before the grandchild finishes. When that happens there is no live
   * listener to deliver into — `tryDeliverToAgent` returns false, and rather than silently
   * dropping the notification, it is *always* recorded as a system-role log line on the
   * child's (the grandchild's parent's — i.e. this task's own) log stream, tagged with
   * whether live delivery actually happened. The task's own log is guaranteed to still be
   * open at this point (it just finished emitting its own completed/failed log line moments
   * earlier), so this is a durable record even when nobody was there to react to it live. The
   * chosen behavior is explicitly "best-effort live delivery, always logged" — never silently
   * lost, but also never blocks or retries: a message an orphaned parent will only ever see by
   * reading its own transcript after the fact is still strictly better than one that vanishes
   * with no trace at all. */
  private handleTaskSettled(snapshot: TaskSnapshot): void {
    const kindLabel = snapshot.kind === "bash" ? "Background Bash task" : "Sub-agent";
    const outcome =
      snapshot.status === "failed" ? `failed: ${snapshot.error ?? "unknown error"}` : "completed";
    const output = snapshot.output.length > 0 ? snapshot.output : "(no output)";
    const message = `[${kindLabel} ${snapshot.id} ${outcome}]\n${output}`;

    // DH-0140: routed through the same live-or-resume decision `sendMessage()`/DH-0003 already
    // makes for explicit operator messages, instead of the old live-only `tryDeliverToAgent()`
    // — a parent that has already reached a terminal status (the stress-test failure this
    // ticket reports) is now resumed with this notification as its next instruction, not
    // silently dropped.
    const delivery = this.deliverOrResumeAgent(snapshot.parentAgentId, message);

    const content =
      delivery === "live"
        ? `Completion notification delivered live to parent agent ${snapshot.parentAgentId}.`
        : delivery === "resumed"
          ? `Completion notification delivered via resume to parent agent ${snapshot.parentAgentId} (it had already reached a terminal status; resumed with this notification as its next instruction): ${message}`
          : `Completion notification could not be delivered (parent agent ${snapshot.parentAgentId} is unreachable) — recorded here only, not lost: ${message}`;

    this.onLogLine?.(snapshot.id, {
      version: 1,
      timestamp: new Date().toISOString(),
      type: "message",
      role: "system",
      content,
    });
  }

  /** DH-0140: delivers `message` into `agentId`'s conversation live if it's currently
   * running/waiting, else resumes it — the root case mirrors `invokeSkill()`'s root-lazy-start
   * convention (a not-yet-started or terminal root is (re)started fire-and-forget with
   * `message` as its instruction); the sub-agent case mirrors `sendMessage()`'s
   * `TaskFinishedError`-triggered `resumeFinishedAgent()` call. Returns `"live"` when a
   * genuinely running/waiting listener received it directly, `"resumed"` when the target had
   * already finished (or wasn't started yet) and was (re)started with `message` as its next
   * instruction, or `"dropped"` only for a case that shouldn't occur given tasks are never
   * evicted (an unknown task id, or a `bash`-kind task, which has no conversation to resume). */
  private deliverOrResumeAgent(agentId: string, message: string): "live" | "resumed" | "dropped" {
    if (agentId === ROOT_AGENT_ID) {
      if (this.rootStarted && this.rootSendMessage && this.isLiveStatus(this.rootStatus)) {
        this.rootSendMessage(message);
        return "live";
      }
      // Fire-and-forget, mirroring invokeSkill()'s root-lazy-start convention: runRoot()'s own
      // try/catch already handles a harness-level start failure (updates rootStatus, emits
      // session_ended), nothing further to do at this call site.
      this.runRoot(message).catch(() => {});
      return "resumed";
    }

    const parentSnapshot = this.tasks.trySnapshot(agentId);
    if (!parentSnapshot) {
      return "dropped";
    }
    if (this.isLiveStatus(parentSnapshot.status)) {
      try {
        this.tasks.sendMessage(agentId, message);
        return "live";
      } catch {
        // Fell terminal between the snapshot check above and this call — fall through to the
        // resume path below, same as the plain terminal case.
      }
    }
    if (parentSnapshot.kind !== "agent") {
      return "dropped";
    }
    const latest = this.tasks.trySnapshot(agentId) ?? parentSnapshot;
    this.resumeFinishedAgent(agentId, latest, message);
    return "resumed";
  }

  private isLiveStatus(status: AgentStatus): boolean {
    return status === "running" || status === "waiting";
  }
}
