// Composition root: wires dh.json config, provider adapters, the tool set, and the task
// registry together so a root agent (and any sub-agents it spawns via the Agent tool) can
// actually run. This is where the tools -> loop -> tools cycle is broken: tools only ever
// see a ToolContext.spawnAgent function; only this module imports both loop.ts and
// tools/index.ts.

import { randomUUID } from "node:crypto";
import {
  type AgentStatus,
  type AgentTreeNode,
  type DhConfig,
  ExitCode,
  type LogLine,
  type ModelConfig,
  type ServerSentEvent,
  type SessionClientKind,
} from "../contracts/index.ts";
import { runAgentLoop } from "./loop.ts";
import { searchConfiguredMcpTools } from "./mcp.ts";
import { createProvider } from "./providers/index.ts";
import type { ModelProvider } from "./providers/types.ts";
import { loadSkillFromPaths } from "./skills.ts";
import { TaskRegistry, type TaskSnapshot } from "./tasks.ts";
import { ALL_TOOLS, buildToolMap } from "./tools/index.ts";
import type { Tool, ToolContext } from "./tools/types.ts";

/** The root agent's fixed identifier — used both as the loop's own `agentId` (its SSE
 * events/log lines) and as the "agentId" `AgentLoopHandle`'s wire-facing operations
 * (sendMessage/stopAgent/the tree) address it by, exactly like every sub-agent's task id
 * (see spawnAgent()'s doc comment for why those two id spaces are now unified). */
export const ROOT_AGENT_ID = "agent-root";

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
}

/** Builds loop.ts's `AgentLoopParams.pricing` from a model's optional config prices — round
 * 6b. Returns undefined when neither price is configured (so `costUsd` stays undefined,
 * per computeCostUsd()'s own doc comment in loop.ts), otherwise an object with only the
 * configured keys present (exactOptionalPropertyTypes forbids passing `undefined` through
 * explicitly). */
function buildPricing(
  model: ModelConfig,
): { inputPricePerMToken?: number; outputPricePerMToken?: number } | undefined {
  if (model.inputPricePerMToken === undefined && model.outputPricePerMToken === undefined) {
    return undefined;
  }
  return {
    ...(model.inputPricePerMToken !== undefined
      ? { inputPricePerMToken: model.inputPricePerMToken }
      : {}),
    ...(model.outputPricePerMToken !== undefined
      ? { outputPricePerMToken: model.outputPricePerMToken }
      : {}),
  };
}

/** Spreadable helper: `{ pricing: ... }` when configured, `{}` otherwise — kept as its own
 * function (rather than inlining the ternary at each call site) because
 * `exactOptionalPropertyTypes` rejects a ternary whose branches are `{ pricing: X }` and
 * `{}` when `X` itself is `T | undefined` (it can't narrow the conditional's own type), so
 * this needs the `undefined` check and the object literal built in one place. */
function pricingOverride(
  model: ModelConfig,
):
  | { pricing: { inputPricePerMToken?: number; outputPricePerMToken?: number } }
  | Record<string, never> {
  const pricing = buildPricing(model);
  if (pricing === undefined) return {};
  return { pricing };
}

export class ConfigModelError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigModelError";
  }
}

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

/** Wires dh.json into a runnable agent runtime: providers, tools, and the task registry that
 * lets Agent/Monitor/TaskOutput/SendMessage/TaskStop cooperate in-process. */
export class AgentRuntime {
  readonly sessionId: string;
  // Round 12 (docs/handoffs/core.md): wired to handleTaskSettled() so every *background*
  // Bash/Agent task's completion pushes a notification into its parent's conversation — see
  // that method's doc comment for the full design, including the orphaned-grandchild case.
  readonly tasks = new TaskRegistry((snapshot) => this.handleTaskSettled(snapshot));
  private readonly config: DhConfig;
  private readonly systemPrompt: string;
  private readonly cwd: string;
  private readonly toolMap: Map<string, Tool>;
  private readonly providers = new Map<string, ModelProvider>();
  private readonly onEvent: ((event: ServerSentEvent) => void) | undefined;
  private readonly onLogLine: ((agentId: string, line: LogLine) => void) | undefined;
  private readonly interactive: boolean;
  private readonly client: SessionClientKind;

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
  // Round 3 (docs/handoffs/core.md status log): the root isn't a TaskRegistry entry, so it
  // needs its own AbortController — mirrors the one TaskRegistry.start() already creates
  // per task, which is what makes stopAgent(subAgentId) reach the loop after this round's
  // AgentLoopParams.signal addition.
  private rootController: AbortController | undefined;

  constructor(options: AgentRuntimeOptions) {
    this.config = options.config;
    this.systemPrompt = options.systemPrompt;
    this.cwd = options.cwd ?? process.cwd();
    this.sessionId = options.sessionId ?? randomUUID();
    this.toolMap = buildToolMap(options.tools ?? ALL_TOOLS);
    this.onEvent = options.onEvent;
    this.onLogLine = options.onLogLine;
    this.interactive = options.interactive ?? false;
    this.client = options.client;
  }

  private resolveModel(name: string): ModelConfig {
    const model = this.config.models.find((m) => m.name === name);
    if (!model) {
      throw new ConfigModelError(
        `unknown model "${name}"; known models: ${this.config.models.map((m) => m.name).join(", ")}`,
      );
    }
    return model;
  }

  private providerFor(model: ModelConfig): ModelProvider {
    let provider = this.providers.get(model.provider);
    if (!provider) {
      const providerConfig = this.config.provider.find((p) => p.name === model.provider);
      if (!providerConfig) {
        throw new ConfigModelError(
          `model "${model.name}" references unknown provider "${model.provider}"`,
        );
      }
      provider = createProvider(providerConfig);
      this.providers.set(model.provider, provider);
    }
    return provider;
  }

  private buildToolContext(agentId: string): ToolContext {
    return {
      cwd: this.cwd,
      runInBackgroundDefault: this.config.options.runInBackgroundDefault ?? true,
      agentId,
      config: this.config,
      tasks: this.tasks,
      spawnAgent: (params: { model: string; prompt: string }) => this.spawnAgent(agentId, params),
      loadSkill: (name: string) => loadSkillFromPaths(name, this.config.skillPaths ?? []),
      searchDeferredTools: (query: string) =>
        searchConfiguredMcpTools(this.config.mcpServers, query),
      // Round 13 (docs/handoffs/core.md): fresh per agent lifetime, matching this
      // ToolContext's own lifetime — see readRegistry's doc comment in tools/types.ts.
      readRegistry: new Map(),
    };
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
    params: { model: string; prompt: string; background?: boolean; description?: string },
  ): string {
    const model = this.resolveModel(params.model);
    const provider = this.providerFor(model);
    const agentId = `agent-${randomUUID()}`;

    return this.tasks.start({
      kind: "agent",
      parentAgentId,
      model: model.name,
      id: agentId,
      background: params.background ?? true,
      ...(params.description !== undefined ? { description: params.description } : {}),
      run: async (handle) => {
        const result = await runAgentLoop({
          sessionId: this.sessionId,
          agentId,
          parentAgentId,
          model: model.name,
          providerModel: model.model,
          systemPrompt: this.systemPrompt,
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
          client: this.client,
          ...(this.config.options.maxTurns !== undefined
            ? { maxTurns: this.config.options.maxTurns }
            : {}),
          ...pricingOverride(model),
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
            this.onEvent?.(event);
          },
          ...(this.onLogLine
            ? { onLogLine: (line: LogLine) => this.onLogLine?.(agentId, line) }
            : {}),
        });
        if (!result.success) {
          throw new Error(result.finalOutput || "sub-agent reported failure");
        }
      },
    });
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
  ): Promise<{ success: boolean; finalOutput: string }> {
    const model = this.resolveModel(modelName ?? this.config.options.defaultModel);
    const provider = this.providerFor(model);

    this.rootStarted = true;
    this.rootModel = model.name;
    this.rootStatus = "running";
    this.rootController = new AbortController();

    let result: { success: boolean; finalOutput: string };
    try {
      result = await runAgentLoop({
        sessionId: this.sessionId,
        agentId: ROOT_AGENT_ID,
        parentAgentId: null,
        model: model.name,
        providerModel: model.model,
        systemPrompt: this.systemPrompt,
        instruction,
        provider,
        tools: this.toolMap,
        toolContext: this.buildToolContext(ROOT_AGENT_ID),
        registerSendMessage: (fn) => {
          this.rootSendMessage = fn;
        },
        signal: this.rootController.signal,
        interactive: this.interactive,
        client: this.client,
        ...(this.config.options.maxTurns !== undefined
          ? { maxTurns: this.config.options.maxTurns }
          : {}),
        ...pricingOverride(model),
        onEvent: (event) => {
          // Round 5: keep rootStatus (what getAgentTree() reads) in sync with the loop's own
          // mid-conversation waiting/running transitions, the same way spawnAgent() keeps the
          // task registry in sync for sub-agents — runRoot() isn't a TaskRegistry entry, so it
          // needs the same bookkeeping done by hand here.
          if (event.type === "agent_status" && event.agentId === ROOT_AGENT_ID) {
            this.rootStatus = event.status;
          }
          this.onEvent?.(event);
        },
        ...(this.onLogLine
          ? { onLogLine: (line: LogLine) => this.onLogLine?.(ROOT_AGENT_ID, line) }
          : {}),
      });
    } catch (err) {
      this.rootStatus = "failed";
      this.onEvent?.({
        version: 1,
        id: randomUUID(),
        timestamp: new Date().toISOString(),
        type: "session_ended",
        exitCode: ExitCode.HarnessError,
      });
      throw err;
    }

    this.rootStatus = result.success ? "done" : "failed";
    this.onEvent?.({
      version: 1,
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      type: "session_ended",
      exitCode: result.success ? ExitCode.Success : ExitCode.TaskFailure,
    });
    return { success: result.success, finalOutput: result.finalOutput };
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

    const delivered = this.tryDeliverToAgent(snapshot.parentAgentId, message);

    this.onLogLine?.(snapshot.id, {
      version: 1,
      timestamp: new Date().toISOString(),
      type: "message",
      role: "system",
      content: delivered
        ? `Completion notification delivered live to parent agent ${snapshot.parentAgentId}.`
        : `Completion notification could NOT be delivered live (parent agent ${snapshot.parentAgentId} is not currently running/waiting — orphaned or already finished) — recorded here only, not lost: ${message}`,
    });
  }

  /** Attempts live delivery of a completion notification into `agentId`'s currently-running
   * conversation. Returns whether it actually reached a live listener (a genuinely
   * running/waiting loop), as opposed to a stale or never-registered `sendMessage` sink —
   * both the root's and a sub-agent task's own `sendMessage` closures remain set after their
   * loop has already returned (nothing clears them), so a status check is required in
   * addition to "is a sink registered at all" to tell a live delivery from a message pushed
   * into a dead, already-abandoned queue nobody will ever drain. */
  private tryDeliverToAgent(agentId: string, message: string): boolean {
    if (agentId === ROOT_AGENT_ID) {
      if (this.rootStarted && this.rootSendMessage && this.isLiveStatus(this.rootStatus)) {
        this.rootSendMessage(message);
        return true;
      }
      return false;
    }

    const parentSnapshot = this.tasks.trySnapshot(agentId);
    if (!parentSnapshot || !this.isLiveStatus(parentSnapshot.status)) {
      return false;
    }
    try {
      this.tasks.sendMessage(agentId, message);
      return true;
    } catch {
      return false;
    }
  }

  private isLiveStatus(status: AgentStatus): boolean {
    return status === "running" || status === "waiting";
  }
}
